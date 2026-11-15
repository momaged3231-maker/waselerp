import {
  BadRequestException, Body, Controller, Get, Injectable, Module, Param,
  ParseIntPipe, Patch, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentUser, Public, RequirePermissions } from '../../common/security';

const AGENT_SECRET = process.env.WASEL_AGENT_SECRET ?? 'wasel-agent-secret-2026';

function agentToken(req: any): string {
  return String(req?.headers?.['x-agent-token'] ?? '').trim();
}

@Injectable()
export class PrintAgentsService {
  constructor(private readonly db: DatabaseService) {}

  // ---- Agent registration / heartbeat (called by the print agent) ----
  async register(body: any, req: any) {
    const secret = String(req?.headers?.['x-agent-secret'] ?? '').trim();
    if (secret !== AGENT_SECRET) throw new UnauthorizedException('invalid agent secret');
    const agentUid = String(body?.agentUid ?? '').trim();
    const machineName = String(body?.machineName ?? '').trim();
    const token = String(body?.token ?? '').trim();
    if (!agentUid || !machineName || !token) {
      throw new BadRequestException('agentUid, machineName and token are required');
    }
    const printers = Array.isArray(body?.printers) ? body.printers : [];
    const ipAddress = String(body?.ipAddress ?? '').trim() || null;

    const existing = await this.db.one<any>(
      `SELECT agent_id AS "agentId" FROM print_agents WHERE agent_uid = $1::text`,
      [agentUid],
    );
    if (existing) {
      await this.db.query(
        `UPDATE print_agents
            SET machine_name = $2::text, ip_address = $3::text, token = $4::text,
                printers = $5::jsonb, is_online = true, last_seen = now(), updated_at = now()
          WHERE agent_uid = $1::text`,
        [agentUid, machineName, ipAddress, token, JSON.stringify(printers)],
      );
      return { agentId: existing.agentId, agentUid, updated: true };
    }
    const row = await this.db.one<any>(
      `INSERT INTO print_agents (agent_uid, machine_name, ip_address, token, printers, is_online, last_seen)
       VALUES ($1::text,$2::text,$3::text,$4::text,$5::jsonb,true,now())
       RETURNING agent_id AS "agentId"`,
      [agentUid, machineName, ipAddress, token, JSON.stringify(printers)],
    );
    return { agentId: row.agentId, agentUid, updated: false };
  }

  async verifyAgent(agentId: number, token: string) {
    const row = await this.db.one<any>(
      `SELECT agent_id AS "agentId", token FROM print_agents WHERE agent_id = $1::int`,
      [agentId],
    );
    if (!row || row.token !== token) throw new UnauthorizedException('invalid agent credentials');
    return row;
  }

  async heartbeat(agentId: number, token: string, body: any) {
    await this.verifyAgent(agentId, token);
    const printers = Array.isArray(body?.printers) ? body.printers : [];
    await this.db.query(
      `UPDATE print_agents
          SET printers = $2::jsonb, is_online = true, last_seen = now(), updated_at = now()
        WHERE agent_id = $1::int`,
      [agentId, JSON.stringify(printers)],
    );
    return { ok: true };
  }

  // ---- User-facing (auth required) ----
  listAgents() {
    return this.db.query<any>(
      `SELECT agent_id AS "agentId", agent_uid AS "agentUid", machine_name AS "machineName",
              ip_address AS "ipAddress", printers, is_online AS "isOnline",
              last_seen AS "lastSeen", created_at AS "createdAt"
         FROM print_agents ORDER BY agent_id`,
    );
  }

  async getAgent(id: number) {
    const row = await this.db.one<any>(
      `SELECT agent_id AS "agentId", agent_uid AS "agentUid", machine_name AS "machineName",
              ip_address AS "ipAddress", printers, is_online AS "isOnline",
              last_seen AS "lastSeen", created_at AS "createdAt"
         FROM print_agents WHERE agent_id = $1::int`,
      [id],
    );
    if (!row) throw new BadRequestException('agent not found');
    return row;
  }

  // ---- Print jobs ----
  async createJob(body: any, user: AuthUser) {
    const agentId = Number(body?.agentId);
    if (!agentId) throw new BadRequestException('agentId is required');
    const printerName = String(body?.printerName ?? '').trim();
    if (!printerName) throw new BadRequestException('printerName is required');
    const printerType = String(body?.printerType ?? 'windows').trim();
    const payload = body?.payload ?? {};
    const copies = Math.min(5, Math.max(1, Number(body?.copies) || 1));
    const width = Number(body?.width) || 42;
    const agent = await this.db.one<any>(`SELECT agent_id FROM print_agents WHERE agent_id = $1::int`, [agentId]);
    if (!agent) throw new BadRequestException('agent not found');
    const row = await this.db.one<any>(
      `INSERT INTO print_jobs (agent_id, printer_name, printer_type, payload, copies, width, created_by)
       VALUES ($1::int,$2::text,$3::text,$4::jsonb,$5::int,$6::int,$7::int)
       RETURNING job_id AS "jobId", status, created_at AS "createdAt"`,
      [agentId, printerName, printerType, JSON.stringify(payload), copies, width, user.userId],
    );
    return row;
  }

  async listPendingJobs(agentId: number, token: string) {
    await this.verifyAgent(agentId, token);
    // mark stale agents offline (no heartbeat in 90s)
    await this.db.query(
      `UPDATE print_agents SET is_online = false WHERE agent_id = $1::int AND last_seen < now() - interval '90 seconds'`,
      [agentId],
    );
    return this.db.query<any>(
      `SELECT job_id AS "jobId", printer_name AS "printerName", printer_type AS "printerType",
              payload, copies, width
         FROM print_jobs
        WHERE agent_id = $1::int AND status = 'pending'
        ORDER BY job_id`,
      [agentId],
    );
  }

  async updateJob(jobId: number, agentId: number, token: string, body: any) {
    await this.verifyAgent(agentId, token);
    const status = String(body?.status ?? '').trim();
    if (!['done', 'failed'].includes(status)) throw new BadRequestException('status must be done or failed');
    const error = body?.error ? String(body.error) : null;
    await this.db.query(
      `UPDATE print_jobs
          SET status = $2::text, error = $3::text,
              started_at = COALESCE(started_at, now()),
              completed_at = now()
        WHERE job_id = $1::int AND agent_id = $4::int`,
      [jobId, status, error, agentId],
    );
    return { ok: true };
  }

  async getJob(id: number, user: AuthUser) {
    const row = await this.db.one<any>(
      `SELECT job_id AS "jobId", agent_id AS "agentId", printer_name AS "printerName",
              printer_type AS "printerType", payload, copies, width, status, error,
              created_at AS "createdAt", completed_at AS "completedAt"
         FROM print_jobs WHERE job_id = $1::int`,
      [id],
    );
    if (!row) throw new BadRequestException('job not found');
    return row;
  }
}

@Controller('print-agents')
export class PrintAgentsController {
  constructor(private readonly svc: PrintAgentsService) {}

  // ---- Agent-side (token auth via header, agentId in body/query) ----
  @Public()
  @Post('register')
  register(@Body() body: any, @Req() req: any) {
    return this.svc.register(body, req);
  }

  @Public()
  @Post(':id/heartbeat')
  heartbeat(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.svc.heartbeat(id, agentToken(req), body);
  }

  @Public()
  @Get('jobs/pending')
  pendingJobs(@Query('agentId') agentId: string, @Req() req: any) {
    return this.svc.listPendingJobs(Number(agentId), agentToken(req));
  }

  @Public()
  @Patch('jobs/:id')
  updateJob(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any, @Query('agentId') agentId: string) {
    return this.svc.updateJob(id, Number(agentId), agentToken(req), body);
  }

  // ---- User-side (JWT + permissions) ----
  @RequirePermissions('pos.operate')
  @Get()
  list() { return this.svc.listAgents(); }

  @RequirePermissions('pos.operate')
  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) { return this.svc.getAgent(id); }

  @RequirePermissions('pos.operate')
  @Post('jobs')
  createJob(@Body() body: any, @CurrentUser() u: AuthUser) { return this.svc.createJob(body, u); }

  @RequirePermissions('pos.operate')
  @Get('jobs/:id')
  getJob(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser) { return this.svc.getJob(id, u); }
}

@Module({ controllers: [PrintAgentsController], providers: [PrintAgentsService] })
export class PrintAgentsModule {}
