"""Ingest one verified Binance Vision month into truth-first Parquet partitions."""

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.services.deep_history import BinanceVisionIngestor, write_manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="BTCUSDT")
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--month", type=int, required=True)
    parser.add_argument("--tick-size", type=float, default=0.1)
    parser.add_argument("--estimate-only", action="store_true")
    parser.add_argument("--build-footprints-only", action="store_true")
    parser.add_argument("--funding-only", action="store_true")
    args = parser.parse_args()
    ingestor = BinanceVisionIngestor()
    if args.estimate_only:
        print(json.dumps(ingestor.estimate_month(args.symbol.upper(), args.year, args.month), indent=2))
        return
    if args.build_footprints_only:
        print(json.dumps(ingestor._build_footprints(args.symbol.upper(), args.tick_size), indent=2))
        print(f"manifest: {write_manifest()}")
        return
    if args.funding_only:
        print(json.dumps(ingestor.ingest_funding_month(args.symbol, args.year, args.month), indent=2))
        print(f"manifest: {write_manifest()}")
        return
    print(json.dumps(ingestor.ingest_month(args.symbol, args.year, args.month, args.tick_size), indent=2))
    print(f"manifest: {write_manifest()}")


if __name__ == "__main__":
    main()
