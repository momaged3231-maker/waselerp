import { PoolClient } from 'pg';

/** Reads one system setting inside the caller's transaction. */
export async function getSetting(client: PoolClient, key: string): Promise<string | null> {
  const { rows } = await client.query<{ setting_value: string | null }>(
    'SELECT setting_value FROM app_settings WHERE setting_key = $1',
    [key],
  );
  return rows.length ? rows[0].setting_value : null;
}

/** Reads a boolean setting. Values are stored as the strings `true` / `false`. */
export async function getBooleanSetting(client: PoolClient, key: string, fallback = false): Promise<boolean> {
  const value = await getSetting(client, key);
  if (value === null) return fallback;
  return value === 'true' || value === '1';
}
