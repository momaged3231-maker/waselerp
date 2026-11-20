-- B5.3 — Damaged portion + Gift/Sample returns — DEC-SALES-011.
-- Additive only: damaged quantity on return lines. 5112 already exists in seed
-- (DAMAGE_EXPENSE mapping), so no new GL account is created here.
ALTER TABLE invoice_lines
  ADD COLUMN IF NOT EXISTS damaged_qty numeric(18,6) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_lines_damaged_qty') THEN
    ALTER TABLE invoice_lines
      ADD CONSTRAINT chk_invoice_lines_damaged_qty CHECK (damaged_qty >= 0 AND damaged_qty <= quantity);
  END IF;
END $$;
