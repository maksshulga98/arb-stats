// Шаг 2 разведки:
//   1) В кабинете A пробуем оффер 519 — может в этом кабинете доступен
//   2) GET-ом дёргаем 405-эндпоинты, у которых POST не разрешён
//   3) Скачиваем JS-бандл создания заявки и ищем там endpoint автокомплита
//   4) Список всех заявок ищем те что с product_id отличающимся от 532 — может прошла свежая успешная РКО заявка с другим ID

process.env.RKO_PROXY_URL = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
process.env.RKO_PARTNER_EMAIL = 'ntatarincev33@gmail.com'
process.env.RKO_PARTNER_PASSWORD = 'Nick.2kkl.019'
process.env.RKO_PROXY_URL_2 = 'http://hP4AWm:cJedWrO2lf@194.32.237.145:5500'
process.env.RKO_PARTNER_EMAIL_2 = 'ms_marishka2003@mail.ru'
process.env.RKO_PARTNER_PASSWORD_2 = 'marishka_love1'

import { fetch, ProxyAgent } from 'undici'
const { getActiveAccounts } = await import('../lib/rko-accounts.js')
const { loginToRkoPartner } = await import('../lib/rko-partner.js')

async function setupAccount(accId) {
  const a = getActiveAccounts().find(x => x.id === accId)
  const auth = await loginToRkoPartner(a)
  const xsrf = auth.cookies.find(c => c.startsWith('XSRF-TOKEN='))?.split('=').slice(1).join('=')
  const xsrfDecoded = xsrf ? decodeURIComponent(xsrf) : ''
  const dp = new ProxyAgent(a.proxyUrl)
  return {
    label: a.label,
    dp,
    headers: {
      Accept: 'application/json',
      'X-XSRF-TOKEN': xsrfDecoded,
      Cookie: auth.cookies.join('; '),
      'User-Agent': 'Mozilla/5.0',
    },
  }
}

async function req(setup, method, url, body) {
  const opts = { method, dispatcher: setup.dp, headers: { ...setup.headers }, signal: AbortSignal.timeout(15000) }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const r = await fetch(`https://rko-partner.com${url}`, opts)
  const text = await r.text()
  return { status: r.status, text }
}

// ── 1. Cabinet A — оффер 519 ──
console.log('━'.repeat(70))
console.log('1. Кабинет A (Татаринцев) — пробуем оффер 519')
console.log('━'.repeat(70))
const A = await setupAccount('a')
const post519A = await req(A, 'POST', '/api/app/orders', { products: [519] })
console.log(`POST /api/app/orders {products:[519]} → ${post519A.status}`)
console.log(`  ${post519A.text.slice(0, 400)}`)

// ── 2. GET вместо POST на 405-эндпоинты ──
console.log('\n' + '━'.repeat(70))
console.log('2. GET-метод на роуты с 405')
console.log('━'.repeat(70))
const B = await setupAccount('b')
const endpoints405 = [
  '/api/app/orders/dadata?query=Иванов',
  '/api/app/orders/dadata-suggest?query=Иванов',
  '/api/app/orders/suggest-party?query=Иванов',
  '/api/app/orders/dadata-by-inn?inn=7707083893',
  '/api/app/orders/dadata?inn=7707083893',
  '/api/app/orders/dadata',
]
for (const url of endpoints405) {
  const r = await req(B, 'GET', url)
  console.log(`  ${r.status}  GET ${url}`)
  if (r.status === 200 || r.status === 422) {
    console.log(`         ${r.text.slice(0, 400).replace(/\n/g, '\n         ')}`)
  } else if (r.status !== 404 && r.status !== 405) {
    console.log(`         ${r.text.slice(0, 200)}`)
  }
}

// Ещё разные методы
console.log('\n  Другие методы на /api/app/orders/dadata:')
for (const m of ['PUT', 'PATCH', 'OPTIONS']) {
  const r = await req(B, m, '/api/app/orders/dadata', m === 'OPTIONS' ? undefined : { query: 'Иванов' })
  console.log(`  ${r.status}  ${m} /api/app/orders/dadata`)
  if (r.status < 400) console.log(`     ${r.text.slice(0, 200)}`)
}

// ── 3. JS-бандл ──
console.log('\n' + '━'.repeat(70))
console.log('3. JS бандл — ищем endpoint автокомплита')
console.log('━'.repeat(70))
const html = await req(B, 'GET', '/app/orders/create?products%5B%5D=519')
// Найти script src
const scripts = [...html.text.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)].map(m => m[1])
console.log(`Найдено script src: ${scripts.length}`)
for (const s of scripts) console.log(`  ${s}`)

// Качаем главный js bundle (обычно largest)
let bundleUrls = scripts.filter(s => s.includes('.js') && (s.includes('chunk') || s.includes('app') || s.includes('orders')))
if (bundleUrls.length === 0) bundleUrls = scripts.filter(s => s.endsWith('.js'))

console.log(`\nКачаю ${bundleUrls.length} JS-файлов и ищу dadata/suggest/party/api/...`)
const apiCalls = new Set()
for (const src of bundleUrls.slice(0, 10)) {
  const url = src.startsWith('http') ? src : `https://rko-partner.com${src.startsWith('/') ? src : '/' + src}`
  try {
    const r = await fetch(url, { dispatcher: B.dp, signal: AbortSignal.timeout(20000) })
    const t = await r.text()
    const len = t.length
    // Ищем все упоминания /api/ путей
    const matches = [...t.matchAll(/['"`](\/api\/[a-zA-Z0-9\-_/]+)['"`]/g)]
    for (const [, p] of matches) apiCalls.add(p)
    // Отдельно ищем 'dadata', 'suggest', 'party'
    for (const word of ['dadata', 'suggest', 'party', 'organization', 'autocomplete']) {
      const re = new RegExp(`['"\`][^'"\`\\s]*${word}[^'"\`\\s]*['"\`]`, 'gi')
      const wmatches = [...t.matchAll(re)]
      for (const [w] of wmatches) apiCalls.add(w.slice(1, -1))
    }
    console.log(`  ✓ ${url.slice(-80)} (${len}b)`)
  } catch (e) {
    console.log(`  ✗ ${url}: ${e.message}`)
  }
}

console.log(`\nНайдено уникальных строк (${apiCalls.size}):`)
const sorted = [...apiCalls].filter(s => s.length > 5).sort()
for (const s of sorted.slice(0, 80)) console.log(`  ${s}`)

// ── 4. Свежие заявки — ищем product_id отличный от 532 ──
console.log('\n' + '━'.repeat(70))
console.log('4. Кабинет B — все product_id из недавних заявок')
console.log('━'.repeat(70))
const orders = await req(B, 'GET', '/api/app/orders?page=1&perPage=100')
if (orders.status === 200) {
  const j = JSON.parse(orders.text)
  const data = j.data || []
  const productCount = {}
  for (const o of data) {
    const pid = Array.isArray(o.products) ? o.products[0] : (o.product_id || 'нет')
    productCount[pid] = (productCount[pid] || 0) + 1
  }
  console.log('Распределение product_id:')
  for (const [pid, n] of Object.entries(productCount)) console.log(`  ${pid}: ${n}`)

  // Самая свежая не-532
  const nonStandard = data.find(o => {
    const pid = Array.isArray(o.products) ? o.products[0] : o.product_id
    return Number(pid) !== 532
  })
  if (nonStandard) {
    console.log('\nПример свежей не-532 заявки:')
    console.log(JSON.stringify({
      id: nonStandard.id,
      products: nonStandard.products,
      product_id: nonStandard.product_id,
      bank_id: nonStandard.bank_id,
      state: nonStandard.state,
      bank_order_form_fields: nonStandard.bank_order_form_fields,
    }, null, 2))
  }
}
