import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { assertDeletionAllowed, countReferencingRows } from '../../common/delete-guard';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';
import { Request } from 'express';
import { logActivity } from '../../common/audit';

const STAGES: Record<number, string> = { 1: 'جديد', 2: 'تم التواصل', 3: 'مؤهل', 4: 'عرض سعر', 5: 'مكسوب', 6: 'خاسر' };

@Injectable()
export class CrmService {
  constructor(private readonly db: DatabaseService) {}

  // --- Sources ---
  listSources() {
    return this.db.query<any>(
      `SELECT source_id AS "sourceId", name, is_active AS "isActive", created_at AS "createdAt"
         FROM crm_sources ORDER BY source_id`,
    );
  }
  async createSource(dto: any) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم المصدر مطلوب');
    return this.db.one<any>(
      `INSERT INTO crm_sources (name, is_active) VALUES ($1::text, COALESCE($2::boolean,true))
       RETURNING source_id AS "sourceId", name, is_active AS "isActive"`,
      [name, dto.isActive ?? true],
    );
  }
  async updateSource(id: number, dto: any) {
    return this.db.one<any>(
      `UPDATE crm_sources SET name = COALESCE($2::text,name), is_active = COALESCE($3::boolean,is_active)
        WHERE source_id = $1::int RETURNING source_id AS "sourceId", name, is_active AS "isActive"`,
      [id, dto.name?.trim() || null, dto.isActive],
    );
  }
  async deleteSource(id: number) {
    await assertDeletionAllowed(this.db, 'crmSources');
    const refs = await countReferencingRows(this.db, 'crm_sources', 'source_id', id);
    if (refs.length) {
      const detail = refs.map((r) => `${r.table} (${r.count})`).join('، ');
      throw new BadRequestException(`لا يمكن حذف المصدر — مستخدم في: ${detail}`);
    }
    await this.db.query('DELETE FROM crm_sources WHERE source_id = $1::int', [id]);
    return { deleted: true };
  }

  // --- Leads ---
  async listLeads(branchId: number, q?: { stage?: number; search?: string; assignedTo?: number }) {
    const stage = q?.stage ? Number(q.stage) : 0;
    const assignedTo = q?.assignedTo ? Number(q.assignedTo) : 0;
    const search = (q?.search ?? '').trim();
    const like = `%${search}%`;
    return this.db.query<any>(
      `SELECT l.lead_id AS "leadId", l.name, l.company, l.phone, l.email,
              l.stage, l.expected_value AS "expectedValue", l.notes, l.lost_reason AS "lostReason",
              l.party_id AS "partyId", l.converted_at AS "convertedAt", l.created_at AS "createdAt",
              s.name AS "sourceName", s.source_id AS "sourceId",
              u.full_name AS "assignedName", l.assigned_to AS "assignedTo",
              p.name AS "partyName"
         FROM crm_leads l
         LEFT JOIN crm_sources s ON s.source_id = l.source_id
         LEFT JOIN users u ON u.user_id = l.assigned_to
         LEFT JOIN parties p ON p.party_id = l.party_id
        WHERE l.branch_id = $1::int
          AND ($2::int = 0 OR l.stage = $2::int)
          AND ($3::int = 0 OR l.assigned_to = $3::int)
          AND ($4::text = '' OR l.name ILIKE $5::text OR COALESCE(l.phone,'') ILIKE $5::text OR COALESCE(l.company,'') ILIKE $5::text)
        ORDER BY l.updated_at DESC, l.lead_id DESC`,
      [branchId, stage, assignedTo, search, like],
    );
  }

  async getLead(id: number, branchId: number) {
    const lead = await this.db.one<any>(
      `SELECT l.lead_id AS "leadId", l.branch_id AS "branchId", l.name, l.company, l.phone, l.email,
              l.stage, l.expected_value AS "expectedValue", l.notes, l.lost_reason AS "lostReason",
              l.party_id AS "partyId", l.converted_at AS "convertedAt", l.created_at AS "createdAt",
              l.source_id AS "sourceId", l.assigned_to AS "assignedTo",
              s.name AS "sourceName", u.full_name AS "assignedName", p.name AS "partyName"
         FROM crm_leads l
         LEFT JOIN crm_sources s ON s.source_id = l.source_id
         LEFT JOIN users u ON u.user_id = l.assigned_to
         LEFT JOIN parties p ON p.party_id = l.party_id
        WHERE l.lead_id = $1::int AND l.branch_id = $2::int`,
      [id, branchId],
    );
    if (!lead) throw new BadRequestException('العميل المحتمل غير موجود');
    const activities = await this.db.query<any>(
      `SELECT a.activity_id AS "activityId", a.activity_type AS "activityType", a.subject, a.notes,
              a.due_at AS "dueAt", a.is_done AS "isDone", a.done_at AS "doneAt",
              a.created_at AS "createdAt", u.full_name AS "createdBy"
         FROM crm_activities a LEFT JOIN users u ON u.user_id = a.created_by
        WHERE a.lead_id = $1::int ORDER BY a.created_at DESC`,
      [id],
    );
    const tickets = await this.db.query<any>(
      `SELECT t.ticket_id AS "ticketId", t.subject, t.status, t.priority, t.created_at AS "createdAt", t.closed_at AS "closedAt"
         FROM crm_tickets t WHERE t.lead_id = $1::int ORDER BY t.created_at DESC`,
      [id],
    );
    return { ...lead, activities, tickets, stageName: STAGES[Number(lead.stage)] ?? '' };
  }

  async createLead(dto: any, branchId: number, user: AuthUser) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('الاسم مطلوب');
    return this.db.one<any>(
      `INSERT INTO crm_leads (branch_id,name,company,phone,email,source_id,stage,expected_value,assigned_to,notes,created_by)
       VALUES ($1::int,$2::text,$3::text,$4::text,$5::text,$6::int,$7::int,$8::numeric,$9::int,$10::text,$11::int)
       RETURNING lead_id AS "leadId", name, stage`,
      [branchId, name, dto.company || null, dto.phone || null, dto.email || null,
       dto.sourceId ? Number(dto.sourceId) : null, Number(dto.stage ?? 1),
       Number(dto.expectedValue ?? 0), dto.assignedTo ? Number(dto.assignedTo) : null,
       dto.notes || null, user.userId],
    );
  }

  async updateLead(id: number, dto: any, branchId: number, user: AuthUser, ip: string) {
    return this.db.transaction(async (client) => {
      const found = await client.query<any>(
        'SELECT lead_id, stage, lost_reason FROM crm_leads WHERE lead_id=$1::int AND branch_id=$2::int', [id, branchId]);
      const existing = found.rows[0];
      if (!existing) throw new BadRequestException('العميل المحتمل غير موجود');
      const oldStage = Number(existing.stage);
      const targetStage = dto.stage != null ? Number(dto.stage) : oldStage;
      const oldReason = String(existing.lost_reason ?? '');
      const hasReasonKey = dto.lostReason !== undefined;
      const newReason = hasReasonKey ? (dto.lostReason == null ? null : String(dto.lostReason).trim() || null)
        : (String(dto.lostReason ?? '').trim() || null);
      // GAP-02 — a lost reason cannot be cleared while the lead stays lost.
      if (oldStage === 6 && hasReasonKey && dto.lostReason === null) {
        throw new BadRequestException('لا يمكن مسح سبب الخسارة — غيّر المرحلة أولًا');
      }
      const effectiveReason = hasReasonKey ? newReason : (oldReason || null);
      if (targetStage === 6 && !(effectiveReason && effectiveReason.length)) {
        throw new BadRequestException('سبب الخسارة إلزامي عند الإغلاق كخاسر');
      }
      const writeReason = targetStage === 6 && hasReasonKey;
      const updated = (await client.query<any>(
        `UPDATE crm_leads SET
           name = COALESCE($3::text,name), company = $4::text, phone = $5::text, email = $6::text,
           source_id = $7::int, stage = COALESCE($8::int,stage), expected_value = COALESCE($9::numeric,expected_value),
           assigned_to = $10::int, notes = $11::text, updated_at = now(),
           lost_reason = CASE WHEN $13::boolean THEN $12::text ELSE lost_reason END
         WHERE lead_id = $1::int AND branch_id = $2::int
         RETURNING lead_id AS "leadId", name, stage`,
        [id, branchId, dto.name?.trim() || null, dto.company ?? null, dto.phone ?? null, dto.email ?? null,
         dto.sourceId ? Number(dto.sourceId) : null, dto.stage != null ? Number(dto.stage) : null,
         dto.expectedValue != null ? Number(dto.expectedValue) : null,
         dto.assignedTo ? Number(dto.assignedTo) : null, dto.notes ?? null, effectiveReason, writeReason])).rows[0];
      // GAP-02 — audit every meaningful stage/reason transition.
      if (targetStage === 6 && oldStage !== 6) {
        await logActivity(client, { userId: user.userId, branchId, action: 'crm.lead.lost',
          entity: 'crm_lead', entityId: String(id), details: `أُغلق كخاسر — ${effectiveReason}`, ip });
      } else if (oldStage === 6 && hasReasonKey && newReason && newReason !== oldReason) {
        await logActivity(client, { userId: user.userId, branchId, action: 'crm.lead.lost_reason.edit',
          entity: 'crm_lead', entityId: String(id), details: `${oldReason} ← ${newReason}`, ip });
      } else if (oldStage !== targetStage && oldStage === 6) {
        await logActivity(client, { userId: user.userId, branchId, action: 'crm.lead.stage.change',
          entity: 'crm_lead', entityId: String(id), details: `${oldStage} ← ${targetStage}`, ip });
      }
      return updated;
    });
  }

  async deleteLead(id: number, branchId: number) {
    await assertDeletionAllowed(this.db, 'crmLeads');
    await this.db.query('DELETE FROM crm_leads WHERE lead_id=$1::int AND branch_id=$2::int', [id, branchId]);
    return { ok: true };
  }

  async convertLead(id: number, branchId: number, user: AuthUser, ip: string) {
    return this.db.transaction(async (client) => {
      const lead = (await client.query<any>(
        `SELECT * FROM crm_leads WHERE lead_id=$1::int AND branch_id=$2::int FOR UPDATE`, [id, branchId]
      )).rows[0];
      if (!lead) throw new BadRequestException('العميل المحتمل غير موجود');
      if (lead.party_id) throw new BadRequestException('تم تحويل هذا العميل مسبقًا');
      const party = (await client.query<any>(
        `INSERT INTO parties (name, party_type, branch_id, phone, mobile, email, notes, is_active)
         VALUES ($1::text, 1, $2::int, $3::text, $3::text, $4::text, $5::text, true)
         RETURNING party_id AS "partyId", name`,
        [lead.name, branchId, lead.phone || null, lead.email || null, lead.notes || null],
      )).rows[0];
      await client.query(
        `UPDATE crm_leads SET party_id=$2::int, stage=5, converted_at=now(), updated_at=now() WHERE lead_id=$1::int`,
        [id, party.partyId],
      );
      await logActivity(client, { userId: user.userId, branchId, action: 'crm.lead.convert',
        entity: 'crm_lead', entityId: String(id),
        details: `تحويل إلى عميل ${party.partyId}`, ip });
      return { ok: true, leadId: id, partyId: Number(party.partyId), partyName: party.name };
    });
  }

  // --- Activities ---
  async addActivity(leadId: number, dto: any, branchId: number, user: AuthUser) {
    const lead = await this.db.one<any>('SELECT lead_id FROM crm_leads WHERE lead_id=$1::int AND branch_id=$2::int', [leadId, branchId]);
    if (!lead) throw new BadRequestException('العميل المحتمل غير موجود');
    const subject = String(dto.subject ?? '').trim();
    if (!subject) throw new BadRequestException('موضوع النشاط مطلوب');
    return this.db.one<any>(
      `INSERT INTO crm_activities (lead_id, activity_type, subject, notes, due_at, created_by)
       VALUES ($1::int,$2::int,$3::text,$4::text,$5::timestamptz,$6::int)
       RETURNING activity_id AS "activityId", subject`,
      [leadId, Number(dto.activityType ?? 1), subject, dto.notes || null, dto.dueAt || null, user.userId],
    );
  }
  async toggleActivity(activityId: number, done: boolean) {
    return this.db.one<any>(
      `UPDATE crm_activities SET is_done=$2::boolean, done_at = CASE WHEN $2::boolean THEN now() ELSE NULL END
        WHERE activity_id=$1::int RETURNING activity_id AS "activityId", is_done AS "isDone"`,
      [activityId, !!done],
    );
  }
  async deleteActivity(activityId: number) {
    await assertDeletionAllowed(this.db, 'crmActivities');
    await this.db.query('DELETE FROM crm_activities WHERE activity_id=$1::int', [activityId]);
    return { ok: true };
  }

  // --- Tickets ---
  async listTickets(branchId: number, q?: { status?: number }) {
    const status = q?.status ? Number(q.status) : 0;
    return this.db.query<any>(
      `SELECT t.ticket_id AS "ticketId", t.subject, t.description, t.status, t.priority,
              t.lead_id AS "leadId", t.party_id AS "partyId", t.created_at AS "createdAt",
              t.closed_at AS "closedAt", l.name AS "leadName", p.name AS "partyName",
              u.full_name AS "assignedName", t.assigned_to AS "assignedTo"
         FROM crm_tickets t
         LEFT JOIN crm_leads l ON l.lead_id = t.lead_id
         LEFT JOIN parties p ON p.party_id = t.party_id
         LEFT JOIN users u ON u.user_id = t.assigned_to
        WHERE t.branch_id = $1::int AND ($2::int = 0 OR t.status = $2::int)
        ORDER BY t.updated_at DESC, t.ticket_id DESC`,
      [branchId, status],
    );
  }
  async createTicket(dto: any, branchId: number, user: AuthUser) {
    const subject = String(dto.subject ?? '').trim();
    if (!subject) throw new BadRequestException('موضوع التذكرة مطلوب');
    return this.db.one<any>(
      `INSERT INTO crm_tickets (branch_id,lead_id,party_id,subject,description,status,priority,assigned_to,created_by)
       VALUES ($1::int,$2::int,$3::int,$4::text,$5::text,$6::int,$7::int,$8::int,$9::int)
       RETURNING ticket_id AS "ticketId", subject, status`,
      [branchId, dto.leadId ? Number(dto.leadId) : null, dto.partyId ? Number(dto.partyId) : null,
       subject, dto.description || null, Number(dto.status ?? 1), Number(dto.priority ?? 2),
       dto.assignedTo ? Number(dto.assignedTo) : null, user.userId],
    );
  }
  async updateTicket(id: number, dto: any, branchId: number) {
    return this.db.one<any>(
      `UPDATE crm_tickets SET
         subject = COALESCE($3::text,subject), description = $4::text,
         status = COALESCE($5::int,status), priority = COALESCE($6::int,priority),
         assigned_to = $7::int, lead_id = $8::int, party_id = $9::int,
         updated_at = now(), closed_at = CASE WHEN $5::int IN (3,4) THEN now() ELSE closed_at END
       WHERE ticket_id=$1::int AND branch_id=$2::int
       RETURNING ticket_id AS "ticketId", subject, status`,
      [id, branchId, dto.subject?.trim() || null, dto.description ?? null,
       dto.status != null ? Number(dto.status) : null, dto.priority != null ? Number(dto.priority) : null,
       dto.assignedTo ? Number(dto.assignedTo) : null, dto.leadId ? Number(dto.leadId) : null, dto.partyId ? Number(dto.partyId) : null],
    );
  }

  // --- Summary ---
  async summary(branchId: number, from?: string, to?: string) {
    const w: string[] = ['branch_id=$1::int'];
    const args: any[] = [branchId];
    if (from) { args.push(from); w.push(`created_at >= $${args.length}::date`); }
    if (to) { args.push(to); w.push(`created_at < ($${args.length}::date + 1)`); }
    const byStage = await this.db.query<any>(
      `SELECT stage, count(*)::int AS count, COALESCE(sum(expected_value),0)::numeric AS value
         FROM crm_leads WHERE ${w.join(' AND ')} GROUP BY stage ORDER BY stage`, args);
    const won = Number((byStage as any[]).find((r: any) => Number(r.stage) === 5)?.count ?? 0);
    const lost = Number((byStage as any[]).find((r: any) => Number(r.stage) === 6)?.count ?? 0);
    const decided = won + lost;
    const winRate = { won, lost, decided, percentage: decided ? Math.round((won / decided) * 100) : null };
    const openTickets = await this.db.one<{ c: number }>(
      `SELECT count(*)::int AS c FROM crm_tickets WHERE branch_id=$1::int AND status IN (1,2)`, [branchId]);
    const dueActivities = await this.db.one<{ c: number }>(
      `SELECT count(*)::int AS c FROM crm_activities a JOIN crm_leads l ON l.lead_id=a.lead_id
        WHERE l.branch_id=$1::int AND a.is_done=false AND a.due_at IS NOT NULL AND a.due_at <= now() + interval '7 days'`,
      [branchId]);
    return { byStage, openTickets: openTickets?.c ?? 0, dueActivities: dueActivities?.c ?? 0, winRate };
  }
}

@Controller('crm')
export class CrmController {
  constructor(private readonly svc: CrmService) {}

  @RequirePermissions('crm.view') @Get('summary') summary(@CurrentBranch() b: number, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.summary(b, from, to); }

  @RequirePermissions('crm.view') @Get('sources') sources() { return this.svc.listSources(); }
  @RequirePermissions('crm.manage') @Post('sources') createSource(@Body() body: any) { return this.svc.createSource(body); }
  @RequirePermissions('crm.manage') @Put('sources/:id') updateSource(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.svc.updateSource(id, body); }
  @RequirePermissions('crm.manage') @Delete('sources/:id') deleteSource(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteSource(id); }

  @RequirePermissions('crm.view') @Get('leads') leads(
    @CurrentBranch() b: number,
    @Query('stage') stage?: string,
    @Query('search') search?: string,
    @Query('assignedTo') assignedTo?: string,
  ) {
    return this.svc.listLeads(b, {
      stage: stage ? Number(stage) : undefined,
      search,
      assignedTo: assignedTo ? Number(assignedTo) : undefined,
    });
  }
  @RequirePermissions('crm.view') @Get('leads/:id') lead(@Param('id', ParseIntPipe) id: number, @CurrentBranch() b: number) { return this.svc.getLead(id, b); }
  @RequirePermissions('crm.manage') @Post('leads') createLead(@Body() body: any, @CurrentBranch() b: number, @CurrentUser() u: AuthUser) { return this.svc.createLead(body, b, u); }
  @RequirePermissions('crm.manage') @Put('leads/:id') updateLead(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentBranch() b: number, @CurrentUser() u: AuthUser, @Req() req: Request) { const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'; return this.svc.updateLead(id, body, b, u, ip); }
  @RequirePermissions('crm.manage') @Delete('leads/:id') deleteLead(@Param('id', ParseIntPipe) id: number, @CurrentBranch() b: number) { return this.svc.deleteLead(id, b); }
  @RequirePermissions('crm.manage') @Post('leads/:id/convert') convertLead(@Param('id', ParseIntPipe) id: number, @CurrentBranch() b: number, @CurrentUser() u: AuthUser, @Req() req: Request) { const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'; return this.svc.convertLead(id, b, u, ip); }

  @RequirePermissions('crm.manage') @Post('leads/:id/activities') addActivity(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentBranch() b: number, @CurrentUser() u: AuthUser) { return this.svc.addActivity(id, body, b, u); }
  @RequirePermissions('crm.manage') @Put('activities/:id/done') toggleActivity(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.svc.toggleActivity(id, !!body?.isDone); }
  @RequirePermissions('crm.manage') @Delete('activities/:id') deleteActivity(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteActivity(id); }

  @RequirePermissions('crm.view') @Get('tickets') tickets(@CurrentBranch() b: number, @Query('status') status?: string) { return this.svc.listTickets(b, { status: status ? Number(status) : undefined }); }
  @RequirePermissions('crm.manage') @Post('tickets') createTicket(@Body() body: any, @CurrentBranch() b: number, @CurrentUser() u: AuthUser) { return this.svc.createTicket(body, b, u); }
  @RequirePermissions('crm.manage') @Put('tickets/:id') updateTicket(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentBranch() b: number) { return this.svc.updateTicket(id, body, b); }
}

@Module({ controllers: [CrmController], providers: [CrmService] })
export class CrmModule {}
