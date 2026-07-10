// E2E через новый lib/rko-partner.js — проверяем что рефакторинг работает.
// Не создаём заявку (одну тестовую уже завели), только логинимся + проверяем
// что fetchAllRkoOrders видит её в списке.

// Прокси и креды передаём через env прямо здесь, не трогая .env.local
process.env.RKO_PROXY_URL = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
process.env.RKO_PARTNER_EMAIL = 'ntatarincev33@gmail.com'
process.env.RKO_PARTNER_PASSWORD = 'Nick.2kkl.019'

const { loginToRkoPartner, fetchAllRkoOrders } = await import('../lib/rko-partner.js')

console.log('1. loginToRkoPartner() ...')
const t0 = Date.now()
const auth = await loginToRkoPartner()
console.log(`   ✓ залогинились, ${auth.cookies.length} cookies (${Date.now() - t0}ms)`)

console.log('\n2. fetchAllRkoOrders() ...')
const t1 = Date.now()
const orders = await fetchAllRkoOrders(auth, { perPage: 50, maxPages: 5 })
console.log(`   ✓ ${orders.length} заявок получено (${Date.now() - t1}ms)`)

if (orders.length === 0) {
  console.log('\n⚠ В кабинете 0 заявок — это странно, ведь тестовую мы только что создавали (#339186)')
} else {
  console.log('\nПервые 3 заявки:')
  for (const o of orders.slice(0, 3)) {
    console.log(`   #${o.id}  state=${o.state}  fio=${o.fio}  inn=${o.inn}  created=${o.created_at}`)
  }
  const found = orders.find(o => o.id === 339186)
  if (found) {
    console.log(`\n✓ Тестовая заявка #339186 видна в списке: state=${found.state}`)
  }
}
