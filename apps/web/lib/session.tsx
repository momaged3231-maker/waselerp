'use client';

import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Session, loadSession, saveSession, apiFetch, hasPermission } from './api';

type SessionContextValue = {
  session: Session | null;
  loading: boolean;
  login: (userName: string, password: string, branchId?: number | null) => Promise<void>;
  adopt: (result: any, branchId?: number | null) => void;
  logout: () => void;
  switchBranch: (branchId: number) => void;
  can: (code: string) => boolean;
};

const SessionContext = createContext<SessionContextValue>({
  session: null,
  loading: true,
  login: async () => {},
  adopt: () => {},
  logout: () => {},
  switchBranch: () => {},
  can: () => false,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const current = loadSession();
    setSession(current);
    setLoading(false);
  }, []);

  const value = useMemo<SessionContextValue>(() => ({
    session,
    loading,
    can: (code: string) => hasPermission(session?.permissions, code),
    login: async (userName: string, password: string, branchId?: number | null) => {
      const result = await apiFetch<any>('/auth/login', {
        method: 'POST',
        body: { userName, password, branchId: branchId ?? null },
      });
      const next: Session = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        user: result.user,
        permissions: result.permissions ?? [],
        branches: result.branches ?? [],
        activeBranchId: result.activeBranchId ?? result.user?.defaultBranchId ?? null,
      };
      saveSession(next);
      setSession(next);
      router.push('/');
    },
    logout: () => {
      saveSession(null);
      setSession(null);
      router.push('/login/');
    },
    adopt: (result: any, branchId?: number | null) => {
      const next: Session = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        user: result.user,
        permissions: result.permissions ?? [],
        branches: result.branches ?? [],
        activeBranchId: branchId ?? result.activeBranchId ?? result.user?.defaultBranchId ?? null,
      };
      saveSession(next);
      setSession(next);
    },
    switchBranch: (branchId: number) => {
      const current = loadSession();
      if (!current) return;
      const next = { ...current, activeBranchId: branchId };
      saveSession(next);
      setSession(next);
    },
  }), [session, loading, router]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
