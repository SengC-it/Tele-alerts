import type { ScanResult, Signal, SignalRule, WatchItem, Layer, LayerConfig, SignalDirection, SignalLevels } from './types';
import { LAYER_CONFIGS, INFO_SIGNAL_IDS } from './types';
import { getEnabledWatchlist, getEnabledRules, addSignal } from './supabase';
import { fetchOHLCV, fetchFundingRate, fetchTicker, loadMarkets } from './exchange';
import { calculateIndicators, isUpTrend, last } from './indicators';
import {
  detectEMACross, detectMACDFlip, detectRSIExtreme, detectBBBreakout,
  detectBBReversion, detectVolumeSurge, detectPriceVolume,
  detectFundingRateAnomaly, detectPriceChange, detectNewHighLow,
  applyTrendFilter, detectBBWithAutoDirection,
} from './detectors';
import { sendSignalSummaryEmail } from './notify';

let marketsLoaded = false;

/**
 * Calculate entry/SL/TP levels for a strategy signal using ATR.
 * - SL = 1.5 × ATR (reasonable for crypto volatility)
 * - TP = 3.0 × ATR (2:1 reward/risk)
 * - ATR comes from the same timeframe candles used for the signal
 */
function calculateLevels(
  signal: Signal, close: number, atr: number | undefined
): Signal | null {
  if (!atr || atr <= 0 || close <= 0) return signal;
  if (signal.direction !== 'long' && signal.direction !== 'short') return signal;
  if (signal.reliability !== 'strategy') return signal;

  const slMultiplier = 1.5;
  const tpMultiplier = 3.0;

  if (signal.direction === 'long') {
    const sl = close - slMultiplier * atr;
    const tp = close + tpMultiplier * atr;
    signal.levels = { entry: close, stopLoss: sl, takeProfit: tp, riskReward: tpMultiplier / slMultiplier };
  } else {
    const sl = close + slMultiplier * atr;
    const tp = close - tpMultiplier * atr;
    signal.levels = { entry: close, stopLoss: sl, takeProfit: tp, riskReward: tpMultiplier / slMultiplier };
  }

  return signal;
}

/** Get layer config for a watch item (defaults to L1) */
function getLayerConfig(layer: Layer): LayerConfig {
  return LAYER_CONFIGS[layer] || LAYER_CONFIGS[1];
}

/** Tag each signal with reliability tier */
function tagReliability(signal: Signal | null): Signal | null {
  if (!signal) return null;
  // Extract base rule id from signal id (e.g. "price_change_SOL/USDT:USDT_xxx" → "price_change")
  const ruleId = signal.id.split('_').slice(0, 2).join('_');
  // More precise check: strip symbol and timestamp suffix
  const baseId = signal.id.replace(/_[A-Z/]+:USDT_\d+$/, '');
  signal.reliability = INFO_SIGNAL_IDS.includes(baseId) ? 'info' : 'strategy';
  return signal;
}

/**
 * Resolve conflicting signals for the same symbol.
 * When a strategy signal and an info signal have opposite directions,
 * the strategy signal wins and the info signal is demoted to supporting context.
 *
 * Rules:
 * 1. If no direction conflict → keep all signals as-is
 * 2. If conflict: strategy signals always win over info signals
 * 3. Info signals with opposite direction are demoted to `supportingSignals` on the strategy signal
 * 4. If only info signals conflict (no strategy signal) → keep the strongest one, demote the rest
 */
function resolveConflicts(signals: Signal[]): Signal[] {
  if (signals.length <= 1) return signals;

  const strategySignals = signals.filter(s => s.reliability === 'strategy');
  const infoSignals = signals.filter(s => s.reliability === 'info');

  // No strategy signals at all — keep only the strongest info signal
  if (strategySignals.length === 0) {
    if (infoSignals.length <= 1) return infoSignals;
    // Multiple info signals: keep the one with highest strength
    const strongest = infoSignals.reduce((a, b) => a.strength >= b.strength ? a : b);
    const others = infoSignals.filter(s => s.id !== strongest.id);
    if (others.length > 0) {
      strongest.supportingSignals = others.map(s => ({
        name: s.name, direction: s.direction, message: s.message,
      }));
      // Adjust message to acknowledge context
      const ctxDirs = [...new Set(others.map(s => s.direction))];
      if (ctxDirs.includes(strongest.direction === 'long' ? 'short' : 'long')) {
        strongest.message += ` (参考: ${others.map(s => s.message).join('; ')})`;
      }
    }
    return [strongest];
  }

  // Check if any strategy signal conflicts with any info signal
  const strategyDirs = new Set(strategySignals.map(s => s.direction));
  const conflictingInfo = infoSignals.filter(s => !strategyDirs.has(s.direction));
  const alignedInfo = infoSignals.filter(s => strategyDirs.has(s.direction));

  if (conflictingInfo.length === 0) {
    // No conflicts — return all
    return [...strategySignals, ...alignedInfo];
  }

  // Conflicts exist: demote conflicting info signals to supporting context on strategy signals
  const result: Signal[] = [...strategySignals];

  // Attach conflicting info as supporting context to the first strategy signal
  if (strategySignals.length > 0) {
    const primary = strategySignals[0];
    primary.supportingSignals = [
      ...(primary.supportingSignals || []),
      ...conflictingInfo.map(s => ({
        name: s.name, direction: s.direction, message: s.message,
      })),
    ];
    // Enrich the message with context
    const conflictMsg = conflictingInfo.map(s => {
      const dir = s.direction === 'long' ? '偏多' : '偏空';
      return `${s.name}(${dir})`;
    }).join(', ');
    primary.message += ` [背景: ${conflictMsg} — 策略信号优先]`;
  }

  // Keep aligned info signals (they reinforce the strategy direction)
  result.push(...alignedInfo);

  return result;
}

/** Run a single detector by rule ID, returning signal or null */
function runDetector(
  ruleId: string, symbol: string, timeframe: string,
  candles: any[], indicators: any, rules: SignalRule[]
): Signal | null {
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return null;

  let signal: Signal | null = null;

  switch (ruleId) {
    case 'ema_cross':
      signal = detectEMACross(symbol, timeframe, indicators); break;
    case 'macd_flip':
      signal = detectMACDFlip(symbol, timeframe, indicators); break;
    case 'rsi_extreme':
      signal = detectRSIExtreme(symbol, timeframe, indicators, rule.params.overbought, rule.params.oversold); break;
    case 'bb_breakout':
      signal = detectBBBreakout(symbol, timeframe, candles, indicators); break;
    case 'bb_reversion':
      signal = detectBBReversion(symbol, timeframe, candles, indicators); break;
    case 'volume_surge':
      signal = detectVolumeSurge(symbol, timeframe, candles); break;
    case 'price_volume':
      signal = detectPriceVolume(symbol, timeframe, candles); break;
    case 'new_high_low':
    case 'price_new_high_low':
      signal = detectNewHighLow(symbol, timeframe, candles, rule.params.lookback || 24); break;
  }

  return tagReliability(signal);
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
      const closeNow = candles[candles.length - 1]?.close;
      const atrNow = last(indicators.atr);
      const candidateSignals: (Signal | null)[] = [];

      for (const sigId of config.signals) {
        let signal: Signal | null = null;

        if (sigId === 'bb_breakout' && config.autoDirection) {
          signal = detectBBWithAutoDirection(item.symbol, tf, candles, indicators);
          signal = tagReliability(signal);
        } else if (sigId === 'bb_reversion' && config.autoDirection) {
          continue;
        } else {
          signal = runDetector(sigId, item.symbol, tf, candles, indicators, rules);
        }

        // Apply trend filter if configured
        if (signal && config.trendFilter) {
          signal = applyTrendFilter(signal, indicators);
        }

        // Calculate entry/SL/TP for strategy signals using ATR
        if (signal && closeNow) {
          signal = calculateLevels(signal, closeNow, atrNow);
        }

        candidateSignals.push(signal);
      }

      // Extra signals (funding, price change) — parallel fetch
      const extraPromises: Promise<Signal | null>[] = [];
      for (const rule of rules) {
        if (rule.id === 'funding_rate') {
          extraPromises.push(
            fetchFundingRate(item.symbol)
              .then((info) => tagReliability(detectFundingRateAnomaly(item.symbol, info, rule.params.threshold)))
              .catch(() => null)
          );
        }
        if (rule.id === 'price_change') {
          extraPromises.push(
            fetchTicker(item.symbol)
              .then((ticker) => tagReliability(detectPriceChange(item.symbol, ticker, rule.params.changePercent)))
              .catch(() => null)
          );
        }
      }
      const extraResults = await Promise.all(extraPromises);
      candidateSignals.push(...extraResults);

      // Collect all valid signals
      const rawSignals = candidateSignals.filter((s): s is Signal => s !== null);
      for (const s of rawSignals) {
        s.layer = item.layer;
      }

      // Resolve direction conflicts: strategy signals win, info signals demoted to context
      const resolvedSignals = resolveConflicts(rawSignals);
      result.signals = resolvedSignals;

      // Store signals to DB (email sent in bulk by scanAll)
      for (const signal of resolvedSignals) {
        const added = await addSignal(signal);
        if (added) {
          const layerLabel = LAYER_CONFIGS[item.layer]?.label || `L${item.layer}`;
          console.log(`[Signal] L${item.layer}(${layerLabel}) ${signal.direction.toUpperCase()} ${signal.name}: ${signal.symbol} ${tf}${signal.levels ? ` Entry=${signal.levels.entry} SL=${signal.levels.stopLoss} TP=${signal.levels.takeProfit}` : ''}`);
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
  const newSignals: Signal[] = []; // Collect signals that passed cooldown (new only)

  for (const item of items) {
    const results = await scanSymbolLayered(item, rules);
    allResults.push(...results);
  }

  // Collect signals that were actually stored (new, not in cooldown)
  for (const r of allResults) {
    for (const s of r.signals) {
      // Signals with created_at were stored (addSignal returned true)
      // We need to track this — let's collect from scan results instead
    }
  }

  const sigCount = allResults.reduce((s, r) => s + r.signals.length, 0);
  const errCount = allResults.filter((r) => r.error).length;
  console.log(`[Scan] 完成: ${items.length}标的 ${allResults.length}次扫描 ${sigCount}信号 ${errCount}错误 ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  // Send ONE aggregated email for all signals from this scan
  const allSignals = allResults.flatMap(r => r.signals);
  if (allSignals.length > 0) {
    sendSignalSummaryEmail(allSignals).catch((err) => {
      console.error('[Scan] 汇总邮件发送失败:', err.message);
    });
  }

  return allResults;
}
