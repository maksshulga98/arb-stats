// Общий модуль для работы с API rko-partner.com.
// Поддерживает работу с несколькими кабинетами одновременно: каждая функция
// принимает объект `account` (см. lib/rko-accounts.js), у которого свой
// логин/пароль и СВОЙ прокси.
//
// ВАЖНО: каждый кабинет ходит со СВОЕГО прокси (account.proxyUrl). Если
// два аккаунта пойдут с одного IP — rko-partner свяжет их и забанит оба.
//
// Используется в:
//   app/api/ip-link/route.js          — создание заявки от менеджера
//   app/api/cron/check-cd-status/route.js — ежедневная проверка статусов

import { fetch, ProxyAgent } from 'undici'

const RKO_BASE = 'https://rko-partner.com'
const DEFAULT_TIMEOUT_MS = 12000

// product_id для оффера "Регистрация бизнеса ИП + РКО | Реферальная ссылка" (Альфа-Банк)
export const RKO_PRODUCT_ID = 520

// ─── ProxyAgent кэш — один на каждый уникальный proxyUrl ───
// undici переиспользует TCP-соединения внутри dispatcher'а. Создавать новый
// ProxyAgent на каждый запрос дорого и лишает преимуществ keep-alive.
const dispatcherCache = new Map()  // proxyUrl → ProxyAgent

function getDispatcher(account) {
  // Fail-safe: ни одного запроса к rko-partner.com мимо прокси.
  // Если случайно вызовут с аккаунтом без proxyUrl — лучше упасть,
  // чем утечь реальный IP Vercel-функции.
  if (!account?.proxyUrl) {
    throw new Error(
      `RKO[${account?.id || '?'}]: proxyUrl не задан — отказ делать прямой запрос (утечка IP)`
    )
  }
  let dp = dispatcherCache.get(account.proxyUrl)
  if (!dp) {
    dp = new ProxyAgent(account.proxyUrl)
    dispatcherCache.set(account.proxyUrl, dp)
  }
  return dp
}

// fetch с таймаутом + проксированием для конкретного аккаунта
async function rkoFetch(account, url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      dispatcher: getDispatcher(account),
    })
  } finally {
    clearTimeout(timer)
  }
}

// ─── Cookies ───
function extractCookies(response) {
  const setCookies = response.headers.getSetCookie?.() || []
  if (setCookies.length === 0) {
    const raw = response.headers.get('set-cookie')
    if (raw) return raw.split(/,(?=\s*\w+=)/).map(c => c.split(';')[0].trim())
    return []
  }
  return setCookies.map(c => c.split(';')[0].trim())
}

function mergeCookies(existing, newCookies) {
  const map = {}
  for (const c of [...existing, ...newCookies]) {
    const [name] = c.split('=')
    map[name.trim()] = c
  }
  return Object.values(map)
}

function getXsrfFromCookies(cookies) {
  const c = cookies.find(c => c.startsWith('XSRF-TOKEN='))
  return c ? decodeURIComponent(c.split('=').slice(1).join('=')) : ''
}

// ─── Логин ───
/**
 * Логинится в кабинет account, возвращает auth { cookies, base, account }.
 * auth дальше передаётся во все остальные функции — они там тащат и cookies,
 * и account (для нужного прокси).
 */
export async function loginToRkoPartner(account) {
  if (!account?.email || !account?.password) {
    throw new Error(`RKO account "${account?.id || '?'}" не настроен (нет email/password)`)
  }

  // 1) GET /login — получаем XSRF-TOKEN cookie
  const pageRes = await rkoFetch(account, `${RKO_BASE}/login`, {
    headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0' },
    redirect: 'manual',
  })
  let cookies = extractCookies(pageRes)
  const xsrfToken = getXsrfFromCookies(cookies)

  // 2) POST /login
  const loginRes = await rkoFetch(account, `${RKO_BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-XSRF-TOKEN': xsrfToken,
      Cookie: cookies.join('; '),
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({ email: account.email, password: account.password }),
    redirect: 'manual',
  })
  cookies = mergeCookies(cookies, extractCookies(loginRes))

  if (loginRes.status === 422) {
    const err = await loginRes.text()
    throw new Error(`RKO[${account.id}] login validation error: ${err.slice(0, 200)}`)
  }
  if (loginRes.status >= 400) {
    throw new Error(`RKO[${account.id}] login failed: HTTP ${loginRes.status}`)
  }

  // 3) Refresh cookies
  const refreshRes = await rkoFetch(account, `${RKO_BASE}/app/orders`, {
    headers: { Accept: 'text/html', Cookie: cookies.join('; '), 'User-Agent': 'Mozilla/5.0' },
    redirect: 'manual',
  })
  cookies = mergeCookies(cookies, extractCookies(refreshRes))

  const loc = refreshRes.headers.get('location') || ''
  if (refreshRes.status === 302 && /\/login/.test(loc)) {
    throw new Error(`RKO[${account.id}] session not established — credentials may be wrong`)
  }

  return { cookies, base: RKO_BASE, account }
}

function rkoHeaders(auth) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0',
  }
  headers['Cookie'] = auth.cookies.join('; ')
  const xsrf = getXsrfFromCookies(auth.cookies)
  if (xsrf) headers['X-XSRF-TOKEN'] = xsrf
  return headers
}

// ─── Создание заявки ───
/**
 * Возвращает { orderId, referralLink, raw }. referralLink берём из tracking_url
 * который приходит прямо в ответе rko-partner — там уже правильный user_id
 * для конкретного аккаунта, ничего хардкодить не надо.
 */
export async function createRkoApplication(auth, { fullName, inn, phone, email, city }) {
  const orderRes = await rkoFetch(auth.account, `${RKO_BASE}/api/app/orders`, {
    method: 'POST',
    headers: rkoHeaders(auth),
    body: JSON.stringify({
      products: [RKO_PRODUCT_ID],
      fio_rukovoditelia: fullName,
      inn,
      elektronnaia_pocta: email,
      telefon: phone,
      gorod_obsluzivaniia: city,
    }),
  }, 30000)

  const text = await orderRes.text()

  if (!orderRes.ok) {
    try {
      const errJson = JSON.parse(text)
      const msg = errJson.message || ''
      const fieldErrors = errJson.errors
        ? Object.entries(errJson.errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')
        : ''
      throw new Error(`Ошибка создания заявки (${orderRes.status}): ${msg}${fieldErrors ? ' — ' + fieldErrors : ''}`)
    } catch (parseErr) {
      if (parseErr.message?.startsWith('Ошибка создания')) throw parseErr
      throw new Error(`RKO[${auth.account.id}] order creation failed (${orderRes.status}): ${text.slice(0, 500)}`)
    }
  }

  let json
  try { json = JSON.parse(text) }
  catch { throw new Error(`RKO[${auth.account.id}] невалидный JSON в ответе: ${text.slice(0, 300)}`) }

  const rawData = json.data ?? json
  const order = Array.isArray(rawData) ? rawData[0] : rawData
  const orderId = order?.id || order?.order_id || order?.orderId

  if (!orderId) {
    throw new Error(`RKO[${auth.account.id}] не удалось получить ID заказа: ${text.slice(0, 500)}`)
  }

  const referralLink = order?.tracking_url
    || (order?.user_id ? `${RKO_BASE}/click/${orderId}?user_id=${order.user_id}` : `${RKO_BASE}/click/${orderId}`)

  return { orderId, referralLink, raw: order }
}

// ─── Получение всех заказов ───
/**
 * Возвращает все заявки аккаунта со всех страниц.
 */
export async function fetchAllRkoOrders(auth, { perPage = 50, maxPages = 100 } = {}) {
  const all = []
  let page = 1
  while (page <= maxPages) {
    const res = await rkoFetch(auth.account, `${RKO_BASE}/api/app/orders?page=${page}&perPage=${perPage}`, {
      headers: rkoHeaders(auth),
    })
    if (!res.ok) {
      throw new Error(`RKO[${auth.account.id}] orders fetch failed (page ${page}): ${res.status}`)
    }
    const json = await res.json()
    const data = json.data || []
    for (const order of data) {
      const fields = Array.isArray(order.bank_order_form_fields) ? order.bank_order_form_fields : []
      const byName = {}
      for (const f of fields) {
        if (f && f.name) byName[f.name] = f.value
      }
      all.push({
        id: order.id,
        state: order.state,
        created_at: order.created_at,
        fio: byName.fio_rukovoditelia || '',
        inn: byName.inn || '',
        phone: byName.telefon || '',
        email: byName.elektronnaia_pocta || '',
        account_id: auth.account.id,
      })
    }
    const lastPage = json.meta?.last_page || 1
    if (page >= lastPage) break
    page++
  }
  return all
}

/**
 * Маппинг state → текст статуса для Google Sheet (одинаковый для всех аккаунтов).
 */
export function mapRkoState(state) {
  if (state === 'accepted' || state === 'progress') {
    return { text: 'Ожидает обработки', color: 'red' }
  }
  if (state === 'confirmed' || state === 'paid') {
    return { text: 'Счет открыт', color: 'green' }
  }
  return null
}
