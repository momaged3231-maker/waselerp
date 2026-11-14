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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap"
        />
      </head>
      <body className="bg-slate-100 text-slate-800 antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
