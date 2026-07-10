// Прогон полного цикла: логин → проверка сессии → создание тестовой заявки
// в новом кабинете rko-partner.com через прокси.
// Запуск: node scripts/test-rko-new-account.mjs

import { ProxyAgent, fetch } from 'undici'

const PROXY_URL = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
const RKO_BASE = 'https://rko-partner.com'

const EMAIL = 'ntatarincev33@gmail.com'
const PASSWORD = 'Nick.2kkl.019'

const PRODUCT_ID = 520  // Альфа РКО+ИП реф (из старого кода)

// Тестовые данные. ИНН валидный (с правильной контрольной суммой).
const TEST_FIO = 'Тестов Тест Тестович'
const TEST_PREFIX_INN = '9999999999'   // 10 цифр, добавим контрольные
const TEST_PHONE = '+79991234567'
const TEST_EMAIL = 'test-rko@example.com'
const TEST_CITY = 'Москва'

const proxy = new ProxyAgent(PROXY_URL)

// ─── Helpers ───
function generateValidINN(prefix10) {
  const d = prefix10.split('').map(Number)
  const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const check1 = w1.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  const d11 = [...d, check1]
  const check2 = w2.reduce((s, w, i) => s + w * d11[i], 0) % 11 % 10
  return prefix10 + check1 + check2
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

function getXsrfFromCookies(cookies) {
  const c = cookies.find(c => c.startsWith('XSRF-TOKEN='))
  return c ? decodeURIComponent(c.split('=').slice(1).join('=')) : ''
}

function logCookieNames(cookies, label) {
  const names = cookies.map(c => c.split('=')[0])
  console.log(`    cookies (${label}): [${names.join(', ')}]`)
}

// ─── 1. GET /login ───
console.log('━'.repeat(70))
console.log('Шаг 1. GET /login через прокси')
console.log('━'.repeat(70))
const t1 = Date.now()
const pageRes = await fetch(`${RKO_BASE}/login`, {
  dispatcher: proxy,
  headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0' },
  redirect: 'manual',
  signal: AbortSignal.timeout(20000),
})
let cookies = extractCookies(pageRes)
const pageHtml = await pageRes.text()
console.log(`  HTTP ${pageRes.status} (${Date.now() - t1}ms), HTML ${pageHtml.length} байт`)
logCookieNames(cookies, 'после GET /login')

// Пробуем 3 способа достать csrf
let csrfToken = ''
const m1 = pageHtml.match(/name="csrf-token"\s+content="([^"]+)"/)
if (m1) { csrfToken = m1[1]; console.log(`  csrf-token из meta-тега: ${csrfToken.slice(0, 20)}...`) }
else {
  const m2 = pageHtml.match(/<meta[^>]*content="([^"]+)"[^>]*name="csrf-token"/)
  if (m2) { csrfToken = m2[1]; console.log(`  csrf-token из meta-тега (reverse): ${csrfToken.slice(0, 20)}...`) }
  else {
    const m3 = pageHtml.match(/_token["']\s*[:=]\s*["']([^"']+)["']/)
    if (m3) { csrfToken = m3[1]; console.log(`  csrf-token из _token поля: ${csrfToken.slice(0, 20)}...`) }
    else console.log('  csrf-token в HTML не найден — используем только XSRF-TOKEN cookie')
  }
}

const xsrfToken = getXsrfFromCookies(cookies)
console.log(`  XSRF-TOKEN из cookie: ${xsrfToken ? xsrfToken.slice(0, 20) + '...' : 'НЕТ'}`)

// ─── 2. POST /login ───
console.log('\n' + '━'.repeat(70))
console.log('Шаг 2. POST /login (отправляем креды)')
console.log('━'.repeat(70))
const t2 = Date.now()
const loginRes = await fetch(`${RKO_BASE}/login`, {
  method: 'POST',
  dispatcher: proxy,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-XSRF-TOKEN': xsrfToken,
    'X-CSRF-TOKEN': csrfToken,
    Cookie: cookies.join('; '),
    'User-Agent': 'Mozilla/5.0',
  },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  redirect: 'manual',
  signal: AbortSignal.timeout(20000),
})
console.log(`  HTTP ${loginRes.status} (${Date.now() - t2}ms)`)
const loginBody = await loginRes.text()
console.log(`  тело ответа (первые 500 байт): ${loginBody.slice(0, 500)}`)
const loginCookies = extractCookies(loginRes)
cookies = mergeCookies(cookies, loginCookies)
logCookieNames(cookies, 'после POST /login')

if (loginRes.status === 422) {
  console.log('\n✗ Логин отклонён (422). Прекращаю.')
  process.exit(1)
}
if (loginRes.status >= 400 && loginRes.status !== 302) {
  console.log(`\n✗ Логин не удался (HTTP ${loginRes.status}). Прекращаю.`)
  process.exit(1)
}

// ─── 3. Refresh: GET /app/orders для актуализации XSRF ───
console.log('\n' + '━'.repeat(70))
console.log('Шаг 3. GET /app/orders (проверка сессии и refresh XSRF)')
console.log('━'.repeat(70))
const t3 = Date.now()
const refreshRes = await fetch(`${RKO_BASE}/app/orders`, {
  dispatcher: proxy,
  headers: {
    Accept: 'text/html',
    Cookie: cookies.join('; '),
    'User-Agent': 'Mozilla/5.0',
  },
  redirect: 'manual',
  signal: AbortSignal.timeout(20000),
})
console.log(`  HTTP ${refreshRes.status} (${Date.now() - t3}ms)`)
const refreshLocation = refreshRes.headers.get('location')
if (refreshLocation) console.log(`  redirect → ${refreshLocation}`)
cookies = mergeCookies(cookies, extractCookies(refreshRes))

if (refreshRes.status === 302 && /login/.test(refreshLocation || '')) {
  console.log('\n✗ Сессия не зацепилась — нас редиректит обратно на /login. Креды/csrf неверные.')
  process.exit(1)
}

// ─── 4. POST /api/app/orders — создаём тестовую заявку ───
console.log('\n' + '━'.repeat(70))
console.log('Шаг 4. POST /api/app/orders (создаём ТЕСТОВУЮ заявку)')
console.log('━'.repeat(70))

const inn = generateValidINN(TEST_PREFIX_INN)
console.log(`  ФИО:    ${TEST_FIO}`)
console.log(`  ИНН:    ${inn}`)
console.log(`  телефон: ${TEST_PHONE}`)
console.log(`  email:  ${TEST_EMAIL}`)
console.log(`  город:  ${TEST_CITY}`)
console.log(`  product_id: ${PRODUCT_ID}\n`)

const xsrfFinal = getXsrfFromCookies(cookies)
const t4 = Date.now()
const orderRes = await fetch(`${RKO_BASE}/api/app/orders`, {
  method: 'POST',
  dispatcher: proxy,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-XSRF-TOKEN': xsrfFinal,
    Cookie: cookies.join('; '),
    'User-Agent': 'Mozilla/5.0',
  },
  body: JSON.stringify({
    products: [PRODUCT_ID],
    fio_rukovoditelia: TEST_FIO,
    inn,
    elektronnaia_pocta: TEST_EMAIL,
    telefon: TEST_PHONE,
    gorod_obsluzivaniia: TEST_CITY,
  }),
  redirect: 'manual',
  signal: AbortSignal.timeout(30000),
})
console.log(`  HTTP ${orderRes.status} (${Date.now() - t4}ms)`)
const orderText = await orderRes.text()
console.log(`  ответ (первые 1500 байт):\n${orderText.slice(0, 1500)}`)

if (!orderRes.ok) {
  console.log('\n✗ Создание заявки не удалось.')
  process.exit(1)
}

let orderJson
try { orderJson = JSON.parse(orderText) } catch { orderJson = null }
const rawData = orderJson?.data ?? orderJson
const order = Array.isArray(rawData) ? rawData[0] : rawData
const orderId = order?.id || order?.order_id || order?.orderId

console.log('\n' + '━'.repeat(70))
console.log('РЕЗУЛЬТАТ')
console.log('━'.repeat(70))
console.log(`Order ID: ${orderId}`)

// ВАЖНО: реф-ссылка в старом коде была вида /click/{orderId}?user_id=2290
// Но user_id=2290 — это партнёрский ID СТАРОГО аккаунта. У нового он другой.
// Надо его узнать. Можно из ответа API, либо скрейпить из dashboard.
const partnerIdFromOrder = order?.user_id || order?.partner_id || null
console.log(`partner_id (если есть в ответе): ${partnerIdFromOrder}`)
if (orderId && partnerIdFromOrder) {
  console.log(`Реф-ссылка: ${RKO_BASE}/click/${orderId}?user_id=${partnerIdFromOrder}`)
} else if (orderId) {
  console.log(`Реф-ссылка (без partner_id, сначала надо узнать наш user_id для нового аккаунта):`)
  console.log(`  ${RKO_BASE}/click/${orderId}?user_id=???`)
}

// Дамп всего ответа для разбора
console.log('\nПолный JSON ответа:')
console.log(JSON.stringify(orderJson, null, 2).slice(0, 4000))
