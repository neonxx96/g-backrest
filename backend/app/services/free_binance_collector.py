"""
FreeBinanceSelfCollector: Zero-Cost Bootstrap Market Data Collector
- Spot L2 depth (@depth20 / limit=1000) for unmanipulated order book walls and depth delta (2.5%, 5%, 10%, 25%)
- Synthetic Liquidation Map computed from Futures swing highs/lows + volume spikes + open interest
- Complete UnifiedMarketData contract provider
"""

import asyncio
import logging
from typing import Dict, List, Optional, Any
import aiohttp
import numpy as np

from backend.app.services.market_data_provider import (
    IMarketDataProvider,
    OrderBookDepthData,
    OrderBookLevel,
    DepthDeltaSummary,
    LiqEstimatesData,
    LiqLevelEstimate,
    MarketSnapshot,
    UnifiedMarketDataResponse,
)

logger = logging.getLogger(__name__)

BINANCE_SPOT_REST = "https://api.binance.com"
BINANCE_FUTURES_REST = "https://fapi.binance.com"


class FreeBinanceSelfCollector(IMarketDataProvider):
    """
    Self-collected market data directly from free Binance Spot & Futures public REST endpoints.
    Eliminates reliance on costly subscriptions while maintaining institutional-grade calculations.
    """

    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None
        self._unified_cache: Dict[str, Any] = {}
        self._depth_cache: Dict[str, Any] = {}

    @property
    def provider_id(self) -> str:
        return "self_binance"

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=15)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    # -------------------------------------------------------------
    # 1. Order Book & Depth Delta (Binance Spot)
    # -------------------------------------------------------------
    async def get_orderbook_depth(
        self, symbol: str, limit: int = 500, wall_multiplier: float = 3.0
    ) -> OrderBookDepthData:
        """
        Pull real spot depth without futures spoofing.
        Compute depth deltas (2.5%, 5%, 10%, 25%) and spot walls.
        """
        import time
        spot_symbol = symbol.upper()
        now_ts = time.time()
        cached = self._depth_cache.get(spot_symbol)
        if cached and (now_ts - cached[0] < 3.0):
            return cached[1]

        session = await self._get_session()
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SignalScript/1.0"}
        params = {"symbol": spot_symbol, "limit": min(limit, 100)}
        data = None

        # 1. Primary: Binance Spot REST (Clean, non-blocked)
        try:
            url_spot = f"{BINANCE_SPOT_REST}/api/v3/depth"
            async with session.get(url_spot, params=params, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                else:
                    logger.debug(f"Binance spot depth status {resp.status} for {symbol}")
        except Exception as e:
            logger.debug(f"Binance spot depth error for {symbol}: {e}")

        # 2. Secondary fallback: Futures depth if spot fails
        if not data or not data.get("bids"):
            try:
                url_fut = f"{BINANCE_FUTURES_REST}/fapi/v1/depth"
                async with session.get(url_fut, params=params, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
            except Exception as e:
                logger.debug(f"Binance futures depth fallback error for {symbol}: {e}")

        bids_raw = [[float(x[0]), float(x[1])] for x in (data or {}).get("bids", []) if len(x) >= 2]
        asks_raw = [[float(x[0]), float(x[1])] for x in (data or {}).get("asks", []) if len(x) >= 2]

        if not bids_raw or not asks_raw:
            if cached:
                return cached[1]
            raise ValueError(f"Empty orderbook for {symbol}")

        best_bid = bids_raw[0][0]
        best_ask = asks_raw[0][0]
        mid_price = (best_bid + best_ask) / 2.0

        # Calculate average volume per level to identify walls
        all_sizes = [lvl[1] for lvl in bids_raw] + [lvl[1] for lvl in asks_raw]
        avg_size = np.mean(all_sizes) if all_sizes else 1.0
        wall_threshold = avg_size * wall_multiplier

        # Process Bids
        bids_processed: List[OrderBookLevel] = []
        walls: List[OrderBookLevel] = []
        running_bid_total = 0.0

        for price, size in bids_raw:
            running_bid_total += size
            is_wall = size >= wall_threshold
            lvl = OrderBookLevel(
                price=price,
                size=round(size, 4),
                total=round(running_bid_total, 4),
                is_wall=is_wall,
                wall_ratio=round(size / avg_size, 2) if avg_size > 0 else 1.0,
            )
            bids_processed.append(lvl)
            if is_wall:
                walls.append(lvl)

        # Process Asks
        asks_processed: List[OrderBookLevel] = []
        running_ask_total = 0.0

        for price, size in asks_raw:
            running_ask_total += size
            is_wall = size >= wall_threshold
            lvl = OrderBookLevel(
                price=price,
                size=round(size, 4),
                total=round(running_ask_total, 4),
                is_wall=is_wall,
                wall_ratio=round(size / avg_size, 2) if avg_size > 0 else 1.0,
            )
            asks_processed.append(lvl)
            if is_wall:
                walls.append(lvl)

        # Calculate Depth Deltas for ranges (2.5%, 5%, 10%, 25%)
        ranges = [0.025, 0.05, 0.10, 0.25]
        depth_deltas: Dict[str, DepthDeltaSummary] = {}

        for r in ranges:
            pct_label = f"{int(r * 100) if (r * 100).is_integer() else r * 100}%"
            bid_cutoff = mid_price * (1.0 - r)
            ask_cutoff = mid_price * (1.0 + r)

            bids_vol = sum(lvl.size * lvl.price for lvl in bids_processed if lvl.price >= bid_cutoff)
            asks_vol = sum(lvl.size * lvl.price for lvl in asks_processed if lvl.price <= ask_cutoff)
            total_vol = bids_vol + asks_vol

            delta_vol = bids_vol - asks_vol
            delta_pct = (delta_vol / total_vol * 100.0) if total_vol > 0 else 0.0

            depth_deltas[pct_label] = DepthDeltaSummary(
                range_pct=r * 100.0,
                bids_vol=round(bids_vol, 2),
                asks_vol=round(asks_vol, 2),
                delta_vol=round(delta_vol, 2),
                delta_pct=round(delta_pct, 2),
            )

        res_depth = OrderBookDepthData(
            symbol=symbol.upper(),
            timestamp=int((data or {}).get("lastUpdateId", 0)),
            source="spot_collector",
            mid_price=round(mid_price, 2),
            bids=bids_processed[:100],  # Return top 100 for clean frontend footprint
            asks=asks_processed[:100],
            walls=sorted(walls, key=lambda w: w.size, reverse=True)[:15],
            depth_deltas=depth_deltas,
        )
        self._depth_cache[spot_symbol] = (now_ts, res_depth)
        return res_depth

    # -------------------------------------------------------------
    # 2. Synthetic Liquidation Map (Binance Futures)
    # -------------------------------------------------------------
    async def get_liquidation_estimates(
        self, symbol: str, timeframe: str = "15m", lookback_bars: int = 150
    ) -> LiqEstimatesData:
        """
        Build synthetic liquidation map from high-volume clusters + swing highs/lows + OI.
        Leverages:
        - 100x: +/- 0.85%
        - 75x:  +/- 1.15%
        - 50x:  +/- 1.75%
        - 25x:  +/- 3.60%
        """
        session = await self._get_session()
        fut_symbol = symbol.upper()

        # Fetch klines & 24h ticker concurrently with headers and graceful Spot fallback
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SignalScript/1.0"}
        klines_url = f"{BINANCE_FUTURES_REST}/fapi/v1/klines"
        klines_params = {"symbol": fut_symbol, "interval": timeframe, "limit": lookback_bars}
        ticker_url = f"{BINANCE_FUTURES_REST}/fapi/v1/ticker/24hr"
        ticker_params = {"symbol": fut_symbol}
        oi_url = f"{BINANCE_FUTURES_REST}/fapi/v1/openInterest"
        oi_params = {"symbol": fut_symbol}

        klines_data, ticker_data, oi_data = None, {}, {}
        try:
            async with session.get(klines_url, params=klines_params, headers=headers) as klines_resp, \
                       session.get(ticker_url, params=ticker_params, headers=headers) as ticker_resp, \
                       session.get(oi_url, params=oi_params, headers=headers) as oi_resp:
                if klines_resp.status == 200:
                    klines_data = await klines_resp.json()
                if ticker_resp.status == 200:
                    ticker_data = await ticker_resp.json()
                if oi_resp.status == 200:
                    oi_data = await oi_resp.json()
        except Exception:
            pass

        current_price = float((ticker_data or {}).get("lastPrice", 0.0) or 0.0)

        # Robust Fallback to Binance Spot REST if futures is rate-limited
        if current_price == 0.0 or not isinstance(klines_data, list):
            try:
                spot_ticker_url = f"{BINANCE_SPOT_REST}/api/v3/ticker/24hr"
                spot_klines_url = f"{BINANCE_SPOT_REST}/api/v3/klines"
                async with session.get(spot_ticker_url, params={"symbol": fut_symbol}, headers=headers) as st_resp, \
                           session.get(spot_klines_url, params={"symbol": fut_symbol, "interval": timeframe, "limit": lookback_bars}, headers=headers) as sk_resp:
                    if st_resp.status == 200:
                        ticker_data = await st_resp.json()
                        current_price = float(ticker_data.get("lastPrice", 0.0) or 0.0)
                    if sk_resp.status == 200:
                        klines_data = await sk_resp.json()
            except Exception:
                pass

        open_interest = float((oi_data or {}).get("openInterest", 0.0) or 0.0) * current_price  # In USD

        if current_price == 0.0 or not isinstance(klines_data, list):
            raise ValueError(f"Failed to fetch market data for {symbol}")

        # Extract highs, lows, and quote volumes
        highs = [float(k[2]) for k in klines_data]
        lows = [float(k[3]) for k in klines_data]
        volumes = [float(k[7]) for k in klines_data]  # Quote volume in USDT
        avg_vol = np.mean(volumes) if volumes else 1.0

        # Define leverage bands: (multiplier_pct, leverage_label)
        leverage_bands = [
            (0.0085, "100x"),
            (0.0120, "75x"),
            (0.0180, "50x"),
            (0.0360, "25x"),
            (0.0520, "15x"),
            (0.0750, "10x"),
        ]

        # Find significant pivot swing clusters
        # For shorts liquidation: clustered above swing highs
        # For longs liquidation: clustered below swing lows
        shorts_candidates: Dict[float, float] = {}
        longs_candidates: Dict[float, float] = {}

        for i in range(len(klines_data)):
            h = highs[i]
            l = lows[i]
            vol_weight = (volumes[i] / avg_vol) if avg_vol > 0 else 1.0

            decimals = 4 if current_price < 1.0 else (3 if current_price < 10.0 else (2 if current_price < 100.0 else 1))
            for pct, lev in leverage_bands:
                # Potential short entries at lower prices get liquidated above
                liq_short_price = round(h * (1.0 + pct), decimals)
                # Potential long entries at higher prices get liquidated below
                liq_long_price = round(l * (1.0 - pct), decimals)

                # Base volume chunk scaled by OI and bar volume
                chunk_usd = (open_interest * 0.0035) * min(vol_weight, 4.0)

                if liq_short_price > current_price:
                    shorts_candidates[liq_short_price] = shorts_candidates.get(liq_short_price, 0.0) + chunk_usd
                if liq_long_price < current_price:
                    longs_candidates[liq_long_price] = longs_candidates.get(liq_long_price, 0.0) + chunk_usd

        # Filter & Sort top pools
        top_shorts = sorted(shorts_candidates.items(), key=lambda x: x[1], reverse=True)[:8]
        top_longs = sorted(longs_candidates.items(), key=lambda x: x[1], reverse=True)[:8]

        all_pool_values = [v for _, v in top_shorts] + [v for _, v in top_longs]
        max_pool = max(all_pool_values) if all_pool_values else 1.0
        if max_pool <= 0:
            max_pool = 1.0

        # Build clean LiqLevelEstimate objects
        shorts_above: List[LiqLevelEstimate] = []
        longs_below: List[LiqLevelEstimate] = []

        def format_usd(val: float) -> str:
            if val >= 1_000_000:
                return f"${val / 1_000_000:.2f}M"
            return f"${val / 1_000:.1f}K"

        # Determine best matching leverage tag based on distance
        def match_lev(dist_pct: float) -> str:
            abs_dist = abs(dist_pct)
            if abs_dist <= 1.0:
                return "100x"
            elif abs_dist <= 1.5:
                return "75x"
            elif abs_dist <= 2.5:
                return "50x"
            else:
                return "25x"

        # Process Shorts (ordered from closest to furthest above current price)
        sorted_shorts_by_price = sorted(top_shorts, key=lambda x: x[0])
        for p, val in sorted_shorts_by_price:
            pct = round(((p - current_price) / current_price) * 100.0, 2)
            raw_int = (val / max_pool) if max_pool > 0 else 0.5
            intensity = min(1.0, max(0.0, round(float(raw_int), 3)))
            if np.isnan(intensity):
                intensity = 0.5
            shorts_above.append(
                LiqLevelEstimate(
                    price=p,
                    pct_from_price=pct,
                    amount_usd=round(val, 2),
                    amount_str=format_usd(val),
                    intensity=intensity,
                    leverage=match_lev(pct),
                    side="SHORT",
                    is_max=False,
                )
            )

        # Process Longs (ordered from closest to furthest below current price)
        sorted_longs_by_price = sorted(top_longs, key=lambda x: x[0], reverse=True)
        for p, val in sorted_longs_by_price:
            pct = round(((p - current_price) / current_price) * 100.0, 2)
            raw_int = (val / max_pool) if max_pool > 0 else 0.5
            intensity = min(1.0, max(0.0, round(float(raw_int), 3)))
            if np.isnan(intensity):
                intensity = 0.5
            longs_below.append(
                LiqLevelEstimate(
                    price=p,
                    pct_from_price=pct,
                    amount_usd=round(val, 2),
                    amount_str=format_usd(val),
                    intensity=intensity,
                    leverage=match_lev(pct),
                    side="LONG",
                    is_max=False,
                )
            )

        # Mark absolute max levels
        biggest_short = max(shorts_above, key=lambda x: x.amount_usd) if shorts_above else None
        if biggest_short:
            biggest_short.is_max = True

        biggest_long = max(longs_below, key=lambda x: x.amount_usd) if longs_below else None
        if biggest_long:
            biggest_long.is_max = True

        total_shorts_usd = sum(s.amount_usd for s in shorts_above)
        total_longs_usd = sum(l.amount_usd for l in longs_below)

        # Leverage breakdown aggregation
        leverage_breakdown: Dict[str, Dict[str, float]] = {
            "25x": {"shorts": 0.0, "longs": 0.0},
            "50x": {"shorts": 0.0, "longs": 0.0},
            "75x": {"shorts": 0.0, "longs": 0.0},
            "100x": {"shorts": 0.0, "longs": 0.0},
        }

        for s in shorts_above:
            if s.leverage in leverage_breakdown:
                leverage_breakdown[s.leverage]["shorts"] += s.amount_usd
        for l in longs_below:
            if l.leverage in leverage_breakdown:
                leverage_breakdown[l.leverage]["longs"] += l.amount_usd

        return LiqEstimatesData(
            symbol=symbol.upper(),
            timestamp=int(ticker_data.get("closeTime", 0)),
            provider="FreeBinanceSelfCollector (Synthetic Model)",
            is_synthetic=True,
            disclaimer="ESTIMATED (MODEL) - Calculated cascade pool levels, not order book orders",
            current_price=round(current_price, 2),
            biggest_short=biggest_short,
            biggest_long=biggest_long,
            shorts_above_usd=round(total_shorts_usd, 2),
            longs_below_usd=round(total_longs_usd, 2),
            shorts_above=shorts_above,
            longs_below=longs_below,
            leverage_breakdown=leverage_breakdown,
        )

    # -------------------------------------------------------------
    # 3. Market Snapshot (Funding, OI, 24h Ticker, CVD)
    # -------------------------------------------------------------
    async def get_market_snapshot(self, symbol: str) -> MarketSnapshot:
        session = await self._get_session()
        fut_symbol = symbol.upper()

        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SignalScript/1.0"}
        ticker_url = f"{BINANCE_FUTURES_REST}/fapi/v1/ticker/24hr"
        oi_url = f"{BINANCE_FUTURES_REST}/fapi/v1/openInterest"
        prem_url = f"{BINANCE_FUTURES_REST}/fapi/v1/premiumIndex"
        klines_url = f"{BINANCE_FUTURES_REST}/fapi/v1/klines?symbol={fut_symbol}&interval=15m&limit=30"

        t_data, oi_data, prem_data, klines_data = {}, {}, {}, None
        try:
            async with session.get(ticker_url, params={"symbol": fut_symbol}, headers=headers) as t_resp, \
                       session.get(oi_url, params={"symbol": fut_symbol}, headers=headers) as oi_resp, \
                       session.get(prem_url, params={"symbol": fut_symbol}, headers=headers) as prem_resp, \
                       session.get(klines_url, headers=headers) as klines_resp:
                if t_resp.status == 200:
                    t_data = await t_resp.json()
                if oi_resp.status == 200:
                    oi_data = await oi_resp.json()
                if prem_resp.status == 200:
                    prem_data = await prem_resp.json()
                if klines_resp.status == 200:
                    klines_data = await klines_resp.json()
        except Exception:
            pass

        price = float((t_data or {}).get("lastPrice", 0.0) or 0.0)
        # Spot fallback if futures is blocked
        if price == 0.0:
            try:
                spot_ticker = f"{BINANCE_SPOT_REST}/api/v3/ticker/24hr"
                async with session.get(spot_ticker, params={"symbol": fut_symbol}, headers=headers) as st_resp:
                    if st_resp.status == 200:
                        t_data = await st_resp.json()
                        price = float(t_data.get("lastPrice", 0.0) or 0.0)
            except Exception:
                pass
        oi_contracts = float(oi_data.get("openInterest", 0.0))
        oi_usd = oi_contracts * price
        funding_rate = float(prem_data.get("lastFundingRate", 0.0))

        # Approximate CVD from recent 30 bars (taker buy vol - taker sell vol)
        cvd_approx = 0.0
        if isinstance(klines_data, list):
            for k in klines_data:
                vol = float(k[5])
                taker_buy = float(k[9])
                taker_sell = vol - taker_buy
                cvd_approx += (taker_buy - taker_sell)

        return MarketSnapshot(
            symbol=fut_symbol,
            timestamp=max(int(t_data.get("closeTime", 0)), int(__import__("time").time() * 1000) - 5000),
            price=round(price, 6),
            change_24h_pct=round(float(t_data.get("priceChangePercent", 0.0)), 2),
            high_24h=round(float(t_data.get("highPrice", 0.0)), 2),
            low_24h=round(float(t_data.get("lowPrice", 0.0)), 2),
            volume_24h_usd=round(float(t_data.get("quoteVolume", 0.0)), 2),
            open_interest_usd=round(oi_usd, 2),
            funding_rate=round(funding_rate, 6),
            cvd_value=round(cvd_approx, 2),
        )

    # -------------------------------------------------------------
    # 4. Unified Full Data Bundle
    # -------------------------------------------------------------
    async def get_unified_data(self, symbol: str) -> UnifiedMarketDataResponse:
        import time as _time
        sym = symbol.upper()
        now = _time.monotonic()
        cached = getattr(self, "_unified_cache", {}).get(sym)
        if cached and (now - cached[0]) < 2.5:
            return cached[1]
        try:
            depth, liqs, snapshot = await asyncio.gather(
                self.get_orderbook_depth(symbol),
                self.get_liquidation_estimates(symbol),
                self.get_market_snapshot(symbol),
            )
            res = UnifiedMarketDataResponse(snapshot=snapshot, orderbook_depth=depth, liq_estimates=liqs)
            if hasattr(self, "_unified_cache"):
                self._unified_cache[sym] = (now, res)
            return res
        except Exception:
            if cached and (now - cached[0]) < 25.0:
                return cached[1]
            raise

    async def _legacy_get_unified_data(self, symbol: str) -> UnifiedMarketDataResponse:
        depth_task = self.get_orderbook_depth(symbol)
        liq_task = self.get_liquidation_estimates(symbol)
        snapshot_task = self.get_market_snapshot(symbol)

        depth, liqs, snapshot = await asyncio.gather(depth_task, liq_task, snapshot_task)

        return UnifiedMarketDataResponse(
            snapshot=snapshot,
            orderbook_depth=depth,
            liq_estimates=liqs,
        )
