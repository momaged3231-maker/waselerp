import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SessionProvider } from '@/lib/session';
import { ThemeProvider } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'واصل ERP — نظام إدارة المبيعات',
  description: 'نظام متكامل لإدارة الفروع والمخزون والمبيعات ونقاط البيع',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0369a1',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/** Prevents a wrong-theme flash before hydration: applies the saved (or OS) theme immediately. */
const noFoucScript = `(function(){try{var t=localStorage.getItem('wasel-theme');if(t!=='dark'&&t!=='light')t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFoucScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&family=Rubik:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="bg-surface text-ink antialiased">
        <ThemeProvider>
          <SessionProvider>{children}</SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
