-- E6 review gate — closing integrity backstops (additive only).
--
-- 1) periods.closing_entry_id must point at exactly one journal: two periods
--    must never reference the same closing journal.
CREATE UNIQUE INDEX IF NOT EXISTS ux_periods_closing_entry
    ON periods(closing_entry_id)
    WHERE closing_entry_id IS NOT NULL;

-- 2) Index the check rows by period for the close-report screen.
CREATE INDEX IF NOT EXISTS ix_period_close_checks_checked
    ON period_close_checks(checked_at);

-- 3) Fast lookup of due expense occurrences per rule (E6 pre-close gate).
CREATE INDEX IF NOT EXISTS ix_bank_expense_runs_rule_period_status
    ON bank_expense_runs(rule_id, period_key, status);

-- 4) Fast existence check for depreciation per asset-month (E6 pre-close gate).
CREATE INDEX IF NOT EXISTS ix_asset_dep_asset_month_posted
    ON asset_depreciation_lines(asset_id, period_month);
