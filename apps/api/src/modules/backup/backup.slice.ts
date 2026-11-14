import {
  Body, Controller, Get, Injectable, Module, Post, BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentUser, RequirePermissions } from '../../common/security';

interface BackupTable {
  rows: any[];
}

interface BackupPayload {
  version: number;
  createdAt: string;
  tables: Record<string, BackupTable | any[]>;
}

@Injectable()
export class BackupService {
  constructor(private readonly db: DatabaseService) {}

  async create() {
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
      return {
        version: 1,
        createdAt: new Date().toISOString(),
        tables,
      };
    });
  }

  async restore(payload: BackupPayload, user: AuthUser) {
    if (!payload || typeof payload !== 'object' || !payload.tables || typeof payload.tables !== 'object') {
      throw new BadRequestException('ملف النسخة الاحتياطية غير صالح');
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

      for (const [tableName, raw] of Object.entries(payload.tables)) {
        if (!tableNames.includes(tableName)) continue;
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
      }

      for (const tableName of tableNames) {
        const columns = await client.query<any>(
          `SELECT column_name
             FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1`,
          [tableName],
        );
        for (const col of columns.rows) {
          const columnName = String(col.column_name);
          const seq = await client.query<any>(
            `SELECT pg_get_serial_sequence($1, $2) AS seq`,
            [tableName, columnName],
          );
          const sequenceName = seq.rows[0]?.seq;
          if (!sequenceName) continue;
          const maxResult = await client.query<any>(
            `SELECT MAX("${columnName}") AS max_value FROM "${tableName}"`,
          );
          const maxValue = maxResult.rows[0]?.max_value;
          if (maxValue === null || maxValue === undefined) {
            await client.query(`SELECT setval($1::regclass, 1, false)`, [sequenceName]);
          } else {
            await client.query(`SELECT setval($1::regclass, $2, true)`, [sequenceName, maxValue]);
          }
        }
      }

      await client.query("SET session_replication_role = 'origin'");
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int, NULL, 'backup.restore', 'database', NULL, $2)`,
        [user.userId, `استعادة نسخة احتياطية by ${user.userName}`],
      );

      return { restored: true, tables: Object.keys(payload.tables).length };
    });
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

  private deserializeValue(value: any, dataType?: string) {
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
    return this.service.create();
  }

  @RequirePermissions('users.manage')
  @Post('restore')
  restore(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.restore(body as BackupPayload, user);
  }
}

@Module({
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
