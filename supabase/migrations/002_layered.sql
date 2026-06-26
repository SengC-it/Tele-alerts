-- Tele-Alerts 分层策略迁移
-- 在 Supabase SQL Editor 中执行 (在 001_init.sql 之后)

-- ========== 1. Watchlist 添加 layer 字段 ==========
ALTER TABLE tele_watchlist ADD COLUMN IF NOT EXISTS layer SMALLINT DEFAULT 1
  CHECK (layer BETWEEN 1 AND 4);

-- ========== 2. Signals 添加 layer 字段 ==========
ALTER TABLE tele_signals ADD COLUMN IF NOT EXISTS layer SMALLINT;

-- ========== 3. Signal Rules 添加 layers 字段 (JSONB) ==========
ALTER TABLE tele_signal_rules ADD COLUMN IF NOT EXISTS layers JSONB DEFAULT '[]';

-- ========== 4. 新增信号规则 ==========
INSERT INTO tele_signal_rules (id, type, name, params, enabled, layers) VALUES
  ('bb_reversion', 'technical', '布林带回归', '{"period":20,"stdDev":2}', TRUE, '[2,3,4]'),
  ('volume_surge', 'technical', '成交量异动', '{"multiplier":3,"avgPeriod":20}', TRUE, '[3,4]'),
  ('price_volume', 'technical', '量价共振', '{"volumeMultiplier":2,"lookback":24}', TRUE, '[4]'),
  ('new_high_low', 'price', 'N周期新高/新低', '{"lookback":24}', TRUE, '[1,2]')
ON CONFLICT (id) DO NOTHING;

-- ========== 5. 更新默认监控列表为分层配置 ==========
-- 先清空旧数据
DELETE FROM tele_watchlist;

-- L1 蓝筹: 4h BB breakout + trend filter
INSERT INTO tele_watchlist (symbol, timeframe, layer, enabled) VALUES
  ('BTC/USDT:USDT', '4h', 1, TRUE),
  ('ETH/USDT:USDT', '4h', 1, TRUE)
ON CONFLICT (symbol, timeframe) DO NOTHING;

-- L2 中市值: 4h + 1h 混合
INSERT INTO tele_watchlist (symbol, timeframe, layer, enabled) VALUES
  ('SOL/USDT:USDT', '4h', 2, TRUE),
  ('AVAX/USDT:USDT', '4h', 2, TRUE),
  ('LINK/USDT:USDT', '4h', 2, TRUE)
ON CONFLICT (symbol, timeframe) DO NOTHING;

-- L3 高波动: 1h reversion
INSERT INTO tele_watchlist (symbol, timeframe, layer, enabled) VALUES
  ('DOGE/USDT:USDT', '1h', 3, TRUE),
  ('WIF/USDT:USDT', '1h', 3, TRUE)
ON CONFLICT (symbol, timeframe) DO NOTHING;

-- L4 动态热门: 暂不添加，通过 hotcoin-scan API 动态更新
-- 如需手动测试：
-- INSERT INTO tele_watchlist (symbol, timeframe, layer, enabled) VALUES
--   ('PEPE/USDT:USDT', '4h', 4, TRUE)
-- ON CONFLICT (symbol, timeframe) DO NOTHING;

-- ========== 6. 更新冷却时间——4h信号需要更长冷却 ==========
-- 不改表结构，冷却逻辑在代码中按周期调整

-- ========== 7. 索引 ==========
CREATE INDEX IF NOT EXISTS idx_tele_signals_layer ON tele_signals(layer);
CREATE INDEX IF NOT EXISTS idx_tele_watchlist_layer ON tele_watchlist(layer);
