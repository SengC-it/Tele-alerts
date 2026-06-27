import { MACD, RSI, BollingerBands, EMA, ATR } from 'technicalindicators';
import type { CandleData, IndicatorResult } from './types';

export function calculateIndicators(candles: CandleData[]): IndicatorResult {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const ema9 = EMA.calculate({ period: 9, values: closes });
  const ema21 = EMA.calculate({ period: 21, values: closes });
  const ema50 = EMA.calculate({ period: 50, values: closes });
  const ema200 = EMA.calculate({ period: 200, values: closes });

  const macdResult = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const rsiResult = RSI.calculate({ period: 14, values: closes });

  const bbResult = BollingerBands.calculate({
    period: 20,
    values: closes,
    stdDev: 2,
  });

  const atrResult = ATR.calculate({
    high: highs, low: lows, close: closes, period: 14,
  });

  return {
    ema9,
    ema21,
    ema50,
    ema200,
    macd: {
      macd: macdResult.map((m) => m.MACD ?? 0),
      signal: macdResult.map((m) => m.signal ?? 0),
      histogram: macdResult.map((m) => m.histogram ?? 0),
    },
    rsi: rsiResult,
    bb: {
      upper: bbResult.map((b) => b.upper),
      middle: bbResult.map((b) => b.middle),
      lower: bbResult.map((b) => b.lower),
    },
    atr: atrResult.map((a: any) => a.atr ?? a),
  };
}

/** Get last element of array */
export function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

/** Get second-to-last element */
export function secondLast<T>(arr: T[]): T | undefined {
  return arr.length >= 2 ? arr[arr.length - 2] : undefined;
}

/**
 * Determine if price is in uptrend (EMA50 > EMA200) or downtrend.
 * Used by trend filter and auto-direction switching.
 */
export function isUpTrend(indicators: IndicatorResult): boolean {
  const ema50Val = last(indicators.ema50);
  const ema200Val = last(indicators.ema200);
  if (ema50Val === undefined || ema200Val === undefined) return false;
  return ema50Val > ema200Val;
}

/**
 * Calculate volume SMA (simple moving average) over the given period.
 * Uses the previous `period` candles (excluding the current/latest one)
 * to compare current volume against the average.
 */
export function calcVolumeSMA(candles: CandleData[], period: number = 20): number {
  if (candles.length < period + 1) return 0;
  const volumes = candles.slice(-period - 1, -1).map(c => c.volume);
  return volumes.reduce((a, b) => a + b, 0) / period;
}

/**
 * Calculate N-bar change percentage.
 * Compares current close to the close `lookback` bars ago.
 * Returns percentage change (e.g. +2.5 for +2.5%).
 */
export function calcNBarChange(candles: CandleData[], lookback: number = 8): number {
  if (candles.length < lookback + 1) return 0;
  const current = candles[candles.length - 1].close;
  const past = candles[candles.length - 1 - lookback].close;
  if (past === 0) return 0;
  return ((current - past) / past) * 100;
}
