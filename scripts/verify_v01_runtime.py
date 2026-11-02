"""Measure v0.1 recorder continuity and backend responsiveness under live load."""

from __future__ import annotations

import argparse
import json
import math
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import urlopen


FIVE_MINUTES_MS = 5 * 60 * 1000


def summarize_health(seconds: list[float]) -> dict[str, float | int | None]:
    if not seconds:
        return {"samples": 0, "median_ms": None, "p95_ms": None, "max_ms": None}
    ordered = sorted(float(value) * 1000.0 for value in seconds)
    p95_index = max(0, math.ceil(0.95 * len(ordered)) - 1)
    return {
        "samples": len(ordered),
        "median_ms": round(statistics.median(ordered), 1),
        "p95_ms": round(ordered[p95_index], 1),
        "max_ms": round(ordered[-1], 1),
    }


def analyze_cluster_observations(observations: list[dict[str, Any]]) -> dict[str, Any]:
    timestamps: set[int] = set()
    previous_volumes: dict[int, float] = {}
    growth_events = 0

    for observation in observations:
        for candle in observation.get("candles", []):
            timestamp = int(candle["timestamp"])
            volume = float(candle.get("total_volume", 0.0))
            timestamps.add(timestamp)
            previous = previous_volumes.get(timestamp)
            if previous is not None and volume > previous:
                growth_events += 1
            previous_volumes[timestamp] = volume

    ordered = sorted(timestamps)
    missing: list[int] = []
    if len(ordered) >= 2:
        expected = range(ordered[0], ordered[-1] + FIVE_MINUTES_MS, FIVE_MINUTES_MS)
        missing = [timestamp for timestamp in expected if timestamp not in timestamps]

    return {
        "observations": len(observations),
        "candle_timestamps": ordered,
        "missing_timestamps": missing,
        "forming_volume_grew": growth_events > 0,
        "volume_growth_events": growth_events,
    }


def _fetch_json(url: str, timeout: float) -> Any:
    with urlopen(url, timeout=timeout) as response:
        return json.load(response)


def run_probe(args: argparse.Namespace) -> dict[str, Any]:
    started_at = datetime.now(timezone.utc)
    started = time.monotonic()
    health_deadline = started + args.health_duration_seconds
    cluster_deadline = started + args.cluster_duration_seconds
    finish_at = max(health_deadline, cluster_deadline)
    next_health = started
    next_cluster = started
    health_seconds: list[float] = []
    health_errors: list[str] = []
    cluster_observations: list[dict[str, Any]] = []
    cluster_errors: list[str] = []

    while time.monotonic() < finish_at:
        now = time.monotonic()
        if now >= next_health and now < health_deadline:
            request_started = time.monotonic()
            try:
                _fetch_json(f"{args.base_url}/health", args.request_timeout_seconds)
                health_seconds.append(time.monotonic() - request_started)
            except Exception as exc:  # evidence records the concrete transport error
                health_errors.append(f"{type(exc).__name__}: {exc}")
            next_health += args.health_interval_seconds

        now = time.monotonic()
        if now >= next_cluster and now < cluster_deadline:
            try:
                candles = _fetch_json(
                    f"{args.base_url}/api/recorder/clusters?symbol=BTCUSDT&limit=100&scale=1",
                    args.request_timeout_seconds,
                )
                cluster_observations.append(
                    {
                        "observed_at": datetime.now(timezone.utc).isoformat(),
                        "candles": candles,
                    }
                )
            except Exception as exc:
                cluster_errors.append(f"{type(exc).__name__}: {exc}")
            next_cluster += args.cluster_interval_seconds

        time.sleep(0.1)

    health = summarize_health(health_seconds)
    clusters = analyze_cluster_observations(cluster_observations)
    report = {
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "base_url": args.base_url,
        "health": {
            **health,
            "errors": health_errors,
            "acceptance_passed": (
                not health_errors
                and health["median_ms"] is not None
                and health["median_ms"] < 300.0
                and health["p95_ms"] < 800.0
            ),
        },
        "clusters": {
            **clusters,
            "errors": cluster_errors,
            "acceptance_passed": (
                not cluster_errors
                and not clusters["missing_timestamps"]
                and clusters["forming_volume_grew"]
            ),
        },
    }
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--health-duration-seconds", type=float, default=600.0)
    parser.add_argument("--cluster-duration-seconds", type=float, default=1800.0)
    parser.add_argument("--health-interval-seconds", type=float, default=2.0)
    parser.add_argument("--cluster-interval-seconds", type=float, default=10.0)
    parser.add_argument("--request-timeout-seconds", type=float, default=10.0)
    parser.add_argument("--output", type=Path, default=Path("logs/v01-runtime-verification.json"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = run_probe(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["health"]["acceptance_passed"] and report["clusters"]["acceptance_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

