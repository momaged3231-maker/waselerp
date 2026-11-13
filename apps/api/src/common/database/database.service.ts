import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';

// `bigint` columns (document ids) come back as strings by default, which
// makes ids inconsistent with the `integer` ones. Every id in this project
// fits in a JS number, so they are parsed as numbers everywhere.
types.setTypeParser(20, (value: string) => Number(value));

export type QueryParam = unknown;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.get<string>('DATABASE_URL') ??
        'postgres://postgres:postgres@localhost:5432/wasel',
      max: config.get<number>('DB_POOL_MAX') ?? 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  async query<T extends QueryResultRow = any>(sql: string, params: QueryParam[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params as any[]);
    return result.rows;
  }

  async one<T extends QueryResultRow = any>(sql: string, params: QueryParam[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length ? rows[0] : null;
  }

  async count(sql: string, params: QueryParam[] = []): Promise<number> {
    const row = await this.one<{ count: string }>(sql, params);
    return row ? Number(row.count) : 0;
  }

  /** Runs `work` inside a single transaction; rolls back on any error. */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Atomically increments and returns the next number of a document sequence. */
  async nextNumber(client: PoolClient, key: string): Promise<number> {
    const { rows } = await client.query<{ last_number: string }>(
      `INSERT INTO number_sequences (sequence_key, last_number) VALUES ($1, 1)
       ON CONFLICT (sequence_key) DO UPDATE SET last_number = number_sequences.last_number + 1
       RETURNING last_number`,
      [key],
    );
    return Number(rows[0].last_number);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
