from __future__ import annotations

import time
from typing import Any


def normalize_agg_trade(
    message: dict[str, Any],
    *,
    node_id: str,
    session_id: str,
    recv_ts_ns: int | None = None,
    recv_mono_ns: int | None = None,
    schema_version: int = 1,
) -> dict[str, Any]:
    """Convert a Binance USD-M aggTrade payload into the canonical envelope."""
    event_ts = int(message["T"])
    is_buyer_maker = bool(message["m"])
    return {
        "exchange": "binance",
        "market": "usd-m",
        "symbol": str(message["s"]).upper(),
        "stream": "trades",
        "exch_ts_ms": event_ts,
        "recv_ts_ns": time.time_ns() if recv_ts_ns is None else int(recv_ts_ns),
        "recv_mono_ns": time.monotonic_ns() if recv_mono_ns is None else int(recv_mono_ns),
        "node_id": node_id,
        "session_id": session_id,
        "schema_version": schema_version,
        "trade_id": int(message["a"]),
        "price": float(message["p"]),
        "quantity": float(message["q"]),
        "aggressor_side": "SELL" if is_buyer_maker else "BUY",
        "first_trade_id": int(message["f"]),
        "last_trade_id": int(message["l"]),
    }


def _envelope(message: dict[str, Any], *, stream: str, node_id: str, session_id: str, recv_ts_ns: int | None, recv_mono_ns: int | None, schema_version: int) -> dict[str, Any]:
    return {
        "exchange": "binance", "market": "usd-m", "symbol": str(message.get("s", "")).upper(),
        "stream": stream, "exch_ts_ms": int(message.get("E", 0)),
        "recv_ts_ns": time.time_ns() if recv_ts_ns is None else int(recv_ts_ns),
        "recv_mono_ns": time.monotonic_ns() if recv_mono_ns is None else int(recv_mono_ns),
        "node_id": node_id, "session_id": session_id, "schema_version": schema_version,
    }


def normalize_message(message: dict[str, Any], *, stream: str, node_id: str, session_id: str, recv_ts_ns: int | None = None, recv_mono_ns: int | None = None, schema_version: int = 1) -> dict[str, Any]:
    if stream == "trades":
        return normalize_agg_trade(message, node_id=node_id, session_id=session_id, recv_ts_ns=recv_ts_ns, recv_mono_ns=recv_mono_ns, schema_version=schema_version)
    event = _envelope(message, stream=stream, node_id=node_id, session_id=session_id, recv_ts_ns=recv_ts_ns, recv_mono_ns=recv_mono_ns, schema_version=schema_version)
    if stream == "book_ticker":
        return {**event, "update_id": int(message["u"]), "bid_price": float(message["b"]), "bid_quantity": float(message["B"]), "ask_price": float(message["a"]), "ask_quantity": float(message["A"])}
    if stream == "mark_price":
        return {**event, "mark_price": float(message["p"]), "index_price": float(message["i"]), "funding_rate": float(message["r"]), "next_funding_ts_ms": int(message["T"])}
    if stream == "liquidation":
        order = message.get("o", message)
        return {**event, "side": str(order["S"]), "order_type": str(order["o"]), "price": float(order["p"]), "average_price": float(order["ap"]), "quantity": float(order["q"]), "status": str(order["X"]), "exch_ts_ms": int(order["T"])}
    if stream == "kline_1m":
        candle = message["k"]
        return {**event, "open_ts_ms": int(candle["t"]), "close_ts_ms": int(candle["T"]), "interval": str(candle["i"]), "open": float(candle["o"]), "high": float(candle["h"]), "low": float(candle["l"]), "close": float(candle["c"]), "volume": float(candle["v"]), "closed": bool(candle["x"])}
    raise ValueError(f"unsupported stream: {stream}")
