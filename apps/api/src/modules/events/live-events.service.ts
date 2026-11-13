import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export type LiveEventType =
  | 'stock.changed'
  | 'item.updated'
  | 'invoice.posted'
  | 'cash.moved';

export interface LiveEvent {
  type: LiveEventType;
  branchId?: number | null;
  warehouseId?: number | null;
  itemIds?: number[];
  invoiceId?: number | null;
  at: string;
}

/**
 * In-process event bus used to push live updates (SSE) to every connected
 * branch. Swap the EventEmitter for Redis pub/sub when running more than
 * one API instance.
 */
@Injectable()
export class LiveEventsService {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: Omit<LiveEvent, 'at'>) {
    const payload: LiveEvent = { ...event, at: new Date().toISOString() };
    this.emitter.emit('live', payload);
  }

  subscribe(handler: (event: LiveEvent) => void): () => void {
    this.emitter.on('live', handler);
    return () => this.emitter.off('live', handler);
  }
}
