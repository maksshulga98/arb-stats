// Сравниваем: что лежит в свежем заказе 340156 (созданном через web UI) и
// что мы отправляем через наш lib. Возможно у UI другой endpoint / поля.

process.env.RKO_PROXY_URL = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
process.env.RKO_PARTNER_EMAIL = 'ntatarincev33@gmail.com'
process.env.RKO_PARTNER_PASSWORD = 'Nick.2kkl.019'
process.env.RKO_PROXY_URL_2 = 'http://hP4AWm:cJedWrO2lf@194.32.237.145:5500'
process.env.RKO_PARTNER_EMAIL_2 = 'ms_marishka2003@mail.ru'
process.env.RKO_PARTNER_PASSWORD_2 = 'marishka_love1'

import { fetch, ProxyAgent } from 'undici'
const { getActiveAccounts } = await import('../lib/rko-accounts.js')
const { loginToRkoPartner } = await import('../lib/rko-partner.js')

// Кабинет B (Маришка) — там пользователь создал 340156
const b = getActiveAccounts().find(a => a.id === 'b')
const auth = await loginToRkoPartner(b)
const dp = new ProxyAgent(b.proxyUrl)
const xsrf = auth.cookies.find(c => c.startsWith('XSRF-TOKEN='))
  ?.split('=').slice(1).join('=')
const xsrfDecoded = xsrf ? decodeURIComponent(xsrf) : ''
const headers = {
  Accept: 'application/json',
  'X-XSRF-TOKEN': xsrfDecoded,
  Cookie: auth.cookies.join('; '),
  'User-Agent': 'Mozilla/5.0',
}

console.log('━'.repeat(70))
console.log('1. Тянем самый свежий заказ из кабинета B (должен быть 340156)')
console.log('━'.repeat(70))
const r = await fetch('https://rko-partner.com/api/app/orders?page=1&perPage=1', {
  dispatcher: dp, headers, signal: AbortSignal.timeout(15000),
})
const j = await r.json()
const fresh = (j.data || [])[0]
if (!fresh) { console.log('  Нет заказов'); process.exit(1) }
console.log(`\nORDER #${fresh.id} state=${fresh.state} created=${fresh.created_at}`)
console.log('\nПОЛНАЯ СТРУКТУРА:')
console.log(JSON.stringify(fresh, null, 2))
