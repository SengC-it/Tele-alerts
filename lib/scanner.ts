import type { ScanResult, Signal, SignalRule, WatchItem, Layer, LayerConfig, SignalDirection, SignalLevels } from './types';
import { LAYER_CONFIGS, INFO_SIGNAL_IDS } from './types';
import { getEnabledWatchlist, getEnabledRules, addSignal } from './supabase';
import { fetchOHLCV, fetchFundingRate, fetchTicker, loadMarkets } from './exchange';
import { calculateIndicators, last } from './indicators';
import {
  detectEMACross, detectMACDFlip, detectRSIExtreme, detectBBBreakout,
  detectBBReversion, detectVolumeSurge, detectPriceVolume,
  detectFundingRateAnomaly, detectPriceChange, detectNewHighLow,
  applyTrendFilter, detectBBWithAutoDirection,
} from './detectors';

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

/** Scan one symbol across its layer's timeframes (parallel within symbol) */
export async function scanSymbolLayered(
  item: WatchItem, rules: SignalRule[]
): Promise<ScanResult[]> {
  const config = getLayerConfig(item.layer);

  // Load markets once
  if (!marketsLoaded) {
    await loadMarkets();
    marketsLoaded = true;
  }

  // Scan all timeframes in parallel — strategy signals only
  // Info signals (funding, price_change) are handled at scanAll level to avoid duplicates
  const results = await Promise.all(
    config.timeframes.map(async (tf) => {
      const result: ScanResult = {
        symbol: item.symbol, timeframe: tf, layer: item.layer,
        timestamp: Date.now(), signals: [],
      };

      try {
        const candles = await fetchOHLCV(item.symbol, tf, config.candleCount);

        if (candles.length < 50) {
          result.error = `K线不足(${candles.length})`;
          return result;
        }

        const indicators = calculateIndicators(candles);
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

          if (signal && config.trendFilter) {
            signal = applyTrendFilter(signal, indicators);
          }

          if (signal && closeNow) {
            signal = calculateLevels(signal, closeNow, atrNow);
          }

          candidateSignals.push(signal);
        }

        const rawSignals = candidateSignals.filter((s): s is Signal => s !== null);
        for (const s of rawSignals) {
          s.layer = item.layer;
        }

        const resolvedSignals = resolveConflicts(rawSignals);
        result.signals = resolvedSignals;

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

      return result;
    })
  );

  return results;
}

  // Scan all timeframes in parallel — info signals handled separately in scanAll
  const results = await Promise.all(
    config.timeframes.map(async (tf) => {
      const result: ScanResult = {
        symbol: item.symbol, timeframe: tf, layer: item.layer,
        timestamp: Date.now(), signals: [],
      };

      try {
        const candles = await fetchOHLCV(item.symbol, tf, config.candleCount);

        if (candles.length < 50) {
          result.error = `K线不足(${candles.length})`;
          return result;
        }

        const indicators = calculateIndicators(candles);
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

        // Collect all valid signals
        const rawSignals = candidateSignals.filter((s): s is Signal => s !== null);
        for (const s of rawSignals) {
          s.layer = item.layer;
        }

        // Resolve direction conflicts
        const resolvedSignals = resolveConflicts(rawSignals);
        result.signals = resolvedSignals;

        // Store signals to DB
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

      return result;
    })
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
  // Start fetching early, results shared across all timeframes
  const extraResultsPromise = Promise.all(extraPromises);

  // Scan all timeframes in parallel
  const isFirstTf = { value: true }; // Track which TF gets the info signals
  const results = await Promise.all(
    config.timeframes.map(async (tf) => {
      const result: ScanResult = {
        symbol: item.symbol, timeframe: tf, layer: item.layer,
        timestamp: Date.now(), signals: [],
      };

      try {
        const [candles, extraResults] = await Promise.all([
          fetchOHLCV(item.symbol, tf, config.candleCount),
          extraResultsPromise,
        ]);

        if (candles.length < 50) {
          result.error = `K线不足(${candles.length})`;
          return result;
        }

        const indicators = calculateIndicators(candles);
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

        // Add shared info signals (funding, price_change) only to the FIRST timeframe
        // to avoid duplicate DB writes from concurrent timeframes
        if (isFirstTf.value) {
          candidateSignals.push(...extraResults);
          isFirstTf.value = false;
        }

        // Collect all valid signals
        const rawSignals = candidateSignals.filter((s): s is Signal => s !== null);
        for (const s of rawSignals) {
          s.layer = item.layer;
        }

        // Resolve direction conflicts
        const resolvedSignals = resolveConflicts(rawSignals);
        result.signals = resolvedSignals;

        // Store signals to DB
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

      return result;
    })
  );

  return results;
}

/** Scan all enabled watchlist items with layer-aware logic and parallel execution */
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

  // Parallel scan with controlled concurrency
  const allResults: ScanResult[] = [];
  const CONCURRENCY = 5;

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(item => scanSymbolLayered(item, rules).catch((err) => {
        console.error(`[Scan] ${item.symbol} L${item.layer} 失败:`, err.message);
        return [{
          symbol: item.symbol,
          timeframe: LAYER_CONFIGS[item.layer]?.timeframes[0] || '1h',
          layer: item.layer,
          timestamp: Date.now(),
          signals: [],
          error: err.message,
        }] as ScanResult[];
      }))
    );
    allResults.push(...batchResults.flat());
  }

  // Collect info signals (funding_rate + price_change) — once per unique symbol
  const seenSymbols = new Set<string>();
  const infoSignals: Signal[] = [];
  for (const item of items) {
    if (seenSymbols.has(item.symbol)) continue;
    seenSymbols.add(item.symbol);

    const infoPromises: Promise<Signal | null>[] = [];
    for (const rule of rules) {
      if (rule.id === 'funding_rate') {
        infoPromises.push(
          fetchFundingRate(item.symbol)
            .then((info) => tagReliability(detectFundingRateAnomaly(item.symbol, info, rule.params.threshold)))
            .catch(() => null)
        );
      }
      if (rule.id === 'price_change') {
        infoPromises.push(
          fetchTicker(item.symbol)
            .then((ticker) => tagReliability(detectPriceChange(item.symbol, ticker, rule.params.changePercent)))
            .catch(() => null)
        );
      }
    }
    const infoResults = await Promise.all(infoPromises);
    for (const sig of infoResults) {
      if (sig) {
        sig.layer = item.layer;
        infoSignals.push(sig);
      }
    }
  }

  // Write info signals to DB
  for (const sig of infoSignals) {
    const added = await addSignal(sig);
    if (added) {
      const layerLabel = LAYER_CONFIGS[sig.layer || 1]?.label || `L${sig.layer}`;
      console.log(`[InfoSignal] ${layerLabel} ${sig.direction.toUpperCase()} ${sig.name}: ${sig.symbol}`);
    }
  }

  // Merge info signals into results (attach to first result of each symbol)
  if (infoSignals.length > 0) {
    const sigBySymbol = new Map<string, Signal[]>();
    for (const sig of infoSignals) {
      const arr = sigBySymbol.get(sig.symbol) || [];
      arr.push(sig);
      sigBySymbol.set(sig.symbol, arr);
    }
    for (const r of allResults) {
      const syms = sigBySymbol.get(r.symbol);
      if (syms && syms.length > 0) {
        r.signals = [...syms, ...r.signals];
        sigBySymbol.delete(r.symbol); // Only add to first result per symbol
      }
    }
  }

  const sigCount = allResults.reduce((s, r) => s + r.signals.length, 0);
  const errCount = allResults.filter((r) => r.error).length;
  console.log(`[Scan] 完成: ${items.length}标的 ${allResults.length}次扫描 ${sigCount}信号 (${infoSignals.length}info) ${errCount}错误 ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  return allResults;
}
