import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query,
  BadRequestException, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { DatabaseService } from '../../common/database/database.service';
import { assertDeletionAllowed } from '../../common/delete-guard';
import { resolvePrices } from '../../common/pricing';
import { CurrentBranch, CurrentUser, AuthUser, RequirePermissions } from '../../common/security';
import { logActivity } from '../../common/audit';
import { LiveEventsService } from '../events/live-events.service';
import { EventsModule } from '../events/events.slice';
import { parseImportFile, buildTemplateXlsx, applyHeaderAliases, ITEM_IMPORT_ALIASES } from '../../common/spreadsheet';

export interface ItemDto {
  itemId?: number;
  code: string;
  barcode?: string;
  name: string;
  nameEn?: string;
  categoryId?: number;
  baseUnitId: number;
  costPrice: number;
  sellPrice: number;
  vatPct?: number;
  discountPct?: number;
  reorderPoint?: number;
  isService?: boolean;
  hasSerial?: boolean;
  isGrouped?: boolean;
  isActive?: boolean;
  notes?: string;
}

@Injectable()
export class ItemsService {
  constructor(private readonly db: DatabaseService, private readonly live: LiveEventsService) {}

  async search(params: {
    search?: string; categoryId?: number; warehouseId?: number; page: number; pageSize: number;
    includeInactive?: boolean; partyId?: number; branchId?: number;
  }) {
    const offset = (params.page - 1) * params.pageSize;
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;

    const where = `
      WHERE ($1::text = '' OR i.name ILIKE $2 OR i.code ILIKE $2 OR COALESCE(i.barcode,'') ILIKE $2)
        AND ($3::int IS NULL OR i.category_id = $3)
        AND ($4::boolean = false OR i.is_active = true)
        AND ($5::int IS NULL OR EXISTS (
              SELECT 1 FROM item_warehouse_qty q2
               WHERE q2.item_id = i.item_id AND q2.warehouse_id = $5 AND q2.unit_id = i.base_unit_id))`;

    const args = [
      search, like, params.categoryId ?? null, params.includeInactive ?? false, params.warehouseId ?? null,
    ];

    const items = await this.db.query(
      `SELECT i.item_id AS "itemId", i.code, i.name, i.name_en AS "nameEn", i.barcode,
              i.category_id AS "categoryId", c.name AS "categoryName",
              i.base_unit_id AS "baseUnitId", u.name AS "baseUnitName",
              i.cost_price AS "costPrice", i.sell_price AS "sellPrice",
              i.vat_pct AS "vatPct", i.discount_pct AS "discountPct", i.reorder_point AS "reorderPoint",
              i.is_service AS "isService", i.has_serial AS "hasSerial", i.is_active AS "isActive",
              COALESCE((SELECT SUM(q.on_hand_qty) FROM item_warehouse_qty q
                         WHERE q.item_id = i.item_id AND q.unit_id = i.base_unit_id
                           AND ($5::int IS NULL OR q.warehouse_id = $5)), 0) AS "onHandQty",
              COALESCE((SELECT json_agg(json_build_object(
                          'unitId', iu.unit_id, 'unitName', u2.name, 'factor', iu.factor,
                          'sellPrice', iu.sell_price, 'buyPrice', iu.buy_price, 'isDefault', iu.is_default)
                          ORDER BY iu.factor)
                          FROM item_units iu JOIN units u2 ON u2.unit_id = iu.unit_id
                         WHERE iu.item_id = i.item_id), '[]'::json) AS units
         FROM items i
         LEFT JOIN categories c ON c.category_id = i.category_id
         LEFT JOIN units u ON u.unit_id = i.base_unit_id
         ${where}
        ORDER BY i.name
        LIMIT $6 OFFSET $7`,
      [...args, params.pageSize, offset],
    );

    const total = await this.db.count(
      `SELECT COUNT(*)::int AS count FROM items i ${where}`,
      args,
    );

    // When a customer is selected the price list of that customer wins over
    // the price on the item card.
    let priced = items;
    if (params.partyId) {
      const prices = await resolvePrices(this.db, {
        itemIds: items.map((row: any) => Number(row.itemId)),
        partyId: params.partyId,
        branchId: params.branchId,
      });
      priced = items.map((row: any) => {
        const resolved = prices.get(Number(row.itemId));
        if (!resolved) return row;
        return {
          ...row,
          sellPrice: resolved.finalPrice,
          listPrice: resolved.price,
          priceListId: resolved.priceListId,
          priceListName: resolved.priceListName,
        };
      });
    }

    return { items: priced, total, page: params.page, pageSize: params.pageSize };
  }

  async findOne(id: number, warehouseId?: number) {
    const row = await this.db.one(
      `SELECT i.item_id AS "itemId", i.code, i.name, i.name_en AS "nameEn", i.barcode,
              i.category_id AS "categoryId", c.name AS "categoryName",
              i.base_unit_id AS "baseUnitId", u.name AS "baseUnitName",
              i.cost_price AS "costPrice", i.sell_price AS "sellPrice",
              i.vat_pct AS "vatPct", i.discount_pct AS "discountPct", i.reorder_point AS "reorderPoint",
              i.is_service AS "isService", i.has_serial AS "hasSerial", i.is_active AS "isActive",
              i.is_grouped AS "isGrouped", i.notes,
              COALESCE((SELECT SUM(q.on_hand_qty) FROM item_warehouse_qty q
                         WHERE q.item_id = i.item_id AND q.unit_id = i.base_unit_id), 0) AS "onHandQty"
         FROM items i
         LEFT JOIN categories c ON c.category_id = i.category_id
         LEFT JOIN units u ON u.unit_id = i.base_unit_id
        WHERE i.item_id = $1`,
      [id],
    );
    if (!row) return null;
    const units = await this.db.query(
      `SELECT iu.item_unit_id AS "itemUnitId", iu.unit_id AS "unitId", u.name AS "unitName",
              iu.factor, iu.sell_price AS "sellPrice", iu.buy_price AS "buyPrice", iu.is_default AS "isDefault"
         FROM item_units iu JOIN units u ON u.unit_id = iu.unit_id
        WHERE iu.item_id = $1 ORDER BY iu.factor`,
      [id],
    );
    return { ...row, units };
  }

  /** Fast barcode / code lookup used by the POS scanner. */
  async lookupByCode(code: string, warehouseId?: number) {
    const rows = await this.db.query(
      `SELECT i.item_id AS "itemId", i.code, i.name, i.barcode, i.base_unit_id AS "baseUnitId",
              i.sell_price AS "sellPrice", i.cost_price AS "costPrice", i.vat_pct AS "vatPct",
              i.discount_pct AS "discountPct", i.is_service AS "isService", i.has_serial AS "hasSerial",
              u.name AS "unitName",
              COALESCE((SELECT SUM(q.on_hand_qty) FROM item_warehouse_qty q
                         WHERE q.item_id = i.item_id AND q.unit_id = i.base_unit_id
                           AND ($2::int IS NULL OR q.warehouse_id = $2)), 0) AS "onHandQty"
         FROM items i LEFT JOIN units u ON u.unit_id = i.base_unit_id
        WHERE i.is_active = true AND (i.barcode = $1 OR i.code = $1)
        LIMIT 5`,
      [code, warehouseId ?? null],
    );
    return rows;
  }

  async create(dto: ItemDto, user: AuthUser) {
    const result = await this.db.transaction(async (client) => {
      let code = String(dto.code ?? '').trim();
      if (!code) {
        const settingRows = await client.query<{ setting_value: string | null }>(
          `SELECT setting_value FROM app_settings WHERE setting_key = $1::text`,
          ['ItemCodeAuto'],
        );
        const auto = ['true', '1'].includes(String(settingRows.rows[0]?.setting_value ?? '').toLowerCase());
        if (!auto) {
          throw new BadRequestException('كود الصنف مطلوب — أو فعّل «كود الصنف تلقائيًا» من الإعدادات ← إعدادات النظام');
        }
        const seq = await this.db.nextNumber(client, 'ITEM');
        code = `ITM-${String(seq).padStart(6, '0')}`;
      }
      const row = await client.query(
        `INSERT INTO items (code, barcode, name, name_en, category_id, base_unit_id, cost_price, sell_price,
                            vat_pct, discount_pct, reorder_point, is_service, has_serial, is_grouped, is_active, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING item_id`,
        [
          code, dto.barcode ?? null, dto.name, dto.nameEn ?? null, dto.categoryId ?? null,
          dto.baseUnitId, dto.costPrice, dto.sellPrice, dto.vatPct ?? 0, dto.discountPct ?? 0,
          dto.reorderPoint ?? 0, dto.isService ?? false, dto.hasSerial ?? false, dto.isGrouped ?? false, dto.isActive ?? true, dto.notes ?? null,
        ],
      );
      return { itemId: Number(row.rows[0].item_id), code };
    });
    this.live.publish({ type: 'item.updated', itemIds: [result.itemId] });
    return result;
  }

  async update(id: number, dto: ItemDto) {
    if (dto.isGrouped === false) {
      const current = await this.db.one<{ is_grouped: boolean }>(
        'SELECT is_grouped FROM items WHERE item_id = $1::int',
        [id],
      );
      if (current?.is_grouped) {
        throw new BadRequestException('لا يمكن إلغاء خيار «صنف مجمع» بعد حفظه — كدليل البرنامج المرجعي');
      }
    }
    await this.db.query(
      `UPDATE items SET code=$2, barcode=$3, name=$4, name_en=$5, category_id=$6, base_unit_id=$7,
              cost_price=$8, sell_price=$9, vat_pct=$10, discount_pct=$11, reorder_point=$12,
              is_service=$13, has_serial=$14, is_grouped=COALESCE($15, is_grouped), is_active=$16, notes=$17, version = version + 1
        WHERE item_id=$1`,
        [
          id, dto.code, dto.barcode ?? null, dto.name, dto.nameEn ?? null, dto.categoryId ?? null,
          dto.baseUnitId, dto.costPrice, dto.sellPrice, dto.vatPct ?? 0, dto.discountPct ?? 0,
          dto.reorderPoint ?? 0, dto.isService ?? false, dto.hasSerial ?? false,
          dto.isGrouped === undefined || dto.isGrouped === null ? null : Boolean(dto.isGrouped),
          dto.isActive ?? true, dto.notes ?? null,
        ],
    );
    this.live.publish({ type: 'item.updated', itemIds: [id] });
    return { itemId: id };
  }

  async remove(id: number) {
    await assertDeletionAllowed(this.db, 'items');
    await this.db.query('UPDATE items SET is_active = false, version = version + 1 WHERE item_id = $1', [id]);
    return { itemId: id };
  }

  async saveUnits(itemId: number, units: { unitId: number; factor: number; sellPrice?: number; buyPrice?: number }[]) {
    await this.db.transaction(async (client) => {
      await client.query('DELETE FROM item_units WHERE item_id = $1', [itemId]);
      for (const unit of units) {
        await client.query(
          `INSERT INTO item_units (item_id, unit_id, factor, sell_price, buy_price)
           VALUES ($1,$2,$3,$4,$5)`,
          [itemId, unit.unitId, unit.factor, unit.sellPrice ?? null, unit.buyPrice ?? null],
        );
      }
    });
    return { itemId, unitCount: units.length };
  }

  // ---- assembled items (BOM — «كارت التصنيع») ----
  async listGrouped() {
    return this.db.query(
      `SELECT i.item_id AS "itemId", i.code, i.name, i.cost_price AS "costPrice", i.sell_price AS "sellPrice",
              i.is_active AS "isActive",
              (SELECT count(*)::int FROM item_components ic WHERE ic.parent_item_id = i.item_id) AS "componentsCount",
              (SELECT COALESCE(SUM(ic.quantity * child.cost_price), 0)
                 FROM item_components ic JOIN items child ON child.item_id = ic.child_item_id
                WHERE ic.parent_item_id = i.item_id)::numeric AS "componentsCost"
         FROM items i WHERE i.is_grouped = true AND i.is_active = true ORDER BY i.name`,
    );
  }

  async getComponents(id: number) {
    return this.db.query(
      `SELECT ic.child_item_id AS "childItemId", i.code, i.name, u.name AS "unitName",
              ic.quantity, ic.unit_id AS "unitId", i.cost_price AS "childCostPrice"
         FROM item_components ic
         JOIN items i ON i.item_id = ic.child_item_id
         LEFT JOIN units u ON u.unit_id = ic.unit_id
        WHERE ic.parent_item_id = $1::int ORDER BY i.name`,
      [id],
    );
  }

  /** Replaces the component BOM of an assembled item and recalculates its cost from the children. */
  async setComponents(id: number, dto: any, user: AuthUser, ip: string) {
    const item = await this.db.one<any>('SELECT item_id FROM items WHERE item_id = $1::int AND is_grouped = true', [id]);
    if (!item) throw new BadRequestException('الصنف غير موجود أو ليس «صنف مجمع»');
    const lines = Array.isArray(dto?.lines) ? dto.lines : [];
    if (lines.length === 0) throw new BadRequestException('أضف مكوّنًا واحدًا على الأقل قبل الحفظ');
    const seen = new Set<number>();
    for (const line of lines) {
      const child = Number(line?.childItemId);
      if (!child) throw new BadRequestException('اختر مكوّنًا لكل سطر');
      if (child === id) throw new BadRequestException('الصنف المجمع لا يمكن أن يكون مكوّنًا من نفسه');
      if (seen.has(child)) throw new BadRequestException('مكوّن مكرر في نفس الكارت');
      seen.add(child);
      if (!Number(line?.quantity) || Number(line.quantity) <= 0) throw new BadRequestException('الكمية يجب أن تكون أكبر من صفر');
    }
    return this.db.transaction(async (client) => {
      await client.query('DELETE FROM item_components WHERE parent_item_id = $1::int', [id]);
      for (const line of lines) {
        const childId = Number(line.childItemId);
        const unitRow = await client.query('SELECT base_unit_id FROM items WHERE item_id = $1::int', [childId]);
        const unitId = line?.unitId ? Number(line.unitId) : (unitRow.rows[0] ? Number(unitRow.rows[0].base_unit_id) : 1);
        await client.query(
          'INSERT INTO item_components (parent_item_id, child_item_id, quantity, unit_id) VALUES ($1::int,$2::int,$3::numeric,$4::int)',
          [id, childId, Number(line.quantity), unitId],
        );
      }
      // Cost of the assembled item = sum of its children's costs (like the reference guide).
      const costRow = await client.query(
        `SELECT COALESCE(SUM(ic.quantity * child.cost_price), 0) AS cost
           FROM item_components ic JOIN items child ON child.item_id = ic.child_item_id
          WHERE ic.parent_item_id = $1::int`,
        [id],
      );
      const cost = Math.round(Number(costRow.rows[0]?.cost ?? 0) * 100) / 100;
      await client.query('UPDATE items SET cost_price = $2::numeric WHERE item_id = $1::int', [id, cost]);
      await logActivity(client, { userId: user.userId, branchId: null, action: 'item.components',
        entity: 'item', entityId: String(id),
        details: `تعديل مكونات صنف مجمع (${lines.length} مكوّن، التكلفة ${cost})`, ip });
      return { parentItemId: id, componentsCount: lines.length, costPrice: cost };
    });
  }

  /** Manufacturing availability: how many units of each assembled item can be built from stock. */
  async assemblyAvailability(branchId: number) {
    const grouped = await this.db.query<any>(
      `SELECT i.item_id AS "itemId", i.code, i.name, u.name AS "unitName",
              i.sell_price AS "sellPrice", i.cost_price AS "costPrice"
         FROM items i LEFT JOIN units u ON u.unit_id = i.base_unit_id
        WHERE i.is_grouped = true AND i.is_active = true ORDER BY i.name`,
    );
    const items = [];
    for (const row of grouped) {
      const components = await this.getComponents(Number(row.itemId));
      let buildable = Infinity;
      for (const comp of components) {
        const stock = await this.db.one<{ q: string }>(
          `SELECT COALESCE(SUM(q.on_hand_qty), 0)::numeric AS q
             FROM item_warehouse_qty q
             JOIN warehouses w ON w.warehouse_id = q.warehouse_id
            WHERE q.item_id = $1::int AND ($2::int = 0 OR w.branch_id = $2::int)`,
          [Number(comp.childItemId), branchId ?? 0],
        );
        comp.onHand = Number(stock?.q ?? 0);
        comp.lineBuildable = Math.floor(comp.onHand / Number(comp.quantity));
        if (comp.lineBuildable < buildable) buildable = comp.lineBuildable;
      }
      items.push({ ...row, components, buildable: Number.isFinite(buildable) ? buildable : 0 });
    }
    return items;
  }

  // ------------------------------------------------------------------ //
  //  Bulk price edit + CSV/XLSX import (Tools → «أسعار الأصناف» / «استيراد أصناف»)
  // ------------------------------------------------------------------ //

  private static readonly IMPORT_HEADER = ['code', 'barcode', 'name', 'category', 'unit', 'cost_price', 'sell_price', 'vat_pct', 'reorder_point'];
  private static readonly IMPORT_EXAMPLE: (string | number)[] = ['ITM-000001', '6221000000011', 'صنف مثال', 'فئة عامة', 'PCS', 10, 15, 0, 5];

  template(format: string) {
    if (format === 'xlsx') {
      return {
        fileName: 'items-import-template.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: buildTemplateXlsx(ItemsService.IMPORT_HEADER, ItemsService.IMPORT_EXAMPLE).toString('base64'),
      };
    }
    const csv = [ItemsService.IMPORT_HEADER.join(','), ItemsService.IMPORT_EXAMPLE.join(',')].join('\r\n') + '\r\n';
    return {
      fileName: 'items-import-template.csv',
      mimeType: 'text/csv; charset=utf-8',
      base64: Buffer.from('﻿' + csv, 'utf-8').toString('base64'),
    };
  }

  /** Normalises the numbers the import accepts (commas/arabic digits/currency tolerated). */
  private parseNumberish(value: string | undefined, fallback = 0): number {
    if (value === undefined || String(value).trim() === '') return fallback;
    const cleaned = String(value)
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[^\d.,\-]/g, '')
      .replace(/,/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
  }

  private async resolveImportRows(raw: Record<string, string>[], client: import('pg').PoolClient) {
    const [categories, units] = await Promise.all([
      client.query<any>('SELECT category_id AS id, code, name FROM categories'),
      client.query<any>('SELECT unit_id AS id, code, name FROM units'),
    ]);
    const byKey = (rows: any[]) => {
      const map = new Map<string, number>();
      for (const row of rows) {
        if (row.code) map.set(String(row.code).trim().toLowerCase(), Number(row.id));
        if (row.name) map.set(String(row.name).trim().toLowerCase(), Number(row.id));
      }
      return map;
    };
    const categoryByKey = byKey(categories.rows);
    const unitByKey = byKey(units.rows);

    const rows: any[] = [];
    const errors: { row: number; message: string }[] = [];
    raw.forEach((rawRow, index) => {
      const line = index + 2; // header is line 1
      const name = String(rawRow.name ?? '').trim();
      if (!name) { errors.push({ row: line, message: 'الاسم مطلوب' }); return; }
      const categoryRef = String(rawRow.category ?? '').trim();
      const categoryId = categoryRef ? categoryByKey.get(categoryRef.toLowerCase()) ?? null : null;
      if (categoryRef && categoryId === null && !/^\d+$/.test(categoryRef)) {
        errors.push({ row: line, message: `الفئة غير موجودة: ${categoryRef}` }); return;
      }
      const unitRef = String(rawRow.unit ?? 'PCS').trim() || 'PCS';
      const unitId = unitByKey.get(unitRef.toLowerCase()) ?? null;
      if (unitId === null && !/^\d+$/.test(unitRef)) {
        errors.push({ row: line, message: `الوحدة غير موجودة: ${unitRef}` }); return;
      }
      const costPrice = this.parseNumberish(rawRow.cost_price, 0);
      const sellPrice = this.parseNumberish(rawRow.sell_price, 0);
      const vatPct = this.parseNumberish(rawRow.vat_pct, 0);
      const reorderPoint = this.parseNumberish(rawRow.reorder_point, 0);
      if (costPrice < 0 || sellPrice < 0 || vatPct < 0 || reorderPoint < 0) {
        errors.push({ row: line, message: 'الأسعار/الضريبة/حد الطلب يجب أن تكون ≥ 0' }); return;
      }
      rows.push({
        line, code: String(rawRow.code ?? '').trim(), barcode: String(rawRow.barcode ?? '').trim() || null,
        name, categoryId: categoryRef && /^\d+$/.test(categoryRef) ? Number(categoryRef) : categoryId,
        baseUnitId: unitRef && /^\d+$/.test(unitRef) ? Number(unitRef) : unitId,
        costPrice, sellPrice, vatPct, reorderPoint,
      });
    });
    return { rows, errors };
  }

  async importFile(dto: any, user: AuthUser, branchId: number, ip: string) {
    const mode = dto?.mode === 'apply' ? 'apply' : 'preview';
    const parsed = parseImportFile({ csv: dto?.csv, xlsxBase64: dto?.xlsxBase64 });
    if (!parsed.raw.length) throw new BadRequestException('الملف لا يحتوي أي صفوف بيانات');
    const withAliases = applyHeaderAliases(parsed.raw, ITEM_IMPORT_ALIASES);

    return this.db.transaction(async (client) => {
      const { rows, errors } = await this.resolveImportRows(withAliases, client);

      if (mode === 'preview') {
        return {
          mode, total: parsed.raw.length, valid: rows.length, invalid: errors.length,
          errors, sample: rows.slice(0, 10),
        };
      }

      // apply
      let created = 0;
      let updated = 0;
      const failed: { row: number; message: string }[] = [...errors];
      for (const row of rows) {
        try {
          const existing = row.code
            ? (await client.query<any>('SELECT item_id AS id FROM items WHERE code = $1', [row.code])).rows[0]
            : null;
          if (existing) {
            await client.query(
              `UPDATE items SET barcode=$2, name=$3, category_id=$4, base_unit_id=$5,
                      cost_price=$6, sell_price=$7, vat_pct=$8, reorder_point=$9, version = version + 1
               WHERE item_id=$1`,
              [existing.id, row.barcode, row.name, row.categoryId, row.baseUnitId,
                row.costPrice, row.sellPrice, row.vatPct, row.reorderPoint],
            );
            updated += 1;
          } else {
            let code = row.code;
            if (!code) {
              const auto = await client.query<any>(
                `SELECT setting_value FROM app_settings WHERE setting_key = 'ItemCodeAuto'`,
              );
              if (!['true', '1'].includes(String(auto.rows[0]?.setting_value ?? '').toLowerCase())) {
                failed.push({ row: row.line, message: 'الكود مطلوب (أو فعّل «كود الصنف تلقائيًا» من الإعدادات)' });
                continue;
              }
              const seq = await this.db.nextNumber(client, 'ITEM');
              code = `ITM-${String(seq).padStart(6, '0')}`;
            }
            await client.query(
              `INSERT INTO items (code, barcode, name, category_id, base_unit_id,
                      cost_price, sell_price, vat_pct, reorder_point, is_service, has_serial, is_active)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,false,true)`,
              [code, row.barcode, row.name, row.categoryId, row.baseUnitId,
                row.costPrice, row.sellPrice, row.vatPct, row.reorderPoint],
            );
            created += 1;
          }
        } catch (error: any) {
          failed.push({ row: row.line, message: error?.message ?? 'تعذر الحفظ' });
        }
      }
      await logActivity(client, { userId: user.userId, branchId, action: 'item.import',
        entity: 'item', entityId: 'batch',
        details: `استيراد أصناف: ${created} جديد، ${updated} محدّث، ${failed.length} فاشل`, ip });
      return { mode, total: parsed.raw.length, created, updated, failed };
    });
  }

  /** Bulk edit sell/cost prices with preview — Tools → «أسعار الأصناف». */
  async bulkPrice(dto: any, user: AuthUser, ip: string) {
    const scope = dto?.scope === 'category' ? 'category' : dto?.scope === 'ids' ? 'ids' : 'all';
    const categoryId = scope === 'category' ? Number(dto?.categoryId ?? 0) : 0;
    if (scope === 'category' && !categoryId) throw new BadRequestException('اختر الفئة أولًا');
    const ids: number[] = scope === 'ids' && Array.isArray(dto?.itemIds)
      ? [...new Set((dto.itemIds as any[]).map((n) => Number(n)))].filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (scope === 'ids' && !ids.length) throw new BadRequestException('حدد أصنافًا أولًا');
    const field = dto?.field === 'costPrice' ? 'costPrice' : 'sellPrice';
    const column = field === 'costPrice' ? 'cost_price' : 'sell_price';
    const op = ['increasePct', 'decreasePct', 'increaseAmount', 'decreaseAmount'].includes(dto?.op)
      ? dto.op : 'increasePct';
    const value = Number(dto?.value);
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException('القيمة يجب أن تكون رقمًا ≥ 0');
    }
    const mode = dto?.mode === 'apply' ? 'apply' : 'preview';

    const rows = await this.db.query<any>(
      `SELECT item_id AS id, code, name, ${column} AS price
         FROM items
        WHERE is_active = true
          AND ($1::int = 0 OR category_id = $1::int)
          AND ($2::int[] IS NULL OR item_id = ANY($2::int[]))
        ORDER BY name`,
      [categoryId, scope === 'ids' ? ids : null],
    );
    const factor = op.endsWith('Pct') ? value / 100 : null;
    const adjust = (price: number) => {
      const current = Number(price);
      if (op === 'increasePct') return Math.round(current * (1 + factor!) * 100) / 100;
      if (op === 'decreasePct') return Math.max(0, Math.round(current * (1 - factor!) * 100) / 100);
      if (op === 'increaseAmount') return Math.round((current + value) * 100) / 100;
      return Math.max(0, Math.round((current - value) * 100) / 100); // decreaseAmount
    };
    const changed = rows.map((row) => ({
      ...row, newPrice: adjust(row.price), price: Number(row.price),
    }));
    if (mode === 'preview') {
      return { mode, field, op, value, scope, categoryId, count: changed.length, sample: changed.slice(0, 10) };
    }
    await this.db.transaction(async (client) => {
      for (const row of changed) {
        await client.query(
          `UPDATE items SET ${column} = $2::numeric, version = version + 1 WHERE item_id = $1::int`,
          [row.id, row.newPrice],
        );
      }
      await logActivity(client, { userId: user.userId, branchId: null, action: 'item.bulk_price',
        entity: 'item', entityId: 'batch',
        details: `تعديل جماعي للأسعار (${field}, ${op}, ${value}) على ${changed.length} صنف`, ip });
    });
    return { mode, field, op, value, scope, categoryId, updated: changed.length };
  }
}

@Controller('items')
export class ItemsController {
  constructor(private readonly service: ItemsService) {}

  @RequirePermissions('items.view')
  @Get()
  search(
    @Query('search') search: string,
    @Query('categoryId') categoryId: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('partyId') partyId: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.search({
      search,
      categoryId: categoryId ? Number(categoryId) : undefined,
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 20, 200),
      includeInactive: false,
      partyId: partyId ? Number(partyId) : undefined,
      branchId,
    });
  }

  @RequirePermissions('items.view')
  @Get('lookup')
  lookup(@Query('code') code: string, @CurrentBranch() branchId: number) {
    return this.service.lookupByCode(code, branchId);
  }

  /** Assembled items (BOM — كارت التصنيع) list — registered before @Get(':id'). */
  @RequirePermissions('items.view')
  @Get('grouped')
  listGrouped() {
    return this.service.listGrouped();
  }

  /** Manufacturing availability per assembled item — registered before @Get(':id'). */
  @RequirePermissions('items.view')
  @Get('assembly-availability')
  assemblyAvailability(@CurrentBranch() branchId: number) {
    return this.service.assemblyAvailability(branchId);
  }

  /** Template for the items import (CSV or XLSX) — before @Get(':id') or it would shadow it. */
  @RequirePermissions('items.manage')
  @Get('import/template')
  importTemplate(@Query('format') format: string) {
    return this.service.template(String(format ?? 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv');
  }

  /** Upload CSV/XLSX (base64 or raw csv text) — mode=preview (default) or mode=apply. */
  @RequirePermissions('items.manage')
  @Post('import')
  importFile(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.importFile(dto, user, branchId, ip);
  }

  /** Bulk edit sell/cost prices — mode=preview (default) or mode=apply. */
  @RequirePermissions('items.manage')
  @Post('bulk-price')
  bulkPrice(@Body() dto: any, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.bulkPrice(dto, user, ip);
  }

  @RequirePermissions('items.view')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.service.findOne(id, branchId);
  }

  @RequirePermissions('items.manage')
  @Post()
  create(@Body() dto: ItemDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @RequirePermissions('items.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: ItemDto) {
    return this.service.update(id, dto);
  }

  @RequirePermissions('items.manage')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @RequirePermissions('items.manage')
  @Get(':id/components')
  getComponents(@Param('id', ParseIntPipe) id: number) {
    return this.service.getComponents(id);
  }

  @RequirePermissions('items.manage')
  @Put(':id/components')
  setComponents(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.setComponents(id, dto, user, ip);
  }

  @RequirePermissions('items.manage')
  @Post(':id/units')
  saveUnits(@Param('id', ParseIntPipe) id: number, @Body() body: { units: any[] }) {
    return this.service.saveUnits(id, body.units ?? []);
  }
}

@Module({
  imports: [EventsModule],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
