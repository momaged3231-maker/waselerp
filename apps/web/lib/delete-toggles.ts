'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from './api';

/**
 * Client mirror of the server-side deletion gate (D29).
 * Missing keys fail open (button visible) — the API still blocks with a clear
 * Arabic message, so behaviour is never wrong, only cosmetically inconsistent
 * on databases that lack /settings/delete-toggles rows.
 */

export type DeleteToggles = {
  deleteEnabled: boolean;
  screens: Record<string, boolean>;
};

let cache: Promise<DeleteToggles> | null = null;
let cached: DeleteToggles | null = null;

export function fetchDeleteToggles(): Promise<DeleteToggles> {
  if (cached) return Promise.resolve(cached);
  if (!cache) {
    cache = apiFetch<DeleteToggles>('/settings/delete-toggles')
      .then((data) => {
        cached = data;
        return data;
      })
      .catch((error) => {
        cache = null;
        throw error;
      });
  }
  return cache;
}

/** Call after a successful settings save so buttons reflect the new map. */
export function invalidateDeleteTogglesCache(): void {
  cache = null;
  cached = null;
}

export function useDeleteToggles() {
  const [toggles, setToggles] = useState<DeleteToggles | null>(cached);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let alive = true;
    fetchDeleteToggles()
      .then((data) => {
        if (!alive) return;
        setToggles(data);
        setLoading(false);
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return useMemo(() => ({ toggles, loading }), [toggles, loading]);
}

/** True when the master switch AND the screen switch allow deletion. */
export function useScreenDeletionEnabled(screenKey: string): boolean {
  const { toggles } = useDeleteToggles();
  if (!toggles) return true;
  return toggles.deleteEnabled && (toggles.screens[screenKey] ?? true);
}
