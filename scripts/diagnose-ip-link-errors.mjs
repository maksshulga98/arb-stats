// Диагностика ошибок 422 / fetch failed в /api/ip-link.
// Делаем три вещи:
//   1. Health-check прокси A и B
//   2. Login в каждый кабинет — проверяем что сессия поднимается
//   3. Воспроизводим 2 проблемные заявки со скрина, ловим РАВ JSON
//      из 422 чтобы увидеть какое поле rko-partner отвергает.
//   4. Параллельно подаём 4 заявки (как при пиковой нагрузке) — ловим
//      fetch failed если он плавающий.

process.env.RKO_PROXY_URL = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
process.env.RKO_PARTNER_EMAIL = 'ntatarincev33@gmail.com'
process.env.RKO_PARTNER_PASSWORD = 'Nick.2kkl.019'
process.env.RKO_PROXY_URL_2 = 'http://hP4AWm:cJedWrO2lf@194.32.237.145:5500'
process.env.RKO_PARTNER_EMAIL_2 = 'ms_marishka2003@mail.ru'
process.env.RKO_PARTNER_PASSWORD_2 = 'marishka_love1'

import { fetch, ProxyAgent } from 'undici'
const { getActiveAccounts } = await import('../lib/rko-accounts.js')
const { loginToRkoPartner, RKO_PRODUCT_ID } = await import('../lib/rko-partner.js')

const accounts = getActiveAccounts()

// ─── 1. Health-check прокси ───
console.log('━'.repeat(70))
console.log('1. Health-check прокси')
console.log('━'.repeat(70))
for (const a of accounts) {
  const tStart = Date.now()
  try {
    const dp = new ProxyAgent(a.proxyUrl)
    const r = await fetch('https://api.ipify.org?format=json', {
      dispatcher: dp,
      signal: AbortSignal.timeout(10000),
    })
    const ip = (await r.json()).ip
    console.log(`   ✓ ${a.id}: ${ip} (${Date.now() - tStart}ms)`)
  } catch (err) {
    console.log(`   ✗ ${a.id}: ${err?.message || err} (${Date.now() - tStart}ms)`)
  }
}
console.log()

// ─── 2. Health-check rko-partner.com через каждый прокси ───
console.log('━'.repeat(70))
console.log('2. Health-check rko-partner.com (HEAD /login через каждый прокси)')
console.log('━'.repeat(70))
for (const a of accounts) {
  const tStart = Date.now()
  try {
    const dp = new ProxyAgent(a.proxyUrl)
    const r = await fetch('https://rko-partner.com/login', {
      method: 'GET',
      dispatcher: dp,
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
      redirect: 'manual',
    })
    console.log(`   ${a.id}: HTTP ${r.status} (${Date.now() - tStart}ms)`)
    // Проверим cf-headers — если Cloudflare ругается, там будут "cf-ray" и т.д.
    const cfRay = r.headers.get('cf-ray')
    const cfMitigated = r.headers.get('cf-mitigated')
    if (cfRay) console.log(`     cf-ray: ${cfRay}`)
    if (cfMitigated) console.log(`     ⚠ cf-mitigated: ${cfMitigated} — Cloudflare блокирует/ограничивает!`)
  } catch (err) {
    console.log(`   ✗ ${a.id}: ${err?.message || err} (${Date.now() - tStart}ms)`)
  }
}
console.log()

// ─── 3. Воспроизводим заявку Арестовой через КАЖДЫЙ кабинет ───
//      Хотим увидеть РАВ ответ от rko-partner на 422
console.log('━'.repeat(70))
console.log('3. Воспроизводим заявку Арестовой через оба кабинета')
console.log('   Хотим увидеть raw body 422 — что именно rko-partner отвергает')
console.log('━'.repeat(70))

const arestova = {
  fio_rukovoditelia: 'Арестова Дарья Николаевна',
  inn: '280722734208',
  elektronnaia_pocta: 'arestovad@internet.ru',
  telefon: '89143971295',
  gorod_obsluzivaniia: 'Свободный',
}

for (const a of accounts) {
  console.log(`\n   ─── Кабинет ${a.id} ───`)
  let auth
  const t0 = Date.now()
  try {
    auth = await loginToRkoPartner(a)
    console.log(`   login OK (${Date.now() - t0}ms, ${auth.cookies.length} cookies)`)
  } catch (err) {
    console.log(`   ✗ login FAILED: ${err.message}`)
    continue
  }

  // Делаем запрос вручную, чтобы напечатать raw body
  const dp = new ProxyAgent(a.proxyUrl)
  const xsrf = auth.cookies.find(c => c.startsWith('XSRF-TOKEN='))
    ?.split('=').slice(1).join('=')
  const xsrfDecoded = xsrf ? decodeURIComponent(xsrf) : ''

  const t1 = Date.now()
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
      body: JSON.stringify({ products: [RKO_PRODUCT_ID], ...arestova }),
      signal: AbortSignal.timeout(30000),
    })
    const text = await r.text()
    console.log(`   POST /api/app/orders → ${r.status} (${Date.now() - t1}ms)`)
    console.log(`   raw body (первые 800 символов):`)
    console.log('   ' + text.slice(0, 800).replace(/\n/g, '\n   '))
  } catch (err) {
    console.log(`   ✗ POST FAILED: ${err.message} (${Date.now() - t1}ms)`)
    if (err.cause) console.log(`     cause: ${err.cause.message || err.cause}`)
  }
}
console.log()

// ─── 4. Параллельная нагрузка: 4 одновременных login ───
console.log('━'.repeat(70))
console.log('4. Параллельная нагрузка: 4×login одновременно (имитация пика)')
console.log('━'.repeat(70))
const tParallel = Date.now()
const parallelResults = await Promise.allSettled([
  loginToRkoPartner(accounts[0]),
  loginToRkoPartner(accounts[1]),
  loginToRkoPartner(accounts[0]),
  loginToRkoPartner(accounts[1]),
])
console.log(`   Общее время: ${Date.now() - tParallel}ms`)
parallelResults.forEach((r, i) => {
  if (r.status === 'fulfilled') {
    console.log(`   #${i + 1}: ✓ ${r.value.cookies.length} cookies`)
  } else {
    console.log(`   #${i + 1}: ✗ ${r.reason?.message || r.reason}`)
  }
})
