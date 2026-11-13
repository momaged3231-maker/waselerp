export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000/api';

export type BranchInfo = { branchId: number; code: string; name: string };
export type UserInfo = {
  userId: number; userName: string; fullName: string;
  defaultBranchId: number | null; isCashier: boolean; isSalesRep: boolean; maxDiscountPct: number;
};

export type Session = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: UserInfo;
  permissions: string[];
  branches: BranchInfo[];
  activeBranchId: number | null;
};

const STORAGE_KEY = 'wasel.session';

export function loadSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null) {
  if (typeof window === 'undefined') return;
  if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else window.localStorage.removeItem(STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T = any>(
  path: string,
  options: { method?: string; body?: any; branchId?: number | null } = {},
): Promise<T> {
  const session = loadSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  const branchId = options.branchId ?? session?.activeBranchId;
  if (branchId) headers['x-branch-id'] = String(branchId);

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401 && session?.refreshToken) {
    const refreshed = await tryRefresh(session.refreshToken);
    if (refreshed) {
      const retry = await fetch(`${API_BASE}${path}`, {
        method: options.method ?? 'GET',
        headers: { ...headers, Authorization: `Bearer ${refreshed.accessToken}` },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      if (retry.ok) return retry.json();
    }
    saveSession(null);
    if (typeof window !== 'undefined') window.location.href = '/login/';
    throw new ApiError('انتهت الجلسة، سجل دخول من جديد', 401);
  }

  if (!response.ok) {
    let message = `خطأ ${response.status}`;
    try {
      const body = await response.json();
      message = body.message ?? message;
      if (Array.isArray(body.message)) message = body.message.join(' • ');
    } catch {
      /* keep default */
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

async function tryRefresh(refreshToken: string): Promise<Session | null> {
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const current = loadSession();
    if (!current) return null;
    const next: Session = { ...current, accessToken: data.accessToken, expiresAt: data.expiresAt };
    saveSession(next);
    return next;
  } catch {
    return null;
  }
}

export function hasPermission(permissions: string[] | undefined, code: string): boolean {
  if (!permissions?.length) return false;
  return permissions.includes(code);
}

export function formatMoney(value: number | string | null | undefined, currency = 'ج.م'): string {
  const number = Number(value ?? 0);
  return `${number.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
