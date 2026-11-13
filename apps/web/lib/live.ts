'use client';

import { useEffect, useRef } from 'react';
import { API_BASE, loadSession } from './api';

export interface LiveEvent {
  type: 'connected' | 'stock.changed' | 'item.updated' | 'invoice.posted' | 'cash.moved';
  branchId?: number | null;
  warehouseId?: number | null;
  itemIds?: number[];
  invoiceId?: number | null;
  at: string;
}

/**
 * Subscribes to the API's Server-Sent Events channel so other branches'
 * changes (stock, prices, invoices) appear immediately.
 */
export function useLiveEvents(onEvent: (event: LiveEvent) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let source: EventSource | null = null;
    let retry = 0;
    let timer: any = null;
    let closed = false;

    const connect = () => {
      const session = loadSession();
      if (!session?.accessToken || closed) return;

      source = new EventSource(
        `${API_BASE}/events/inventory?access_token=${encodeURIComponent(session.accessToken)}`,
      );

      source.onmessage = (message) => {
        try {
          handler.current(JSON.parse(message.data));
        } catch {
          /* ignore malformed frames */
        }
      };

      source.onerror = () => {
        source?.close();
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        timer = setTimeout(connect, 1000 * 2 ** retry);
      };

      source.onopen = () => { retry = 0; };
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(timer);
      source?.close();
    };
  }, []);
}
