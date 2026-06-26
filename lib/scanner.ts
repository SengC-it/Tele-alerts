import type { ScanResult, Signal, SignalRule } from './types';
import { getEnabledWatchlist, getEnabledRules, addSignal } from './supabase';
import { fetchOHLCV, fetchFundingRate, fetchTicker, loadMarkets } from './exchange';
import { calculateIndicators } from './indicators';
import {
  detectEMACross, detectMACDFlip, detectRSIExtreme, detectBBBreakout,
  detectFundingRateAnomaly, detectPriceChange, detectNewHighLow,
} from './detectors';
import { sendSignalEmail } from './notify';

let marketsLoaded = false;

/** 扫描单个标的 */
export async function scanSymbol(
  symbol: string, timeframe: string, rules: SignalRule[]
): Promise<ScanResult> {
  const result: ScanResult = { symbol, timeframe, timestamp: Date.now(), signals: [] };

  try {
    // 加载市场
    if (!marketsLoaded) {
      await loadMarkets();
      marketsLoaded = true;
    }

    const candles = await fetchOHLCV(symbol, timeframe, 200);
    if (candles.length < 30) { result.error = 'K线数据不足'; return result; }

    const indicators = calculateIndicators(candles);
    const candidateSignals: (Signal | null)[] = [];

    for (const rule of rules) {
      switch (rule.id) {
        case 'ema_cross':
          candidateSignals.push(detectEMACross(symbol, timeframe, indicators));
          break;
        case 'macd_flip':
          candidateSignals.push(detectMACDFlip(symbol, timeframe, indicators));
          break;
        case 'rsi_extreme':
          candidateSignals.push(detectRSIExtreme(
            symbol, timeframe, indicators,
            rule.params.overbought, rule.params.oversold
          ));
          break;
        case 'bb_breakout':
          candidateSignals.push(detectBBBreakout(symbol, timeframe, candles, indicators));
          break;
        case 'price_new_high_low':
          candidateSignals.push(detectNewHighLow(symbol, timeframe, candles, rule.params.lookback));
          break;
      }
    }

    // 资金面 & 价格面（需要额外 API 调用，用 Promise.allSettled 并行）
    const extraPromises: Promise<Signal | null>[] = [];

    for (const rule of rules) {
      if (rule.id === 'funding_rate') {
        extraPromises.push(
          fetchFundingRate(symbol)
            .then((info) => detectFundingRateAnomaly(symbol, info, rule.params.threshold))
            .catch(() => null)
        );
      }
      if (rule.id === 'price_change') {
        extraPromises.push(
          fetchTicker(symbol)
            .then((ticker) => detectPriceChange(symbol, ticker, rule.params.changePercent))
            .catch(() => null)
        );
      }
    }

    const extraResults = await Promise.all(extraPromises);
    candidateSignals.push(...extraResults);

    // 收集有效信号
    const validSignals = candidateSignals.filter((s): s is Signal => s !== null);
    result.signals = validSignals;

    // 存储 + 通知（不阻塞主流程）
    for (const signal of validSignals) {
      const added = await addSignal(signal);
      if (added) {
        console.log(`[Signal] ${signal.direction.toUpperCase()} ${signal.name}: ${signal.symbol}`);
        sendSignalEmail(signal).catch(() => {});
      }
    }
  } catch (err: any) {
    result.error = err.message;
    console.error(`[Scan] ${symbol} 失败:`, err.message);
  }

  return result;
}

/** 扫描全部监控列表 */
export async function scanAll(): Promise<ScanResult[]> {
  const items = await getEnabledWatchlist();
  const rules = await getEnabledRules();

  if (items.length === 0 || rules.length === 0) {
    console.log('[Scan] 无启用的监控标的或信号规则');
    return [];
  }

  console.log(`[Scan] 开始扫描 ${items.length} 个标的...`);
  const startTime = Date.now();

  // 逐个扫描（避免 API 限频），但每个标的内部并行获取资金面/价格面数据
  const results: ScanResult[] = [];
  for (const item of items) {
    const r = await scanSymbol(item.symbol, item.timeframe, rules);
    results.push(r);
  }

  const sigCount = results.reduce((s, r) => s + r.signals.length, 0);
  const errCount = results.filter((r) => r.error).length;
  console.log(`[Scan] 完成: ${items.length}标的 ${sigCount}信号 ${errCount}错误 ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  return results;
}
