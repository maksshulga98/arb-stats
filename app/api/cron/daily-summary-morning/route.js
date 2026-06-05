// Утренняя финальная сводка за ВЧЕРАШНИЙ день — для учёта отчётов,
// которые менеджеры сдают на следующее утро.
// Запускается в 9:00 UTC = 12:00 МСК (см. vercel.json).
//
// Реализация: проксируем основной handler из /api/cron/daily-summary,
// но дописываем ?offset=-1 в URL. Так одна логика, два cron-а.

import { GET as mainHandler } from '../daily-summary/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request) {
  const url = new URL(request.url)
  // Принудительно offset=-1, перебивая если он не задан / был задан другим
  url.searchParams.set('offset', '-1')
  const forwarded = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers,
  })
  return mainHandler(forwarded)
}
