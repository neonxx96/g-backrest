import json
from pathlib import Path

from recorder.events import normalize_agg_trade
from recorder.gaps import GapJournal
from recorder.manifest import build_data_manifest, write_data_manifest
from recorder.storage import LakeWriter


def _event(ts_ms: int, trade_id: int) -> dict:
    return normalize_agg_trade(
        {"e": "aggTrade", "s": "BTCUSDT", "a": trade_id, "p": "100.0", "q": "1", "f": trade_id, "l": trade_id, "T": ts_ms, "m": False},
        node_id="node-a",
        session_id="session-a",
        recv_ts_ns=1,
        recv_mono_ns=2,
    )


def test_build_data_manifest_aggregates_ranges_types_and_gaps(tmp_path: Path):
    writer = LakeWriter(tmp_path / "lake", node_id="node-a", session_id="session-a")
    writer.close_segment("trades", [_event(1_700_000_000_000, 1), _event(1_700_000_060_000, 2)], sequence=1)
    writer.close_segment("trades", [_event(1_700_000_120_000, 3)], sequence=2)

    gaps = GapJournal(tmp_path / "gaps" / "node-a.jsonl")
    gaps.record(exchange="binance", market="usd-m", symbol="BTCUSDT", stream="trades", gap_start_ts=1000, gap_end_ts=2000, reason="disconnect", node_id="node-a")

    manifest = build_data_manifest(tmp_path / "lake", generated_at_ms=1_700_000_999_000)

    assert manifest["manifest_version"] == 1
    assert manifest["generated_at_ms"] == 1_700_000_999_000
    assert manifest["dataset_count"] == 1

    dataset = manifest["datasets"][0]
    assert (dataset["exchange"], dataset["market"], dataset["symbol"], dataset["stream"]) == ("binance", "usd-m", "BTCUSDT", "trades")
    assert dataset["row_count"] == 3
    assert dataset["segment_count"] == 2
    assert dataset["min_exch_ts_ms"] == 1_700_000_000_000
    assert dataset["max_exch_ts_ms"] == 1_700_000_120_000
    assert dataset["dates"] == ["2023-11-14"]
    assert dataset["gap_count"] == 1
    assert dataset["gaps"][0]["reason"] == "disconnect"
    assert all(seg["sha256"] for seg in dataset["segments"])


def test_write_data_manifest_is_atomic_and_machine_readable(tmp_path: Path):
    writer = LakeWriter(tmp_path / "lake", node_id="node-a", session_id="session-a")
    writer.close_segment("trades", [_event(1_700_000_000_000, 1)], sequence=1)

    output = write_data_manifest(tmp_path / "lake")

    assert output.name == "data_manifest.json"
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["dataset_count"] == 1
    assert not output.with_suffix(".json.tmp").exists()


def test_build_data_manifest_handles_empty_lake(tmp_path: Path):
    manifest = build_data_manifest(tmp_path / "lake")

    assert manifest["dataset_count"] == 0
    assert manifest["datasets"] == []
