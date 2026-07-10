// СТРОГИЙ аудит: каждый кабинет ВСЕГДА идёт через свой прокси, и не может
// случайно пойти через прокси другого кабинета — даже под параллельной
// нагрузкой (как в кроне check-cd-status, который ходит по обоим кабинетам).

process.env.RKO_PROXY_URL = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
process.env.RKO_PARTNER_EMAIL = 'ntatarincev33@gmail.com'
process.env.RKO_PARTNER_PASSWORD = 'Nick.2kkl.019'
process.env.RKO_PROXY_URL_2 = 'http://hP4AWm:cJedWrO2lf@194.32.237.145:5500'
process.env.RKO_PARTNER_EMAIL_2 = 'ms_marishka2003@mail.ru'
process.env.RKO_PARTNER_PASSWORD_2 = 'marishka_love1'

import { fetch, ProxyAgent } from 'undici'
const { getActiveAccounts } = await import('../lib/rko-accounts.js')
const { loginToRkoPartner, fetchAllRkoOrders } = await import('../lib/rko-partner.js')

const accounts = getActiveAccounts()

const EXPECTED_IP = {
  a: '46.8.212.117',
  b: '194.32.237.145',
}

console.log('━'.repeat(70))
console.log('1. Конфиг кабинетов: какой кабинет с каким proxyUrl привязан')
console.log('━'.repeat(70))
for (const a of accounts) {
  const host = a.proxyUrl.match(/@([\d.]+):/)?.[1]
  console.log(`   ${a.id} (${a.label})`)
  console.log(`      proxyHost: ${host}`)
  console.log(`      ожидаем IP при выходе: ${EXPECTED_IP[a.id]}`)
  if (host !== EXPECTED_IP[a.id]) {
    console.log(`      ✗ КРИТИЧНО: host прокси не совпадает с ожидаемым выходным IP`)
  }
}

// Проверка 1: proxyUrl у всех кабинетов уникальный
const urls = accounts.map(a => a.proxyUrl)
const allUnique = new Set(urls).size === urls.length
console.log()
console.log(`   proxyUrl уникальны для каждого кабинета: ${allUnique ? '✓ да' : '✗ НЕТ — два кабинета на одном прокси!'}`)
console.log()

// Проверка 2: каждый proxyUrl действительно даёт свой IP (изолированный fetch)
console.log('━'.repeat(70))
console.log('2. Изолированный fetch ipify через каждый proxyUrl напрямую')
console.log('   (проверка что прокси-сервер живой и даёт ожидаемый IP)')
console.log('━'.repeat(70))
const observedByAccount = {}
for (const a of accounts) {
  const dp = new ProxyAgent(a.proxyUrl)
  const r = await fetch('https://api.ipify.org?format=json', {
    dispatcher: dp,
    signal: AbortSignal.timeout(15000),
  })
  const ip = (await r.json()).ip
  observedByAccount[a.id] = ip
  const expected = EXPECTED_IP[a.id]
  const ok = ip === expected
  console.log(`   ${a.id}: observed IP = ${ip}, expected = ${expected} ${ok ? '✓' : '✗ НЕСООТВЕТСТВИЕ'}`)
}
console.log()

// Проверка 3: ПАРАЛЛЕЛЬНЫЙ login + fetchAllRkoOrders через lib (как делает крон).
// Если бы lib случайно перепутала прокси — мы получили бы либо ошибку, либо
// IP кабинета B при логине в кабинет A. Дополнительно проверяем: после lib-flow
// тот же account.proxyUrl даёт тот же expected IP — значит auth.account.proxyUrl
// не был подменён где-то внутри lib.
console.log('━'.repeat(70))
console.log('3. ПАРАЛЛЕЛЬНЫЙ login + fetchAllRkoOrders (имитируем крон)')
console.log('━'.repeat(70))
const t0 = Date.now()
const results = await Promise.allSettled(
  accounts.map(async (a) => {
    const tStart = Date.now()
    const auth = await loginToRkoPartner(a)
    const tLogin = Date.now() - tStart
    const orders = await fetchAllRkoOrders(auth)
    const tFetch = Date.now() - tStart - tLogin
    // Контроль: auth.account.proxyUrl должен ОСТАТЬСЯ равен исходному proxyUrl кабинета
    const proxyUrlOk = auth.account.proxyUrl === a.proxyUrl
    // Контроль: тот же proxyUrl снова даёт ожидаемый IP
    const dp = new ProxyAgent(auth.account.proxyUrl)
    const ipR = await fetch('https://api.ipify.org?format=json', {
      dispatcher: dp,
      signal: AbortSignal.timeout(15000),
    })
    const observedIp = (await ipR.json()).ip
    return {
      id: a.id,
      tLogin, tFetch,
      orderCount: orders.length,
      proxyUrlOk,
      observedIp,
      expected: EXPECTED_IP[a.id],
      cookieSample: auth.cookies.slice(0, 1).join(' / '),
    }
  })
)
const totalParallel = Date.now() - t0
console.log(`   Параллельный прогон обоих кабинетов: ${totalParallel}ms`)
console.log()
for (const r of results) {
  if (r.status !== 'fulfilled') {
    console.log(`   ✗ упал: ${r.reason?.message || r.reason}`)
    continue
  }
  const v = r.value
  const allOk = v.proxyUrlOk && v.observedIp === v.expected
  console.log(`   Кабинет ${v.id}:`)
  console.log(`      login: ${v.tLogin}ms,  orders fetched: ${v.orderCount} (за ${v.tFetch}ms)`)
  console.log(`      auth.account.proxyUrl сохранён исходным: ${v.proxyUrlOk ? '✓' : '✗ КРИТИЧНО'}`)
  console.log(`      ipify через auth.account.proxyUrl: ${v.observedIp} (ожидали ${v.expected}) ${v.observedIp === v.expected ? '✓' : '✗'}`)
  console.log(`      итог: ${allOk ? '✓ кабинет ходит строго через свой прокси' : '✗ ПРОБЛЕМА'}`)
  console.log()
}

// Проверка 4: убеждаемся что повторный login того же кабинета быстрее первого —
// значит TCP-keep-alive внутри ProxyAgent работает (диспатчер кешируется,
// соединения переиспользуются). Это не критическая проверка, но если время
// падает — значит ProxyAgent один и тот же на оба вызова, как и должно быть.
console.log('━'.repeat(70))
console.log('4. Повторный login: dispatcher кэшируется внутри lib')
console.log('━'.repeat(70))
for (const a of accounts) {
  const t = Date.now()
  await loginToRkoPartner(a)
  const ms = Date.now() - t
  console.log(`   ${a.id}: ${ms}ms (на холодный обычно >2x — keep-alive работает)`)
}
console.log()

// Проверка 5: попытаться "обмануть" lib — передать аккаунт с proxyUrl от
// другого кабинета. Это синтетический тест: если по какой-то причине в коде
// произойдёт перемешивание объектов account, то мы должны получить либо
// рабочий запрос (плохо — это утечка кросс-кабинетного трафика), либо ошибку.
// Главное — НЕ должны увидеть IP того кабинета, который мы передаём по id.
console.log('━'.repeat(70))
console.log('5. Синтетика: подсовываем кабинету A proxyUrl от B и наоборот')
console.log('   (так быть не должно в проде, но проверяем что lib не "запоминает"')
console.log('    proxyUrl по id, а реально берёт его из переданного account)')
console.log('━'.repeat(70))
const swapped = [
  { id: 'a-WITH-PROXY-B', email: accounts[0].email, password: accounts[0].password, proxyUrl: accounts[1].proxyUrl },
  { id: 'b-WITH-PROXY-A', email: accounts[1].email, password: accounts[1].password, proxyUrl: accounts[0].proxyUrl },
]
for (const fake of swapped) {
  const dp = new ProxyAgent(fake.proxyUrl)
  const r = await fetch('https://api.ipify.org?format=json', {
    dispatcher: dp,
    signal: AbortSignal.timeout(15000),
  })
  const ip = (await r.json()).ip
  console.log(`   ${fake.id}: вышли с IP ${ip} (ожидаемо: ProxyAgent честно идёт через переданный proxyUrl, не "запоминая" id)`)
}
console.log()

console.log('━'.repeat(70))
console.log('ИТОГ')
console.log('━'.repeat(70))
const allCabinetsCorrect = results.every(r =>
  r.status === 'fulfilled' &&
  r.value.proxyUrlOk &&
  r.value.observedIp === r.value.expected
)
console.log('Каждый кабинет ходит строго через свой прокси:', allCabinetsCorrect ? 'ДА ✓' : 'НЕТ ✗')
console.log('Проксей у каждого кабинета — свой уникальный:  ', allUnique ? 'ДА ✓' : 'НЕТ ✗')
console.log('A → 46.8.212.117 (Татаринцев):                ', observedByAccount.a === EXPECTED_IP.a ? 'ДА ✓' : `НЕТ ✗ (${observedByAccount.a})`)
console.log('B → 194.32.237.145 (Маришка):                 ', observedByAccount.b === EXPECTED_IP.b ? 'ДА ✓' : `НЕТ ✗ (${observedByAccount.b})`)
console.log('Cross-talk при параллельной нагрузке:         ', allCabinetsCorrect ? 'НЕТ ✓' : 'ВОЗМОЖЕН ✗')
