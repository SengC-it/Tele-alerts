-- Tele-Alerts 扩币迁移 (v2)
-- 基于 30 币 × 3 时间框架 × 3 策略回测结果优化
-- 在 Supabase SQL Editor 中执行 (在 004_signal_levels.sql 之后)

-- ========== 1. 新增信号规则 ==========
INSERT INTO tele_signal_rules (id, type, name, params, enabled, layers) VALUES
  ('rsi_extreme', 'technical', 'RSI超买超卖', '{"overbought":70,"oversold":30}', TRUE, '[1,2,3,4]')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  params = EXCLUDED.params,
  enabled = EXCLUDED.enabled,
  layers = EXCLUDED.layers;

-- ========== 2. 更新监控列表 — 基于回测数据 ==========
-- 先清空旧数据
DELETE FROM tele_watchlist;

-- L1 蓝筹主流: 4h bb_breakout + rsi_extreme + trend filter
-- BTC: bb_breakout+Trend WR69% +67%, ETH: confirmed profitable
INSERT INTO tele_watchlist (symbol, timeframe, layer, enabled) VALUES
  ('BTC/USDT:USDT', '4h', 1, TRUE),
  ('ETH/USDT:USDT', '4h', 1, TRUE);

-- L2 中盘突破: 4h bb_breakout + rsi_extreme + trend filter
-- 回测证明 4h bb_breakout+Trend 是最稳健策略
INSERT INTO tele_watchlist (symbol, timeframe, layer, enabled) VALUES
  ('SOL/USDT:USDT', '4h', 2, TRUE),
  ('AVAX/USDT:USDT', '4h', 2, TRUE),
  ('LINK/USDT:USDT', '4h', 2, TRUE),
  ('ADA/USDT:USDT', '4h', 2, TRUE),
  ('BCH/USDT:USDT', '4h', 2, TRUE),
  ('SUI/USDT:USDT', '4h', 2, TRUE),
  ('XRP/USDT:USDT', '4h', 2, TRUE),
  ('BNB/USDT:USDT', '4h', 2, TRUE);

-- L3 高波动策略: 1h bb_reversion + rsi_extreme + trend filter
-- WIF: 1h bb_reversion+Trend WR51% +70%, FIL: 1h rsi_extreme WR48% +145%
INSERT INTO tele_watchlist (symbol, timeframe, layer, enabled) VALUES
  ('WIF/USDT:USDT', '1h', 3, TRUE),
  ('DOGE/USDT:USDT', '1h', 3, TRUE),
  ('FIL/USDT:USDT', '1h', 3, TRUE),
  ('OP/USDT:USDT', '1h', 3, TRUE),
  ('INJ/USDT:USDT', '1h', 3, TRUE),
  ('STX/USDT:USDT', '1h', 3, TRUE),
  ('APT/USDT:USDT', '1h', 3, TRUE);

-- L4 弹性新币: 4h + 1h, auto-direction
-- TIA: 4h bb_breakout WR57% +163%, NEAR: 4h rsi_extreme+Trend WR60% +134%
INSERT INTO tele_watchlist (symbol, timeframe, layer, enabled) VALUES
  ('TIA/USDT:USDT', '4h', 4, TRUE),
  ('NEAR/USDT:USDT', '4h', 4, TRUE),
  ('RENDER/USDT:USDT', '1h', 4, TRUE);

-- ========== 3. 更新冷却时间逻辑 ==========
-- 15m信号冷却=30min (代码中处理，无需改表)
-- 新增 15m 冷却支持：
-- 注: 当前扫描频率为每小时，15m信号每小时检查一次

-- ========== 4. 索引优化 ==========
CREATE INDEX IF NOT EXISTS idx_tele_signals_symbol_layer ON tele_signals(symbol, layer);
