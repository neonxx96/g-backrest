"""Truth-first Binance Vision ingestion and aggregate-trade footprints.

The module keeps Binance Vision archives, live recorder data, and derived
research data separate.  A footprint is only populated from aggTrades; OHLCV
is never used as a proxy for POC or footprint delta.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal, ROUND_FLOOR
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
import requests

logger = logging.getLogger(__name__)

VISION_ROOT = "https://data.binance.vision/data/futures/um/monthly"
BASE_DIR = Path(__file__).resolve().parents[2]
RESEARCH_ROOT = BASE_DIR / "data" / "research"
MANIFEST_PATH = RESEARCH_ROOT / "manifest.json"

FOOTPRINT_COLUMNS = [
    "timestamp",
    "volume",
    "buy_volume",
    "sell_volume",
    "volume_delta",
    "poc_price",
    "imbalance",
    "stacked_imbalance",
    "cluster_profile",
]


def _empty_footprint() -> pd.DataFrame:
    return pd.DataFrame(columns=FOOTPRINT_COLUMNS)


def _bucket_timestamp(timestamp: pd.Series, timeframe: str) -> pd.Series:
    minutes = {
        "1m": 1, "1min": 1, "5m": 5, "5min": 5, "15m": 15, "15min": 15,
        "1h": 60, "4h": 240,
    }.get(timeframe)
    if minutes is None:
        raise ValueError(f"Unsupported footprint timeframe: {timeframe}")
    interval_ms = minutes * 60_000
    values = pd.to_numeric(timestamp, errors="raise").astype("int64")
    return (values // interval_ms) * interval_ms


def _price_key(price: float) -> str:
    key = f"{price:.10f}".rstrip("0").rstrip(".")
    return key if "." in key else f"{key}.0"


def _normalise_side(value: Any) -> bool:
    """Return True when the buyer was maker, i.e. this is sell aggression."""
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"true", "1", "yes"}


def _canonical_column(value: Any) -> str:
    return "".join(character for character in str(value).lower() if character.isalnum())


def _find_column(frame: pd.DataFrame, *names: str) -> str:
    columns = {_canonical_column(column): column for column in frame.columns}
    for name in names:
        matched = columns.get(_canonical_column(name))
        if matched is not None:
            return matched
    raise ValueError(f"Unexpected archive columns: {list(frame.columns)}")


def _summarise_profile(levels: dict[float, dict[str, float]], imbalance_ratio: float = 3.0) -> dict[str, Any]:
    if not levels:
        return {
            "volume": 0.0,
            "buy_volume": 0.0,
            "sell_volume": 0.0,
            "volume_delta": 0.0,
            "poc_price": None,
            "imbalance": 0.0,
            "stacked_imbalance": 0,
            "cluster_profile": "",
        }

    ordered = sorted(levels.items())
    total_buy = sum(level["buy_volume"] for _, level in ordered)
    total_sell = sum(level["sell_volume"] for _, level in ordered)
    total_volume = total_buy + total_sell
    poc_price = min(
        (price for price, level in ordered if level["buy_volume"] + level["sell_volume"] == max(item["buy_volume"] + item["sell_volume"] for _, item in ordered)),
        default=None,
    )
    max_level_delta = max(abs(level["buy_volume"] - level["sell_volume"]) for _, level in ordered)
    longest_streak = streak = 0
    previous_direction: int | None = None
    profile: dict[str, dict[str, float]] = {}
    for price, level in ordered:
        buy, sell = level["buy_volume"], level["sell_volume"]
        if buy >= max(sell, 1e-12) * imbalance_ratio:
            direction = 1
        elif sell >= max(buy, 1e-12) * imbalance_ratio:
            direction = -1
        else:
            direction = 0
        streak = streak + 1 if direction and direction == previous_direction else (1 if direction else 0)
        previous_direction = direction
        longest_streak = max(longest_streak, streak)
        profile[_price_key(price)] = {
            "buy_volume": round(buy, 12),
            "sell_volume": round(sell, 12),
            "delta": round(buy - sell, 12),
        }
    return {
        "volume": total_volume,
        "buy_volume": total_buy,
        "sell_volume": total_sell,
        "volume_delta": total_buy - total_sell,
        "poc_price": poc_price,
        "imbalance": max_level_delta / total_volume if total_volume else 0.0,
        "stacked_imbalance": longest_streak,
        "cluster_profile": json.dumps(profile, separators=(",", ":"), sort_keys=True),
    }


def build_footprint_1m(agg_trades: pd.DataFrame, tick_size: float = 0.1) -> pd.DataFrame:
    """Build exact one-minute profiles from Binance aggregate trades."""
    if agg_trades.empty:
        return _empty_footprint()
    required = {"timestamp", "price", "quantity", "is_buyer_maker"}
    missing = required.difference(agg_trades.columns)
    if missing:
        raise ValueError(f"aggTrades missing required columns: {sorted(missing)}")
    if tick_size <= 0:
        raise ValueError("tick_size must be positive")

    frame = agg_trades.loc[:, list(required)].copy()
    frame["timestamp"] = pd.to_numeric(frame["timestamp"], errors="coerce").astype("Int64")
    frame["price"] = pd.to_numeric(frame["price"], errors="coerce")
    frame["quantity"] = pd.to_numeric(frame["quantity"], errors="coerce")
    frame = frame.dropna(subset=["timestamp", "price", "quantity"])
    frame = frame[frame["quantity"] > 0]
    if frame.empty:
        return _empty_footprint()
    frame["minute"] = _bucket_timestamp(frame["timestamp"].astype("int64"), "1min")
    tick = Decimal(str(tick_size))
    frame["price_level"] = frame["price"].map(
        lambda price: float((Decimal(str(price)) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick)
    )
    maker_is_buyer = frame["is_buyer_maker"].map(_normalise_side)
    frame["buy_volume"] = frame["quantity"].where(~maker_is_buyer, 0.0)
    frame["sell_volume"] = frame["quantity"].where(maker_is_buyer, 0.0)
    levels_frame = (
        frame.groupby(["minute", "price_level"], sort=True, as_index=False)[["buy_volume", "sell_volume"]]
        .sum()
    )
    return _profiles_from_levels(levels_frame)


def _profiles_from_levels(levels_frame: pd.DataFrame) -> pd.DataFrame:
    """Summarise normalised ``minute × price`` rows without OHLC proxies."""
    if levels_frame.empty:
        return _empty_footprint()
    levels_frame = levels_frame.copy()
    levels_frame["minute"] = pd.to_numeric(levels_frame["minute"], errors="raise").astype("int64")
    levels_frame["price_level"] = pd.to_numeric(levels_frame["price_level"], errors="raise")
    levels_frame["buy_volume"] = pd.to_numeric(levels_frame["buy_volume"], errors="raise")
    levels_frame["sell_volume"] = pd.to_numeric(levels_frame["sell_volume"], errors="raise")
    levels_frame["volume"] = levels_frame["buy_volume"] + levels_frame["sell_volume"]
    levels_frame["delta"] = levels_frame["buy_volume"] - levels_frame["sell_volume"]
    minute_totals = levels_frame.groupby("minute", sort=True).agg(
        volume=("volume", "sum"),
        buy_volume=("buy_volume", "sum"),
        sell_volume=("sell_volume", "sum"),
        max_level_delta=("delta", lambda values: values.abs().max()),
    )
    minute_totals["volume_delta"] = minute_totals["buy_volume"] - minute_totals["sell_volume"]
    minute_totals["imbalance"] = minute_totals["max_level_delta"] / minute_totals["volume"]
    poc = (
        levels_frame.sort_values(["minute", "volume", "price_level"], ascending=[True, False, True])
        .drop_duplicates("minute")
        .set_index("minute")["price_level"]
    )
    minute_totals["poc_price"] = poc

    def profile_json(group: pd.DataFrame) -> str:
        profile = group.set_index("price_level")[["buy_volume", "sell_volume", "delta"]]
        return profile.to_json(orient="index", double_precision=12)

    minute_totals["cluster_profile"] = levels_frame.groupby("minute", sort=True).apply(
        profile_json, include_groups=False
    )
    direction = pd.Series(0, index=levels_frame.index, dtype="int8")
    direction.loc[levels_frame["buy_volume"] >= levels_frame["sell_volume"].clip(lower=1e-12) * 3.0] = 1
    direction.loc[levels_frame["sell_volume"] >= levels_frame["buy_volume"].clip(lower=1e-12) * 3.0] = -1
    levels_frame["direction"] = direction

    def longest_streak(group: pd.DataFrame) -> int:
        longest = current = 0
        previous = 0
        for value in group.sort_values("price_level")["direction"]:
            current = current + 1 if value and value == previous else (1 if value else 0)
            previous = value
            longest = max(longest, current)
        return longest

    minute_totals["stacked_imbalance"] = levels_frame.groupby("minute", sort=True).apply(
        longest_streak, include_groups=False
    )
    result = minute_totals.reset_index().rename(columns={"minute": "timestamp"})
    return result.loc[:, FOOTPRINT_COLUMNS]


def build_price_levels_1m(agg_trades: pd.DataFrame, tick_size: float = 0.1) -> pd.DataFrame:
    """Persistable 1m price-level table used to aggregate higher timeframes."""
    if agg_trades.empty:
        return pd.DataFrame(columns=["minute", "price_level", "buy_volume", "sell_volume"])
    required = {"timestamp", "price", "quantity", "is_buyer_maker"}
    missing = required.difference(agg_trades.columns)
    if missing:
        raise ValueError(f"aggTrades missing required columns: {sorted(missing)}")
    if tick_size <= 0:
        raise ValueError("tick_size must be positive")
    frame = agg_trades.loc[:, list(required)].copy()
    frame["timestamp"] = pd.to_numeric(frame["timestamp"], errors="coerce").astype("Int64")
    frame["price"] = pd.to_numeric(frame["price"], errors="coerce")
    frame["quantity"] = pd.to_numeric(frame["quantity"], errors="coerce")
    frame = frame.dropna(subset=["timestamp", "price", "quantity"])
    frame = frame[frame["quantity"] > 0]
    if frame.empty:
        return pd.DataFrame(columns=["minute", "price_level", "buy_volume", "sell_volume"])
    frame["minute"] = _bucket_timestamp(frame["timestamp"].astype("int64"), "1min")
    tick = Decimal(str(tick_size))
    frame["price_level"] = frame["price"].map(
        lambda price: float((Decimal(str(price)) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick)
    )
    maker_is_buyer = frame["is_buyer_maker"].map(_normalise_side)
    frame["buy_volume"] = frame["quantity"].where(~maker_is_buyer, 0.0)
    frame["sell_volume"] = frame["quantity"].where(maker_is_buyer, 0.0)
    return (
        frame.groupby(["minute", "price_level"], sort=True, as_index=False)[["buy_volume", "sell_volume"]]
        .sum()
    )


def aggregate_price_levels(levels: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """Aggregate 1m price-level rows into a higher-timeframe profile."""
    if levels.empty:
        return _empty_footprint()
    frame = levels.copy()
    frame["minute"] = _bucket_timestamp(frame["minute"], timeframe)
    frame = frame.groupby(["minute", "price_level"], sort=True, as_index=False)[["buy_volume", "sell_volume"]].sum()
    return _profiles_from_levels(frame)


def aggregate_footprints(minute_footprints: pd.DataFrame, timeframe: str) -> pd.DataFrame:
    """Aggregate 1m cluster profiles; never derive a profile from OHLCV."""
    if minute_footprints.empty:
        return _empty_footprint()
    required = {"timestamp", "cluster_profile"}
    if required.difference(minute_footprints.columns):
        raise ValueError("minute footprints need timestamp and cluster_profile")
    frame = minute_footprints.loc[:, ["timestamp", "cluster_profile"]].copy()
    frame["bucket"] = _bucket_timestamp(pd.to_numeric(frame["timestamp"]), timeframe)
    records: list[dict[str, Any]] = []
    for bucket, group in frame.groupby("bucket", sort=True):
        levels: dict[float, dict[str, float]] = defaultdict(lambda: {"buy_volume": 0.0, "sell_volume": 0.0})
        for profile_json in group["cluster_profile"]:
            if not profile_json or profile_json == "{}":
                continue
            for raw_price, values in json.loads(profile_json).items():
                level = levels[float(raw_price)]
                level["buy_volume"] += float(values.get("buy_volume", 0.0))
                level["sell_volume"] += float(values.get("sell_volume", 0.0))
        records.append({"timestamp": int(bucket), **_summarise_profile(levels)})
    return pd.DataFrame(records, columns=FOOTPRINT_COLUMNS)


@dataclass(frozen=True)
class ArchiveSpec:
    dataset: str
    url: str


class BinanceVisionIngestor:
    """Downloads one monthly archive at a time and writes date partitions."""

    def __init__(self, root: Path = RESEARCH_ROOT, session: requests.Session | None = None) -> None:
        self.root = Path(root)
        self.session = session or requests.Session()
        self.tmp_root = self.root / ".downloads"

    @staticmethod
    def monthly_specs(symbol: str, year: int, month: int) -> list[ArchiveSpec]:
        stamp = f"{year}-{month:02d}"
        return [
            ArchiveSpec("klines_1m", f"{VISION_ROOT}/klines/{symbol}/1m/{symbol}-1m-{stamp}.zip"),
            ArchiveSpec("agg_trades", f"{VISION_ROOT}/aggTrades/{symbol}/{symbol}-aggTrades-{stamp}.zip"),
            ArchiveSpec("funding_rate", f"{VISION_ROOT}/fundingRate/{symbol}/{symbol}-fundingRate-{stamp}.zip"),
        ]

    def estimate_month(self, symbol: str, year: int, month: int) -> list[dict[str, Any]]:
        result = []
        for spec in self.monthly_specs(symbol, year, month):
            response = self.session.head(spec.url, timeout=30)
            response.raise_for_status()
            result.append({
                "dataset": spec.dataset,
                "url": spec.url,
                "bytes": int(response.headers["Content-Length"]),
                "last_modified": response.headers.get("Last-Modified"),
            })
        return result

    def _download_verified(self, spec: ArchiveSpec) -> tuple[Path, str]:
        self.tmp_root.mkdir(parents=True, exist_ok=True)
        destination = self.tmp_root / Path(spec.url).name
        response = self.session.get(spec.url, stream=True, timeout=60)
        response.raise_for_status()
        digest = hashlib.sha256()
        with destination.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
                    digest.update(chunk)
        checksum_response = self.session.get(f"{spec.url}.CHECKSUM", timeout=30)
        checksum_response.raise_for_status()
        expected = checksum_response.text.strip().split()[0]
        actual = digest.hexdigest()
        if expected.lower() != actual.lower():
            destination.unlink(missing_ok=True)
            raise ValueError(f"Checksum mismatch for {spec.url}: {actual} != {expected}")
        return destination, actual

    @staticmethod
    def _normalise_agg_chunk(chunk: pd.DataFrame) -> pd.DataFrame:
        return pd.DataFrame({
            "aggregate_trade_id": chunk[_find_column(chunk, "aggregate trade id", "aggregate_trade_id", "agg_trade_id", "a")],
            "price": chunk[_find_column(chunk, "price", "p")],
            "quantity": chunk[_find_column(chunk, "quantity", "q")],
            "timestamp": chunk[_find_column(chunk, "timestamp", "transact time", "transact_time", "t")],
            "is_buyer_maker": chunk[_find_column(chunk, "was the buyer the maker", "is_buyer_maker", "isBuyerMaker", "m")],
        })

    def _partition_path(self, symbol: str, dataset: str, day: str) -> Path:
        return self.root / symbol / dataset / f"date={day}" / "part-000.parquet"

    def _write_partition(self, frame: pd.DataFrame, symbol: str, dataset: str, day: str) -> None:
        if frame.empty:
            return
        destination = self._partition_path(symbol, dataset, day)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            current = pd.read_parquet(destination)
            frame = pd.concat([current, frame], ignore_index=True)
        dedupe_key = "aggregate_trade_id" if "aggregate_trade_id" in frame.columns else None
        frame.drop_duplicates(subset=dedupe_key).sort_values("timestamp").to_parquet(destination, index=False, compression="snappy")

    def _process_agg_trades(self, archive: Path, symbol: str) -> int:
        rows = 0
        chunk_index = 0
        source_stamp = archive.stem.replace(".zip", "")
        with zipfile.ZipFile(archive) as zipped:
            csv_name = next(name for name in zipped.namelist() if name.endswith(".csv"))
            with zipped.open(csv_name) as handle:
                for chunk in pd.read_csv(handle, chunksize=500_000):
                    normalised = self._normalise_agg_chunk(chunk)
                    normalised["timestamp"] = pd.to_numeric(normalised["timestamp"], errors="coerce")
                    normalised = normalised.dropna(subset=["timestamp"])
                    normalised["timestamp"] = normalised["timestamp"].astype("int64")
                    normalised["date"] = pd.to_datetime(normalised["timestamp"], unit="ms", utc=True).dt.strftime("%Y-%m-%d")
                    for day, daily in normalised.groupby("date", sort=False):
                        destination = (
                            self.root / symbol / "agg_trades" / f"date={day}"
                            / f"{source_stamp}-chunk-{chunk_index:05d}.parquet"
                        )
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        # A completed chunk is immutable.  Its deterministic
                        # name makes reruns resume safely without rewriting
                        # any recorder or previously ingested source data.
                        if not destination.exists():
                            daily.drop(columns="date").to_parquet(destination, index=False, compression="snappy")
                    chunk_index += 1
                    rows += len(normalised)
                    if chunk_index % 20 == 0:
                        print(f"[ingest] aggTrades chunks={chunk_index} rows={rows}", flush=True)
        return rows

    def _process_small_csv(self, archive: Path, symbol: str, dataset: str) -> int:
        with zipfile.ZipFile(archive) as zipped:
            csv_name = next(name for name in zipped.namelist() if name.endswith(".csv"))
            with zipped.open(csv_name) as handle:
                frame = pd.read_csv(handle)
        try:
            timestamp_col = _find_column(
                frame, "open time", "funding time", "timestamp", "funding_time", "calc_time"
            )
        except ValueError as error:
            raise ValueError(f"No timestamp column in {dataset}: {list(frame.columns)}") from error
        frame["timestamp"] = pd.to_numeric(frame[timestamp_col], errors="coerce")
        frame = frame.dropna(subset=["timestamp"])
        frame["timestamp"] = frame["timestamp"].astype("int64")
        frame["date"] = pd.to_datetime(frame["timestamp"], unit="ms", utc=True).dt.strftime("%Y-%m-%d")
        for day, daily in frame.groupby("date", sort=False):
            self._write_partition(daily.drop(columns="date"), symbol, dataset, day)
        return len(frame)

    def _build_footprints(self, symbol: str, tick_size: float) -> dict[str, int]:
        daily_paths = sorted((self.root / symbol / "agg_trades").glob("date=*"))
        counts: dict[str, int] = {"footprint_truth_1m": 0}
        for day_dir in daily_paths:
            day = day_dir.name.split("=", 1)[1]
            minute_output = self._partition_path(symbol, "footprint_truth_1m", day)
            levels_output = self._partition_path(symbol, "footprint_truth_levels_1m", day)
            levels: pd.DataFrame
            if levels_output.exists():
                levels = pd.read_parquet(levels_output)
            else:
                paths = sorted(day_dir.glob("*.parquet"))
                if not paths:
                    continue
                daily_trades = pd.concat([pd.read_parquet(path) for path in paths], ignore_index=True)
                if "aggregate_trade_id" in daily_trades:
                    daily_trades = daily_trades.drop_duplicates(subset="aggregate_trade_id")
                levels = build_price_levels_1m(daily_trades, tick_size=tick_size)
                self._write_partition(levels, symbol, "footprint_truth_levels_1m", day)
            if minute_output.exists():
                minute = pd.read_parquet(minute_output)
            else:
                minute = _profiles_from_levels(levels)
                self._write_partition(minute, symbol, "footprint_truth_1m", day)
                print(f"[ingest] footprint day={day} minutes={len(minute)}", flush=True)
            counts["footprint_truth_1m"] += len(minute)
        if not counts["footprint_truth_1m"]:
            return {"footprint_1m": 0}
        for timeframe in ("5min", "15min", "1h", "4h"):
            aggregated = aggregate_footprints(all_minutes, timeframe)
            dataset = f"footprint_truth_{timeframe}"
            counts[dataset] = 0
            for day_dir in daily_paths:
                day = day_dir.name.split("=", 1)[1]
                output = self._partition_path(symbol, dataset, day)
                if output.exists():
                    counts[dataset] += len(pd.read_parquet(output, columns=["timestamp"]))
                    continue
                levels = pd.read_parquet(self._partition_path(symbol, "footprint_truth_levels_1m", day))
                aggregated = aggregate_price_levels(levels, timeframe)
                self._write_partition(aggregated, symbol, dataset, day)
                counts[dataset] += len(aggregated)
        return counts

    def ingest_month(self, symbol: str, year: int, month: int, tick_size: float = 0.1) -> dict[str, Any]:
        symbol = symbol.upper()
        datasets: dict[str, Any] = {}
        for spec in self.monthly_specs(symbol, year, month):
            archive, checksum = self._download_verified(spec)
            try:
                if spec.dataset == "agg_trades":
                    records = self._process_agg_trades(archive, symbol)
                else:
                    records = self._process_small_csv(archive, symbol, spec.dataset)
                datasets[spec.dataset] = {"records": records, "checksum_sha256": checksum, "status": "verified"}
            finally:
                archive.unlink(missing_ok=True)
        datasets.update(self._build_footprints(symbol, tick_size))
        return {"symbol": symbol, "month": f"{year}-{month:02d}", "datasets": datasets}

    def ingest_funding_month(self, symbol: str, year: int, month: int) -> dict[str, Any]:
        symbol = symbol.upper()
        spec = next(item for item in self.monthly_specs(symbol, year, month) if item.dataset == "funding_rate")
        archive, checksum = self._download_verified(spec)
        try:
            records = self._process_small_csv(archive, symbol, spec.dataset)
        finally:
            archive.unlink(missing_ok=True)
        return {"symbol": symbol, "month": f"{year}-{month:02d}", "datasets": {"funding_rate": {
            "records": records, "checksum_sha256": checksum, "status": "verified"
        }}}


def write_manifest(root: Path = RESEARCH_ROOT, recorder_root: Path | None = None) -> Path:
    """Write a transparent availability manifest. Historical L2 is always absent."""
    root = Path(root)
    recorder_root = recorder_root or (BASE_DIR.parent / "data")
    payload: dict[str, Any] = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "storage": "Parquet daily partitions",
        "symbols": {},
    }
    for symbol_dir in sorted(path for path in root.iterdir() if path.is_dir() and not path.name.startswith(".")) if root.exists() else []:
        datasets: dict[str, Any] = {}
        for dataset_dir in sorted(path for path in symbol_dir.iterdir() if path.is_dir()):
            parts = sorted(dataset_dir.glob("date=*/*.parquet"))
            if not parts:
                continue
            total = 0
            dates: list[str] = []
            for part in parts:
                total += len(pd.read_parquet(part, columns=["timestamp"]))
                dates.append(part.parent.name.split("=", 1)[1])
            datasets[dataset_dir.name] = {
                "source": "Binance Vision USD-M Futures",
                "records": total,
                "period": {"from": min(dates), "to": max(dates)},
                "checksum": "verified during ingest",
                "gaps": "not yet audited",
            }
        datasets["historical_l2"] = {"source": None, "status": "No data (forward recorder only)"}
        payload["symbols"][symbol_dir.name] = datasets
    root.mkdir(parents=True, exist_ok=True)
    manifest = root / "manifest.json"
    manifest.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return manifest
