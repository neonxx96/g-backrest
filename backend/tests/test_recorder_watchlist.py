import json
from pathlib import Path

from recorder.service import RecorderService


def test_load_watchlist_symbols_reads_symbols_payload(tmp_path: Path):
    path = tmp_path / "active_watchlist.json"
    path.write_text(json.dumps({"updated_at": 1, "symbols": ["btcusdt", " ethusdt ", ""]}), encoding="utf-8")

    assert RecorderService.load_watchlist_symbols(path) == ("BTCUSDT", "ETHUSDT")


def test_load_watchlist_symbols_accepts_plain_list(tmp_path: Path):
    path = tmp_path / "watchlist.json"
    path.write_text(json.dumps(["SOLUSDT"]), encoding="utf-8")

    assert RecorderService.load_watchlist_symbols(path) == ("SOLUSDT",)


def test_load_watchlist_symbols_survives_missing_or_corrupt_file(tmp_path: Path):
    assert RecorderService.load_watchlist_symbols(tmp_path / "missing.json") == ()
    assert RecorderService.load_watchlist_symbols(None) == ()
    assert RecorderService.load_watchlist_symbols("") == ()

    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{not json", encoding="utf-8")
    assert RecorderService.load_watchlist_symbols(corrupt) == ()

    wrong_shape = tmp_path / "wrong.json"
    wrong_shape.write_text(json.dumps({"symbols": "BTCUSDT"}), encoding="utf-8")
    assert RecorderService.load_watchlist_symbols(wrong_shape) == ()


def test_merged_symbols_unions_tier1_and_watchlist_without_duplicates():
    merged = RecorderService.merged_symbols(("BTCUSDT", "ETHUSDT"), ("ethusdt", "SOLUSDT"))

    assert merged == ("BTCUSDT", "ETHUSDT", "SOLUSDT")
    assert RecorderService.merged_symbols(("BTCUSDT",), ()) == ("BTCUSDT",)
