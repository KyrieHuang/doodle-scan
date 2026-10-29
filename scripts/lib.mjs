// Pure helpers for the data pipeline. No network here, so they can be unit tested.

export const INTERVALS = ['15m', '1h', '4h', '1d'];
export const KEEP_CANDLES = 150;

// Stablecoins and fiat-pegged assets (stage 0 report, 2026-10-28) plus older ones in case they relist.
export const STABLE = new Set([
  'USDC', 'FDUSD', 'TUSD', 'USD1', 'XUSD', 'BFUSD', 'USDE', 'RLUSD', 'USDS', 'U', 'RWUSD',
  'EUR', 'EURI', 'KGST', 'DAI', 'BUSD', 'USDP', 'PYUSD', 'AEUR', 'TRY',
]);

// Gold-backed tokens: not crypto in the sense Kyrie wants.
export const GOLD = new Set(['PAXG', 'XAUT']);

// Binance puts every tokenized stock/ETF (NVDAB, SPYB, ...) in this permission group.
export const STOCK_GROUP = 'TRD_GRP_261';

export function isTokenizedStock(sym) {
  return (sym.permissionSets || []).some((set) => set.includes(STOCK_GROUP));
}

// Returns { keep: [{symbol, base}], excluded: {stable, gold, stock} }
export function pickSymbols(exchangeInfo) {
  const excluded = { stable: [], gold: [], stock: [] };
  const keep = [];
  for (const s of exchangeInfo.symbols) {
    if (s.quoteAsset !== 'USDT' || s.status !== 'TRADING') continue;
    if (STABLE.has(s.baseAsset)) excluded.stable.push(s.baseAsset);
    else if (GOLD.has(s.baseAsset)) excluded.gold.push(s.baseAsset);
    else if (isTokenizedStock(s)) excluded.stock.push(s.baseAsset);
    else keep.push({ symbol: s.symbol, base: s.baseAsset });
  }
  return { keep, excluded };
}

// 6 significant digits is plenty for shape matching and keeps the files small.
export function roundSig(x) {
  return Number(Number(x).toPrecision(6));
}

// Binance kline row: [openTime, open, high, low, close, ...]. Keep only closes.
export function compactKlines(rows) {
  const tail = rows.slice(-KEEP_CANDLES);
  return {
    lastOpenTime: tail.length ? tail[tail.length - 1][0] : null,
    closes: tail.map((r) => roundSig(r[4])),
  };
}

// One file per interval. Parallel arrays keep JSON small.
export function buildIntervalFile(interval, updatedAt, entries) {
  const sorted = [...entries].sort((a, b) => a.base.localeCompare(b.base));
  return {
    interval,
    updatedAt,
    source: 'Binance',
    symbols: sorted.map((e) => e.base),
    lastOpenTime: sorted.map((e) => e.lastOpenTime),
    closes: sorted.map((e) => e.closes),
  };
}

// The pipeline refuses to publish when too much is missing, so the live site keeps the last good data.
export function enoughData(got, wanted, minRatio = 0.9) {
  return wanted > 0 && got / wanted >= minRatio;
}
