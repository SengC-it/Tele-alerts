export interface WatchItem {
  id?: number;
  symbol: string;
  timeframe: string;
  enabled: boolean;
}

export interface SignalRule {
  id: string;
  type: 'technical' | 'funding' | 'price';
  name: string;
  params: Record<string, any>;
  enabled: boolean;
}

export type SignalDirection = 'long' | 'short' | 'neutral';

export interface Signal {
  id: string;
  type: 'technical' | 'funding' | 'price';
  symbol: string;
  timeframe: string;
  name: string;
  direction: SignalDirection;
  message: string;
  strength: number; // 1-5
  data: Record<string, any>;
  created_at?: string;
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
  macd: { macd: number[]; signal: number[]; histogram: number[] };
  rsi: number[];
  bb: { upper: number[]; middle: number[]; lower: number[] };
}

export interface ScanResult {
  symbol: string;
  timeframe: string;
  timestamp: number;
  signals: Signal[];
  error?: string;
}
