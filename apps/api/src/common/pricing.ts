/**
 * Price list resolution.
 *
 * Shared by the pricing slice and the item/POS lookups. Lives in `common`
 * because two different slices need it and slices must not import each other.
 */

export interface ResolvedPrice {
  itemId: number;
  price: number;
  minPrice: number;
  discountPct: number;
  finalPrice: number;
  priceListId: number | null;
  priceListName: string | null;
  source: 'price_list' | 'item_card';
}

/** Anything able to run a parameterised query (DatabaseService or PoolClient). */
export interface QueryRunner {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  one<T = any>(sql: string, params?: any[]): Promise<T | null>;
}

/** Adapts a `pg` client to the QueryRunner interface. */
export function asRunner(client: {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}): QueryRunner {
  return {
    query: async (sql: string, params?: any[]) => (await client.query(sql, params)).rows,
    one: async (sql: string, params?: any[]) => {
      const result = await client.query(sql, params);
      return result.rows[0] ?? null;
    },
  };
}

/** The price list assigned to a customer, if any. */
export async function partyPriceListId(runner: QueryRunner, partyId?: number | null): Promise<number | null> {
  if (!partyId) return null;
  const row = await runner.one<{ price_list_id: number | null }>(
    'SELECT price_list_id FROM parties WHERE party_id = $1::int',
    [partyId],
  );
  return row?.price_list_id ?? null;
}

/**
 * Resolves the price of several items at once.
 * The list assigned to the customer wins, then the highest priority list.
 */
export async function resolvePrices(
  runner: QueryRunner,
  params: { itemIds: number[]; partyId?: number | null; branchId?: number; date?: string },
): Promise<Map<number, ResolvedPrice>> {
  const result = new Map<number, ResolvedPrice>();
  const itemIds = (params.itemIds ?? []).filter((id) => Number.isFinite(Number(id)));
  if (!itemIds.length) return result;

  const date = params.date ?? new Date().toISOString().slice(0, 10);
  const partyListId = await partyPriceListId(runner, params.partyId);

  const rows = await runner.query<any>(
    `SELECT l.item_id, l.price, l.min_price, p.price_list_id, p.name AS price_list_name,
            p.discount_pct, p.priority
       FROM price_list_lines l
       JOIN price_lists p ON p.price_list_id = l.price_list_id
      WHERE l.item_id = ANY($1::int[])
        AND p.is_active = true
        AND (p.branch_id IS NULL OR $2::int = 0 OR p.branch_id = $2::int)
        AND (p.start_date IS NULL OR p.start_date <= $3::date)
        AND (p.end_date IS NULL OR p.end_date >= $3::date)
        AND (l.start_date IS NULL OR l.start_date <= $3::date)
        AND (l.end_date IS NULL OR l.end_date >= $3::date)
      ORDER BY l.item_id,
               CASE WHEN p.price_list_id = $4::int THEN 0 ELSE 1 END,
               p.priority DESC, p.price_list_id`,
    [itemIds, params.branchId ?? 0, date, partyListId],
  );

  for (const row of rows) {
    const itemId = Number(row.item_id);
    if (result.has(itemId)) continue;
    const discount = Number(row.discount_pct ?? 0);
    const price = Number(row.price);
    result.set(itemId, {
      itemId,
      price,
      minPrice: Number(row.min_price ?? 0),
      discountPct: discount,
      finalPrice: Math.round(price * (1 - discount / 100) * 10000) / 10000,
      priceListId: Number(row.price_list_id),
      priceListName: row.price_list_name,
      source: 'price_list',
    });
  }
  return result;
}

/**
 * Resolves a single price, falling back to the item card when the item is
 * not part of any list.
 */
export async function resolvePrice(
  runner: QueryRunner,
  params: { itemId: number; unitId?: number; partyId?: number | null; branchId?: number; date?: string },
): Promise<ResolvedPrice | null> {
  const date = params.date ?? new Date().toISOString().slice(0, 10);
  const partyListId = await partyPriceListId(runner, params.partyId);

  const rows = await runner.query<any>(
    `SELECT l.price, l.min_price, l.unit_id, p.price_list_id, p.name AS price_list_name,
            p.discount_pct, p.priority
       FROM price_list_lines l
       JOIN price_lists p ON p.price_list_id = l.price_list_id
      WHERE l.item_id = $1::int
        AND p.is_active = true
        AND (l.unit_id IS NULL OR $2::int = 0 OR l.unit_id = $2::int)
        AND (p.branch_id IS NULL OR $4::int = 0 OR p.branch_id = $4::int)
        AND (p.start_date IS NULL OR p.start_date <= $3::date)
        AND (p.end_date IS NULL OR p.end_date >= $3::date)
        AND (l.start_date IS NULL OR l.start_date <= $3::date)
        AND (l.end_date IS NULL OR l.end_date >= $3::date)
      ORDER BY CASE WHEN p.price_list_id = $5::int THEN 0 ELSE 1 END,
               p.priority DESC, p.price_list_id
      LIMIT 1`,
    [params.itemId, params.unitId ?? 0, date, params.branchId ?? 0, partyListId],
  );

  if (rows.length) {
    const row = rows[0];
    const discount = Number(row.discount_pct ?? 0);
    const price = Number(row.price);
    return {
      itemId: params.itemId,
      price,
      minPrice: Number(row.min_price ?? 0),
      discountPct: discount,
      finalPrice: Math.round(price * (1 - discount / 100) * 10000) / 10000,
      priceListId: Number(row.price_list_id),
      priceListName: row.price_list_name,
      source: 'price_list',
    };
  }

  const card = await runner.one<any>(
    `SELECT i.sell_price, i.min_price, i.discount_pct, u.sell_price AS unit_sell_price
       FROM items i
       LEFT JOIN item_units u ON u.item_id = i.item_id AND u.unit_id = $2::int
      WHERE i.item_id = $1::int`,
    [params.itemId, params.unitId ?? 0],
  );
  if (!card) return null;

  const discount = Number(card.discount_pct ?? 0);
  const price = Number(card.unit_sell_price ?? card.sell_price ?? 0);
  return {
    itemId: params.itemId,
    price,
    minPrice: Number(card.min_price ?? 0),
    discountPct: discount,
    finalPrice: Math.round(price * (1 - discount / 100) * 10000) / 10000,
    priceListId: null,
    priceListName: null,
    source: 'item_card',
  };
}
