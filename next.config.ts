import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,

  // HTML страниц — не кешируем на edge надолго.
  // Без этого Vercel мог держать старый HTML до 24+ часов после деплоя,
  // и пользователи получали устаревшую версию (с уже починенными багами в JS).
  async headers() {
    return [
      {
        // Все HTML-страницы (всё, кроме /_next/static, /api и /_next/data)
        source: "/((?!_next/static|_next/data|api|.*\\..*).*)",
        headers: [
          {
            key: "Cache-Control",
            // Браузер: 0 сек (всегда revalidate). Edge CDN: 60 сек, потом фоновое обновление до 1 часа.
            value: "public, max-age=0, must-revalidate, s-maxage=60, stale-while-revalidate=3600",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
