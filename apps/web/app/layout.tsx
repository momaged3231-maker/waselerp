import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SessionProvider } from '@/lib/session';

export const metadata: Metadata = {
  title: 'واصل ERP — نظام إدارة المبيعات',
  description: 'نظام متكامل لإدارة الفروع والمخزون والمبيعات ونقاط البيع',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#1447e1',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-slate-100 text-slate-800 antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
