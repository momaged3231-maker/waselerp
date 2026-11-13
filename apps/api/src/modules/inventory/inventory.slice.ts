import {
  Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Query, BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { applyMovement, getWarehouseCost, toBaseUnits, MoveType } from '../../common/stock';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';
import { LiveEventsService } from '../events/live-events.service';
import { EventsModule } from '../events/events.slice';

export interface StockOperationInput {
  operationType: number;   // 1 transfer, 2 count, 3 adjustment
  fromWarehouseId?: number;
  toWarehouseId?: number;
  operationDate?: string;
  notes?: string;
  lines: {
    itemId: number;
    unitId: number;
    expectedQty?: number;
    actualQty?: number;
    unitCost?: number;
    serialNo?: string;
    expiryDate?: string;
    notes?: string;
  }[];
}

@Injectable()
export class InventoryService {
  constructor(private readonly db: DatabaseService, private readonly live: LiveEventsService) {}

  /** Current balance per item / warehouse. */
  async balances(params: { warehouseId?: number; search?: string; lowStockOnly?: boolean }) {
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;
    return this.db.query(
      `SELECT i.item_id AS "itemId", i.code, i.name, u.name AS "unitName",
              w.warehouse_id AS "warehouseId", w.name AS "warehouseName", b.name AS "branchName",
              COALESCE(q.on_hand_qty,0) AS "onHandQty", COALESCE(q.avg_cost,0) AS "avgCost",
              COALESCE(q.reserved_qty,0) AS "reservedQty",
              (COALESCE(q.on_hand_qty,0) - COALESCE(q.reserved_qty,0)) AS "availableQty",
              i.reorder_point AS "reorderPoint", i.sell_price AS "sellPrice",
              COALESCE(q.on_hand_qty,0) * COALESCE(q.avg_cost,0) AS "stockValue",
              (COALESCE(q.on_hand_qty,0) <= i.reorder_point) AS "lowStock"
         FROM items i
         CROSS JOIN warehouses w
         JOIN branches b ON b.branch_id = w.branch_id
         LEFT JOIN item_warehouse_qty q ON q.item_id = i.item_id AND q.warehouse_id = w.warehouse_id
                                        AND q.unit_id = i.base_unit_id
         LEFT JOIN units u ON u.unit_id = i.base_unit_id
        WHERE i.is_active = true
          AND ($1::int IS NULL OR w.warehouse_id = $1)
          AND ($2::text = '' OR i.name ILIKE $3 OR i.code ILIKE $3)
          AND ($4::boolean = false OR COALESCE(q.on_hand_qty,0) <= i.reorder_point)
        ORDER BY i.name, w.name`,
      [params.warehouseId ?? null, search, like, params.lowStockOnly ?? false],
    );
  }

  async movements(params: { itemId?: number; warehouseId?: number; branchId?: number; from?: string; to?: string; limit: number }) {
    return this.db.query(
      `SELECT m.stock_movement_id AS "movementId", m.move_date AS "moveDate", m.move_type AS "moveType",
              i.code AS "itemCode", i.name AS "itemName", u.name AS "unitName", m.quantity,
              m.unit_cost AS "unitCost", m.reference_no AS "referenceNo", m.notes,
              w.name AS "warehouseName", b.name AS "branchName"
         FROM stock_movements m
         JOIN items i ON i.item_id = m.item_id
         LEFT JOIN units u ON u.unit_id = m.unit_id
         LEFT JOIN warehouses w ON w.warehouse_id = m.warehouse_id
         LEFT JOIN branches b ON b.branch_id = m.branch_id
        WHERE ($1::int IS NULL OR m.item_id = $1)
          AND ($2::int IS NULL OR m.warehouse_id = $2)
          AND ($3::int IS NULL OR m.branch_id = $3)
          AND ($4::date IS NULL OR m.move_date::date >= $4::date)
          AND ($5::date IS NULL OR m.move_date::date <= $5::date)
        ORDER BY m.move_date DESC, m.stock_movement_id DESC
        LIMIT $6`,
      [params.itemId ?? null, params.warehouseId ?? null, params.branchId ?? null, params.from ?? null,
        params.to ?? null, params.limit],
    );
  }

  /** Transfer between warehouses, stock count, or manual adjustment. */
  async createOperation(dto: StockOperationInput, user: AuthUser, branchId: number) {
    if (!dto.lines?.length) throw new BadRequestException('لا توجد أصناف في العملية');
    if (dto.operationType === 1 && (!dto.fromWarehouseId || !dto.toWarehouseId)) {
      throw new BadRequestException('حدد المخزن المرسل والمستقبل');
    }

    return this.db.transaction(async (client) => {
      const serial = await this.db.nextNumber(client, `stockop:${branchId}`);
      const operationNo = `SO-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`;

      const operation = await client.query<{ stock_operation_id: number }>(
        `INSERT INTO stock_operations
           (operation_no, operation_type, branch_id, from_warehouse_id, to_warehouse_id, operation_date, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5, COALESCE($6, now()), 2, $7, $8) RETURNING stock_operation_id`,
        [operationNo, dto.operationType, branchId, dto.fromWarehouseId ?? null, dto.toWarehouseId ?? null,
          dto.operationDate ?? null, dto.notes ?? null, user.userId],
      );
      const operationId = Number(operation.rows[0].stock_operation_id);

      for (const line of dto.lines) {
        const baseExpected = await toBaseUnits(client, line.itemId, line.unitId, Number(line.expectedQty ?? 0));
        const baseActual = await toBaseUnits(client, line.itemId, line.unitId, Number(line.actualQty ?? 0));
        const diff = baseActual - baseExpected;

        await client.query(
          `INSERT INTO stock_operation_lines
             (stock_operation_id, item_id, unit_id, expected_qty, actual_qty, diff_qty, unit_cost, serial_no, expiry_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [operationId, line.itemId, line.unitId, baseExpected, baseActual, diff, Number(line.unitCost ?? 0),
            line.serialNo ?? null, line.expiryDate ?? null, line.notes ?? null],
        );

        if (dto.operationType === 1) {
          // Transfers keep the source warehouse's average cost.
          const sourceCost = await getWarehouseCost(client, line.itemId, dto.fromWarehouseId);
          const transferCost = sourceCost > 0 ? sourceCost : Number(line.unitCost ?? 0);
          await applyMovement(client, {
            branchId, warehouseId: dto.fromWarehouseId, itemId: line.itemId, unitId: line.unitId,
            moveType: 'transferOut', quantity: baseActual, unitCost: transferCost,
            referenceType: 2, referenceId: operationId, referenceNo: operationNo, userId: user.userId,
          });
          await applyMovement(client, {
            branchId, warehouseId: dto.toWarehouseId, itemId: line.itemId, unitId: line.unitId,
            moveType: 'transferIn', quantity: baseActual, unitCost: transferCost,
            referenceType: 2, referenceId: operationId, referenceNo: operationNo, userId: user.userId,
          });
        } else if (dto.operationType === 2) {
          const warehouseId = dto.fromWarehouseId ?? dto.toWarehouseId;
          if (diff !== 0) {
            await applyMovement(client, {
              branchId, warehouseId, itemId: line.itemId, unitId: line.unitId,
              moveType: diff > 0 ? 'countGain' : 'countLoss', quantity: Math.abs(diff),
              unitCost: Number(line.unitCost ?? 0), referenceType: 2, referenceId: operationId,
              referenceNo: operationNo, userId: user.userId,
            });
          }
        } else if (dto.operationType === 3) {
          const warehouseId = dto.fromWarehouseId ?? dto.toWarehouseId;
          if (diff !== 0) {
            // Negative adjustments must reduce the balance: adjustmentOut carries the minus sign.
            await applyMovement(client, {
              branchId, warehouseId, itemId: line.itemId, unitId: line.unitId,
              moveType: diff > 0 ? 'adjustment' : 'adjustmentOut', quantity: Math.abs(diff),
              unitCost: Number(line.unitCost ?? 0), referenceType: 2, referenceId: operationId,
              referenceNo: operationNo, userId: user.userId,
            });
          }
        }
      }

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'stock.operation','stock_operation',$3,$4)`,
        [user.userId, branchId, String(operationId), `عملية مخزون ${operationNo}`],
      );

      this.live.publish({
        type: 'stock.changed',
        branchId,
        warehouseId: dto.toWarehouseId ?? dto.fromWarehouseId ?? null,
        itemIds: dto.lines.map((line) => line.itemId),
      });

      return { operationId, operationNo };
    });
  }

  async listOperations(branchId: number, limit = 100) {
    return this.db.query(
      `SELECT so.stock_operation_id AS "operationId", so.operation_no AS "operationNo",
              so.operation_type AS "operationType", so.operation_date AS "operationDate", so.status,
              so.notes, fw.name AS "fromWarehouse", tw.name AS "toWarehouse", u.full_name AS "createdBy",
              (SELECT count(*)::int FROM stock_operation_lines l WHERE l.stock_operation_id = so.stock_operation_id) AS "lineCount"
         FROM stock_operations so
         LEFT JOIN warehouses fw ON fw.warehouse_id = so.from_warehouse_id
         LEFT JOIN warehouses tw ON tw.warehouse_id = so.to_warehouse_id
         LEFT JOIN users u ON u.user_id = so.created_by
        WHERE ($1::int = 0 OR so.branch_id = $1)
        ORDER BY so.operation_date DESC LIMIT $2`,
      [branchId, limit],
    );
  }
}

@Controller('inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @RequirePermissions('stock.view')
  @Get('balances')
  balances(@Query('warehouseId') warehouseId: string, @Query('search') search: string, @Query('lowStock') lowStock: string) {
    return this.service.balances({
      warehouseId: warehouseId ? Number(warehouseId) : undefined,
      search,
      lowStockOnly: lowStock === 'true',
    });
  }

  @RequirePermissions('stock.view')
  @Get('movements')
  movements(
    @Query('itemId') itemId: string,
    @Query('warehouseId') warehouseId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit: string,
  ) {
    return this.service.movements({
      itemId: itemId ? Number(itemId) : undefined,
      warehouseId: warehouseId ? Number(warehouseId) : undefined,
      from, to,
      limit: Math.min(Number(limit) || 200, 1000),
    });
  }

  @RequirePermissions('stock.manage')
  @Post('operations')
  createOperation(@Body() dto: StockOperationInput, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.createOperation(dto, user, branchId);
  }

  @RequirePermissions('stock.view')
  @Get('operations')
  listOperations(@CurrentBranch() branchId: number) {
    return this.service.listOperations(branchId);
  }
}

@Module({
  imports: [EventsModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
