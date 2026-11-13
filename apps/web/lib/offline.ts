'use client';

import { useEffect, useState } from 'react';
import { API_BASE, loadSession } from './api';

export interface QueuedOperation {
  id: string;            // client request id (idempotency key)
  url: string;
  body: any;
  createdAt: number;
  attempts: number;
  lastError?: string;
  status: 'pending' | 'failed';
}

const DB_NAME = 'wasel-offline';
const STORE = 'operations';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('status', 'status');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

export const offlineQueue = {
  async list(): Promise<QueuedOperation[]> {
    const all = await withStore<QueuedOperation[]>('readonly', (store) => store.getAll());
    return (all ?? []).sort((a, b) => a.createdAt - b.createdAt);
  },

  async enqueue(operation: Omit<QueuedOperation, 'createdAt' | 'attempts' | 'status'>): Promise<void> {
    const record: QueuedOperation = { ...operation, createdAt: Date.now(), attempts: 0, status: 'pending' };
    await withStore('readwrite', (store) => store.put(record));
    window.dispatchEvent(new CustomEvent('wasel:queue-changed'));
  },

  async remove(id: string): Promise<void> {
    await withStore('readwrite', (store) => store.delete(id));
    window.dispatchEvent(new CustomEvent('wasel:queue-changed'));
  },

  async update(id: string, patch: Partial<QueuedOperation>): Promise<void> {
    const all = await withStore<QueuedOperation[]>('readonly', (store) => store.getAll());
    const record = (all ?? []).find((item) => item.id === id);
    if (!record) return;
    await withStore('readwrite', (store) => store.put({ ...record, ...patch }));
    window.dispatchEvent(new CustomEvent('wasel:queue-changed'));
  },

  /** Sends every pending operation; network failures stay queued, validation errors are dropped. */
  async flush(): Promise<{ sent: number; failed: number }> {
    const pending = (await offlineQueue.list()).filter((item) => item.status === 'pending');
    let sent = 0;
    let failed = 0;

    for (const operation of pending) {
      const session = loadSession();
      try {
        const response = await fetch(`${API_BASE}${operation.url}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
            ...(session?.activeBranchId ? { 'x-branch-id': String(session.activeBranchId) } : {}),
          },
          body: JSON.stringify(operation.body),
        });

        if (response.ok) {
          await offlineQueue.remove(operation.id);
          sent++;
        } else if (response.status >= 400 && response.status < 500) {
          // rejected by the server (validation / permission) — retrying will not help
          await offlineQueue.update(operation.id, { status: 'failed', lastError: `HTTP ${response.status}` });
          failed++;
        } else {
          await offlineQueue.update(operation.id, { attempts: operation.attempts + 1, lastError: `HTTP ${response.status}` });
          failed++;
        }
      } catch (error: any) {
        await offlineQueue.update(operation.id, { attempts: operation.attempts + 1, lastError: error?.message ?? 'network' });
        failed++;
      }
    }

    window.dispatchEvent(new CustomEvent('wasel:queue-changed'));
    return { sent, failed };
  },
};

export function useOfflineQueue() {
  const [pending, setPending] = useState<QueuedOperation[]>([]);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const refresh = async () => setPending(await offlineQueue.list());
    refresh();

    const onChange = () => refresh();
    const onOnline = () => { setOnline(true); offlineQueue.flush(); };
    const onOffline = () => setOnline(false);

    window.addEventListener('wasel:queue-changed', onChange);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const timer = setInterval(() => {
      if (navigator.onLine) offlineQueue.flush().then(() => refresh());
    }, 15_000);

    return () => {
      window.removeEventListener('wasel:queue-changed', onChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(timer);
    };
  }, []);

  return {
    pending,
    pendingCount: pending.filter((item) => item.status === 'pending').length,
    failedCount: pending.filter((item) => item.status === 'failed').length,
    online,
    syncing,
    flush: async () => {
      setSyncing(true);
      const result = await offlineQueue.flush();
      setPending(await offlineQueue.list());
      setSyncing(false);
      return result;
    },
  };
}

/** True when the failure is a connectivity problem (not a server rejection). */
export function isNetworkError(error: any): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    error?.status === undefined ||
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('load failed')
  );
}
