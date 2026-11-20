-- B4 — v_invoice_overdue: single source of truth for open/overdue invoices.
--
-- DEC-SALES-008: all screens/reports read overdue from ONE view (no duplicate
-- logic in code). DEC-SALES-007: due date is STORED (not computed); empty due
-- date = immediately due; overdue amount = remaining balance (total - paid).
--
-- This view intentionally covers ALL invoice types (1 sale, 2 purchase,
-- 3 sales return, 4 purchase return) so both the sales dunning/aging screens
-- and the B4 supplier statement read the same definition. `invoice_type` is a
-- column, so consumers filter party side by type (e.g. type=2 for suppliers).
--
-- TD-21/C-38 closed: the view was previously only designed, never built.

CREATE OR REPLACE VIEW v_invoice_overdue AS
SELECT
    i.invoice_id,
    i.invoice_no,
    i.invoice_type,
    i.party_id,
    i.branch_id,
    i.invoice_date,
    i.due_date,
    -- Empty due_date is treated as immediately due (DEC-SALES-007).
    COALESCE(i.due_date, i.invoice_date::date) AS effective_due_date,
    GREATEST(0, (CURRENT_DATE - COALESCE(i.due_date, i.invoice_date::date)))::int AS days_past_due,
    i.total_amount,
    i.paid_amount,
    (i.total_amount - i.paid_amount) AS remaining,
    i.status
FROM invoices i
WHERE i.status = 2                          -- posted invoices only
  AND (i.total_amount - i.paid_amount) > 0.005;  -- open balance only
