import asyncio

from backend.app.services.free_binance_collector import FreeBinanceSelfCollector
from backend.app.services.market_data_provider import MarketSnapshot


def test_snapshot_contract_marks_missing_values_instead_of_calling_them_fresh() -> None:
    snapshot = MarketSnapshot(
        symbol="BTCUSDT",
        timestamp=0,
        observed_at=1_700_000_000_000,
        data_status="unavailable",
        unavailable_fields=["price", "cvd_value"],
        closed_candles_only=True,
        closed_candle_count=0,
        price=0.0,
        change_24h_pct=0.0,
        high_24h=0.0,
        low_24h=0.0,
        volume_24h_usd=0.0,
        open_interest_usd=0.0,
        funding_rate=0.0,
        cvd_value=0.0,
    )

    assert snapshot.schema_version == 1
    assert snapshot.timestamp == 0
    assert snapshot.data_status == "unavailable"
    assert "price" in snapshot.unavailable_fields
    assert snapshot.closed_candles_only is True


class _Response:
    def __init__(self, status, payload):
        self.status = status
        self._payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def json(self):
        return self._payload


class _SnapshotSession:
    def __init__(self, payloads):
        self.payloads = payloads

    def get(self, url, **_kwargs):
        for key, payload in self.payloads.items():
            if key in url:
                return _Response(200, payload)
        return _Response(503, {})


def test_provider_marks_partial_data_and_excludes_forming_candle(monkeypatch) -> None:
    collector = FreeBinanceSelfCollector()
    session = _SnapshotSession({
        "ticker/24hr": {"lastPrice": "100", "closeTime": 1_699_999_999_000, "priceChangePercent": "1", "highPrice": "102", "lowPrice": "98", "quoteVolume": "10000"},
        "openInterest": {},
        "premiumIndex": {"lastFundingRate": "0.0001"},
        "klines": [
            [0, 0, 0, 0, 0, "10", 1_699_999_999_000, 0, 0, "7"],
            [0, 0, 0, 0, 0, "99", 1_700_000_001_000, 0, 0, "90"],
        ],
    })

    async def get_session():
        return session

    monkeypatch.setattr(collector, "_get_session", get_session)
    monkeypatch.setattr("time.time", lambda: 1_700_000_000)
    snapshot = asyncio.run(collector.get_market_snapshot("btcusdt"))

    assert snapshot.data_status == "partial"
    assert snapshot.unavailable_fields == ["open_interest_usd"]
    assert snapshot.closed_candle_count == 1
    assert snapshot.cvd_value == 4.0
