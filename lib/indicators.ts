import { MACD, RSI, BollingerBands, EMA } from 'technicalindicators';
import type { CandleData, IndicatorResult } from './types';

export function calculateIndicators(candles: CandleData[]): IndicatorResult {
  const closes = candles.map((c) => c.close);

  const ema9 = EMA.calculate({ period: 9, values: closes });
  const ema21 = EMA.calculate({ period: 21, values: closes });

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

  return {
    ema9,
    ema21,
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
  };
}

export function last<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

export function secondLast<T>(arr: T[]): T | undefined {
  return arr.length >= 2 ? arr[arr.length - 2] : undefined;
}
