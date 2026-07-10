// Изучаем оффер "Альфа-Банк Расчётно-кассовое обслуживание (РЕФ)" на rko-partner.
// Нужно понять:
//   1) Какой product_id у этого оффера (≠ 532 — там был оффер ИП+РКО Регистрация)
//   2) Какие поля принимает POST /api/app/orders для этого оффера
//   3) Есть ли search-endpoint для подбора организации по ФИО — и как он возвращает ИНН
//   4) Как привязать выбранную организацию из списка к заявке
//
// Запуск:  node scripts/explore-rko-account-offer.mjs

process.env.RKO_PROXY_URL = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
process.env.RKO_PARTNER_EMAIL = 'ntatarincev33@gmail.com'
process.env.RKO_PARTNER_PASSWORD = 'Nick.2kkl.019'
process.env.RKO_PROXY_URL_2 = 'http://hP4AWm:cJedWrO2lf@194.32.237.145:5500'
process.env.RKO_PARTNER_EMAIL_2 = 'ms_marishka2003@mail.ru'
process.env.RKO_PARTNER_PASSWORD_2 = 'marishka_love1'

import { fetch } from 'undici'
const { getActiveAccounts } = await import('../lib/rko-accounts.js')
const { loginToRkoPartner } = await import('../lib/rko-partner.js')

const accounts = getActiveAccounts()
if (accounts.length === 0) { console.error('Нет кабинетов'); process.exit(1) }
const a = accounts[0]
console.log(`Использую кабинет: ${a.label}\n`)

const auth = await loginToRkoPartner(a)
const xsrf = auth.cookies.find(c => c.startsWith('XSRF-TOKEN='))?.split('=').slice(1).join('=')
const xsrfDecoded = xsrf ? decodeURIComponent(xsrf) : ''

const { ProxyAgent } = await import('undici')
const dp = new ProxyAgent(a.proxyUrl)
const headers = {
  Accept: 'application/json',
  'X-XSRF-TOKEN': xsrfDecoded,
  Cookie: auth.cookies.join('; '),
  'User-Agent': 'Mozilla/5.0',
}

async function get(url) {
  const r = await fetch(`https://rko-partner.com${url}`, { dispatcher: dp, headers, signal: AbortSignal.timeout(15000) })
  const text = await r.text()
  return { status: r.status, text }
}

// ── 1) Список продуктов — ищем оффер РКО Альфа короткая заявка ──
console.log('━'.repeat(70))
console.log('1. GET /api/app/products — ищем оффер РКО Альфа короткая заявка СМС РЕФ')
console.log('━'.repeat(70))
const products = await get('/api/app/products?perPage=200')
console.log(`status: ${products.status}`)
if (products.status === 200) {
  let json
  try { json = JSON.parse(products.text) } catch { console.log('bad JSON'); process.exit(1) }
  const items = Array.isArray(json) ? json : (json.data || [])
  console.log(`всего продуктов: ${items.length}`)

  const alfa = items.filter(p => {
    const s = JSON.stringify(p).toLowerCase()
    return s.includes('альфа') || s.includes('alfa')
  })
  console.log(`\nАльфа-продукты (${alfa.length}):`)
  for (const p of alfa) {
    const name = p.name || p.title || '?'
    const restr = p.is_restricted ?? p.restricted ?? '?'
    console.log(`  id=${String(p.id).padEnd(4)} | restricted=${restr} | ${name}`)
  }

  // Сужаем до РКО + СМС + РЕФ
  const target = alfa.filter(p => {
    const s = JSON.stringify(p).toLowerCase()
    return s.includes('ркo') || s.includes('рко') || s.includes('расчётн') || s.includes('расчетн') || s.includes('rko')
  })
  console.log(`\nИз них с РКО/расчёт.. (${target.length}):`)
  for (const p of target) {
    console.log(JSON.stringify(p, null, 2))
  }
}

// ── 2) Существующая структура — посмотрим свежую заявку РКО (которую может уже завели) ──
console.log('\n' + '━'.repeat(70))
console.log('2. GET /api/app/orders?page=1&perPage=20 — ищем последние не-ИП заявки')
console.log('━'.repeat(70))
const orders = await get('/api/app/orders?page=1&perPage=20')
if (orders.status === 200) {
  const j = JSON.parse(orders.text)
  const data = j.data || []
  console.log(`заявок: ${data.length}, продукты в них:`)
  const productCount = {}
  for (const o of data) {
    const pid = Array.isArray(o.products) ? o.products.join(',') : (o.product_id || '?')
    productCount[pid] = (productCount[pid] || 0) + 1
  }
  console.log(productCount)

  // Покажем структуру первой не-ИП-РКО заявки (если есть)
  const nonAlfaIP = data.find(o => {
    const pid = Array.isArray(o.products) ? o.products[0] : o.product_id
    return pid && Number(pid) !== 532
  })
  if (nonAlfaIP) {
    console.log('\nПример заявки с другим product_id:')
    console.log(JSON.stringify(nonAlfaIP, null, 2).slice(0, 2000))
  } else {
    console.log('\nВсе свежие заявки на 532 (ИП+РКО регистрация). Завести тестовую вручную и перезапустить.')
  }
}

// ── 3) Endpoint поиска организаций ──
console.log('\n' + '━'.repeat(70))
console.log('3. Пробуем endpoints поиска организаций (по ФИО / по ИНН)')
console.log('━'.repeat(70))
const searchEndpoints = [
  '/api/app/companies/search?q=Иванов',
  '/api/app/companies?search=Иванов',
  '/api/app/company-search?q=Иванов',
  '/api/app/dadata/search?query=Иванов',
  '/api/app/dadata/party/search?query=Иванов',
  '/api/app/orders/companies?q=Иванов',
  '/api/app/orders/dadata?query=Иванов',
  '/api/app/suggest/party?query=Иванов',
  '/api/dadata/suggest/party?query=Иванов',
]
for (const ep of searchEndpoints) {
  const r = await get(ep)
  const summary = r.status === 200
    ? `OK ${r.text.length}b: ${r.text.slice(0, 250)}`
    : `${r.status}: ${r.text.slice(0, 120)}`
  console.log(`  ${ep}\n    → ${summary}\n`)
}
