import { Controller, Get, Module } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { DELETE_SCREENS, isTruthySetting } from '../../common/delete-guard';

/**
 * Lightweight read-only endpoints for the UI (any authenticated user can read —
 * they expose flags / clock info only, no data, no secrets). Writes stay on
 * /admin/settings (PUT with the app_settings map).
 */
@Controller('settings')
export class DeleteTogglesController {
  constructor(private readonly db: DatabaseService) {}

  @Get('delete-toggles')
  async toggles() {
    const rows = await this.db.query<{ setting_key: string; setting_value: string | null }>(
      `SELECT setting_key, setting_value FROM app_settings
        WHERE setting_key = 'DeleteEnabled' OR setting_key LIKE 'DeleteEnabled_%'`,
    );
    const map = new Map(rows.map((row) => [row.setting_key, String(row.setting_value ?? '')]));
    const screens: Record<string, boolean> = {};
    for (const key of Object.keys(DELETE_SCREENS)) {
      screens[key] = isTruthySetting(map.get(`DeleteEnabled_${key}`));
    }
    return {
      deleteEnabled: isTruthySetting(map.get('DeleteEnabled')),
      screens,
    };
  }

  /**
   * Clock / time-display info for the UI: the display timezone (IANA, '' = the
   * device timezone) and whether times should be read from the server clock.
   * Any authenticated user can read it (no data, no secrets).
   */
  @Get('time-display')
  async timeDisplay() {
    const rows = await this.db.query<{ setting_key: string; setting_value: string | null }>(
      `SELECT setting_key, setting_value FROM app_settings
        WHERE setting_key = 'DisplayTimezone' OR setting_key = 'TimeFromServer'`,
    );
    const map = new Map(rows.map((row) => [row.setting_key, String(row.setting_value ?? '')]));
    const timeZone = String(map.get('DisplayTimezone') || 'Africa/Cairo');
    const fromServer = map.get('TimeFromServer') === 'true' || map.get('TimeFromServer') === '1';
    return {
      timeZone,
      fromServer,
      serverTime: new Date().toISOString(),
      serverEpochMs: Date.now(),
    };
  }
}

@Module({ controllers: [DeleteTogglesController] })
export class DeleteTogglesModule {}
