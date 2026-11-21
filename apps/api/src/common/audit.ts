import { PoolClient } from 'pg';

/**
 * GAP-01 Part B — unified `activity_log` writer (closes TD-49).
 *
 * Every financial mutation MUST pass the caller's client IP. The parameter is
 * REQUIRED (not optional) on purpose: TypeScript enforces it at each call site,
 * so no new financial path can silently omit attribution.
 */
export async function logActivity(client: PoolClient, params: {
  userId: number;
  branchId: number;
  action: string;
  entity: string;
  entityId: string | number;
  details?: string;
  ip: string;
}): Promise<void> {
  await client.query(
    `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details, ip_address)
     VALUES ($1::int, $2::int, $3::varchar, $4::varchar, $5::varchar, $6::text, $7::varchar)`,
    [
      params.userId,
      params.branchId,
      params.action,
      params.entity,
      String(params.entityId),
      params.details ?? null,
      params.ip,
    ],
  );
}
