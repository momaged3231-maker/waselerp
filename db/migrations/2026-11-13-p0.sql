-- =====================================================================
--  P0 migration — 2026-11-13
--  Run once on an existing database:
--    node tools/pg/run-sql.js wasel db/migrations/2026-11-13-p0.sql
--  Fresh databases already get these changes from db/schema.postgres.sql.
-- =====================================================================
BEGIN;

-- 1) Link cash movements to the cashier shift that produced them.
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS shift_id bigint;
DO $$
BEGIN
  ALTER TABLE cash_transactions
    ADD CONSTRAINT fk_cash_transactions_shift FOREIGN KEY (shift_id) REFERENCES shifts(shift_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS ix_cash_tx_shift ON cash_transactions(shift_id);

-- 2) Idempotency key must be unique (it is also in the fresh schema).
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_client_request
  ON invoices(client_request_id) WHERE client_request_id IS NOT NULL;

-- 3) Historical movement quantities were stored in base units while the
--    row was keyed by the selling unit. Normalise them to the base unit.
UPDATE stock_movements m
   SET unit_id = i.base_unit_id
  FROM items i
 WHERE m.item_id = i.item_id
   AND m.unit_id <> i.base_unit_id;

-- 4) Consolidate item_warehouse_qty into one row per item / warehouse,
--    keyed by the item's base unit (quantities were already in base units).
WITH agg AS (
  SELECT q.item_id,
         q.warehouse_id,
         i.base_unit_id,
         SUM(q.on_hand_qty) AS qty,
         CASE WHEN SUM(q.on_hand_qty) <> 0
              THEN SUM(q.on_hand_qty * q.avg_cost) / SUM(q.on_hand_qty)
              ELSE MAX(q.avg_cost) END AS avg_cost,
         MAX(q.last_move_at) AS last_move_at
    FROM item_warehouse_qty q
    JOIN items i ON i.item_id = q.item_id
   GROUP BY q.item_id, q.warehouse_id, i.base_unit_id
)
INSERT INTO item_warehouse_qty (item_id, warehouse_id, unit_id, on_hand_qty, avg_cost, last_move_at)
SELECT item_id, warehouse_id, base_unit_id, qty, COALESCE(avg_cost, 0), last_move_at
  FROM agg
ON CONFLICT (item_id, warehouse_id, unit_id) DO UPDATE SET
  on_hand_qty = EXCLUDED.on_hand_qty,
  avg_cost = EXCLUDED.avg_cost,
  last_move_at = EXCLUDED.last_move_at;

DELETE FROM item_warehouse_qty q
 USING items i
 WHERE q.item_id = i.item_id
   AND q.unit_id <> i.base_unit_id;

COMMIT;
