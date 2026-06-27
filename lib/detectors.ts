import type { IndicatorResult, CandleData, FundingRateInfo, TickerInfo, Signal, Layer, VolumeConfirmResult, BTCStrengthResult } from './types';
import { last, secondLast, isUpTrend, calcVolumeSMA, calcNBarChange } from './indicators';

// ========== 技术面信号 ==========

export function detectEMACross(
  symbol: string, timeframe: string, indicators: IndicatorResult
): Signal | null {
  const ema9Now = last(indicators.ema9);
  const ema9Prev = secondLast(indicators.ema9);
  const ema21Now = last(indicators.ema21);
  const ema21Prev = secondLast(indicators.ema21);
  if (!ema9Now || !ema9Prev || !ema21Now || !ema21Prev) return null;

  if (ema9Prev <= ema21Prev && ema9Now > ema21Now) {
    return {
      id: `ema_cross_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: 'EMA金叉', direction: 'long',
      message: `${symbol} EMA9上穿EMA21，形成金叉，看多信号`,
      strength: 3, data: { ema9: ema9Now, ema21: ema21Now },
    };
  }
  if (ema9Prev >= ema21Prev && ema9Now < ema21Now) {
    return {
      id: `ema_cross_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: 'EMA死叉', direction: 'short',
      message: `${symbol} EMA9下穿EMA21，形成死叉，看空信号`,
      strength: 3, data: { ema9: ema9Now, ema21: ema21Now },
    };
  }
  return null;
}

export function detectMACDFlip(
  symbol: string, timeframe: string, indicators: IndicatorResult
): Signal | null {
  const histNow = last(indicators.macd.histogram);
  const histPrev = secondLast(indicators.macd.histogram);
  if (histNow === undefined || histPrev === undefined) return null;

  if (histPrev < 0 && histNow > 0) {
    return {
      id: `macd_flip_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: 'MACD翻红', direction: 'long',
      message: `${symbol} MACD柱状图由绿转红，多头动能增强`,
      strength: 3, data: { histogram: histNow },
    };
  }
  if (histPrev > 0 && histNow < 0) {
    return {
      id: `macd_flip_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: 'MACD翻绿', direction: 'short',
      message: `${symbol} MACD柱状图由红转绿，空头动能增强`,
      strength: 3, data: { histogram: histNow },
    };
  }
  return null;
}

export function detectRSIExtreme(
  symbol: string, timeframe: string, indicators: IndicatorResult,
  overbought: number = 70, oversold: number = 30
): Signal | null {
  const rsiNow = last(indicators.rsi);
  const rsiPrev = secondLast(indicators.rsi);
  if (rsiNow === undefined || rsiPrev === undefined) return null;

  if (rsiPrev < overbought && rsiNow >= overbought) {
    return {
      id: `rsi_extreme_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: 'RSI超买', direction: 'short',
      message: `${symbol} RSI=${rsiNow.toFixed(1)}进入超买区(>${overbought})，警惕回调`,
      strength: 2, data: { rsi: rsiNow },
    };
  }
  if (rsiPrev > oversold && rsiNow <= oversold) {
    return {
      id: `rsi_extreme_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: 'RSI超卖', direction: 'long',
      message: `${symbol} RSI=${rsiNow.toFixed(1)}进入超卖区(<${oversold})，可能反弹`,
      strength: 2, data: { rsi: rsiNow },
    };
  }
  return null;
}

export function detectBBBreakout(
  symbol: string, timeframe: string, candles: CandleData[], indicators: IndicatorResult
): Signal | null {
  const upper = last(indicators.bb.upper);
  const lower = last(indicators.bb.lower);
  const closeNow = candles[candles.length - 1]?.close;
  if (upper === undefined || lower === undefined || closeNow === undefined) return null;

  if (closeNow > upper) {
    return {
      id: `bb_breakout_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: '布林带突破上轨', direction: 'long',
      message: `${symbol} 价格突破布林带上轨(${upper.toFixed(2)})，强势突破`,
      strength: 4, data: { close: closeNow, upper, lower },
    };
  }
  if (closeNow < lower) {
    return {
      id: `bb_breakout_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: '布林带跌破下轨', direction: 'short',
      message: `${symbol} 价格跌破布林带下轨(${lower.toFixed(2)})，弱势信号`,
      strength: 4, data: { close: closeNow, upper, lower },
    };
  }
  return null;
}

/**
 * BB Reversion — opposite logic to BB Breakout.
 * When price touches upper band → expect reversion down (short).
 * When price touches lower band → expect reversion up (long).
 * Key finding: this works on down-trending / high-volatility coins (L3, L4),
 * while BB breakout works on up-trending coins (L1).
 */
export function detectBBReversion(
  symbol: string, timeframe: string, candles: CandleData[], indicators: IndicatorResult
): Signal | null {
  const upper = last(indicators.bb.upper);
  const lower = last(indicators.bb.lower);
  const closeNow = candles[candles.length - 1]?.close;
  if (upper === undefined || lower === undefined || closeNow === undefined) return null;

  if (closeNow > upper) {
    return {
      id: `bb_reversion_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: '布林带超买回归', direction: 'short',
      message: `${symbol} 价格触及上轨后大概率回归，看空信号`,
      strength: 4, data: { close: closeNow, upper, lower },
    };
  }
  if (closeNow < lower) {
    return {
      id: `bb_reversion_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: '布林带超卖回归', direction: 'long',
      message: `${symbol} 价格触及下轨后大概率反弹，看多信号`,
      strength: 4, data: { close: closeNow, upper, lower },
    };
  }
  return null;
}

/**
 * Volume Surge — current volume > 3x 20-period average + price direction.
 * Large volume confirms the move direction.
 */
export function detectVolumeSurge(
  symbol: string, timeframe: string, candles: CandleData[]
): Signal | null {
  const len = candles.length;
  if (len < 22) return null;

  const volumes = candles.map((c) => c.volume);
  const avgVol = volumes.slice(len - 21, len - 1).reduce((a, b) => a + b, 0) / 20;
  const curVol = volumes[len - 1];

  if (avgVol <= 0 || curVol < avgVol * 3) return null;

  const curClose = candles[len - 1].close;
  const prevClose = candles[len - 2].close;

  if (curClose > prevClose) {
    return {
      id: `volume_surge_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: '放量上涨', direction: 'long',
      message: `${symbol} 成交量达均量${(curVol / avgVol).toFixed(1)}倍，量增价涨`,
      strength: 4, data: { volume: curVol, avgVolume: avgVol, ratio: curVol / avgVol },
    };
  }
  if (curClose < prevClose) {
    return {
      id: `volume_surge_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: '放量下跌', direction: 'short',
      message: `${symbol} 成交量达均量${(curVol / avgVol).toFixed(1)}倍，量增价跌`,
      strength: 4, data: { volume: curVol, avgVolume: avgVol, ratio: curVol / avgVol },
    };
  }
  return null;
}

/**
 * Price-Volume Resonance — volume > 2x avg + 24-bar price breakout.
 * Combines volume and price breakout for higher-confidence signals.
 */
export function detectPriceVolume(
  symbol: string, timeframe: string, candles: CandleData[]
): Signal | null {
  const len = candles.length;
  if (len < 26) return null;

  const volumes = candles.map((c) => c.volume);
  const avgVol = volumes.slice(len - 21, len - 1).reduce((a, b) => a + b, 0) / 20;
  const curVol = volumes[len - 1];

  if (avgVol <= 0 || curVol < avgVol * 2) return null;

  const prev24 = candles.slice(len - 25, len - 1);
  const maxHigh = Math.max(...prev24.map((c) => c.high));
  const minLow = Math.min(...prev24.map((c) => c.low));
  const curClose = candles[len - 1].close;

  if (curClose > maxHigh) {
    return {
      id: `price_volume_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: '量价共振突破', direction: 'long',
      message: `${symbol} 放量突破24周期高点，量价共振看多`,
      strength: 5, data: { close: curClose, breakout: maxHigh, volumeRatio: curVol / avgVol },
    };
  }
  if (curClose < minLow) {
    return {
      id: `price_volume_${symbol}_${Date.now()}`,
      type: 'technical', symbol, timeframe,
      name: '量价共振破位', direction: 'short',
      message: `${symbol} 放量跌破24周期低点，量价共振看空`,
      strength: 5, data: { close: curClose, breakout: minLow, volumeRatio: curVol / avgVol },
    };
  }
  return null;
}

// ========== 资金面信号 ==========

export function detectFundingRateAnomaly(
  symbol: string, fundingInfo: FundingRateInfo, threshold: number = 0.05
): Signal | null {
  const rate = fundingInfo.fundingRate * 100;
  if (Math.abs(rate) < threshold) return null;

  const direction: Signal['direction'] = rate > 0 ? 'short' : 'long';
  const payers = rate > 0 ? '多头付费异常偏高，留意空头机会' : '空头付费异常偏高，留意多头机会';
  const strength = Math.min(5, Math.floor(Math.abs(rate) / threshold));

  return {
    id: `funding_rate_${symbol}_${Date.now()}`,
    type: 'funding', symbol, timeframe: '-',
    name: '资金费率异常', direction,
    message: `${symbol} 资金费率${rate.toFixed(4)}%，${payers}`,
    strength, data: { fundingRate: rate, markPrice: fundingInfo.markPrice },
  };
}

// ========== 价格突破信号 ==========

export function detectPriceChange(
  symbol: string, ticker: TickerInfo, changePercent: number = 5
): Signal | null {
  const pct = Math.abs(ticker.changePercent24h);
  if (pct < changePercent) return null;

  const direction: Signal['direction'] = ticker.changePercent24h > 0 ? 'long' : 'short';
  const label = direction === 'long' ? '暴涨' : '暴跌';

  return {
    id: `price_change_${symbol}_${Date.now()}`,
    type: 'price', symbol, timeframe: '-',
    name: `${label}异动`, direction,
    message: `${symbol} 24h${label} ${ticker.changePercent24h.toFixed(2)}%，当前价${ticker.last}`,
    strength: Math.min(5, Math.floor(pct / changePercent)),
    data: { changePercent: ticker.changePercent24h, price: ticker.last },
  };
}

export function detectNewHighLow(
  symbol: string, timeframe: string, candles: CandleData[], lookback: number = 24
): Signal | null {
  if (candles.length < lookback + 1) return null;

  const recent = candles.slice(-lookback - 1);
  const current = recent[recent.length - 1];
  const previous = recent.slice(0, -1);

  const maxHigh = Math.max(...previous.map((c) => c.high));
  const minLow = Math.min(...previous.map((c) => c.low));

  if (current.close > maxHigh) {
    return {
      id: `new_high_${symbol}_${Date.now()}`,
      type: 'price', symbol, timeframe,
      name: `${lookback}周期新高`, direction: 'long',
      message: `${symbol} 创${lookback}周期新高 ${current.close.toFixed(2)}，突破前高${maxHigh.toFixed(2)}`,
      strength: 4, data: { close: current.close, previousHigh: maxHigh },
    };
  }
  if (current.close < minLow) {
    return {
      id: `new_low_${symbol}_${Date.now()}`,
      type: 'price', symbol, timeframe,
      name: `${lookback}周期新低`, direction: 'short',
      message: `${symbol} 创${lookback}周期新低 ${current.close.toFixed(2)}，跌破前低${minLow.toFixed(2)}`,
      strength: 4, data: { close: current.close, previousLow: minLow },
    };
  }
  return null;
}

// ========== Trend Filter & Auto-Direction ==========

/**
 * Apply trend filter: suppress long signals in downtrend, short signals in uptrend.
 * Returns the signal if it passes, null if filtered out.
 */
export function applyTrendFilter(
  signal: Signal | null, indicators: IndicatorResult
): Signal | null {
  if (!signal) return null;
  const up = isUpTrend(indicators);
  // In uptrend: allow long, suppress short
  // In downtrend: allow short, suppress long
  if (up && signal.direction === 'short') return null;
  if (!up && signal.direction === 'long') return null;
  return signal;
}

/**
 * Auto-direction switch for BB signals.
 * In uptrend: use BB breakout (breakout = follow trend)
 * In downtrend: use BB reversion (breakout = fake, expect reversion)
 * Returns the appropriate signal based on current trend.
 */
export function detectBBWithAutoDirection(
  symbol: string, timeframe: string, candles: CandleData[], indicators: IndicatorResult
): Signal | null {
  const up = isUpTrend(indicators);
  if (up) {
    // Uptrend: use breakout (follow the trend)
    return detectBBBreakout(symbol, timeframe, candles, indicators);
  } else {
    // Downtrend: use reversion (breakout = fake, mean-revert)
    return detectBBReversion(symbol, timeframe, candles, indicators);
  }
}

// ========== Volume & BTC Strength Filters ==========

/**
 * Volume Confirmation — returns volume ratio info for strength boosting.
 * NOT a standalone signal; used to boost/suppress existing strategy signals.
 * Compares current candle volume against the average of the previous `avgPeriod` candles.
 */
export function detectVolumeConfirm(
  candles: CandleData[], avgPeriod: number = 20, threshold: number = 2.0
): VolumeConfirmResult {
  const avgVol = calcVolumeSMA(candles, avgPeriod);
  if (avgVol <= 0 || candles.length < avgPeriod + 1) {
    return { confirmed: false, volRatio: 0 };
  }
  const curVol = candles[candles.length - 1].volume;
  const volRatio = curVol / avgVol;
  return { confirmed: volRatio >= threshold, volRatio };
}

/**
 * BTC Relative Strength — compares coin's N-bar change vs BTC's N-bar change.
 * NOT a standalone signal; used to boost/suppress existing strategy signals.
 *
 * Key backtest finding: BTC absolute advantage >= 1% is the best filter.
 * - avgPnl jumps from 0.171% (baseline) to 0.738% (4.3x improvement)
 * - Total PnL only drops ~10%
 * - Trade count halves (less noise)
 */
export function detectBTCStrength(
  coinCandles: CandleData[], btcCandles: CandleData[], lookback: number = 8
): BTCStrengthResult {
  const coinChange = calcNBarChange(coinCandles, lookback);
  const btcChange = calcNBarChange(btcCandles, lookback);
  const advantage = coinChange - btcChange;
  const ratio = btcChange !== 0 ? coinChange / btcChange : 0;
  return { coinChange, btcChange, advantage, ratio, lookback };
}
