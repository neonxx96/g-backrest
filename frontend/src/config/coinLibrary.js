/**
 * Global Coin Library & Multi-Exchange Metadata
 * Standardized registry for supported cryptocurrency pairs, default exchanges,
 * and asset types across SignalScript modules.
 */

export const DEFAULT_FOCUS_LIST = [
  'BTCUSDT',
  'SOLUSDT',
  'LINKUSDT',
  'ADAUSDT',
  'SUIUSDT',
  'UNIUSDT',
  'ZECUSDT'
];

export const EXCHANGES = {
  BINANCE: {
    id: 'binance',
    name: 'Binance',
    badge: 'BINANCE',
    shortBadge: 'B',
    accentColor: '#f3ba2f'
  },
  BYBIT: {
    id: 'bybit',
    name: 'Bybit',
    badge: 'BYBIT',
    shortBadge: 'BYB',
    accentColor: '#f7a600'
  },
  OKX: {
    id: 'okx',
    name: 'OKX',
    badge: 'OKX',
    shortBadge: 'OKX',
    accentColor: '#ffffff'
  }
};

export const COIN_REGISTRY = {
  // Focus Coins (Explicitly monitored for institutional scalping)
  BTCUSDT: {
    symbol: 'BTCUSDT',
    base: 'BTC',
    quote: 'USDT',
    name: 'Bitcoin',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 1,
    minQty: 0.001
  },
  SOLUSDT: {
    symbol: 'SOLUSDT',
    base: 'SOL',
    quote: 'USDT',
    name: 'Solana',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 2,
    minQty: 0.01
  },
  LINKUSDT: {
    symbol: 'LINKUSDT',
    base: 'LINK',
    quote: 'USDT',
    name: 'Chainlink',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 3,
    minQty: 0.1
  },
  ADAUSDT: {
    symbol: 'ADAUSDT',
    base: 'ADA',
    quote: 'USDT',
    name: 'Cardano',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 4,
    minQty: 1.0
  },
  SUIUSDT: {
    symbol: 'SUIUSDT',
    base: 'SUI',
    quote: 'USDT',
    name: 'Sui',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 4,
    minQty: 0.1
  },
  UNIUSDT: {
    symbol: 'UNIUSDT',
    base: 'UNI',
    quote: 'USDT',
    name: 'Uniswap',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 3,
    minQty: 0.1
  },
  ZECUSDT: {
    symbol: 'ZECUSDT',
    base: 'ZEC',
    quote: 'USDT',
    name: 'Zcash',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 2,
    minQty: 0.01
  },

  // Major and Liquidity Benchmark Coins
  ETHUSDT: {
    symbol: 'ETHUSDT',
    base: 'ETH',
    quote: 'USDT',
    name: 'Ethereum',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 2,
    minQty: 0.001
  },
  BNBUSDT: {
    symbol: 'BNBUSDT',
    base: 'BNB',
    quote: 'USDT',
    name: 'BNB',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 2,
    minQty: 0.01
  },
  DOGEUSDT: {
    symbol: 'DOGEUSDT',
    base: 'DOGE',
    quote: 'USDT',
    name: 'Dogecoin',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 5,
    minQty: 1.0
  },
  XRPUSDT: {
    symbol: 'XRPUSDT',
    base: 'XRP',
    quote: 'USDT',
    name: 'XRP',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 4,
    minQty: 1.0
  },
  NEARUSDT: {
    symbol: 'NEARUSDT',
    base: 'NEAR',
    quote: 'USDT',
    name: 'NEAR Protocol',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 3,
    minQty: 0.1
  },
  AVAXUSDT: {
    symbol: 'AVAXUSDT',
    base: 'AVAX',
    quote: 'USDT',
    name: 'Avalanche',
    exchange: 'Bybit',
    assetType: 'Perpetual',
    precision: 2,
    minQty: 0.1
  },
  APTUSDT: {
    symbol: 'APTUSDT',
    base: 'APT',
    quote: 'USDT',
    name: 'Aptos',
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 3,
    minQty: 0.1
  },
  TONUSDT: {
    symbol: 'TONUSDT',
    base: 'TON',
    quote: 'USDT',
    name: 'Toncoin',
    exchange: 'Bybit',
    assetType: 'Perpetual',
    precision: 3,
    minQty: 0.1
  }
};

/**
 * Returns coin metadata or falls back to synthetic parsing from ticker
 */
export function getCoinMeta(rawSymbol) {
  if (!rawSymbol) {
    return {
      symbol: 'UNKNOWN',
      base: 'UNKNOWN',
      quote: 'USDT',
      name: 'Unknown Asset',
      exchange: 'Binance',
      assetType: 'Perpetual'
    };
  }

  const clean = rawSymbol.toUpperCase().trim();
  if (COIN_REGISTRY[clean]) {
    return COIN_REGISTRY[clean];
  }

  const base = clean.replace(/(USDT|BUSD|USDC)$/, '') || clean;
  const quote = clean.slice(base.length) || 'USDT';

  return {
    symbol: clean,
    base,
    quote,
    name: base,
    exchange: 'Binance',
    assetType: 'Perpetual',
    precision: 2,
    minQty: 0.01
  };
}
