import json
from pathlib import Path

import pyarrow.parquet as pq
import pytest

from recorder.events import normalize_agg_trade, normalize_message
from recorder.config import load_config
from recorder.gaps import GapJournal
from recorder.storage import LakeWriter, SpoolJournal
from recorder.service import DiskPolicy, RecorderService


def test_binance_buyer_maker_maps_to_sell_aggressor():
    event = normalize_agg_trade(
        {"e": "aggTrade", "s": "BTCUSDT", "a": 7, "p": "100.00", "q": "0.5", "f": 7, "l": 7, "T": 1700000000000, "m": True},
        node_id="node-a",
        session_id="session-a",
        recv_ts_ns=10,
        recv_mono_ns=20,
    )

    assert event["aggressor_side"] == "SELL"
    assert event["exch_ts_ms"] == 1700000000000
    assert event["trade_id"] == 7


def test_binance_raw_trade_payload_uses_trade_id_as_singleton_range():
    event = normalize_agg_trade(
        {"e": "trade", "s": "BTCUSDT", "t": 8, "p": "100.00", "q": "0.5", "T": 1700000000000, "m": False},
        node_id="node-a", session_id="session-a", recv_ts_ns=10, recv_mono_ns=20,
    )

    assert event["trade_id"] == 8
    assert event["first_trade_id"] == 8
    assert event["last_trade_id"] == 8


def test_spool_replays_complete_lines_after_restart(tmp_path: Path):
    spool = SpoolJournal(tmp_path / "spool" / "segment.jsonl")
    spool.append({"stream": "trades", "trade_id": 1})
    spool.append({"stream": "trades", "trade_id": 2})
    spool.flush()

    assert list(SpoolJournal.replay(spool.path)) == [
        {"stream": "trades", "trade_id": 1},
        {"stream": "trades", "trade_id": 2},
    ]


def test_closed_segment_has_manifest_and_cannot_be_appended(tmp_path: Path):
    writer = LakeWriter(tmp_path / "lake", node_id="node-a", session_id="session-a")
    event = normalize_agg_trade(
        {"e": "aggTrade", "s": "BTCUSDT", "a": 7, "p": "100.00", "q": "0.5", "f": 7, "l": 7, "T": 1700000000000, "m": False},
        node_id="node-a",
        session_id="session-a",
        recv_ts_ns=10,
        recv_mono_ns=20,
    )
    segment, manifest = writer.close_segment("trades", [event], sequence=0)

    assert segment.exists()
    assert manifest.exists()
    assert pq.read_table(segment).num_rows == 1
    with pytest.raises(FileExistsError):
        writer.close_segment("trades", [event], sequence=0)


def test_gap_journal_records_reason_and_bounds(tmp_path: Path):
    journal = GapJournal(tmp_path / "gaps.jsonl")
    journal.record(
        exchange="binance",
        market="usd-m",
        symbol="BTCUSDT",
        stream="book_diff",
        gap_start_ts=1000,
        gap_end_ts=2000,
        reason="seq_gap",
        node_id="node-a",
    )

    row = json.loads(journal.path.read_text(encoding="utf-8").splitlines()[0])
    assert row["reason"] == "seq_gap"
    assert row["gap_start_ts"] == 1000
    assert row["resolved_by"] == "none"


def test_normalize_book_ticker_and_closed_kline():
    ticker = normalize_message(
        {"e": "bookTicker", "s": "BTCUSDT", "u": 99, "b": "100.0", "B": "2", "a": "101.0", "A": "3", "E": 1700000000000},
        stream="book_ticker", node_id="node-a", session_id="session-a", recv_ts_ns=1, recv_mono_ns=2,
    )
    kline = normalize_message(
        {"e": "kline", "s": "BTCUSDT", "E": 1700000000000, "k": {"t": 1, "T": 2, "i": "1m", "o": "1", "h": "2", "l": "0.5", "c": "1.5", "v": "10", "x": True}},
        stream="kline_1m", node_id="node-a", session_id="session-a", recv_ts_ns=1, recv_mono_ns=2,
    )

    assert ticker["bid_price"] == 100.0
    assert ticker["ask_quantity"] == 3.0
    assert kline["closed"] is True


def test_config_loads_explicit_50_gib_limit(tmp_path: Path):
    path = tmp_path / "recorder.yaml"
    path.write_text("node_id: node-a\nlake_root: data/lake\nmax_storage_gib: 50\n", encoding="utf-8")

    config = load_config(path)

    assert config.node_id == "node-a"
    assert config.max_storage_gib == 50


def test_disk_policy_hard_stops_all_tiers_at_50_gib():
    policy = DiskPolicy(max_storage_gib=50)

    assert policy.allows("tier1", used_bytes=60 * 1024**3) is False
    assert policy.allows("tier2", used_bytes=49 * 1024**3) is False
    assert policy.allows("tier3", used_bytes=45 * 1024**3) is False


def test_service_processes_wrapped_binance_message_without_network(tmp_path: Path):
    service = RecorderService(lake_root=tmp_path / "lake", spool_root=tmp_path / "spool", node_id="node-a", session_id="session-a")
    service.process_message({"stream": "btcusdt@aggTrade", "data": {"e": "aggTrade", "s": "BTCUSDT", "a": 1, "p": "100", "q": "1", "f": 1, "l": 1, "T": 1700000000000, "m": False}})

    assert service.counters["trades"] == 1
    service.spool.flush()
    assert list(SpoolJournal.replay(service.spool.path))[0]["trade_id"] == 1
    service.close()


def test_service_processes_wrapped_raw_trade_message_without_network(tmp_path: Path):
    service = RecorderService(lake_root=tmp_path / "lake", spool_root=tmp_path / "spool", node_id="node-a", session_id="session-a")
    event = service.process_message({"stream": "btcusdt@trade", "data": {"e": "trade", "s": "BTCUSDT", "t": 2, "p": "100", "q": "1", "T": 1700000000000, "m": False}})

    assert event["stream"] == "trades"
    assert event["trade_id"] == 2
    service.close()


def test_service_records_disk_full_gap_before_spooling(tmp_path: Path):
    service = RecorderService(lake_root=tmp_path / "lake", spool_root=tmp_path / "spool", node_id="node-a", session_id="session-a", max_storage_gib=0)
    result = service.process_message({"stream": "btcusdt@aggTrade", "data": {"e": "aggTrade", "s": "BTCUSDT", "a": 1, "p": "100", "q": "1", "f": 1, "l": 1, "T": 1700000000000, "m": False}})

    assert result["ignored"] is True
    assert "disk_full" in service.status()["alerts"]
    assert "disk_full" in service.gaps.path.read_text(encoding="utf-8")
    service.close()


def test_service_caches_disk_usage_scan_between_checks(tmp_path: Path):
    service = RecorderService(lake_root=tmp_path / "lake", spool_root=tmp_path / "spool", node_id="node-a", session_id="session-a")
    calls = []
    service._scan_data_size_bytes = lambda: calls.append(1) or 123

    assert service._data_size_bytes() == 123
    assert service._data_size_bytes() == 123
    assert len(calls) == 1
    service.close()
