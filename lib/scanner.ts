import type { ScanResult, Signal, SignalRule, WatchItem, Layer, LayerConfig, SignalDirection, SignalLevels, VolumeConfirmResult, BTCStrengthResult } from './types';
import { LAYER_CONFIGS, INFO_SIGNAL_IDS } from './types';
import { getEnabledWatchlist, getEnabledRules, addSignal } from './supabase';
import { fetchOHLCV, fetchFundingRate, fetchTicker, loadMarkets } from './exchange';
import { calculateIndicators, last } from './indicators';
import {
  detectEMACross, detectMACDFlip, detectRSIExtreme, detectBBBreakout,
  detectBBReversion, detectVolumeSurge, detectPriceVolume,
  detectFundingRateAnomaly, detectPriceChange, detectNewHighLow,
  applyTrendFilter, detectBBWithAutoDirection,
  detectVolumeConfirm, detectBTCStrength,
} from './detectors';

let marketsLoaded = false;

/** BTC candle cache — fetched once per scan, shared across all symbols */
export interface BTCCache {
  [timeframe: string]: any[]; // CandleData[] keyed by timeframe ('4h', '1h', etc.)
}

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

/**
 * Apply volume confirmation and BTC relative strength filters to a strategy signal.
 * These are quality boosters, not hard filters — they boost/suppress signal strength.
 *
 * Backtest findings:
 * - BTC absolute advantage >= 1%: avgPnl 4.3x improvement, only ~10% trade reduction
 * - Volume >= 2x: strength +1 boost
 * - Design: boost strength instead of hard-filtering to avoid losing too many trades
 */
function applyVolumeAndBTCStrength(
  signal: Signal,
  config: LayerConfig,
  candles: any[],
  btcCandles: any[] | undefined
): void {
  if (signal.reliability !== 'strategy') return;
  if (signal.direction !== 'long' && signal.direction !== 'short') return;

  // Volume confirmation boost
  if (config.volumeBoost) {
    const volResult = detectVolumeConfirm(candles, 20, config.volumeThreshold);
    signal.data.volumeConfirm = volResult.confirmed;
    signal.data.volRatio = Math.round(volResult.volRatio * 10) / 10;
    if (volResult.confirmed) {
      signal.strength = Math.min(5, signal.strength + 1);
      signal.message += ` [放量${volResult.volRatio.toFixed(1)}x]`;
    }
  }

  // BTC relative strength boost
  if (config.btcStrengthFilter && btcCandles && btcCandles.length >= 9) {
    const strength = detectBTCStrength(candles, btcCandles, 8);
    signal.data.btcStrength = strength;

    // Check if coin outperforms BTC in the SAME direction as the signal
    const isLong = signal.direction === 'long';
    const coinOutperforms = isLong
      ? strength.advantage >= config.btcStrengthThreshold * 100  // threshold is e.g. 0.01, need 1%
      : strength.advantage <= -(config.btcStrengthThreshold * 100);

    if (coinOutperforms) {
      signal.strength = Math.min(5, signal.strength + 1);
      const dir = isLong ? '强于' : '弱于';
      signal.message += ` [${dir}BTC ${Math.abs(strength.advantage).toFixed(1)}%]`;
    }
  }
}

/** Scan one symbol across its layer's timeframes (parallel within symbol) */
export async function scanSymbolLayered(
  item: WatchItem, rules: SignalRule[], btcCache: BTCCache = {}
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

          // Apply volume confirmation + BTC relative strength boosters
          if (signal) {
            applyVolumeAndBTCStrength(signal, config, candles, btcCache[tf]);
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
            console.log(`[Signal] L${item.layer}(${layerLabel}) ${signal.direction.toUpperCase()} ${signal.name}: ${signal.symbol} ${tf}${signal.levels ? ` Entry=${signal.levels.entry} SL=${signal.levels.stopLoss} TP=${signal.levels.takeProfit}` : ''}${signal.data.volumeConfirm ? ' VOL' : ''}${signal.data.btcStrength ? ' BTC-RS' : ''}`);
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

  // Pre-fetch BTC candles for all timeframes that need BTC strength filter
  // This is done once per scan instead of per-symbol, saving ~19 API calls
  const btcCache: BTCCache = {};
  const btCNeeded = new Set<string>();
  for (const item of items) {
    const config = getLayerConfig(item.layer);
    if (config.btcStrengthFilter) {
      for (const tf of config.timeframes) {
        btCNeeded.add(tf);
      }
    }
  }
  if (btCNeeded.size > 0) {
    try {
      await loadMarkets();
      marketsLoaded = true;
      const btcPromises = [...btCNeeded].map(async (tf) => {
        const candles = await fetchOHLCV('BTC/USDT:USDT', tf, 300);
        return { tf, candles };
      });
      const btcResults = await Promise.all(btcPromises);
      for (const { tf, candles } of btcResults) {
        if (candles.length >= 9) {
          btcCache[tf] = candles;
        }
      }
      console.log(`[Scan] BTC缓存已加载: ${Object.keys(btcCache).join(', ')}`);
    } catch (err: any) {
      console.warn(`[Scan] BTC缓存加载失败(继续扫描): ${err.message}`);
    }
  }

  // Parallel scan with controlled concurrency
  const allResults: ScanResult[] = [];
  const CONCURRENCY = 5;

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(item => scanSymbolLayered(item, rules, btcCache).catch((err) => {
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
