-- GAP-03: warranty policy enforcement for maintenance tickets.
-- v1: manual warranty dates + mandatory reference; charging a warranty ticket
-- requires a dedicated permission and a reason; COGS of consumed parts is
-- posted independently of collection (TD-56).
-- No new GL account (TD-54) and no automatic eligibility from purchase
-- documents (TD-53). posting.ts is intentionally untouched.

ALTER TABLE maintenance_tickets
  ADD COLUMN IF NOT EXISTS warranty_start_date       date NULL,
  ADD COLUMN IF NOT EXISTS warranty_end_date         date NULL,
  ADD COLUMN IF NOT EXISTS warranty_charged          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warranty_charge_reason    text NULL;

ALTER TABLE maintenance_products
  ADD COLUMN IF NOT EXISTS warranty_duration_days integer NULL;

ALTER TABLE maintenance_models
  ADD COLUMN IF NOT EXISTS warranty_duration_days integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_maintenance_tickets_warranty_dates') THEN
    ALTER TABLE maintenance_tickets
      ADD CONSTRAINT ck_maintenance_tickets_warranty_dates
      CHECK (warranty_end_date IS NULL OR warranty_start_date IS NULL
             OR warranty_end_date >= warranty_start_date);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_maintenance_tickets_warranty_dates
  ON maintenance_tickets (warranty_start_date, warranty_end_date);
