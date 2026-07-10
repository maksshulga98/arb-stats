// Программная разведка структуры формы оффера 519 (Альфа РКО короткая+смс).
// Цель — узнать:
//   1) Полная карточка продукта (form_fields, application_name, схема)
//   2) Список required полей через 422 от POST (отправляем пустое тело)
//   3) Endpoint автокомплита dadata — пробуем 12+ вариантов URL
//
// Запуск:  node scripts/probe-rko-account-form.mjs

process.env.RKO_PROXY_URL = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
process.env.RKO_PARTNER_EMAIL = 'ntatarincev33@gmail.com'
process.env.RKO_PARTNER_PASSWORD = 'Nick.2kkl.019'
process.env.RKO_PROXY_URL_2 = 'http://hP4AWm:cJedWrO2lf@194.32.237.145:5500'
process.env.RKO_PARTNER_EMAIL_2 = 'ms_marishka2003@mail.ru'
process.env.RKO_PARTNER_PASSWORD_2 = 'marishka_love1'

import { fetch, ProxyAgent } from 'undici'
const { getActiveAccounts } = await import('../lib/rko-accounts.js')
const { loginToRkoPartner } = await import('../lib/rko-partner.js')

const ACCOUNT_ID = 'b' // Маришка — у неё точно есть оффер 519 (она его и тыкала только что)
const PRODUCT_ID = 519

const accounts = getActiveAccounts()
const a = accounts.find(x => x.id === ACCOUNT_ID)
console.log(`Кабинет: ${a.label}`)

const auth = await loginToRkoPartner(a)
const xsrf = auth.cookies.find(c => c.startsWith('XSRF-TOKEN='))?.split('=').slice(1).join('=')
const xsrfDecoded = xsrf ? decodeURIComponent(xsrf) : ''
const dp = new ProxyAgent(a.proxyUrl)
const baseHeaders = {
  Accept: 'application/json',
  'X-XSRF-TOKEN': xsrfDecoded,
  Cookie: auth.cookies.join('; '),
  'User-Agent': 'Mozilla/5.0',
}

async function req(method, url, body, extraHeaders = {}) {
  const opts = {
    method,
    dispatcher: dp,
    headers: { ...baseHeaders, ...extraHeaders },
    signal: AbortSignal.timeout(15000),
  }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const r = await fetch(`https://rko-partner.com${url}`, opts)
  const text = await r.text()
  return { status: r.status, text, headers: Object.fromEntries(r.headers) }
}

// ── 1. Карточка продукта 519 ──
console.log('\n' + '━'.repeat(70))
console.log(`1. GET /api/app/products/${PRODUCT_ID} — карточка оффера`)
console.log('━'.repeat(70))
const prodCard = await req('GET', `/api/app/products/${PRODUCT_ID}`)
console.log(`status: ${prodCard.status}`)
if (prodCard.status === 200) {
  const j = JSON.parse(prodCard.text)
  const p = j.data || j
  console.log(`name: ${p.name}`)
  console.log(`application_name: ${p.application_name}`)
  console.log(`is_restricted: ${p.is_restricted}`)
  console.log(`form_fields/schema:`)
  console.log(JSON.stringify(p.form_fields || p.schema || p.fields || 'нет такого поля', null, 2).slice(0, 2000))
} else {
  console.log(prodCard.text.slice(0, 500))
}

// ── 2. POST без полей — получим 422 со списком required ──
console.log('\n' + '━'.repeat(70))
console.log(`2. POST /api/app/orders {products:[${PRODUCT_ID}]} — провоцируем 422 со схемой`)
console.log('━'.repeat(70))
const minPost = await req('POST', '/api/app/orders', { products: [PRODUCT_ID] })
console.log(`status: ${minPost.status}`)
console.log(minPost.text.slice(0, 2500))

// ── 3. Пробуем 18 разных endpoint автокомплита ──
console.log('\n' + '━'.repeat(70))
console.log(`3. Поиск endpoint автокомплита (ФИО → организация)`)
console.log('━'.repeat(70))

const fioQuery = 'Иванов Иван'
const innQuery = '7707083893'  // Сбербанк — он точно есть в реестре

const endpoints = [
  // По общим Laravel/RKO-стилям
  ['GET', `/api/app/dadata/suggest?query=${encodeURIComponent(fioQuery)}`],
  ['POST', `/api/app/dadata/suggest`, { query: fioQuery }],
  ['POST', `/api/app/dadata`, { query: fioQuery }],
  ['GET', `/api/app/dadata?query=${encodeURIComponent(fioQuery)}`],
  ['GET', `/api/dadata/suggestions/api/4_1/rs/suggest/party?query=${fioQuery}`],
  ['POST', `/api/dadata/suggestions/api/4_1/rs/suggest/party`, { query: fioQuery }],
  ['POST', `/api/app/suggestions/party`, { query: fioQuery }],
  ['POST', `/api/app/orders/dadata`, { query: fioQuery }],
  ['POST', `/api/app/orders/dadata-suggest`, { query: fioQuery }],
  ['POST', `/api/app/orders/suggest-party`, { query: fioQuery }],
  // С учётом что product специфический — может быть scoped endpoint
  ['POST', `/api/app/products/${PRODUCT_ID}/suggest-party`, { query: fioQuery }],
  ['POST', `/api/app/products/${PRODUCT_ID}/dadata`, { query: fioQuery }],
  ['POST', `/api/app/orders/create/dadata`, { query: fioQuery }],
  // По имени бизнес-объекта в Laravel
  ['POST', `/api/app/dadata-party`, { query: fioQuery }],
  ['POST', `/api/app/party-suggest`, { query: fioQuery }],
  ['POST', `/api/app/party`, { query: fioQuery }],
  // Может быть company / organization
  ['GET', `/api/app/organizations?search=${encodeURIComponent(fioQuery)}`],
  ['GET', `/api/app/organizations/suggest?query=${encodeURIComponent(fioQuery)}`],
  // По ИНН
  ['POST', `/api/app/dadata/party-by-inn`, { inn: innQuery }],
  ['POST', `/api/app/orders/dadata-by-inn`, { inn: innQuery }],
]

for (const [method, url, body] of endpoints) {
  const r = await req(method, url, body)
  const tag = r.status === 200 ? '✓ 200' : r.status === 422 ? '? 422' : `  ${r.status}`
  console.log(`  ${tag}  ${method.padEnd(4)} ${url}`)
  if (r.status === 200 || r.status === 422) {
    console.log(`         ${r.text.slice(0, 300).replace(/\n/g, '\n         ')}`)
  }
}

// ── 4. Посмотрим HTML страницы create — может в нём видно endpoint ──
console.log('\n' + '━'.repeat(70))
console.log(`4. GET /app/orders/create — ищем подсказки в HTML`)
console.log('━'.repeat(70))
const htmlPage = await req('GET', `/app/orders/create?products%5B%5D=${PRODUCT_ID}`, undefined, { Accept: 'text/html' })
console.log(`status: ${htmlPage.status}, length: ${htmlPage.text.length}`)

// Ищем упоминания dadata/suggest/party в HTML / JS
const interesting = [
  /dadata[^"'\s]*/gi,
  /suggest[^"'\s]*/gi,
  /party[^"'\s]*/gi,
  /naimenovanie[^"'\s]*/gi,
  /\/api\/[a-z0-9\-_/]+/gi,
]
const hits = new Set()
for (const re of interesting) {
  const matches = htmlPage.text.match(re) || []
  for (const m of matches) hits.add(m.slice(0, 80))
}
const sorted = [...hits].filter(h => h.length > 8 && !h.match(/^[a-z]+$/i)).sort()
console.log(`\nИнтересные строки из HTML (${sorted.length}):`)
for (const h of sorted.slice(0, 50)) console.log(`  ${h}`)
