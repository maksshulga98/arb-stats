// Диагностика "Ошибка партнёрской программы: fetch failed" в /api/account-link.
//
// Проверяем по шагам:
//   1. Health-check прокси A и B (через ipify)
//   2. HEAD/GET rko-partner.com через каждый прокси (доступность, Cloudflare)
//   3. Login в каждый кабинет — проверка сессии
//   4. POST /api/app/orders с тестовыми данными — ловим причину 4xx/5xx
//   5. Параллельная нагрузка (имитация одновременных запросов)

process.env.RKO_PROXY_URL    = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
process.env.RKO_PARTNER_EMAIL    = 'ntatarincev33@gmail.com'
process.env.RKO_PARTNER_PASSWORD = 'Nick.2kkl.019'
process.env.RKO_PROXY_URL_2    = 'http://hP4AWm:cJedWrO2lf@194.32.237.145:5500'
process.env.RKO_PARTNER_EMAIL_2    = 'ms_marishka2003@mail.ru'
process.env.RKO_PARTNER_PASSWORD_2 = 'marishka_love1'

import { fetch, ProxyAgent } from 'undici'
const { getActiveAccounts } = await import('../lib/rko-accounts.js')
const { loginToRkoPartner, RKO_ACCOUNT_PRODUCT_ID } = await import('../lib/rko-partner.js')

const accounts = getActiveAccounts()
console.log(`Активных кабинетов: ${accounts.length}`)
console.log(`RKO_ACCOUNT_PRODUCT_ID = ${RKO_ACCOUNT_PRODUCT_ID}\n`)

// ─── 1. Health-check прокси ───
console.log('━'.repeat(70))
console.log('1. Health-check прокси (ipify)')
console.log('━'.repeat(70))
for (const a of accounts) {
  const t0 = Date.now()
  try {
    const dp = new ProxyAgent(a.proxyUrl)
    const r = await fetch('https://api.ipify.org?format=json', {
      dispatcher: dp,
      signal: AbortSignal.timeout(10000),
    })
    const j = await r.json()
    console.log(`   ✓ ${a.id} (${a.label}): exit-IP=${j.ip} (${Date.now()-t0}ms)`)
  } catch (err) {
    console.log(`   ✗ ${a.id}: ${err?.message || err} (${Date.now()-t0}ms)`)
    if (err.cause) console.log(`      cause: ${err.cause?.message || err.cause}`)
  }
}

// ─── 2. Health-check rko-partner.com через каждый прокси ───
console.log('\n' + '━'.repeat(70))
console.log('2. Доступность rko-partner.com (GET /login через прокси)')
console.log('━'.repeat(70))
for (const a of accounts) {
  const t0 = Date.now()
  try {
    const dp = new ProxyAgent(a.proxyUrl)
    const r = await fetch('https://rko-partner.com/login', {
      dispatcher: dp,
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
      redirect: 'manual',
    })
    console.log(`   ${a.id}: HTTP ${r.status} (${Date.now()-t0}ms)`)
    const cfRay = r.headers.get('cf-ray')
    const cfMit = r.headers.get('cf-mitigated')
    const server = r.headers.get('server')
    if (cfRay) console.log(`      cf-ray: ${cfRay}`)
    if (cfMit) console.log(`      ⚠ cf-mitigated: ${cfMit} — Cloudflare ограничивает!`)
    if (server) console.log(`      server: ${server}`)
  } catch (err) {
    console.log(`   ✗ ${a.id}: ${err?.message || err} (${Date.now()-t0}ms)`)
    if (err.cause) console.log(`      cause: ${err.cause?.message || err.cause}`)
  }
}

// ─── 3. Логин ───
console.log('\n' + '━'.repeat(70))
console.log('3. Login в каждый кабинет')
console.log('━'.repeat(70))
const auths = {}
for (const a of accounts) {
  const t0 = Date.now()
  try {
    const auth = await loginToRkoPartner(a)
    console.log(`   ✓ ${a.id}: ${auth.cookies.length} cookies (${Date.now()-t0}ms)`)
    auths[a.id] = auth
  } catch (err) {
    console.log(`   ✗ ${a.id}: ${err?.message || err} (${Date.now()-t0}ms)`)
    if (err.cause) console.log(`      cause: ${err.cause?.message || err.cause}`)
  }
}

// ─── 4. POST заявки с реальными данными (как на скриншоте) ───
console.log('\n' + '━'.repeat(70))
console.log(`4. POST /api/app/orders (product=${RKO_ACCOUNT_PRODUCT_ID}) — реальный кейс`)
console.log('━'.repeat(70))

const testPayload = {
  products: [RKO_ACCOUNT_PRODUCT_ID],
  naimenovanie_organizacii: 'ИП Тестов Тест Тестович',
  inn: '770000000082',
  iuridiceskii_adres: 'г Москва, ул Тестовая, д 1',
  gorod_obsluzivaniia: 'Москва',
  kontaktnoe_lico: 'Тестов Т.Т.',
  elektronnaia_pocta: 'test.deploy@example.com',
  telefon: '+7 999 123 45 67',
}

for (const a of accounts) {
  console.log(`\n   ─── Кабинет ${a.id} (${a.label}) ───`)
  const auth = auths[a.id]
  if (!auth) { console.log('   ✗ нет сессии (login упал ранее)'); continue }

  const dp = new ProxyAgent(a.proxyUrl)
  const xsrf = auth.cookies.find(c => c.startsWith('XSRF-TOKEN='))?.split('=').slice(1).join('=')
  const xsrfDecoded = xsrf ? decodeURIComponent(xsrf) : ''

  const t0 = Date.now()
  try {
    const r = await fetch('https://rko-partner.com/api/app/orders', {
      method: 'POST',
      dispatcher: dp,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-XSRF-TOKEN': xsrfDecoded,
        Cookie: auth.cookies.join('; '),
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify(testPayload),
      signal: AbortSignal.timeout(30000),
    })
    const text = await r.text()
    console.log(`   POST → ${r.status} (${Date.now()-t0}ms)`)
    console.log(`   raw body: ${text.slice(0, 800).replace(/\n/g, '\n   ')}`)
  } catch (err) {
    console.log(`   ✗ ${err?.message || err} (${Date.now()-t0}ms)`)
    if (err.cause) console.log(`      cause: ${err.cause?.message || err.cause}`)
  }
}

// ─── 5. Параллельная нагрузка ───
console.log('\n' + '━'.repeat(70))
console.log('5. Параллельная нагрузка: 4 одновременных POST (имитация пика)')
console.log('━'.repeat(70))
const tPar = Date.now()
const parallel = []
for (let i = 0; i < 4; i++) {
  const a = accounts[i % accounts.length]
  const auth = auths[a.id]
  if (!auth) continue
  parallel.push((async () => {
    const dp = new ProxyAgent(a.proxyUrl)
    const xsrf = auth.cookies.find(c => c.startsWith('XSRF-TOKEN='))?.split('=').slice(1).join('=')
    const xsrfDecoded = xsrf ? decodeURIComponent(xsrf) : ''
    try {
      const r = await fetch('https://rko-partner.com/api/app/orders', {
        method: 'POST',
        dispatcher: dp,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-XSRF-TOKEN': xsrfDecoded,
          Cookie: auth.cookies.join('; '),
          'User-Agent': 'Mozilla/5.0',
        },
        body: JSON.stringify({ ...testPayload, elektronnaia_pocta: `test${i}@example.com` }),
        signal: AbortSignal.timeout(30000),
      })
      return { i, acc: a.id, status: r.status }
    } catch (err) {
      return { i, acc: a.id, error: err?.message || String(err), cause: err.cause?.message }
    }
  })())
}
const parRes = await Promise.allSettled(parallel)
console.log(`Общее время: ${Date.now()-tPar}ms`)
parRes.forEach((r, i) => {
  if (r.status === 'fulfilled') {
    const v = r.value
    if (v.error) console.log(`   #${i+1} ${v.acc}: ✗ ${v.error}${v.cause ? ` (${v.cause})` : ''}`)
    else console.log(`   #${i+1} ${v.acc}: HTTP ${v.status}`)
  } else {
    console.log(`   #${i+1}: ✗ ${r.reason?.message || r.reason}`)
  }
})
