import type { IndicatorResult, CandleData, FundingRateInfo, TickerInfo, Signal } from './types';
import { last, secondLast } from './indicators';

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
