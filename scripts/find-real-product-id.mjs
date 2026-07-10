// Смотрим в реальные заказы кабинетов какой product_id у Альфа-Банк ИП+РКО.
// Используем lib-функции которые точно работают.

process.env.RKO_PROXY_URL = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
process.env.RKO_PARTNER_EMAIL = 'ntatarincev33@gmail.com'
process.env.RKO_PARTNER_PASSWORD = 'Nick.2kkl.019'
process.env.RKO_PROXY_URL_2 = 'http://hP4AWm:cJedWrO2lf@194.32.237.145:5500'
process.env.RKO_PARTNER_EMAIL_2 = 'ms_marishka2003@mail.ru'
process.env.RKO_PARTNER_PASSWORD_2 = 'marishka_love1'

import { fetch, ProxyAgent } from 'undici'
const { getActiveAccounts } = await import('../lib/rko-accounts.js')
const { loginToRkoPartner } = await import('../lib/rko-partner.js')

for (const a of getActiveAccounts()) {
  console.log('━'.repeat(70))
  console.log(`Кабинет ${a.id}`)
  console.log('━'.repeat(70))

  const auth = await loginToRkoPartner(a)
  const dp = new ProxyAgent(a.proxyUrl)

  // ВАЖНО: на GET у этого API тоже надо слать X-XSRF-TOKEN (Laravel quirk)
  const xsrf = auth.cookies.find(c => c.startsWith('XSRF-TOKEN='))
    ?.split('=').slice(1).join('=')
  const xsrfDecoded = xsrf ? decodeURIComponent(xsrf) : ''

  const headers = {
    Accept: 'application/json',
    'X-XSRF-TOKEN': xsrfDecoded,
    Cookie: auth.cookies.join('; '),
    'User-Agent': 'Mozilla/5.0',
  }

  // 1. Берём заказы и смотрим product_id внутри
  const r = await fetch('https://rko-partner.com/api/app/orders?page=1&perPage=3', {
    dispatcher: dp, headers, signal: AbortSignal.timeout(15000),
  })
  const text = await r.text()
  if (r.status >= 400) {
    console.log(`  GET /api/app/orders → ${r.status}: ${text.slice(0, 300)}`)
    continue
  }
  let json
  try { json = JSON.parse(text) } catch { console.log('  bad JSON'); continue }
  const orders = json.data || []
  console.log(`  Найдено заказов: ${orders.length}\n`)
  for (const o of orders) {
    console.log(`  Order #${o.id} state=${o.state} created=${o.created_at}`)
    // Любые ключи где может прятаться product id
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'object' && v !== null) continue
      if (k.includes('product') || k.includes('bank')) console.log(`     ${k}: ${v}`)
    }
    if (Array.isArray(o.products)) {
      console.log(`     products[]: ${JSON.stringify(o.products).slice(0, 400)}`)
    }
    if (o.product) {
      console.log(`     product: ${JSON.stringify(o.product).slice(0, 400)}`)
    }
    if (o.bank) {
      console.log(`     bank: ${JSON.stringify(o.bank).slice(0, 200)}`)
    }
  }

  // 2. Пытаемся получить каталог продуктов разными урлами
  console.log('\n  Пробуем endpoints с каталогом:')
  const endpoints = [
    '/api/app/products',
    '/api/products',
    '/api/app/banks',
    '/api/banks',
    '/api/app/offers',
    '/api/app/offer-products',
    '/api/app/orders/create',  // иногда там показан список доступных продуктов
  ]
  for (const ep of endpoints) {
    try {
      const rr = await fetch(`https://rko-partner.com${ep}`, {
        dispatcher: dp, headers, signal: AbortSignal.timeout(10000),
      })
      const tt = await rr.text()
      if (rr.status === 200) {
        console.log(`     ${ep} → 200 (${tt.length} bytes)`)
        // Найти Альфу
        if (tt.toLowerCase().includes('альфа') || tt.toLowerCase().includes('alfa')) {
          console.log(`        ⚠ упоминание Альфы найдено!`)
          // Парсим и ищем product
          try {
            const j = JSON.parse(tt)
            const items = Array.isArray(j) ? j : (j.data || [])
            for (const item of items) {
              const s = JSON.stringify(item).toLowerCase()
              if (s.includes('альфа') || s.includes('alfa')) {
                console.log(`        → ${JSON.stringify(item).slice(0, 400)}`)
              }
            }
          } catch {}
        }
      } else {
        console.log(`     ${ep} → ${rr.status}`)
      }
    } catch (err) {
      console.log(`     ${ep} → ✗ ${err.message}`)
    }
  }

  console.log()
}
