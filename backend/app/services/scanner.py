"""
Market Scanner Engine
Scans Binance USDT-M Futures, applies 24h filters and timeframe indicators, and manages signal cooldowns.
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from sqlalchemy import select

from backend.app.db.database import AsyncSessionLocal
from backend.app.db.models import UserSetting, SignalHistory, DecisionLog
from backend.app.services.binance_service import binance_service
from backend.app.services.coingecko import coingecko_service
from backend.app.services.indicators import (
    compute_indicators,
    check_ema20_cross,
    check_volume_spike,
    check_rsi_condition,
    check_cvd_divergence
)
from backend.app.services.bot import broadcast_signal

logger = logging.getLogger(__name__)

class MarketScanner:
    def __init__(self):
        # Cooldown map: (symbol, condition_type) -> last_triggered_datetime
        self.cooldown_tracker: Dict[Tuple[str, str], datetime] = {}
        self.is_running = False
        self.last_scan_results: List[Dict[str, Any]] = []

    def is_in_cooldown(self, symbol: str, condition_type: str, cooldown_minutes: int) -> bool:
        key = (symbol, condition_type)
        last_time = self.cooldown_tracker.get(key)
        if not last_time:
            return False
        elapsed = (datetime.utcnow() - last_time).total_seconds() / 60.0
        return elapsed < cooldown_minutes

    def update_cooldown(self, symbol: str, condition_type: str):
        self.cooldown_tracker[(symbol, condition_type)] = datetime.utcnow()

    async def get_active_settings(self) -> UserSetting:
        """Loads current settings (default user_id='0')."""
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(UserSetting).where(UserSetting.user_id == "0"))
            setting = res.scalar_one_or_none()
            if not setting:
                setting = UserSetting(user_id="0")
            return setting

    async def scan_market(self, setting: Optional[UserSetting] = None) -> List[Dict[str, Any]]:
        """
        Runs one full scan pass across top 150 Binance pairs.
        Returns list of newly triggered signals.
        """
        if setting is None:
            setting = await self.get_active_settings()

        logger.info(f"Starting scan pass: TF={setting.timeframe}, Cooldown={setting.cooldown_minutes}m")
        
        # 1. Fetch 24h tickers & Top Symbols
        tickers = await binance_service.fetch_24h_tickers()
        if not tickers:
            logger.warning("No tickers received from Binance.")
            return []

        # 2. Get CoinGecko market caps if mcap filter enabled
        mcaps = await coingecko_service.get_market_caps() if setting.mcap_enabled else {}

        # 3. Filter coins by 24h market criteria
        candidates = []
        top_symbols = binance_service.top_symbols or list(tickers.keys())[:150]

        for sym in top_symbols:
            t = tickers.get(sym)
            if not t:
                continue

            # Price change 24h filter
            if setting.price_change_enabled:
                if abs(t['price_change_pct']) < setting.price_change_min:
                    continue

            # Market Cap filter (CoinGecko)
            if setting.mcap_enabled:
                mcap = coingecko_service.get_symbol_mcap(sym)
                if mcap is not None:
                    if mcap < setting.mcap_min_usd or mcap > setting.mcap_max_usd:
                        continue

            candidates.append(t)

        logger.info(f"Candidates after 24h price/mcap filter: {len(candidates)} of {len(top_symbols)}")

        # 4. Check candidates on TF indicators & OI & Liquidations
        new_signals = []

        # Parse per-coin overrides
        import json
        try:
            coin_overrides = json.loads(setting.coin_overrides) if setting.coin_overrides else {}
        except Exception:
            coin_overrides = {}

        norm_mode = getattr(setting, 'normalization_mode', 'raw') or 'raw'

        # Limit concurrent kline fetches to avoid rate limit spikes
        semaphore = asyncio.Semaphore(10)

        async def inspect_candidate(cand: Dict[str, Any]):
            sym = cand['symbol']
            coin_cfg = coin_overrides.get(sym, {})
            
            # Check 24h OI change if enabled
            if setting.oi_change_enabled:
                oi_chg = await binance_service.fetch_open_interest_24h_change(sym)
                min_oi = float(coin_cfg.get('oi_change_min', setting.oi_change_min))
                if abs(oi_chg) < min_oi:
                    return

            # Check 24h Liquidations if enabled
            if setting.liquidation_enabled:
                liq_usd = await binance_service.get_24h_liquidations_sum(sym)
                min_liq = float(coin_cfg.get('liquidation_min_usd', setting.liquidation_min_usd))
                if liq_usd < min_liq:
                    return

            # Fetch klines for indicator analysis
            async with semaphore:
                try:
                    df = await binance_service.fetch_klines(sym, timeframe=setting.timeframe, limit=50)
                except Exception as e:
                    logger.debug(f"Could not fetch klines for {sym}: {e}")
                    return

            if df.empty or len(df) < 20:
                return

            eff_ema_period = int(coin_cfg.get('ema_period', 20))
            df = compute_indicators(df, overrides={'ema': {'period': eff_ema_period}})
            last_price = cand['last_price']
            
            # --- Check Indicator Triggers ---
            
            # A. EMA Cross
            if setting.ema_cross_enabled:
                cross = check_ema20_cross(df)
                if cross and not self.is_in_cooldown(sym, "EMA_CROSS", setting.cooldown_minutes):
                    self.update_cooldown(sym, "EMA_CROSS")
                    col = f"ema_{eff_ema_period}" if f"ema_{eff_ema_period}" in df.columns else "ema_20"
                    diff = df['close'] - df[col]
                    norm_diff = normalize_series(diff, mode=norm_mode, atr_series=df.get('atr'))
                    norm_display = format_normalized_display(float(norm_diff.iloc[-1]), norm_mode)

                    new_signals.append({
                        'symbol': sym,
                        'timeframe': setting.timeframe,
                        'price': last_price,
                        'condition_type': 'EMA_CROSS',
                        'direction': cross,
                        'description': f"Свеча пересекла EMA({eff_ema_period}) снизу вверх ({cross})" if cross == 'BULLISH' else f"Свеча пересекла EMA({eff_ema_period}) сверху вниз ({cross})",
                        'normalized_metric': norm_display
                    })

            # B. Volume Spike
            if setting.vol_spike_enabled:
                eff_vol_mult = float(coin_cfg.get('vol_spike_mult', setting.vol_spike_mult))
                if check_volume_spike(df, eff_vol_mult):
                    if not self.is_in_cooldown(sym, "VOL_SPIKE", setting.cooldown_minutes):
                        self.update_cooldown(sym, "VOL_SPIKE")
                        vol_r = round(df.iloc[-1]['vol_ratio'], 1)
                        norm_vol = normalize_series(df['vol_ratio'], mode=norm_mode)
                        norm_display = format_normalized_display(float(norm_vol.iloc[-1]), norm_mode)

                        new_signals.append({
                            'symbol': sym,
                            'timeframe': setting.timeframe,
                            'price': last_price,
                            'condition_type': 'VOL_SPIKE',
                            'direction': 'ALERT',
                            'description': f"Всплеск объема в {vol_r}x выше среднего MA",
                            'normalized_metric': norm_display
                        })

            # C. RSI Extreme
            if setting.rsi_filter_enabled:
                eff_rsi_min = float(coin_cfg.get('rsi_min', setting.rsi_min))
                eff_rsi_max = float(coin_cfg.get('rsi_max', setting.rsi_max))
                rsi_state = check_rsi_condition(df, eff_rsi_min, eff_rsi_max)
                if rsi_state and not self.is_in_cooldown(sym, "RSI_EXTREME", setting.cooldown_minutes):
                    self.update_cooldown(sym, "RSI_EXTREME")
                    rsi_val = round(df.iloc[-1]['rsi'], 1)
                    norm_rsi = normalize_series(df['rsi'], mode=norm_mode)
                    norm_display = format_normalized_display(float(norm_rsi.iloc[-1]), norm_mode)

                    new_signals.append({
                        'symbol': sym,
                        'timeframe': setting.timeframe,
                        'price': last_price,
                        'condition_type': 'RSI_EXTREME',
                        'direction': 'OVERSOLD' if rsi_state == 'OVERSOLD' else 'OVERBOUGHT',
                        'description': f"RSI вышел в экстремальную зону ({rsi_val})",
                        'normalized_metric': norm_display
                    })

            # D. CVD Divergence
            if setting.cvd_divergence_enabled:
                cvd_div = check_cvd_divergence(df)
                if cvd_div and not self.is_in_cooldown(sym, "CVD_DIV", setting.cooldown_minutes):
                    self.update_cooldown(sym, "CVD_DIV")
                    norm_cvd = normalize_series(df['cvd'], mode=norm_mode)
                    norm_display = format_normalized_display(float(norm_cvd.iloc[-1]), norm_mode)

                    new_signals.append({
                        'symbol': sym,
                        'timeframe': setting.timeframe,
                        'price': last_price,
                        'condition_type': 'CVD_DIV',
                        'direction': cvd_div,
                        'description': f"Дивергенция кумулятивной дельты ({cvd_div})",
                        'normalized_metric': norm_display
                    })

            # E. ATR Volatility Spike
            if setting.atr_filter_enabled:
                atr_pct = float(df.iloc[-1].get('atr_pct', 0.0))
                min_atr = float(coin_cfg.get('atr_volatility_min_pct', setting.atr_volatility_min_pct))
                if atr_pct >= min_atr:
                    if not self.is_in_cooldown(sym, "ATR_VOLATILITY", setting.cooldown_minutes):
                        self.update_cooldown(sym, "ATR_VOLATILITY")
                        new_signals.append({
                            'symbol': sym,
                            'timeframe': setting.timeframe,
                            'price': last_price,
                            'condition_type': 'ATR_VOLATILITY',
                            'direction': 'VOLATILE',
                            'description': f"Всплеск волатильности: ATR {atr_pct:.2f}% от цены",
                            'normalized_metric': f"{atr_pct:.1f}% ATR"
                        })

            # F. VWAP Trigger
            from backend.app.services.indicators import check_vwap_signal
            eff_vwap_thresh = float(coin_cfg.get('vwap_deviation_pct', 1.5))
            vwap_sig = check_vwap_signal(df, deviation_threshold_pct=eff_vwap_thresh)
            if vwap_sig and not self.is_in_cooldown(sym, vwap_sig['condition_type'], setting.cooldown_minutes):
                self.update_cooldown(sym, vwap_sig['condition_type'])
                norm_vwap = normalize_series(df['vwap_deviation_pct'], mode=norm_mode)
                norm_display = format_normalized_display(float(norm_vwap.iloc[-1]), norm_mode)
                new_signals.append({
                    'symbol': sym,
                    'timeframe': setting.timeframe,
                    'price': last_price,
                    'condition_type': vwap_sig['condition_type'],
                    'direction': vwap_sig['direction'],
                    'description': vwap_sig['description'],
                    'normalized_metric': norm_display
                })

        # Run tasks for candidates
        tasks = [inspect_candidate(c) for c in candidates[:60]] # process top candidates
        await asyncio.gather(*tasks, return_exceptions=True)

        # Save to database and broadcast
        if new_signals:
            async with AsyncSessionLocal() as db:
                for sig in new_signals:
                    record = SignalHistory(
                        symbol=sig['symbol'],
                        timeframe=sig['timeframe'],
                        price=sig['price'],
                        condition_type=sig['condition_type'],
                        direction=sig['direction'],
                        description=sig['description'],
                        normalized_metric=sig.get('normalized_metric'),
                        created_at=datetime.utcnow()
                    )
                    db.add(record)

                    # Stage 1: Automatically log triggered signal into Decision Journal
                    dir_mapped = "LONG" if sig['direction'] in ("BULLISH", "OVERSOLD", "LONG") else ("SHORT" if sig['direction'] in ("BEARISH", "OVERBOUGHT", "SHORT") else "NEUTRAL")
                    decision_row = DecisionLog(
                        timestamp=datetime.utcnow(),
                        event_type="SIGNAL",
                        symbol=sig['symbol'],
                        timeframe=sig['timeframe'],
                        direction=dir_mapped,
                        price=float(sig['price'] or 0.0),
                        strategy_or_condition=f"{sig['condition_type']}: {sig['description']}",
                        context_json=json.dumps({
                            "condition_type": sig['condition_type'],
                            "raw_direction": sig['direction'],
                            "normalized_metric": sig.get('normalized_metric')
                        }, ensure_ascii=False),
                        user_decision="PENDING",
                        notes=""
                    )
                    db.add(decision_row)
                    
                    if setting.notifications_enabled:
                        try:
                            await broadcast_signal(sig)
                        except Exception as e:
                            logger.error(f"Error broadcasting signal {sig['symbol']}: {e}")

                await db.commit()

        self.last_scan_results = new_signals
        logger.info(f"Scan complete. Found {len(new_signals)} new signals.")
        return new_signals

scanner = MarketScanner()
