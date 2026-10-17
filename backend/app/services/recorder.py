"""
Market Data & Order Flow Recorder (Binance USDT-M Futures)
Records aggTrades, L2 Depth snapshots, and Footprint Clusters to Parquet.
Enforces configurable disk quota (default 100 GB) with automatic FIFO rotation.
"""

import os
import sys
import json
import time
import shutil
import zipfile
import asyncio
import logging
from datetime import datetime, date
from pathlib import Path
from typing import Dict, List, Optional, Any
import pandas as pd
import websockets

from backend.app.config import RECORDED_DATA_DIR, MAX_STORAGE_GB, FOCUS_SYMBOLS, WATCHLIST_SYMBOLS

logger = logging.getLogger(__name__)

class OrderFlowRecorder:
    def __init__(self):
        self.focus_symbols: List[str] = list(FOCUS_SYMBOLS)
        self.watchlist_symbols: List[str] = list(WATCHLIST_SYMBOLS)
        self.max_storage_gb: float = MAX_STORAGE_GB
        self.max_retention_days: int = 14
        self.data_dir: Path = RECORDED_DATA_DIR
        self.data_dir.mkdir(parents=True, exist_ok=True)

        self.is_running: bool = False
        self.ws_task: Optional[asyncio.Task] = None
        
        # In-memory buffers
        self.trade_buffer: List[Dict[str, Any]] = []
        self.depth_buffer: List[Dict[str, Any]] = []
        
        # Real-time footprint cluster cache:
        # { symbol: { candle_ts: { price_bucket: {'buy_vol': float, 'sell_vol': float, 'delta': float, 'trades': int} } } }
        self.footprint_cache: Dict[str, Dict[int, Dict[float, Dict[str, float]]]] = {
            s: {} for s in self.focus_symbols
        }

        # Stats tracking
        self.total_trades_recorded: int = 0
        self.last_flush_time: float = time.time()
        self.flush_interval_sec: int = 45  # Flush to parquet every 45 seconds

    def get_price_bucket(self, price: float, symbol: str) -> float:
        """Rounds price to appropriate tick cluster bucket based on coin magnitude."""
        if price > 5000:
            return round(price / 10.0) * 10.0  # BTC: $10 buckets
        elif price > 500:
            return round(price / 1.0) * 1.0    # ETH, BNB: $1 buckets
        elif price > 50:
            return round(price / 0.1) * 0.1    # SOL: $0.1 buckets
        elif price > 1:
            return round(price / 0.01) * 0.01  # NEAR, SUI: $0.01 buckets
        else:
            return round(price / 0.0001) * 0.0001 # DOGE, XRP: $0.0001 buckets

    def record_agg_trade(self, symbol: str, price: float, qty: float, is_buyer_maker: bool, ts: int):
        """Processes a single aggregated trade."""
        usd_val = price * qty
        # If buyer is maker, taker is seller (sell order hit bid). Else taker is buyer (market buy hit ask).
        is_taker_buy = not is_buyer_maker
        delta = qty if is_taker_buy else -qty

        # Buffer for parquet
        self.trade_buffer.append({
            'symbol': symbol,
            'timestamp': ts,
            'price': price,
            'quantity': qty,
            'usd_amount': usd_val,
            'is_taker_buy': is_taker_buy,
            'delta': delta
        })
        self.total_trades_recorded += 1

        # Update in-memory footprint cluster (5m bucket)
        tf_ms = 5 * 60 * 1000
        candle_ts = (ts // tf_ms) * tf_ms
        bucket = self.get_price_bucket(price, symbol)

        sym_cache = self.footprint_cache.setdefault(symbol, {})
        c_cache = sym_cache.setdefault(candle_ts, {})
        p_stat = c_cache.setdefault(bucket, {'buy_vol': 0.0, 'sell_vol': 0.0, 'delta': 0.0, 'trades': 0})

        if is_taker_buy:
            p_stat['buy_vol'] += qty
            p_stat['delta'] += qty
        else:
            p_stat['sell_vol'] += qty
            p_stat['delta'] -= qty
        p_stat['trades'] += 1

        # Keep footprint cache to last 100 candles per symbol to conserve RAM
        if len(sym_cache) > 100:
            oldest_key = min(sym_cache.keys())
            del sym_cache[oldest_key]

    def record_depth_snapshot(self, symbol: str, bids: List[List[str]], asks: List[List[str]], ts: int):
        """Buffers a 500ms / 1s depth snapshot (top 10 levels)."""
        parsed_bids = [[float(p), float(q)] for p, q in bids[:10]]
        parsed_asks = [[float(p), float(q)] for p, q in asks[:10]]
        self.depth_buffer.append({
            'symbol': symbol,
            'timestamp': ts,
            'bids': json.dumps(parsed_bids),
            'asks': json.dumps(parsed_asks)
        })

    def flush_buffers(self):
        """Flushes in-memory trades and depth snapshots into daily Parquet files."""
        if not self.trade_buffer and not self.depth_buffer:
            return

        today_str = date.today().strftime("%Y-%m-%d")

        # 1. Flush Trades
        if self.trade_buffer:
            trades_df = pd.DataFrame(self.trade_buffer)
            self.trade_buffer = []

            for sym, group in trades_df.groupby('symbol'):
                sym_dir = self.data_dir / sym
                sym_dir.mkdir(parents=True, exist_ok=True)
                parquet_file = sym_dir / f"trades_{today_str}.parquet"

                if parquet_file.exists():
                    try:
                        existing_df = pd.read_parquet(parquet_file)
                        combined_df = pd.concat([existing_df, group], ignore_index=True)
                        combined_df.drop_duplicates(subset=['timestamp', 'price', 'quantity'], inplace=True)
                        combined_df.to_parquet(parquet_file, compression='snappy')
                    except Exception as e:
                        logger.error(f"Error appending trades parquet for {sym}: {e}")
                        group.to_parquet(parquet_file, compression='snappy')
                else:
                    group.to_parquet(parquet_file, compression='snappy')

        # 2. Flush Depth
        if self.depth_buffer:
            depth_df = pd.DataFrame(self.depth_buffer)
            self.depth_buffer = []

            for sym, group in depth_df.groupby('symbol'):
                sym_dir = self.data_dir / sym
                sym_dir.mkdir(parents=True, exist_ok=True)
                parquet_file = sym_dir / f"depth_{today_str}.parquet"

                if parquet_file.exists():
                    try:
                        existing_df = pd.read_parquet(parquet_file)
                        combined_df = pd.concat([existing_df, group], ignore_index=True)
                        combined_df.to_parquet(parquet_file, compression='snappy')
                    except Exception:
                        group.to_parquet(parquet_file, compression='snappy')
                else:
                    group.to_parquet(parquet_file, compression='snappy')

        self.last_flush_time = time.time()
        self.check_and_rotate_storage()

    def check_and_rotate_storage(self):
        """
        Calculates total size of RECORDED_DATA_DIR.
        Prunes files exceeding max_retention_days and enforces max_storage_gb FIFO rotation.
        """
        all_files = list(self.data_dir.glob("*/*.parquet"))
        if not all_files:
            return

        now = time.time()
        # 1. Retention days purge
        if self.max_retention_days > 0:
            retention_cutoff = now - (self.max_retention_days * 86400)
            for f in list(all_files):
                try:
                    if f.stat().st_mtime < retention_cutoff:
                        f_size = f.stat().st_size
                        f.unlink()
                        logger.info(f"Retention limit ({self.max_retention_days}d) purged: {f.name} ({f_size / 1024 / 1024:.1f} MB)")
                except Exception as e:
                    logger.error(f"Error purging old file {f}: {e}")
            all_files = list(self.data_dir.glob("*/*.parquet"))

        # 2. Storage quota FIFO rotation
        total_bytes = sum(f.stat().st_size for f in all_files)
        total_gb = total_bytes / (1024 ** 3)

        if total_gb > self.max_storage_gb:
            logger.warning(f"Storage limit reached: {total_gb:.2f} GB / {self.max_storage_gb:.2f} GB. Starting FIFO rotation...")
            
            # Sort files by modification time (oldest first)
            all_files.sort(key=lambda f: f.stat().st_mtime)

            target_bytes = self.max_storage_gb * 0.90 * (1024 ** 3)
            current_bytes = total_bytes

            for f in all_files:
                if current_bytes <= target_bytes:
                    break
                try:
                    f_size = f.stat().st_size
                    f.unlink()
                    current_bytes -= f_size
                    logger.info(f"FIFO Rotation purged: {f.name} ({f_size / 1024 / 1024:.1f} MB)")
                except Exception as e:
                    logger.error(f"Error purging file {f}: {e}")

    def get_storage_stats(self) -> Dict[str, Any]:
        """Returns disk quota status, file counts, breakdown per symbol, and earliest timestamp."""
        all_files = list(self.data_dir.glob("*/*.parquet"))
        total_bytes = sum(f.stat().st_size for f in all_files) if all_files else 0
        total_gb = total_bytes / (1024 ** 3)

        earliest_time = None
        for f in all_files:
            mtime = f.stat().st_mtime
            if earliest_time is None or mtime < earliest_time:
                earliest_time = mtime
        earliest_str = datetime.fromtimestamp(earliest_time).strftime("%Y-%m-%d %H:%M") if earliest_time else datetime.utcnow().strftime("%Y-%m-%d %H:%M")

        symbol_breakdown = {}
        for sym in self.focus_symbols + self.watchlist_symbols:
            sym_dir = self.data_dir / sym
            if sym_dir.exists():
                sym_files = list(sym_dir.glob("*.parquet"))
                sym_bytes = sum(f.stat().st_size for f in sym_files)
                symbol_breakdown[sym] = {
                    "files_count": len(sym_files),
                    "size_mb": round(sym_bytes / (1024 * 1024), 2),
                    "dates": sorted([f.name.split("_")[1].replace(".parquet", "") for f in sym_files if "_" in f.name])
                }
            else:
                symbol_breakdown[sym] = {"files_count": 0, "size_mb": 0.0, "dates": []}

        return {
            "is_recording": self.is_running,
            "max_storage_gb": self.max_storage_gb,
            "max_retention_days": self.max_retention_days,
            "storage_path": str(self.data_dir),
            "earliest_recorded_at": earliest_str,
            "used_storage_gb": round(total_gb, 3),
            "used_storage_mb": round(total_bytes / (1024 * 1024), 1),
            "usage_pct": round((total_gb / self.max_storage_gb) * 100, 2) if self.max_storage_gb > 0 else 0,
            "total_files": len(all_files),
            "total_trades_session": self.total_trades_recorded,
            "focus_symbols": self.focus_symbols,
            "watchlist_symbols": self.watchlist_symbols,
            "breakdown": symbol_breakdown
        }

    def get_heatmap_data(self, symbol: str, min_usd: float = 50000.0, limit: int = 400) -> List[Dict[str, Any]]:
        """
        Extracts historical orderbook depth density snapshots for chart heatmap.
        Filters price levels where USD volume >= min_usd.
        """
        sym = symbol.upper()
        results = []
        today_str = date.today().strftime("%Y-%m-%d")
        sym_dir = self.data_dir / sym
        parquet_file = sym_dir / f"depth_{today_str}.parquet"

        raw_snapshots = []
        if parquet_file.exists():
            try:
                df = pd.read_parquet(parquet_file)
                if not df.empty:
                    sample_size = min(limit // 2, len(df))
                    step = max(1, len(df) // sample_size)
                    sampled_df = df.iloc[::step].tail(sample_size)
                    for _, row in sampled_df.iterrows():
                        raw_snapshots.append({
                            'timestamp': int(row['timestamp']),
                            'bids': json.loads(row['bids']) if isinstance(row['bids'], str) else row['bids'],
                            'asks': json.loads(row['asks']) if isinstance(row['asks'], str) else row['asks']
                        })
            except Exception as e:
                logger.error(f"Error reading depth parquet for heatmap: {e}")

        mem_snapshots = [b for b in self.depth_buffer if b.get('symbol') == sym]
        if mem_snapshots:
            step = max(1, len(mem_snapshots) // min(50, len(mem_snapshots)))
            for item in mem_snapshots[::step]:
                raw_snapshots.append({
                    'timestamp': int(item['timestamp']),
                    'bids': json.loads(item['bids']) if isinstance(item['bids'], str) else item['bids'],
                    'asks': json.loads(item['asks']) if isinstance(item['asks'], str) else item['asks']
                })

        raw_snapshots.sort(key=lambda x: x['timestamp'])
        snapshots_to_use = raw_snapshots[-limit:]

        for snap in snapshots_to_use:
            ts = snap['timestamp']
            for p, q in snap.get('bids', []):
                usd = float(p) * float(q)
                if usd >= min_usd:
                    results.append({
                        'timestamp': ts,
                        'price': float(p),
                        'volume_usd': usd,
                        'side': 'bid'
                    })
            for p, q in snap.get('asks', []):
                usd = float(p) * float(q)
                if usd >= min_usd:
                    results.append({
                        'timestamp': ts,
                        'price': float(p),
                        'volume_usd': usd,
                        'side': 'ask'
                    })

        return results

    def export_dataset_zip(self, symbol: Optional[str] = None) -> Path:
        """Zips recorded parquet files for a given symbol or all symbols for downloading."""
        export_dir = self.data_dir / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        
        timestamp_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        target_name = f"export_{symbol}_{timestamp_str}.zip" if symbol else f"export_all_{timestamp_str}.zip"
        zip_path = export_dir / target_name

        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            if symbol:
                sym_dir = self.data_dir / symbol.upper()
                if sym_dir.exists():
                    for f in sym_dir.glob("*.parquet"):
                        zipf.write(f, arcname=f"{symbol.upper()}/{f.name}")
            else:
                for f in self.data_dir.glob("*/*.parquet"):
                    zipf.write(f, arcname=f"{f.parent.name}/{f.name}")

        return zip_path

    def get_clusters_for_chart(self, symbol: str, limit_candles: int = 20) -> List[Dict[str, Any]]:
        """Returns formatted cluster/footprint data for web chart."""
        sym_cache = self.footprint_cache.get(symbol.upper(), {})
        if not sym_cache:
            return []

        sorted_candles = sorted(sym_cache.keys())[-limit_candles:]
        result = []

        for c_ts in sorted_candles:
            levels = []
            levels_dict = sym_cache[c_ts]
            for p_bucket in sorted(levels_dict.keys(), reverse=True):
                info = levels_dict[p_bucket]
                levels.append({
                    "price": p_bucket,
                    "buy_vol": round(info['buy_vol'], 4),
                    "sell_vol": round(info['sell_vol'], 4),
                    "delta": round(info['delta'], 4),
                    "trades": info['trades']
                })
            
            c_delta = sum(l['delta'] for l in levels)
            c_vol = sum(l['buy_vol'] + l['sell_vol'] for l in levels)

            result.append({
                "timestamp": c_ts,
                "total_volume": round(c_vol, 4),
                "total_delta": round(c_delta, 4),
                "levels": levels
            })

        return result

    async def start(self):
        """Starts WebSocket multi-stream recording task."""
        if self.is_running:
            return
        self.is_running = True
        self.ws_task = asyncio.create_task(self._run_recorder_loop())
        logger.info(f"OrderFlow Recorder started for symbols: {self.focus_symbols}")

    async def stop(self):
        """Stops recorder and flushes any buffered data."""
        self.is_running = False
        if self.ws_task:
            self.ws_task.cancel()
            try:
                await self.ws_task
            except asyncio.CancelledError:
                pass
        self.flush_buffers()
        logger.info("OrderFlow Recorder stopped.")

    async def _run_recorder_loop(self):
        """Runs the combined WebSocket stream listener and periodic flush."""
        while self.is_running:
            ws_url = "wss://fstream.binance.com/ws"
            logger.info(f"Connecting to Binance Recorder WS: {ws_url}...")

            try:
                async with websockets.connect(ws_url, ping_interval=20, ping_timeout=15, max_size=10*1024*1024) as ws:
                    # Subscribe to trades and depth for all focus symbols
                    sub_params = []
                    for s in self.focus_symbols:
                        s_lower = s.lower()
                        sub_params.append(f"{s_lower}@trade")
                        sub_params.append(f"{s_lower}@depth20@500ms")
                    
                    sub_msg = {"method": "SUBSCRIBE", "params": sub_params, "id": 100}
                    await ws.send(json.dumps(sub_msg))
                    logger.info(f"Subscribed to {len(sub_params)} streams on Binance Futures WS.")

                    last_flush = time.time()


                    while self.is_running:
                        try:
                            # Use timeout so we can periodically flush even during low trade frequency
                            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                            data = json.loads(msg)
                            
                            # Handle both wrapped ({"stream":..., "data":...}) and unwrapped formats
                            stream_name = data.get('stream', '')
                            payload = data.get('data', data)
                            event_type = payload.get('e', '')

                            if event_type in ('trade', 'aggTrade') or '@trade' in stream_name.lower() or '@aggtrade' in stream_name.lower():
                                sym = payload.get('s')
                                p = float(payload.get('p', 0))
                                q = float(payload.get('q', 0))
                                m = payload.get('m', False)
                                ts = int(payload.get('T', payload.get('E', int(time.time() * 1000))))
                                if sym and p > 0:
                                    self.record_agg_trade(sym, p, q, m, ts)

                            elif 'b' in payload and 'a' in payload:
                                # Depth snapshot or depth update
                                sym = payload.get('s') or (stream_name.split('@')[0].upper() if '@' in stream_name else '')
                                bids = payload.get('b', [])
                                asks = payload.get('a', [])
                                ts = int(payload.get('E', int(time.time() * 1000)))
                                if sym and (bids or asks):
                                    self.record_depth_snapshot(sym, bids, asks, ts)

                        except asyncio.TimeoutError:
                            pass


                        # Flush to disk periodically or on large buffer
                        now = time.time()
                        if now - last_flush >= self.flush_interval_sec or len(self.trade_buffer) >= 3000:
                            self.flush_buffers()
                            last_flush = now

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Recorder WS stream disconnected: {e}. Reconnecting in 5s...")
                self.flush_buffers()
                await asyncio.sleep(5)

recorder = OrderFlowRecorder()
