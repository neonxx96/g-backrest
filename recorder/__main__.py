from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from .config import load_config
from .service import RecorderService


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m recorder")
    parser.add_argument("command", choices=("run", "status"))
    parser.add_argument("--config", type=Path, default=Path("recorder.yaml"))
    args = parser.parse_args()
    config = load_config(args.config)
    service = RecorderService(lake_root=config.lake_root, spool_root=config.lake_root.parent / "spool", node_id=config.node_id)
    if args.command == "status":
        print(json.dumps(service.status(), indent=2))
        service.close()
        return 0
    url = config.binance_ws_url or service.build_binance_url(config.tier1_symbols)
    try:
        asyncio.run(service.run_forever(url))
    except KeyboardInterrupt:
        service.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
