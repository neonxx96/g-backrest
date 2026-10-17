"""
CoinGecko Market Cap Service with Caching and Fallback
"""

import time
import logging
import aiohttp
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# Fallback top caps in USD in case of API rate limits
FALLBACK_MCAP: Dict[str, float] = {
    "BTC": 1_300_000_000_000,
    "ETH": 350_000_000_000,
    "SOL": 80_000_000_000,
    "BNB": 85_000_000_000,
    "XRP": 30_000_000_000,
    "DOGE": 18_000_000_000,
    "ADA": 15_000_000_000,
    "AVAX": 10_000_000_000,
    "LINK": 8_000_000_000,
    "SUI": 6_000_000_000,
    "NEAR": 5_000_000_000,
    "APT": 4_000_000_000
}

class CoinGeckoService:
    def __init__(self, cache_ttl_seconds: int = 3600):
        self.cache_ttl = cache_ttl_seconds
        self.last_fetch_time = 0
        self.mcap_cache: Dict[str, float] = FALLBACK_MCAP.copy()

    async def get_market_caps(self) -> Dict[str, float]:
        """
        Returns a dictionary mapping base asset symbol (e.g. 'BTC') to USD market cap.
        """
        now = time.time()
        if now - self.last_fetch_time < self.cache_ttl and len(self.mcap_cache) > 20:
            return self.mcap_cache

        url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1"
        try:
            timeout = aiohttp.ClientTimeout(total=8)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as response:
                    if response.status == 200:
                        data = await response.json()
                        new_cache = {}
                        for item in data:
                            sym = item.get("symbol", "").upper()
                            mcap = item.get("market_cap")
                            if sym and mcap:
                                new_cache[sym] = float(mcap)
                        if new_cache:
                            self.mcap_cache.update(new_cache)
                            self.last_fetch_time = now
                            logger.info(f"CoinGecko cache updated: {len(new_cache)} coins.")
                    else:
                        logger.warning(f"CoinGecko status {response.status}, using cached/fallback mcap.")
        except Exception as e:
            logger.warning(f"Failed to fetch CoinGecko mcap: {e}. Using cache.")

        return self.mcap_cache

    def get_symbol_mcap(self, symbol: str) -> Optional[float]:
        """
        Extracts base coin from symbol (e.g. BTCUSDT -> BTC) and returns mcap.
        """
        clean = symbol.upper().replace("USDT", "").replace("BUSD", "").replace("USDC", "")
        return self.mcap_cache.get(clean)

coingecko_service = CoinGeckoService()
