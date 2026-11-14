import { Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query, Delete } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

@Injectable()
export class RemindersService {
  constructor(private readonly db: DatabaseService) {}

  async list(params: { branchId: number; done?: boolean; from?: string; to?: string }) {
    return this.db.query<any>(
      `SELECT r.reminder_id AS "reminderId", r.title, r.description, r.remind_at AS "remindAt",
              r.is_done AS "isDone", r.done_at AS "doneAt", r.created_at AS "createdAt",
              u.full_name AS "createdBy"
         FROM reminders r LEFT JOIN users u ON u.user_id = r.created_by
        WHERE r.branch_id = $1
          AND ($2::boolean IS NULL OR r.is_done = $2)
          AND ($3::timestamptz IS NULL OR r.remind_at >= $3::timestamptz)
          AND ($4::timestamptz IS NULL OR r.remind_at <= $4::timestamptz)
        ORDER BY r.is_done, r.remind_at`,
      [params.branchId, params.done ?? null, params.from ?? null, params.to ?? null],
    );
  }

  async upcoming(branchId: number) {
    return this.db.query<any>(
      `SELECT r.reminder_id AS "reminderId", r.title, r.description, r.remind_at AS "remindAt", r.is_done AS "isDone"
         FROM reminders r
        WHERE r.branch_id = $1 AND r.is_done = false AND r.remind_at <= now() + interval '7 days'
        ORDER BY r.remind_at`,
      [branchId],
    );
  }

  async create(dto: any, user: AuthUser, branchId: number) {
    const row = await this.db.one<any>(
      `INSERT INTO reminders (branch_id, title, description, remind_at, created_by)
       VALUES ($1,$2,$3,$4::timestamptz,$5) RETURNING reminder_id AS "reminderId"`,
      [branchId, dto.title, dto.description ?? null, dto.remindAt, user.userId],
    );
    return row;
  }

  async update(id: number, dto: any) {
    await this.db.query(
      `UPDATE reminders SET title = COALESCE($2, title), description = COALESCE($3, description),
              remind_at = COALESCE($4::timestamptz, remind_at)
        WHERE reminder_id = $1`,
      [id, dto.title ?? null, dto.description ?? null, dto.remindAt ?? null],
    );
    return { reminderId: id };
  }

  async toggleDone(id: number, done: boolean) {
    await this.db.query(
      `UPDATE reminders SET is_done = $2, done_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE reminder_id = $1`,
      [id, done],
    );
    return { reminderId: id, isDone: done };
  }

  async remove(id: number) {
    await this.db.query(`DELETE FROM reminders WHERE reminder_id = $1`, [id]);
    return { reminderId: id, deleted: true };
  }
}

@Controller('reminders')
export class RemindersController {
  constructor(private readonly service: RemindersService) {}

  @RequirePermissions('dashboard.view')
  @Get() list(@CurrentBranch() branchId: number, @Query('done') done: string, @Query('from') from: string, @Query('to') to: string) {
    return this.service.list({ branchId, done: done === 'true' ? true : done === 'false' ? false : undefined, from, to });
  }
  @RequirePermissions('dashboard.view')
  @Get('upcoming') upcoming(@CurrentBranch() branchId: number) { return this.service.upcoming(branchId); }
  @RequirePermissions('settings.manage')
  @Post() create(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) { return this.service.create(dto, user, branchId); }
  @RequirePermissions('settings.manage')
  @Put(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.update(id, dto); }
  @RequirePermissions('settings.manage')
  @Put(':id/done') toggleDone(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.toggleDone(id, dto.isDone ?? true); }
  @RequirePermissions('settings.manage')
  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) { return this.service.remove(id); }
}

@Module({
  providers: [RemindersService],
  controllers: [RemindersController],
})
export class RemindersModule {}
