import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentUser, RequirePermissions } from '../../common/security';

interface BackupTable {
  rows: any[];
}

interface BackupPayload {
  version: number;
  createdAt?: string;
  meta?: any;
  tables: Record<string, BackupTable | any[]>;
}

interface RestoreRequest {
  backup?: BackupPayload;
  confirm?: string;
  user_id?: number;
}

interface FkDef {
  constraint: string;
  childTable: string;
  childCols: string[];
  parentTable: string;
  parentCols: string[];
}

@Injectable()
export class BackupService {
  constructor(private readonly db: DatabaseService) {}

  async create(user: AuthUser) {
    return this.db.transaction(async (client) => {
      const tableRows = await client.query<any>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          ORDER BY table_name`,
      );
      const tables: Record<string, any[]> = {};
      for (const row of tableRows.rows) {
        const tableName = String(row.table_name);
        const data = await client.query<any>(`SELECT * FROM "${tableName}"`);
        tables[tableName] = data.rows.map((r) => this.serializeRow(r));
      }
      const totalRows = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
      const meta = { tables: tableRows.rows.length, rows: totalRows };
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int, NULL, 'backup.export', 'database', NULL, $2::text)`,
        [user.userId, `تصدير نسخة احتياطية (${meta.tables} جدول، ${meta.rows} سطر)`],
      );
      return {
        version: 1,
        createdAt: new Date().toISOString(),
        meta,
        tables,
      };
    });
  }

  /** Legacy restore (admin/backup/restore, users.manage) — kept for compatibility. */
  async restore(payload: BackupPayload, user: AuthUser) {
    if (!payload || typeof payload !== 'object' || !payload.tables || typeof payload.tables !== 'object') {
      throw new BadRequestException('ملف النسخة الاحتياطية غير صالح');
    }
    if (payload.version !== 1) {
      throw new BadRequestException('نسخة احتياطية غير مدعومة (version غير معروف) — استخدم نسخة من هذا النظام');
    }
    const payloadTables = Object.entries(payload.tables);
    if (payloadTables.length === 0) {
      throw new BadRequestException('النسخة الاحتياطية لا تحتوي أي جداول');
    }
    return this.db.transaction(async (client) => {
      await client.query("SET session_replication_role = 'replica'");
      const dbTables = await client.query<any>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const tableNames = dbTables.rows.map((r: any) => String(r.table_name));
      for (const tableName of tableNames) {
        await client.query(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE`);
      }
      const skipped: string[] = [];
      let restoredRows = 0;
      let restoredTables = 0;
      for (const [tableName, raw] of payloadTables) {
        if (!tableNames.includes(tableName)) {
          skipped.push(tableName);
          continue;
        }
        const rows = Array.isArray(raw) ? raw : (raw as any)?.rows;
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const columns = await client.query<any>(
          `SELECT column_name, data_type, is_generated
             FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position`,
          [tableName],
        );
        const insertable = columns.rows
          .filter((c: any) => c.is_generated !== 'ALWAYS')
          .map((c: any) => String(c.column_name));
        if (!insertable.length) continue;
        const colTypes = new Map(columns.rows.map((c: any) => [String(c.column_name), String(c.data_type)]));
        for (const row of rows) {
          const values = insertable.map((col) => this.deserializeValue(row[col], colTypes.get(col)));
          const placeholders = insertable.map((_, i) => `$${i + 1}`).join(', ');
          await client.query(
            `INSERT INTO "${tableName}" (${insertable.map((c) => `"${c}"`).join(', ')})
             VALUES (${placeholders})`,
            values,
          );
        }
        restoredTables += 1;
        restoredRows += rows.length;
      }
      await this.resetSequences(client, tableNames);
      await client.query("SET session_replication_role = 'origin'");
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int, NULL, 'backup.restore', 'database', NULL, $2::text)`,
        [user.userId, `استعادة نسخة احتياطية (${restoredTables} جدول، ${restoredRows} سطر${skipped.length ? `، تجاهل ${skipped.length} جدول غير معروف` : ''}) — بواسطة ${user.userName}`],
      );
      return { restored: true, tables: restoredTables, rows: restoredRows, skipped };
    });
  }

  /** GAP-07 compliant restore: POST /admin/restore */
  async restoreGAP07(body: RestoreRequest, user: AuthUser, sourceIp: string | null) {
    if (!body || body.confirm !== 'RESTORE') {
      throw new BadRequestException('يجب تأكيد الاستعادة بإرسال confirm: "RESTORE"');
    }
    const backup = body.backup as BackupPayload;
    if (!backup || typeof backup !== 'object' || !backup.tables || typeof backup.tables !== 'object') {
      throw new BadRequestException('ملف النسخة الاحتياطية غير صالح');
    }
    if (backup.version !== 1) {
      throw new BadRequestException('نسخة احتياطية غير مدعومة (version != 1) — استخدم نسخة من هذا النظام');
    }
    const includedTableNames = Object.keys(backup.tables);
    if (includedTableNames.length === 0) {
      throw new BadRequestException('النسخة الاحتياطية لا تحتوي أي جداول');
    }

    // Normalize rows and expected counts
    const normalized: Record<string, any[]> = {};
    const expectedCounts: Record<string, number> = {};
    for (const t of includedTableNames) {
      const raw = (backup.tables as any)[t];
      const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows : null;
      if (!Array.isArray(rows)) {
        throw new BadRequestException(`جدول النسخة الاحتياطية غير صالح: ${t}`);
      }
      normalized[t] = rows;
      expectedCounts[t] = rows.length;
    }

    // GAP07 specific malformed case: gl_journals present with rows but gl_entries missing/empty
    if ((normalized['gl_journals']?.length ?? 0) > 0 && (normalized['gl_entries']?.length ?? 0) === 0) {
      throw new BadRequestException('نسخة احتياطية مشوّهة: قيود محاسبية (gl_journals) بدون سطور (gl_entries)');
    }

    return this.db.transaction(async (client) => {
      // Load DB tables and FKs
      const dbTablesRes = await client.query<any>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const dbTableSet = new Set(dbTablesRes.rows.map((r: any) => String(r.table_name)));

      // Ensure all backup tables exist in DB
      for (const t of includedTableNames) {
        if (!dbTableSet.has(t)) {
          throw new BadRequestException(`جدول غير معروف في النسخة الاحتياطية: ${t}`);
        }
      }

      const fks = await this.loadForeignKeys(client);
      const includedSet = new Set(includedTableNames);
      const fksInScope = fks.filter((fk) => includedSet.has(fk.childTable) && includedSet.has(fk.parentTable));

      // FK dangling validation (within backup payload)
      this.validateNoDanglingFks(normalized, includedSet, fksInScope);

      // Compute FK-safe order among included tables
      const insertOrder = this.topoSortInsert(includedTableNames, fksInScope);
      const deleteOrder = [...insertOrder].reverse();

      // Destructive restore in one transaction
      await client.query("SET session_replication_role = 'replica'");

      // DELETE in FK reverse order (children before parents) — only tables included in backup
      for (const tableName of deleteOrder) {
        await client.query(`DELETE FROM "${tableName}"`);
      }

      // INSERT in FK correct order (parents before children)
      for (const tableName of insertOrder) {
        const rows = normalized[tableName] || [];
        if (rows.length === 0) continue;
        const columns = await client.query<any>(
          `SELECT column_name, data_type, is_generated
             FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position`,
          [tableName],
        );
        const insertable = columns.rows
          .filter((c: any) => c.is_generated !== 'ALWAYS')
          .map((c: any) => String(c.column_name));
        if (!insertable.length) continue;
        const colTypes = new Map(columns.rows.map((c: any) => [String(c.column_name), String(c.data_type)]));
        for (const row of rows) {
          const values = insertable.map((col) => this.deserializeValue(row[col], colTypes.get(col)));
          const placeholders = insertable.map((_, i) => `$${i + 1}`).join(', ');
          await client.query(
            `INSERT INTO "${tableName}" (${insertable.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
            values,
          );
        }
      }

      // Verify counts per table == backup counts
      for (const tableName of includedTableNames) {
        const cntRes = await client.query<any>(`SELECT COUNT(*)::int AS c FROM "${tableName}"`);
        const actual = Number(cntRes.rows[0]?.c ?? 0);
        const expected = expectedCounts[tableName];
        if (actual !== expected) {
          throw new BadRequestException(`فشل التحقق من عدد السطور لجدول ${tableName}: المتوقع ${expected}، الفعلي ${actual}`);
        }
      }

      // Reset sequences for included tables
      await this.resetSequences(client, includedTableNames);

      await client.query("SET session_replication_role = 'origin'");

      // restore_log audit (per restore)
      await client.query(
        `INSERT INTO restore_log (restored_by, backup_version, table_counts, source_ip)
         VALUES ($1::int, $2::int, $3::jsonb, $4::text)`,
        [user.userId, backup.version, JSON.stringify(expectedCounts), sourceIp],
      );
      // also keep activity_log for traceability
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int, NULL, 'backup.restore', 'database', NULL, $2::text)`,
        [user.userId, `استعادة نسخة (GAP-07) — ${includedTableNames.length} جدول، ${Object.values(expectedCounts).reduce((a, b) => a + b, 0)} سطر`],
      );

      return {
        restored: true,
        tables: includedTableNames.length,
        rows: Object.values(expectedCounts).reduce((a, b) => a + b, 0),
        counts: expectedCounts,
        deleteOrder,
        insertOrder,
      };
    });
  }

  private async loadForeignKeys(client: PoolClient): Promise<FkDef[]> {
    const res = await client.query<any>(
      `SELECT
          tc.constraint_name,
          tc.table_name AS child_table,
          kcu.column_name AS child_column,
          ccu.table_name AS parent_table,
          ccu.column_name AS parent_column,
          kcu.ordinal_position
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        ORDER BY tc.constraint_name, kcu.ordinal_position`,
    );
    const map = new Map<string, FkDef>();
    for (const r of res.rows) {
      const key = String(r.constraint_name);
      if (!map.has(key)) {
        map.set(key, {
          constraint: key,
          childTable: String(r.child_table),
          childCols: [],
          parentTable: String(r.parent_table),
          parentCols: [],
        });
      }
      const def = map.get(key)!;
      def.childCols.push(String(r.child_column));
      def.parentCols.push(String(r.parent_column));
    }
    return Array.from(map.values());
  }

  private validateNoDanglingFks(normalized: Record<string, any[]>, includedSet: Set<string>, fks: FkDef[]) {
    // Build key sets for parent tables: key = JSON of parentCols values tuple
    const parentKeySets = new Map<string, Set<string>>();
    const getKeySet = (table: string, cols: string[]): Set<string> => {
      const cacheKey = table + '::' + cols.join(',');
      if (parentKeySets.has(cacheKey)) return parentKeySets.get(cacheKey)!;
      const set = new Set<string>();
      for (const row of normalized[table] || []) {
        set.add(this.tupleKey(row, cols));
      }
      parentKeySets.set(cacheKey, set);
      return set;
    };

    for (const fk of fks) {
      if (!includedSet.has(fk.childTable) || !includedSet.has(fk.parentTable)) continue;
      const parentSet = getKeySet(fk.parentTable, fk.parentCols);
      for (const row of normalized[fk.childTable] || []) {
        // if any FK column is null, skip (nullable FK)
        let hasNull = false;
        for (const c of fk.childCols) {
          if (row[c] === null || row[c] === undefined) { hasNull = true; break; }
        }
        if (hasNull) continue;
        const k = this.tupleKey(row, fk.childCols);
        if (!parentSet.has(k)) {
          throw new BadRequestException(
            `مرجع أجنبي معلق (FK dangling): الجدول ${fk.childTable} يشير إلى ${fk.parentTable} بقيمة غير موجودة (${fk.constraint})`,
          );
        }
      }
    }
  }

  private tupleKey(row: any, cols: string[]): string {
    return JSON.stringify(cols.map((c) => (row[c] === undefined ? null : row[c])));
  }

  /** Topological sort: parents before children for insert. */
  private topoSortInsert(tables: string[], fks: FkDef[]): string[] {
    const set = new Set(tables);
    const indeg = new Map<string, number>();
    const children = new Map<string, Set<string>>();
    for (const t of tables) {
      indeg.set(t, 0);
      children.set(t, new Set());
    }
    for (const fk of fks) {
      if (!set.has(fk.childTable) || !set.has(fk.parentTable)) continue;
      if (fk.childTable === fk.parentTable) continue; // self-FK handled by replica mode
      if (!children.get(fk.parentTable)!.has(fk.childTable)) {
        children.get(fk.parentTable)!.add(fk.childTable);
        indeg.set(fk.childTable, (indeg.get(fk.childTable) || 0) + 1);
      }
    }
    // Kahn's algorithm with stable-ish order (alphabetical for determinism)
    const queue: string[] = tables.filter((t) => (indeg.get(t) || 0) === 0).sort();
    const out: string[] = [];
    while (queue.length) {
      const n = queue.shift()!;
      out.push(n);
      const kids = Array.from(children.get(n) || []).sort();
      for (const k of kids) {
        indeg.set(k, (indeg.get(k) || 0) - 1);
        if (indeg.get(k) === 0) {
          // insert keeping queue sorted for determinism
          let i = 0;
          while (i < queue.length && queue[i] < k) i++;
          queue.splice(i, 0, k);
        }
      }
    }
    // cycle fallback: append remaining in name order (replica mode will handle)
    if (out.length < tables.length) {
      const remaining = tables.filter((t) => !out.includes(t)).sort();
      out.push(...remaining);
    }
    return out;
  }

  private async resetSequences(client: PoolClient, tableNames: string[]) {
    for (const tableName of tableNames) {
      const columns = await client.query<any>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [tableName],
      );
      for (const col of columns.rows) {
        const columnName = String(col.column_name);
        const seq = await client.query<any>(`SELECT pg_get_serial_sequence($1, $2) AS seq`, [tableName, columnName]);
        const sequenceName = (seq.rows[0] as any)?.seq;
        if (!sequenceName) continue;
        const maxResult = await client.query<any>(`SELECT MAX("${columnName}") AS max_value FROM "${tableName}"`);
        const maxValue = (maxResult.rows[0] as any)?.max_value;
        if (maxValue === null || maxValue === undefined) {
          await client.query(`SELECT setval($1::regclass, 1, false)`, [sequenceName]);
        } else {
          await client.query(`SELECT setval($1::regclass, $2, true)`, [sequenceName, maxValue]);
        }
      }
    }
  }

  private serializeRow(row: any) {
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      if (Buffer.isBuffer(value)) {
        out[key] = { __bytea: value.toString('base64') };
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  private deserializeValue(value: any, _dataType?: string) {
    if (value && typeof value === 'object' && value.__bytea) {
      return Buffer.from(value.__bytea, 'base64');
    }
    return value;
  }
}

@Controller('admin/backup')
export class BackupController {
  constructor(private readonly service: BackupService) {}

  @RequirePermissions('users.manage')
  @Get()
  create(@CurrentUser() user: AuthUser) {
    return this.service.create(user);
  }

  @RequirePermissions('users.manage')
  @Post('restore')
  restore(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.restore(body as BackupPayload, user);
  }
}

@Controller('admin/restore')
export class AdminRestoreController {
  constructor(private readonly service: BackupService) {}

  @RequirePermissions('admin.restore_backup')
  @Post()
  restore(@Body() body: RestoreRequest, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const forwarded = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    const ip = forwarded || req.ip || (req.socket as any)?.remoteAddress || null;
    return this.service.restoreGAP07(body, user, ip);
  }
}

@Module({
  controllers: [BackupController, AdminRestoreController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
