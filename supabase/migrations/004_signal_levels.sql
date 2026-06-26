-- 004: Add entry/SL/TP levels to signals
ALTER TABLE tele_signals
  ADD COLUMN IF NOT EXISTS levels jsonb DEFAULT NULL;

COMMENT ON COLUMN tele_signals.levels IS 'Entry/StopLoss/TakeProfit levels derived from ATR (strategy signals only). JSON: {entry, stopLoss, takeProfit, riskReward}';
