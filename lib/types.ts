export type Layer = 1 | 2 | 3 | 4;

export interface WatchItem {
  id?: number;
  symbol: string;
  timeframe: string;
  layer: Layer;
  enabled: boolean;
}

export interface SignalRule {
  id: string;
  type: 'technical' | 'funding' | 'price';
  name: string;
  params: Record<string, any>;
  enabled: boolean;
  /** Which layers this rule applies to (empty = all) */
  layers?: Layer[];
}

export type SignalDirection = 'long' | 'short' | 'neutral';

/**
 * Signal reliability tier:
 * - 'strategy': Backtest-validated core signals (bb_reversion, bb_breakout, etc.)
 * - 'info': Market state indicators (price_change, funding_rate) — NOT standalone trade signals
 */
export type SignalReliability = 'strategy' | 'info';

/** Rules that are "informational" only — they describe market state, not trade direction */
export const INFO_SIGNAL_IDS = ['price_change', 'funding_rate'];

/** Strategy signal entry/TP/SL levels derived from ATR */
export interface SignalLevels {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  /** Risk/Reward ratio (TP distance / SL distance) */
  riskReward: number;
}

export interface Signal {
  id: string;
  type: 'technical' | 'funding' | 'price';
  symbol: string;
  timeframe: string;
  name: string;
  direction: SignalDirection;
  message: string;
  strength: number; // 1-5
  layer?: Layer;
  data: Record<string, any>;
  created_at?: string;
  /** Whether this signal is backtest-validated strategy or informational context */
  reliability?: SignalReliability;
  /** When conflicting signals were merged, list the suppressed info signals */
  supportingSignals?: { name: string; direction: SignalDirection; message: string }[];
  /** Entry / Stop Loss / Take Profit levels (strategy signals only) */
  levels?: SignalLevels;
}

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FundingRateInfo {
  symbol: string;
  fundingRate: number;
  fundingTimestamp: number;
  markPrice: number;
  indexPrice: number;
  nextFundingTime: number;
}

export interface TickerInfo {
  symbol: string;
  last: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
}

export interface IndicatorResult {
  ema9: number[];
  ema21: number[];
  ema50: number[];
  ema200: number[];
  macd: { macd: number[]; signal: number[]; histogram: number[] };
  rsi: number[];
  bb: { upper: number[]; middle: number[]; lower: number[] };
  atr: number[];
}

export interface ScanResult {
  symbol: string;
  timeframe: string;
  layer?: Layer;
  timestamp: number;
  signals: Signal[];
  error?: string;
}

/** Per-layer strategy config */
export interface LayerConfig {
  layer: Layer;
  label: string;
  timeframes: string[];      // which timeframes to scan
  signals: string[];          // which signal IDs to apply
  trendFilter: boolean;       // apply EMA50/200 trend filter
  /** For BB signals: if true, auto-switch breakout/reversion based on trend */
  autoDirection: boolean;
  candleCount: number;        // how many candles to fetch
}

/** Default layer configs — matches backtest findings (v2: expanded from 30-coin backtest) */
export const LAYER_CONFIGS: Record<Layer, LayerConfig> = {
  1: {
    layer: 1, label: '蓝筹主流',
    timeframes: ['4h'],
    signals: ['bb_breakout', 'rsi_extreme'],
    trendFilter: true,
    autoDirection: false,
    candleCount: 300,
  },
  2: {
    layer: 2, label: '中盘突破',
    timeframes: ['4h'],
    signals: ['bb_breakout', 'rsi_extreme'],
    trendFilter: true,
    autoDirection: false,
    candleCount: 300,
  },
  3: {
    layer: 3, label: '高波动策略',
    timeframes: ['1h'],
    signals: ['bb_reversion', 'rsi_extreme'],
    trendFilter: true,
    autoDirection: false,
    candleCount: 300,
  },
  4: {
    layer: 4, label: '弹性新币',
    timeframes: ['4h', '1h'],
    signals: ['bb_breakout', 'bb_reversion', 'rsi_extreme'],
    trendFilter: true,
    autoDirection: true,
    candleCount: 300,
  },
};
