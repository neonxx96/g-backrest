from __future__ import annotations

import argparse
import asyncio
import logging
import json
from pathlib import Path

from .config import load_config
from .service import RecorderService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m recorder")
    parser.add_argument("command", choices=("run", "status", "manifest"))
    parser.add_argument("--config", type=Path, default=Path("recorder.yaml"))
    args = parser.parse_args()
    config = load_config(args.config)
    service = RecorderService(lake_root=config.lake_root, spool_root=config.lake_root.parent / "spool", node_id=config.node_id, max_storage_gib=config.max_storage_gib)
    if args.command == "status":
        print(json.dumps(service.status(), indent=2))
        service.close()
        return 0
    if args.command == "manifest":
        from .manifest import write_data_manifest
        output = write_data_manifest(config.lake_root)
        print(json.dumps({"manifest": str(output)}, indent=2))
        service.close()
        return 0
    url = config.binance_ws_url or service.build_binance_url(
        RecorderService.merged_symbols(config.tier1_symbols, RecorderService.load_watchlist_symbols(config.watchlist_file))
    )
    try:
        asyncio.run(service.run_forever(
            url,
            watchlist_path=config.watchlist_file or None,
            base_symbols=config.tier1_symbols,
        ))
    except KeyboardInterrupt:
        service.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
