-- ============================================================================
--  WaselERP — Accounting Control Accounts (P3.1a/b — is_control + mark control accounts)
-- ============================================================================
--  Phase-2 P3.1: Add is_control column to gl_accounts and mark control accounts.
--  D-17 resolved: Option A (is_control on gl_accounts, not hardcoded list).
--
--  Control accounts (initial): AR (1103), INVENTORY (1104), VAT_INPUT (1105),
--  AP (2101), VAT_OUTPUT (2102), COGS (5101).
--  GRNI (2107) added when created in P3.3.
--
--  THIS MIGRATION IS A SCAFFOLD. IT HAS NOT BEEN RUN ON ANY DATABASE.
--  Running it is the responsibility of the operator (migrate-all) after
--  reviewing each statement.
-- ============================================================================

-- P3.1a — Add is_control column
ALTER TABLE gl_accounts
  ADD COLUMN IF NOT EXISTS is_control boolean NOT NULL DEFAULT false;

-- P3.1b — Mark existing control accounts
UPDATE gl_accounts SET is_control = true
WHERE code IN ('1103', '1104', '1105', '2101', '2102', '5101');

-- Verification queries (run after migration):
-- SELECT code, name, is_control FROM gl_accounts WHERE is_control = true;
-- SELECT code, name, is_control FROM gl_accounts WHERE is_control = false;