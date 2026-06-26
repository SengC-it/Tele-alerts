-- Tele-Alerts 数据库初始化
-- 在 Supabase SQL Editor 中执行

-- ========== 监控列表 ==========
CREATE TABLE IF NOT EXISTS watchlist (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT '15m',
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol, timeframe)
);

-- ========== 信号规则 ==========
CREATE TABLE IF NOT EXISTS signal_rules (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('technical', 'funding', 'price')),
  name TEXT NOT NULL,
  params JSONB DEFAULT '{}',
  enabled BOOLEAN DEFAULT TRUE
);

-- ========== 信号记录 ==========
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT DEFAULT '-',
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('long', 'short', 'neutral')),
  message TEXT,
  strength INTEGER DEFAULT 1 CHECK (strength BETWEEN 1 AND 5),
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== 信号冷却（防止同一信号频繁触发）==========
CREATE TABLE IF NOT EXISTS signal_cooldown (
  key TEXT PRIMARY KEY,
  last_triggered TIMESTAMPTZ NOT NULL
);

-- ========== 索引 ==========
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_type ON signals(type);
CREATE INDEX IF NOT EXISTS idx_signals_direction ON signals(direction);
CREATE INDEX IF NOT EXISTS idx_watchlist_enabled ON watchlist(enabled);
CREATE INDEX IF NOT EXISTS idx_signal_cooldown_last ON signal_cooldown(last_triggered);

-- ========== 初始数据：默认信号规则 ==========
INSERT INTO signal_rules (id, type, name, params, enabled) VALUES
  ('ema_cross', 'technical', 'EMA金叉/死叉', '{"fastPeriod":9,"slowPeriod":21}', TRUE),
  ('macd_flip', 'technical', 'MACD柱状图翻红/翻绿', '{"fastPeriod":12,"slowPeriod":26,"signalPeriod":9}', TRUE),
  ('rsi_extreme', 'technical', 'RSI超买/超卖', '{"period":14,"overbought":70,"oversold":30}', TRUE),
  ('bb_breakout', 'technical', '布林带突破', '{"period":20,"stdDev":2}', TRUE),
  ('funding_rate', 'funding', '资金费率异常', '{"threshold":0.05}', TRUE),
  ('oi_surge', 'funding', '持仓量异动', '{"changePercent":10}', TRUE),
  ('price_change', 'price', '24h涨跌幅异动', '{"changePercent":5}', TRUE),
  ('price_new_high_low', 'price', 'N周期新高/新低', '{"lookback":24}', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ========== 初始数据：默认监控列表 ==========
INSERT INTO watchlist (symbol, timeframe, enabled) VALUES
  ('BTC/USDT:USDT', '15m', TRUE),
  ('ETH/USDT:USDT', '15m', TRUE),
  ('SOL/USDT:USDT', '15m', TRUE)
ON CONFLICT (symbol, timeframe) DO NOTHING;

-- ========== 自动清理旧数据（保留 30 天）==========
-- 可以通过 Supabase pg_cron 扩展或 GitHub Actions 定期执行
-- DELETE FROM signals WHERE created_at < NOW() - INTERVAL '30 days';
-- DELETE FROM signal_cooldown WHERE last_triggered < NOW() - INTERVAL '1 day';
