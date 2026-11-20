-- B5.1-16 — DEC-SALES-006: separate overdue FACT from hard-block POLICY.
--   overdue fact  = today > due_date            (aging only)
--   hard block    = today > due_date + grace_days (credit absolute block)
-- Exposes both in v_invoice_overdue so the credit check reads ONE source.
-- DROP first: CREATE OR REPLACE cannot reorder/rename existing view columns.
DROP VIEW IF EXISTS v_invoice_overdue;
CREATE VIEW v_invoice_overdue AS
SELECT
    i.invoice_id,
    i.invoice_no,
    i.invoice_type,
    i.party_id,
    i.branch_id,
    i.invoice_date,
    i.due_date,
    COALESCE(i.due_date, i.invoice_date::date) AS effective_due_date,
    GREATEST(0, (CURRENT_DATE - COALESCE(i.due_date, i.invoice_date::date)))::int AS days_past_due,
    COALESCE(p.grace_days, 0)::int AS grace_days,
    (CURRENT_DATE > COALESCE(i.due_date, i.invoice_date::date) + COALESCE(p.grace_days, 0) * INTERVAL '1 day') AS is_hard_block,
    i.total_amount,
    i.paid_amount,
    (i.total_amount - i.paid_amount) AS remaining,
    i.status
FROM invoices i
LEFT JOIN parties p ON p.party_id = i.party_id
WHERE i.status = 2
  AND (i.total_amount - i.paid_amount) > 0.005;
