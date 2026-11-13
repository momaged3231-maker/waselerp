import { BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { getBooleanSetting } from './settings';

export type MoveType =
  | 'purchase' | 'sales' | 'salesReturn' | 'purchaseReturn'
  | 'transferIn' | 'transferOut' | 'countGain' | 'countLoss' | 'opening'
  | 'adjustment' | 'adjustmentOut';

const SIGN: Record<MoveType, 1 | -1> = {
  purchase: 1, sales: -1, salesReturn: 1, purchaseReturn: -1,
  transferIn: 1, transferOut: -1, countGain: 1, countLoss: -1, opening: 1,
  adjustment: 1, adjustmentOut: -1,
};

export const MOVE_CODE: Record<MoveType, number> = {
  purchase: 1, sales: 2, salesReturn: 3, purchaseReturn: 4,
  transferIn: 5, transferOut: 6, countGain: 7, countLoss: 8, opening: 9,
  adjustment: 10, adjustmentOut: 11,
};

export interface MovementInput {
  branchId: number;
  warehouseId: number;
  itemId: number;
  /** Selling unit of the source document (kept for traceability only). */
  unitId: number;
  /** Direction / reason of the movement. */
  moveType: MoveType;
  /** Quantity is ALWAYS expressed in the item's base unit. */
  quantity: number;
  unitCost: number;
  referenceType: number;
  referenceId?: number | null;
  referenceNo?: string | null;
  periodId?: number | null;
  serialNo?: string | null;
  expiryDate?: string | null;
  notes?: string | null;
  userId?: number | null;
  /** Optional cache of the item's base unit to avoid an extra query. */
  baseUnitId?: number;
}

/** Returns the item's base unit, or throws when the item does not exist. */
export async function getBaseUnitId(client: PoolClient, itemId: number): Promise<number> {
  const { rows } = await client.query<{ base_unit_id: number }>(
    'SELECT base_unit_id FROM items WHERE item_id = $1',
    [itemId],
  );
  if (!rows.length) throw new BadRequestException(`الصنف رقم ${itemId} غير موجود`);
  return Number(rows[0].base_unit_id);
}

/** Current weighted-average cost per base unit for one item / warehouse. */
export async function getWarehouseCost(client: PoolClient, itemId: number, warehouseId: number): Promise<number> {
  const { rows } = await client.query<{ avg_cost: string }>(
    `SELECT COALESCE(q.avg_cost, 0) AS avg_cost
       FROM items i
       LEFT JOIN item_warehouse_qty q
              ON q.item_id = i.item_id
             AND q.warehouse_id = $2
             AND q.unit_id = i.base_unit_id
      WHERE i.item_id = $1`,
    [itemId, warehouseId],
  );
  return rows.length ? Number(rows[0].avg_cost) : 0;
}

/**
 * Writes one movement to the ledger and keeps the balance row in sync.
 *
 * The balance row is always keyed by the item's BASE unit, so selling the same
 * item in pieces and boxes never fragments its on-hand quantity. When the
 * `AllowNegativeStock` setting is off, any movement that would push a balance
 * below zero is rejected inside the same transaction.
 *
 * Always executed inside the caller's transaction.
 */
export async function applyMovement(client: PoolClient, input: MovementInput): Promise<void> {
  const baseUnitId = input.baseUnitId ?? (await getBaseUnitId(client, input.itemId));
  const signed = input.quantity === 0 ? 0 : Math.abs(input.quantity) * SIGN[input.moveType];
  if (signed === 0) return;

  if (signed < 0) {
    const allowNegative = await getBooleanSetting(client, 'AllowNegativeStock', false);
    if (!allowNegative) {
      const { rows } = await client.query<{ name: string; on_hand_qty: string }>(
        `SELECT i.name, COALESCE(q.on_hand_qty, 0) AS on_hand_qty
           FROM items i
           LEFT JOIN item_warehouse_qty q
                  ON q.item_id = i.item_id
                 AND q.warehouse_id = $2
                 AND q.unit_id = i.base_unit_id
          WHERE i.item_id = $1`,
        [input.itemId, input.warehouseId],
      );
      const available = Number(rows[0]?.on_hand_qty ?? 0);
      if (available + signed < -0.000001) {
        throw new BadRequestException(
          `الرصيد غير كافٍ للصنف ${rows[0]?.name ?? input.itemId} في هذا المخزن (المتاح ${available})`,
        );
      }
    }
  }

  await client.query(
    `INSERT INTO stock_movements
       (branch_id, warehouse_id, item_id, unit_id, move_type, move_date, quantity, unit_cost,
        reference_type, reference_id, reference_no, period_id, serial_no, expiry_date, notes, created_by)
     VALUES ($1,$2,$3,$4,$5, now(), $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      input.branchId, input.warehouseId, input.itemId, baseUnitId, MOVE_CODE[input.moveType],
      signed, input.unitCost, input.referenceType, input.referenceId ?? null, input.referenceNo ?? null,
      input.periodId ?? null, input.serialNo ?? null, input.expiryDate ?? null, input.notes ?? null,
      input.userId ?? null,
    ],
  );

  await client.query(
    `INSERT INTO item_warehouse_qty (item_id, warehouse_id, unit_id, on_hand_qty, avg_cost, last_move_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (item_id, warehouse_id, unit_id) DO UPDATE SET
       on_hand_qty = item_warehouse_qty.on_hand_qty + $4,
       avg_cost = CASE
                   WHEN $4 > 0 AND $5 > 0
                   THEN ((item_warehouse_qty.on_hand_qty * item_warehouse_qty.avg_cost) + ($4 * $5))
                        / NULLIF(item_warehouse_qty.on_hand_qty + $4, 0)
                   ELSE item_warehouse_qty.avg_cost END,
       last_move_at = now()`,
    [input.itemId, input.warehouseId, baseUnitId, signed, input.unitCost],
  );

  // Keep the item's headline cost aligned with the latest purchase / opening cost.
  if ((input.moveType === 'purchase' || input.moveType === 'opening') && input.unitCost > 0) {
    await client.query(
      `UPDATE items
          SET cost_price = COALESCE((
                SELECT avg_cost FROM item_warehouse_qty
                 WHERE item_id = $1 AND warehouse_id = $2 AND unit_id = $3), cost_price)
        WHERE item_id = $1`,
      [input.itemId, input.warehouseId, baseUnitId],
    );
  }
}

/** Converts a quantity expressed in `unitId` into base units using item_units. */
export async function toBaseUnits(client: PoolClient, itemId: number, unitId: number, quantity: number): Promise<number> {
  const baseUnitId = await getBaseUnitId(client, itemId);
  if (baseUnitId === unitId) return quantity;

  const { rows } = await client.query<{ factor: string }>(
    `SELECT factor FROM item_units WHERE item_id = $1 AND unit_id = $2 LIMIT 1`,
    [itemId, unitId],
  );
  if (!rows.length) {
    throw new BadRequestException(`وحدة القياس غير معرّفة للصنف رقم ${itemId}`);
  }
  return quantity * Number(rows[0].factor);
}
