'use client';

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

/**
 * Theme provider — light/dark عبر توكنز `--wm-*` في globals.css.
 * لا يلمس أي منطق تطبيق: يضبط `data-theme` على <html> فقط.
 * - الاختيار محفوظ في localStorage ('wasel-theme')؛ بدون اختيار يتبع تفضيل النظام.
 * - الطباعة دائمًا فاتحة (beforeprint يبدّل مؤقتًا) حتى لا تُطبع فواتير بنص فاتح على أبيض.
 */
type Theme = 'light' | 'dark';

const STORAGE_KEY = 'wasel-theme';
const META_LIGHT = '#0369a1';
const META_DARK = '#0b1220';

type ThemeContextValue = {
  theme: Theme;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({ theme: 'light', toggle: () => {} });

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? META_DARK : META_LIGHT;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* private mode */ }
    const initial: Theme = saved === 'dark' || saved === 'light'
      ? saved
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initial);
    applyTheme(initial);
  }, []);

  // Follow the OS preference only while the user has not picked a theme.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* ignore */ }
      if (saved !== 'dark' && saved !== 'light') {
        setTheme(e.matches ? 'dark' : 'light');
        applyTheme(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Printing is always light — dark utilities would print as pale-on-white.
  useEffect(() => {
    let restore: Theme | null = null;
    const before = () => {
      const current = document.documentElement.dataset.theme;
      if (current === 'dark') { restore = 'dark'; document.documentElement.dataset.theme = 'light'; }
    };
    const after = () => {
      if (restore) { document.documentElement.dataset.theme = restore; restore = null; }
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      applyTheme(next);
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
