import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Не отправлять заголовок X-Powered-By: Next.js (мелочь, но экономит байты на каждый ответ)
  poweredByHeader: false,

  // gzip сжатие включено по умолчанию, но проговариваем явно для ясности
  compress: true,

  // Кеш предзагруженных маршрутов в браузере: 60 сек для динамических, 300 сек для статических.
  // Это значит, что при возврате на закешированную страницу (через router.back или prefetch),
  // не будет лишних запросов к серверу.
  experimental: {
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
    // Tree-shake не используемые экспорты Supabase для уменьшения бандла на клиенте
    optimizePackageImports: ['@supabase/supabase-js'],
  },

  // Чтобы Next.js не показывал в HTTP заголовках информацию о конкретной билд-системе
  generateEtags: true,
};

export default nextConfig;
