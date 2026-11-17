-- Fix: budgets push failed with "numeric field overflow" because alert_threshold was
-- DECIMAL(3,2) (max 9.99) while the app stores a percentage (e.g. 80).
-- Run once in the Supabase SQL editor.

ALTER TABLE budgets
  ALTER COLUMN alert_threshold DROP DEFAULT;

ALTER TABLE budgets
  ALTER COLUMN alert_threshold TYPE INTEGER
  USING ROUND(alert_threshold * 100)::INTEGER;   -- 0.8 -> 80

ALTER TABLE budgets
  ALTER COLUMN alert_threshold SET DEFAULT 80;
