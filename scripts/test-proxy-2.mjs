// Проверяем второй прокси и логин во второй кабинет.
import { ProxyAgent, fetch } from 'undici'

const PROXY_URL = 'http://hP4AWm:cJedWrO2lf@194.32.237.145:5500'
const EXPECTED_IP = '194.32.237.145'

const RKO_BASE = 'https://rko-partner.com'
const EMAIL = 'ms_marishka2003@mail.ru'
const PASSWORD = 'marishka_love1'

const proxy = new ProxyAgent(PROXY_URL)

// 1. Проверка прокси через ipify
async function getIp(label, dispatcher) {
  const t0 = Date.now()
  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      dispatcher,
      signal: AbortSignal.timeout(15000),
    })
    const json = await res.json()
    console.log(`  ${label}: ${json.ip} (${Date.now() - t0}ms)`)
    return json.ip
  } catch (err) {
    console.log(`  ${label}: FAIL "${err.message}"`)
    return null
  }
}

console.log('1. Проверка прокси:')
const noProxyIp = await getIp('Без прокси    ', undefined)
const proxyIp = await getIp('Через прокси  ', proxy)

if (proxyIp !== EXPECTED_IP) {
  console.log(`✗ ожидали ${EXPECTED_IP}, получили ${proxyIp}`)
  process.exit(1)
}
if (proxyIp === noProxyIp) {
  console.log(`✗ прокси не перенаправил трафик`)
  process.exit(1)
}
console.log(`  ✓ прокси работает, IP = ${proxyIp}\n`)

// 2. Полный цикл логина во второй кабинет
console.log('2. Логин во второй кабинет:')

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
function getXsrf(cookies) {
  const c = cookies.find(c => c.startsWith('XSRF-TOKEN='))
  return c ? decodeURIComponent(c.split('=').slice(1).join('=')) : ''
}

const pageRes = await fetch(`${RKO_BASE}/login`, {
  dispatcher: proxy, headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0' },
  redirect: 'manual', signal: AbortSignal.timeout(20000),
})
let cookies = extractCookies(pageRes)
console.log(`  GET /login: HTTP ${pageRes.status}, ${cookies.length} cookies`)

const loginRes = await fetch(`${RKO_BASE}/login`, {
  method: 'POST', dispatcher: proxy,
  headers: {
    'Content-Type': 'application/json', Accept: 'application/json',
    'X-XSRF-TOKEN': getXsrf(cookies), Cookie: cookies.join('; '),
    'User-Agent': 'Mozilla/5.0',
  },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  redirect: 'manual', signal: AbortSignal.timeout(20000),
})
const loginBody = await loginRes.text()
console.log(`  POST /login: HTTP ${loginRes.status}, body: ${loginBody.slice(0, 200)}`)
cookies = mergeCookies(cookies, extractCookies(loginRes))

if (loginRes.status >= 400) {
  console.log(`  ✗ логин не прошёл`)
  process.exit(1)
}

// 3. Проверка сессии + узнаём partner user_id для будущих реф-ссылок
const refreshRes = await fetch(`${RKO_BASE}/app/orders`, {
  dispatcher: proxy,
  headers: { Accept: 'text/html', Cookie: cookies.join('; '), 'User-Agent': 'Mozilla/5.0' },
  redirect: 'manual', signal: AbortSignal.timeout(20000),
})
console.log(`  GET /app/orders: HTTP ${refreshRes.status}`)
cookies = mergeCookies(cookies, extractCookies(refreshRes))

if (refreshRes.status === 302 && /login/.test(refreshRes.headers.get('location') || '')) {
  console.log(`  ✗ сессия не зацепилась`)
  process.exit(1)
}

// 4. Запрос /api/app/orders чтобы увидеть аккаунт
const ordersRes = await fetch(`${RKO_BASE}/api/app/orders?page=1&perPage=5`, {
  dispatcher: proxy,
  headers: {
    'Content-Type': 'application/json', Accept: 'application/json',
    Cookie: cookies.join('; '), 'X-XSRF-TOKEN': getXsrf(cookies),
    'User-Agent': 'Mozilla/5.0',
  },
})
const ordersJson = await ordersRes.json()
console.log(`  GET /api/app/orders: HTTP ${ordersRes.status}, total в кабинете: ${ordersJson.meta?.total ?? '?'}`)

// Из любого ордера можно вытащить partner user_id (или из user объекта внутри)
if (Array.isArray(ordersJson.data) && ordersJson.data.length > 0) {
  const sample = ordersJson.data[0]
  console.log(`  partner user_id: ${sample.user_id}`)
  console.log(`  partner name:    ${sample.user?.name || sample.user?.email || '-'}`)
}

console.log('\n✓ Второй кабинет доступен через свой прокси, готов к интеграции')
