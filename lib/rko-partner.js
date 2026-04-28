// Общий модуль для работы с API rko-partner.com
// Используется в app/api/ip-link/route.js и app/api/cron/check-cd-status/route.js

const RKO_BASE = 'https://rko-partner.com'
const DEFAULT_TIMEOUT_MS = 12000  // 12 сек на любой запрос к rko-partner

// fetch с таймаутом — если rko-partner.com тормозит или недоступен,
// запрос отменяется через timeout вместо того чтобы зависнуть навсегда
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

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

export async function loginToRkoPartner() {
  const email = process.env.RKO_PARTNER_EMAIL
  const password = process.env.RKO_PARTNER_PASSWORD
  if (!email || !password) {
    throw new Error('RKO_PARTNER_EMAIL or RKO_PARTNER_PASSWORD not set')
  }

  // 1) GET /login — получаем CSRF и cookie
  const pageRes = await fetchWithTimeout(`${RKO_BASE}/login`, {
    headers: { Accept: 'text/html' },
    redirect: 'manual',
  })
  let cookies = extractCookies(pageRes)
  const pageHtml = await pageRes.text()

  let csrfToken = ''
  const metaMatch = pageHtml.match(/name="csrf-token"\s+content="([^"]+)"/)
  if (metaMatch) csrfToken = metaMatch[1]

  const xsrfCookie = cookies.find(c => c.startsWith('XSRF-TOKEN='))
  const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.split('=').slice(1).join('=')) : ''

  // 2) POST /login
  const loginRes = await fetchWithTimeout(`${RKO_BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-XSRF-TOKEN': xsrfToken,
      'X-CSRF-TOKEN': csrfToken,
      Cookie: cookies.join('; '),
    },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  })
  cookies = mergeCookies(cookies, extractCookies(loginRes))

  if (loginRes.status === 422) {
    const err = await loginRes.text()
    throw new Error(`RKO login validation error: ${err}`)
  }

  // 3) Refresh cookies по /app/orders
  const refreshRes = await fetchWithTimeout(`${RKO_BASE}/app/orders`, {
    headers: { Accept: 'text/html', Cookie: cookies.join('; ') },
    redirect: 'manual',
  })
  cookies = mergeCookies(cookies, extractCookies(refreshRes))

  return { cookies, base: RKO_BASE }
}

export function rkoHeaders(auth) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  headers['Cookie'] = auth.cookies.join('; ')
  const xsrf = auth.cookies.find(c => c.startsWith('XSRF-TOKEN='))
  if (xsrf) {
    headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf.split('=').slice(1).join('='))
  }
  return headers
}

/**
 * Получить все заявки со всех страниц rko-partner
 * Возвращает массив объектов { id, state, fio, inn, phone, created_at }
 */
export async function fetchAllRkoOrders(auth, { perPage = 50, maxPages = 100 } = {}) {
  const all = []
  let page = 1
  while (page <= maxPages) {
    const res = await fetchWithTimeout(`${RKO_BASE}/api/app/orders?page=${page}&perPage=${perPage}`, {
      headers: rkoHeaders(auth),
    })
    if (!res.ok) {
      throw new Error(`RKO orders fetch failed (page ${page}): ${res.status}`)
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
      })
    }
    const lastPage = json.meta?.last_page || 1
    if (page >= lastPage) break
    page++
  }
  return all
}

/**
 * Маппинг state → текст статуса для Google Sheet
 */
export function mapRkoState(state) {
  if (state === 'accepted' || state === 'progress') {
    return { text: 'Ожидает обработки', color: 'red' }
  }
  if (state === 'confirmed' || state === 'paid') {
    return { text: 'Счет открыт', color: 'green' }
  }
  return null // для rejected и прочих ничего не пишем
}
