// Проверяет что HTTP-прокси работает: делает GET на ipify через прокси
// и сравнивает с GET без прокси. Если IP-адреса разные и через прокси
// возвращается 46.8.212.117 — прокси живой и готов к использованию.
//
// Запуск: node scripts/test-proxy.mjs

import { ProxyAgent, fetch } from 'undici'

const PROXY_URL = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
const EXPECTED_IP = '46.8.212.117'

async function getIp(label, dispatcher) {
  const t0 = Date.now()
  try {
    const res = await fetch('https://api.ipify.org?format=json', {
      dispatcher,
      signal: AbortSignal.timeout(15000),
    })
    const ms = Date.now() - t0
    if (!res.ok) {
      console.log(`  ${label}: HTTP ${res.status} (${ms}ms)`)
      return null
    }
    const json = await res.json()
    console.log(`  ${label}: ${json.ip} (${ms}ms)`)
    return json.ip
  } catch (err) {
    const ms = Date.now() - t0
    console.log(`  ${label}: FAIL "${err.message}" (${ms}ms)`)
    return null
  }
}

console.log('Проверка прокси:')
console.log(`  URL: ${PROXY_URL.replace(/:[^:@]+@/, ':***@')}`)
console.log()

const directIp = await getIp('Без прокси    ', undefined)

const proxy = new ProxyAgent(PROXY_URL)
const proxyIp = await getIp('Через прокси  ', proxy)

console.log()
if (proxyIp === EXPECTED_IP) {
  console.log(`✓ ПРОКСИ РАБОТАЕТ. Внешний IP через прокси = ${proxyIp}`)
} else if (proxyIp && proxyIp !== directIp) {
  console.log(`⚠ Прокси работает, но IP ${proxyIp} ≠ ожидаемому ${EXPECTED_IP}`)
  console.log('  (может быть прокси-провайдер за NAT — проверь что трафик пойдёт куда нужно)')
} else if (proxyIp === directIp) {
  console.log(`✗ Прокси НЕ перенаправляет: IP такой же как без прокси (${proxyIp})`)
} else {
  console.log('✗ Не удалось получить IP через прокси — прокси отвалился или креды неверные')
}

// Проверим что через этот же прокси открывается сам rko-partner.com
console.log('\nПроверяю доступ к rko-partner.com через прокси:')
const t0 = Date.now()
try {
  const res = await fetch('https://rko-partner.com/login', {
    dispatcher: proxy,
    headers: { Accept: 'text/html' },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  })
  const ms = Date.now() - t0
  console.log(`  HTTP ${res.status} (${ms}ms), content-type=${res.headers.get('content-type')}`)
  const html = await res.text()
  const hasCsrf = /name="csrf-token"/.test(html)
  console.log(`  csrf-token meta присутствует: ${hasCsrf}`)
  console.log(`  размер HTML: ${html.length} байт`)
} catch (err) {
  const ms = Date.now() - t0
  console.log(`  FAIL: "${err.message}" (${ms}ms)`)
}
