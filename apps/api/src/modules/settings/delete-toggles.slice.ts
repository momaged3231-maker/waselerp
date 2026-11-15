import { Controller, Get, Module } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { DELETE_SCREENS, isTruthySetting } from '../../common/delete-guard';

/**
 * Lightweight read-only endpoint for the UI to know which screens may show
 * their delete button. Any authenticated user can read it — it exposes only
 * on/off flags (no data, no secrets). Writes stay on /admin/settings.
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
}

@Module({ controllers: [DeleteTogglesController] })
export class DeleteTogglesModule {}
