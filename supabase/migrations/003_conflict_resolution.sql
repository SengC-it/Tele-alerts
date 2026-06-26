-- 003: Signal conflict resolution — add reliability & supporting signals
-- Adds columns to tele_signals for strategy/info classification and conflict merge context

ALTER TABLE tele_signals
  ADD COLUMN IF NOT EXISTS reliability text DEFAULT 'strategy',
  ADD COLUMN IF NOT EXISTS supporting_signals jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN tele_signals.reliability IS 'strategy = backtest-validated, info = informational context only';
COMMENT ON COLUMN tele_signals.supporting_signals IS 'Suppressed conflicting signals attached as context (JSON array)';
