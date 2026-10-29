// Fetch Binance public market data and write static JSON files into public/data/.
// Runs in GitHub Actions every hour. No API key is used or needed.
// Exits non-zero when data is incomplete, so the deploy step is skipped and the site keeps old data.

import { mkdir, writeFile } from 'node:fs/promises';
import {
  INTERVALS, KEEP_CANDLES, pickSymbols, compactKlines, buildIntervalFile, enoughData, roundSig,
} from './lib.mjs';

const BASE = 'https://data-api.binance.vision/api/v3';
const OUT = new URL('../public/data/', import.meta.url);
const CONCURRENCY = 8;
const WEIGHT_SOFT_LIMIT = 3000; // per minute; Binance's own limit is higher

let usedWeight = 0;
let pause = null; // shared, so all workers wait together

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForWeight() {
  if (usedWeight <= WEIGHT_SOFT_LIMIT) return;
  if (!pause) {
    const wait = 61_000 - (Date.now() % 60_000);
    console.log(`weight ${usedWeight}, pausing ${Math.round(wait / 1000)}s`);
    pause = sleep(wait).then(() => { usedWeight = 0; pause = null; });
  }
  await pause;
}

async function get(path, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    await waitForWeight();
    try {
      const res = await fetch(BASE + path, { signal: AbortSignal.timeout(20_000) });
      usedWeight = Number(res.headers.get('x-mbx-used-weight-1m')) || usedWeight;
      if (res.status === 429 || res.status === 418) {
        const retry = Number(res.headers.get('retry-after')) || 30;
        console.log(`rate limited (${res.status}), waiting ${retry}s`);
        await sleep(retry * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === tries) throw new Error(`${path}: ${err.message}`);
      await sleep(1000 * i);
    }
  }
  throw new Error(`${path}: rate limited ${tries} times`);
}

async function mapPool(items, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]).catch((err) => ({ error: err.message }));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

async function main() {
  const started = Date.now();
  const updatedAt = new Date().toISOString();

  const info = await get('/exchangeInfo?permissions=SPOT');
  const { keep, excluded } = pickSymbols(info);
  console.log(`symbols: ${keep.length} kept; excluded stable ${excluded.stable.length}, gold ${excluded.gold.length}, tokenized stocks ${excluded.stock.length}`);

  const tickers = await get('/ticker/24hr?type=MINI');
  const tickerBy = new Map(tickers.map((t) => [t.symbol, t]));

  await mkdir(OUT, { recursive: true });

  for (const interval of INTERVALS) {
    // A few extra candles in case the newest one is still forming.
    const limit = KEEP_CANDLES + 1;
    const rows = await mapPool(keep, async (s) => {
      const k = await get(`/klines?symbol=${s.symbol}&interval=${interval}&limit=${limit}`);
      return { base: s.base, ...compactKlines(k) };
    });
    const failed = rows.filter((r) => r.error);
    const good = rows.filter((r) => !r.error && r.closes.length > 0);
    console.log(`${interval}: ${good.length}/${keep.length} ok, ${failed.length} failed`);
    if (failed.length) console.log(`  first errors: ${failed.slice(0, 3).map((f) => f.error).join(' | ')}`);
    if (!enoughData(good.length, keep.length)) {
      throw new Error(`${interval}: only ${good.length}/${keep.length} symbols fetched, not publishing`);
    }
    const file = buildIntervalFile(interval, updatedAt, good);
    await writeFile(new URL(`klines-${interval}.json`, OUT), JSON.stringify(file));
  }

  const symbols = keep
    .map((s) => {
      const t = tickerBy.get(s.symbol);
      if (!t) return null;
      const open = Number(t.openPrice);
      const last = Number(t.lastPrice);
      return {
        base: s.base,
        symbol: s.symbol,
        last: roundSig(last),
        change24h: open ? roundSig(((last - open) / open) * 100) : 0,
        quoteVolume24h: Math.round(Number(t.quoteVolume)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);

  await writeFile(new URL('symbols.json', OUT), JSON.stringify({ updatedAt, source: 'Binance', symbols }));
  await writeFile(new URL('meta.json', OUT), JSON.stringify({ updatedAt, source: 'Binance', count: symbols.length, intervals: INTERVALS }));

  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
});
