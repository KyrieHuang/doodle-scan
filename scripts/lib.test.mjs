import { describe, it, expect } from 'vitest';
import {
  pickSymbols, compactKlines, buildIntervalFile, enoughData, roundSig, KEEP_CANDLES,
} from './lib.mjs';

const sym = (base, extra = {}) => ({
  symbol: `${base}USDT`, baseAsset: base, quoteAsset: 'USDT', status: 'TRADING',
  permissionSets: [['SPOT', 'TRD_GRP_004']], ...extra,
});

describe('pickSymbols', () => {
  it('keeps crypto and drops stablecoins, gold and tokenized stocks', () => {
    const info = {
      symbols: [
        sym('BTC'),
        sym('BNB'), // ends with B but is crypto
        sym('USDC'),
        sym('PAXG'),
        sym('NVDAB', { permissionSets: [['SPOT', 'TRD_GRP_261']] }),
        sym('ETH', { status: 'BREAK' }),
        { ...sym('SOL'), quoteAsset: 'BTC', symbol: 'SOLBTC' },
      ],
    };
    const { keep, excluded } = pickSymbols(info);
    expect(keep.map((k) => k.base)).toEqual(['BTC', 'BNB']);
    expect(excluded).toEqual({ stable: ['USDC'], gold: ['PAXG'], stock: ['NVDAB'] });
  });
});

describe('compactKlines', () => {
  it('keeps only the last closes, rounded', () => {
    const rows = Array.from({ length: KEEP_CANDLES + 5 }, (_, i) => [i * 1000, '1', '2', '0.5', `${i}.1234567`]);
    const out = compactKlines(rows);
    expect(out.closes).toHaveLength(KEEP_CANDLES);
    expect(out.closes[0]).toBe(5.12346);
    expect(out.lastOpenTime).toBe((KEEP_CANDLES + 4) * 1000);
  });
});

describe('buildIntervalFile', () => {
  it('sorts by base and uses parallel arrays', () => {
    const f = buildIntervalFile('1h', 'T', [
      { base: 'SOL', lastOpenTime: 2, closes: [2] },
      { base: 'BTC', lastOpenTime: 1, closes: [1] },
    ]);
    expect(f.symbols).toEqual(['BTC', 'SOL']);
    expect(f.closes).toEqual([[1], [2]]);
    expect(f.source).toBe('Binance');
  });
});

describe('enoughData / roundSig', () => {
  it('refuses to publish below 90%', () => {
    expect(enoughData(89, 100)).toBe(false);
    expect(enoughData(90, 100)).toBe(true);
    expect(enoughData(0, 0)).toBe(false);
  });
  it('rounds to 6 significant digits', () => {
    expect(roundSig('81526.123456')).toBe(81526.1);
    expect(roundSig('0.00001234567')).toBe(0.0000123457);
  });
});
