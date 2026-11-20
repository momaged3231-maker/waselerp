-- ============================================================================
-- GAP-06: Server-side idempotency for financial mutations
-- Adds client_request_id + partial UNIQUE indexes to vouchers and
-- purchase_receipts. invoices already has ux_invoices_client_request.
-- Safe to re-run (IF NOT EXISTS / idempotent).
-- ============================================================================

ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS client_request_id varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS ux_vouchers_client_request
  ON vouchers (client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE purchase_receipts
  ADD COLUMN IF NOT EXISTS client_request_id varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_receipts_client_request
  ON purchase_receipts (client_request_id)
  WHERE client_request_id IS NOT NULL;
