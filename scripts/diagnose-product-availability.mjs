// Проверяем: продукт 520 (Альфа-Банк ИП+РКО) отключен глобально в кабинетах,
// или дело в конкретном городе/ФИО? Пробуем разные комбинации.

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

// Свежий ИНН и обычная Москва — самый стандартный кейс. Если и тут 422 —
// продукт точно отключен в кабинете полностью.
function generateValidINN(prefix10) {
  const d = prefix10.split('').map(Number)
  const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const c1 = w1.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  const c2 = w2.reduce((s, w, i) => s + w * [...d, c1][i], 0) % 11 % 10
  return prefix10 + c1 + c2
}

const cases = [
  { city: 'Москва',          fio: 'Тестов Тест Москвич',  prefix: '7700999111' },
  { city: 'Санкт-Петербург', fio: 'Тестов Тест Питерский', prefix: '7800999111' },
  { city: 'Свободный',       fio: 'Тестов Тест Свободный', prefix: '2807999111' },
  { city: 'Глазов',          fio: 'Тестов Тест Глазовский', prefix: '1837999111' },
]

for (const a of accounts) {
  console.log('━'.repeat(70))
  console.log(`Кабинет ${a.id} (${a.label})`)
  console.log('━'.repeat(70))

  let auth
  try {
    auth = await loginToRkoPartner(a)
  } catch (err) {
    console.log(`  ✗ login: ${err.message}`)
    continue
  }
  const dp = new ProxyAgent(a.proxyUrl)
  const xsrf = auth.cookies.find(c => c.startsWith('XSRF-TOKEN='))
    ?.split('=').slice(1).join('=')
  const xsrfDecoded = xsrf ? decodeURIComponent(xsrf) : ''

  for (const c of cases) {
    const inn = generateValidINN(c.prefix)
    const body = {
      products: [RKO_PRODUCT_ID],
      fio_rukovoditelia: c.fio,
      inn,
      elektronnaia_pocta: `test.${Date.now()}.${a.id}@example.com`,
      telefon: '+79009990000',
      gorod_obsluzivaniia: c.city,
    }
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
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      })
      const text = await r.text()
      let parsed = text.slice(0, 200)
      try {
        const j = JSON.parse(text)
        const msg = Array.isArray(j) ? j[0]?.message : (j.message || JSON.stringify(j).slice(0, 200))
        parsed = msg
      } catch {}
      console.log(`  ${c.city.padEnd(18)} ИНН ${inn} → ${r.status}: ${parsed}`)
    } catch (err) {
      console.log(`  ${c.city.padEnd(18)} ИНН ${inn} → ✗ ${err.message}`)
    }
  }
  console.log()
}

// Дополнительно: посмотрим список доступных продуктов в кабинете —
// есть ли там Альфа вообще или её убрали из списка
console.log('━'.repeat(70))
console.log('Список продуктов, доступных в каждом кабинете')
console.log('━'.repeat(70))
for (const a of accounts) {
  let auth
  try { auth = await loginToRkoPartner(a) } catch (err) {
    console.log(`  ${a.id}: ✗ login: ${err.message}`); continue
  }
  const dp = new ProxyAgent(a.proxyUrl)
  try {
    const r = await fetch('https://rko-partner.com/api/app/products', {
      dispatcher: dp,
      headers: {
        Accept: 'application/json',
        Cookie: auth.cookies.join('; '),
        'User-Agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(15000),
    })
    const text = await r.text()
    if (r.status >= 400) {
      console.log(`  ${a.id}: ${r.status}: ${text.slice(0, 200)}`)
      continue
    }
    let products = []
    try {
      const j = JSON.parse(text)
      products = j.data || j
    } catch { console.log(`  ${a.id}: невалидный JSON`); continue }
    const alfa = (Array.isArray(products) ? products : []).filter(p =>
      String(p?.bank?.name || p?.name || JSON.stringify(p)).toLowerCase().includes('альфа')
    )
    console.log(`  ${a.id}: всего продуктов ${Array.isArray(products) ? products.length : '?'}, Альфа-Банк: ${alfa.length}`)
    for (const p of alfa) {
      console.log(`     id=${p.id} name="${p.name}" bank="${p.bank?.name}" available=${p.available ?? p.is_active ?? '?'}`)
    }
  } catch (err) {
    console.log(`  ${a.id}: ✗ ${err.message}`)
  }
}
