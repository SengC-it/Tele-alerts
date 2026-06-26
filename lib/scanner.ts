import type { ScanResult, Signal, SignalRule, WatchItem, Layer, LayerConfig } from './types';
import { LAYER_CONFIGS } from './types';
import { getEnabledWatchlist, getEnabledRules, addSignal } from './supabase';
import { fetchOHLCV, fetchFundingRate, fetchTicker, loadMarkets } from './exchange';
import { calculateIndicators, isUpTrend } from './indicators';
import {
  detectEMACross, detectMACDFlip, detectRSIExtreme, detectBBBreakout,
  detectBBReversion, detectVolumeSurge, detectPriceVolume,
  detectFundingRateAnomaly, detectPriceChange, detectNewHighLow,
  applyTrendFilter, detectBBWithAutoDirection,
} from './detectors';
import { sendSignalEmail } from './notify';

let marketsLoaded = false;

/** Get layer config for a watch item (defaults to L1) */
function getLayerConfig(layer: Layer): LayerConfig {
  return LAYER_CONFIGS[layer] || LAYER_CONFIGS[1];
}

/** Run a single detector by rule ID, returning signal or null */
function runDetector(
  ruleId: string, symbol: string, timeframe: string,
  candles: any[], indicators: any, rules: SignalRule[]
): Signal | null {
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return null;

  switch (ruleId) {
    case 'ema_cross':
      return detectEMACross(symbol, timeframe, indicators);
    case 'macd_flip':
      return detectMACDFlip(symbol, timeframe, indicators);
    case 'rsi_extreme':
      return detectRSIExtreme(symbol, timeframe, indicators, rule.params.overbought, rule.params.oversold);
    case 'bb_breakout':
      return detectBBBreakout(symbol, timeframe, candles, indicators);
    case 'bb_reversion':
      return detectBBReversion(symbol, timeframe, candles, indicators);
    case 'volume_surge':
      return detectVolumeSurge(symbol, timeframe, candles);
    case 'price_volume':
      return detectPriceVolume(symbol, timeframe, candles);
    case 'new_high_low':
    case 'price_new_high_low':
      return detectNewHighLow(symbol, timeframe, candles, rule.params.lookback || 24);
    default:
      return null;
  }
}

/** Scan one symbol on one timeframe with layer-specific logic */
export async function scanSymbolLayered(
  item: WatchItem, rules: SignalRule[]
): Promise<ScanResult[]> {
  const config = getLayerConfig(item.layer);
  const results: ScanResult[] = [];

  // Load markets once
  if (!marketsLoaded) {
    await loadMarkets();
    marketsLoaded = true;
  }

  for (const tf of config.timeframes) {
    const result: ScanResult = {
      symbol: item.symbol, timeframe: tf, layer: item.layer,
      timestamp: Date.now(), signals: [],
    };

    try {
      const candles = await fetchOHLCV(item.symbol, tf, config.candleCount);
      if (candles.length < 50) {
        result.error = `K线不足(${candles.length})`;
        results.push(result);
        continue;
      }

      const indicators = calculateIndicators(candles);
      const upTrend = isUpTrend(indicators);
      const candidateSignals: (Signal | null)[] = [];

      for (const sigId of config.signals) {
        let signal: Signal | null = null;

        if (sigId === 'bb_breakout' && config.autoDirection) {
          // Auto-direction: switch breakout/reversion based on trend
          signal = detectBBWithAutoDirection(item.symbol, tf, candles, indicators);
        } else if (sigId === 'bb_reversion' && config.autoDirection) {
          // Already handled by bb_breakout when autoDirection is on
          continue;
        } else {
          signal = runDetector(sigId, item.symbol, tf, candles, indicators, rules);
        }

        // Apply trend filter if configured
        if (signal && config.trendFilter) {
          signal = applyTrendFilter(signal, indicators);
        }

        candidateSignals.push(signal);
      }

      // Extra signals (funding, price change) — parallel fetch
      const extraPromises: Promise<Signal | null>[] = [];
      for (const rule of rules) {
        if (rule.id === 'funding_rate') {
          extraPromises.push(
            fetchFundingRate(item.symbol)
              .then((info) => detectFundingRateAnomaly(item.symbol, info, rule.params.threshold))
              .catch(() => null)
          );
        }
        if (rule.id === 'price_change') {
          extraPromises.push(
            fetchTicker(item.symbol)
              .then((ticker) => detectPriceChange(item.symbol, ticker, rule.params.changePercent))
              .catch(() => null)
          );
        }
      }
      const extraResults = await Promise.all(extraPromises);
      candidateSignals.push(...extraResults);

      // Collect valid signals and save
      const validSignals = candidateSignals.filter((s): s is Signal => s !== null);
      for (const s of validSignals) {
        s.layer = item.layer;
      }
      result.signals = validSignals;

      // Store + notify
      for (const signal of validSignals) {
        const added = await addSignal(signal);
        if (added) {
          const layerLabel = LAYER_CONFIGS[item.layer]?.label || `L${item.layer}`;
          console.log(`[Signal] L${item.layer}(${layerLabel}) ${signal.direction.toUpperCase()} ${signal.name}: ${signal.symbol} ${tf}`);
          sendSignalEmail(signal).catch(() => {});
        }
      }
    } catch (err: any) {
      result.error = err.message;
      console.error(`[Scan] ${item.symbol} ${tf} L${item.layer} 失败:`, err.message);
    }

    results.push(result);
  }

  return results;
}

/** Scan all enabled watchlist items with layer-aware logic */
export async function scanAll(): Promise<ScanResult[]> {
  const items = await getEnabledWatchlist();
  const rules = await getEnabledRules();

  if (items.length === 0 || rules.length === 0) {
    console.log('[Scan] 无启用的监控标的或信号规则');
    return [];
  }

  // Log layer distribution
  const layerCounts: Record<number, number> = {};
  for (const item of items) {
    const l = item.layer || 1;
    layerCounts[l] = (layerCounts[l] || 0) + 1;
  }
  const layerSummary = Object.entries(layerCounts)
    .map(([l, c]) => `L${l}=${c}`)
    .join(', ');

  console.log(`[Scan] 开始扫描 ${items.length} 个标的 (${layerSummary})...`);
  const startTime = Date.now();

  // Scan each item (sequential to avoid API rate limits)
  const allResults: ScanResult[] = [];
  for (const item of items) {
    const results = await scanSymbolLayered(item, rules);
    allResults.push(...results);
  }

  const sigCount = allResults.reduce((s, r) => s + r.signals.length, 0);
  const errCount = allResults.filter((r) => r.error).length;
  console.log(`[Scan] 完成: ${items.length}标的 ${allResults.length}次扫描 ${sigCount}信号 ${errCount}错误 ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  return allResults;
}
