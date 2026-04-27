import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// display: 'swap' — браузер показывает системный fallback пока шрифт качается, потом подменяет
// preload: false — у нас всё равно много не-латиницы (русский), грузить шрифт на каждой странице нет смысла
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Arb Stats",
  description: "Внутренний кабинет",
  // Не разрешаем поисковикам индексировать панель
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        {/* DNS-prefetch и preconnect к Supabase — браузер заранее открывает соединение, экономит ~100-200мс на первом запросе */}
        <link rel="dns-prefetch" href="https://agnrzveeoswkscjwxnde.supabase.co" />
        <link rel="preconnect" href="https://agnrzveeoswkscjwxnde.supabase.co" crossOrigin="" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
