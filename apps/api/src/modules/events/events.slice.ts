import { Controller, Get, Header, Module, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { LiveEventsService } from './live-events.service';
import { AuthUser, CurrentUser, RequireAnyPermission } from '../../common/security';

/**
 * Server-Sent Events channel: branches receive stock / price changes the
 * moment another branch posts an invoice.
 */
@Controller('events')
export class EventsController {
  constructor(private readonly live: LiveEventsService) {}

  @RequireAnyPermission('dashboard.view', 'pos.operate')
  @Get('inventory')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  stream(@Req() request: Request, @Res() response: Response, @CurrentUser() user: AuthUser) {
    response.flushHeaders?.();

    const write = (event: unknown) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    write({ type: 'connected', branchId: user.defaultBranchId, at: new Date().toISOString() });

    const unsubscribe = this.live.subscribe((event) => {
      // a branch only listens to its own scope unless it has access to all
      if (event.branchId && user.branchIds.length && !user.branchIds.includes(event.branchId)) return;
      write(event);
    });

    const heartbeat = setInterval(() => response.write(': ping\n\n'), 25_000);

    request.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      response.end();
    });
  }
}

@Module({
  controllers: [EventsController],
  providers: [LiveEventsService],
  exports: [LiveEventsService],
})
export class EventsModule {}
