// Минимальный хелпер для отправки сообщений в Telegram.
// Используется в /api/cron/daily-summary — больше пока нигде.
//
// ВАЖНО: bot.sendMessage 403 для пользователей, которые НЕ написали боту /start.
// Если в логах видишь "chat not found" / "bot was blocked by the user" —
// пользователь должен открыть бота и нажать «Start».

const TG_API = 'https://api.telegram.org'

/**
 * Шлёт одно сообщение конкретному chat_id.
 * @returns {Promise<{ok:boolean, status:number, body:any}>}
 */
export async function sendTelegramMessage(token, chatId, text, options = {}) {
  if (!token) throw new Error('Telegram: токен не задан (TELEGRAM_BOT_TOKEN)')
  if (!chatId) throw new Error('Telegram: chat_id не задан')

  const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: options.parseMode || 'HTML',
      disable_web_page_preview: true,
      ...options,
    }),
    signal: AbortSignal.timeout(15000),
  })
  let body
  try { body = await res.json() } catch { body = await res.text() }
  return { ok: res.ok && body?.ok, status: res.status, body }
}

/**
 * Шлёт одно и то же сообщение в несколько чатов параллельно.
 * Падение в одном чате не отменяет остальные.
 */
export async function broadcastTelegramMessage(token, chatIds, text, options = {}) {
  const results = await Promise.allSettled(
    chatIds.filter(Boolean).map(id => sendTelegramMessage(token, id, text, options))
  )
  return results.map((r, i) => ({
    chatId: chatIds[i],
    ok: r.status === 'fulfilled' && r.value.ok,
    error: r.status === 'rejected' ? String(r.reason) : (r.value.ok ? null : JSON.stringify(r.value.body)),
  }))
}

/**
 * Экранирование для HTML parse_mode. В HTML экранируем только <, >, &.
 */
export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
