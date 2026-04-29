import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://agnrzveeoswkscjwxnde.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbnJ6dmVlb3N3a3Njand4bmRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMzIwNzUsImV4cCI6MjA4ODkwODA3NX0.sHXaPpeVykZ-AySMSjUErWU-73arR6BB47BlQXZjxcU'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Автоочистка залипшей сессии. У некоторых пользователей в localStorage
// остаётся битый refresh-token, из-за которого supabase-js при инициализации
// делает refresh-запрос и зависает. Если sb-* ключи в storage есть — даём
// getSession 4 секунды; если не успел — стираем и продолжаем как новый
// посетитель. У новых пользователей этот код вообще не запускается.
if (typeof window !== 'undefined') {
  try {
    const hasSbKeys = Object.keys(window.localStorage).some((k) => k.startsWith('sb-'))
    if (hasSbKeys) {
      Promise.race([
        supabase.auth.getSession(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('SESSION_INIT_TIMEOUT')), 4000),
        ),
      ]).catch((e) => {
        if (e?.message === 'SESSION_INIT_TIMEOUT') {
          console.warn('Supabase session init stalled — clearing local auth cache')
          try {
            Object.keys(window.localStorage)
              .filter((k) => k.startsWith('sb-'))
              .forEach((k) => window.localStorage.removeItem(k))
          } catch { /* ignore */ }
        }
      })
    }
  } catch { /* ignore */ }
}

/**
 * Безопасно получает access_token.
 * Возвращает токен или null если сессии нет (юзер вышел / токен протух).
 * Если null — вызывающий код должен показать ошибку или редирект на /login.
 */
export async function getAccessToken() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  } catch {
    return null
  }
}

/**
 * Делает авторизованный fetch с таймаутом. Если сессии нет — кидает понятную ошибку.
 * Опции как у обычного fetch + опциональный timeout (по умолчанию 15 сек).
 */
export async function authFetch(url, options = {}) {
  const token = await getAccessToken()
  if (!token) {
    const err = new Error('Сессия истекла, войдите заново')
    err.code = 'NO_SESSION'
    throw err
  }
  const { timeout = 15000, headers = {}, ...rest } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: { ...headers, Authorization: `Bearer ${token}` },
    })
    return res
  } finally {
    clearTimeout(timer)
  }
}