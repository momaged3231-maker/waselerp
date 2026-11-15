-- D27 — invoice_no must be unique per branch, not globally.
-- Two branches starting their sequences at 1 produced the same invoice_no (e.g. P-2026-000001)
-- for the same invoice_type and violated invoices_invoice_no_invoice_type_key.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_no_invoice_type_key;
ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_no_invoice_type_branch_key
  UNIQUE (invoice_no, invoice_type, branch_id);
