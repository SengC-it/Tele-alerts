import ccxt, { type Exchange } from 'ccxt';
import type { CandleData, FundingRateInfo, TickerInfo } from './types';

let exchange: Exchange | null = null;

export function getExchange(): Exchange {
  if (exchange) return exchange;

  exchange = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY || '',
    secret: process.env.BINANCE_API_SECRET || '',
    options: {
      defaultType: 'future',
      adjustForTimeDifference: true,
    },
    enableRateLimit: true,
  });

  return exchange;
}

/** 获取K线数据 */
export async function fetchOHLCV(
  symbol: string,
  timeframe: string,
  limit: number = 200
): Promise<CandleData[]> {
  const ex = getExchange();
  const raw = await ex.fetchOHLCV(symbol, timeframe, undefined, limit);
  return raw.map((c) => ({
    timestamp: c[0] as number,
    open: c[1] as number,
    high: c[2] as number,
    low: c[3] as number,
    close: c[4] as number,
    volume: c[5] as number,
  }));
}

/** 获取资金费率 */
export async function fetchFundingRate(symbol: string): Promise<FundingRateInfo> {
  const ex = getExchange();
  const binanceSymbol = symbol.replace('/', '').replace(':USDT', '');

  const response = await (ex as any).fapiPublicGetPremiumIndex({
    symbol: binanceSymbol,
  });

  if (Array.isArray(response)) {
    const item = response.find((r: any) => r.symbol === binanceSymbol);
    if (item) {
      return {
        symbol,
        fundingRate: parseFloat(item.lastFundingRate),
        fundingTimestamp: item.time,
        markPrice: parseFloat(item.markPrice),
        indexPrice: parseFloat(item.indexPrice),
        nextFundingTime: item.nextFundingTime,
      };
    }
  }

  return {
    symbol,
    fundingRate: parseFloat(response.lastFundingRate || '0'),
    fundingTimestamp: response.time || Date.now(),
    markPrice: parseFloat(response.markPrice || '0'),
    indexPrice: parseFloat(response.indexPrice || '0'),
    nextFundingTime: response.nextFundingTime || 0,
  };
}

/** 获取行情 Ticker */
export async function fetchTicker(symbol: string): Promise<TickerInfo> {
  const ex = getExchange();
  const ticker = await ex.fetchTicker(symbol);
  return {
    symbol,
    last: ticker.last || 0,
    change24h: ticker.change || 0,
    changePercent24h: ticker.percentage || 0,
    high24h: ticker.high || 0,
    low24h: ticker.low || 0,
    volume24h: ticker.baseVolume || 0,
    quoteVolume24h: ticker.quoteVolume || 0,
  };
}

/** 加载市场信息 */
export async function loadMarkets(): Promise<void> {
  const ex = getExchange();
  await ex.loadMarkets();
}
