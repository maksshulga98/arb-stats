// Раннер авто-оформления банковских ссылок.
//
// Крутится на машине, где запущен Dolphin Anty (сейчас — Mac, позже — VPS,
// код один и тот же, всё через .env). Цикл:
//   1. Атомарно забрать задачу из очереди (RPC claim_bank_link_job).
//   2. (опц.) Ротировать мобильный IP.
//   3. Создать профиль Dolphin с прокси → запустить (Local API) → Puppeteer.
//   4. Заполнить форму, отправить, вытащить «красивую» ссылку.
//   5. Записать результат в задачу. Остановить и удалить профиль.
//
// Запуск: node worker.js   (см. runner/README.md)

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { createProfile, deleteProfile, startProfile, stopProfile } from './dolphin.js'
import { runApplication } from './automation.js'

const {
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  DOLPHIN_PROXIES,             // пул прокси (по одному в строке), см. parseProxies
  DOLPHIN_PROXY_TYPE = 'http',
  DOLPHIN_PROXY_HOST,          // одиночный прокси — запасной вариант, если пула нет
  DOLPHIN_PROXY_PORT,
  DOLPHIN_PROXY_LOGIN,
  DOLPHIN_PROXY_PASSWORD,
  PROXY_ROTATION_URL,          // опц.: GET по этому URL меняет мобильный IP
  // Провайдер разрешает менять IP не чаще, чем раз в N мс (у proxys.world — 2 мин).
  ROTATE_MIN_INTERVAL_MS = '120000',
  RUNNER_ID = 'runner-local',
  POLL_INTERVAL_MS = '4000',
  HEADLESS = '1',
} = process.env

/**
 * Разбор списка прокси. Поддерживаются привычные форматы (по одному в строке
 * или через запятую), тип по умолчанию http:
 *   host:port:login:password
 *   login:password@host:port
 *   http://login:password@host:port     (или socks5://…)
 */
function parseProxies(raw) {
  if (!raw) return []
  return raw
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(line => {
      let type = DOLPHIN_PROXY_TYPE
      const scheme = line.match(/^(https?|socks5):\/\//i)
      if (scheme) { type = scheme[1].toLowerCase().replace('https', 'http'); line = line.replace(/^\w+:\/\//, '') }

      if (line.includes('@')) {                       // login:pass@host:port
        const [cred, addr] = line.split('@')
        const [login, password] = cred.split(':')
        const [host, port] = addr.split(':')
        return { type, host, port, login, password }
      }
      const p = line.split(':')                       // host:port:login:pass
      if (p.length >= 4) return { type, host: p[0], port: p[1], login: p[2], password: p.slice(3).join(':') }
      if (p.length === 2) return { type, host: p[0], port: p[1], login: '', password: '' }
      return null
    })
    .filter(p => p && p.host && p.port)
}

// Пул прокси: заявки распределяются по нему по кругу (1-я → 1-й прокси,
// 2-я → 2-й и т.д.), чтобы нагрузка и IP-адреса не концентрировались на одном.
const PROXY_POOL = DOLPHIN_PROXIES
  ? parseProxies(DOLPHIN_PROXIES)
  : (DOLPHIN_PROXY_HOST ? [{
      type: DOLPHIN_PROXY_TYPE, host: DOLPHIN_PROXY_HOST, port: DOLPHIN_PROXY_PORT,
      login: DOLPHIN_PROXY_LOGIN, password: DOLPHIN_PROXY_PASSWORD,
    }] : [])

if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Нет NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env')
  process.exit(1)
}
if (PROXY_POOL.length === 0) {
  console.error('Не задан ни один прокси: заполните DOLPHIN_PROXIES (список) или DOLPHIN_PROXY_HOST/PORT')
  process.exit(1)
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Сколько прокси из пула пробовать на одну заявку, если предыдущий не отвечает
const MAX_PROXY_TRIES = 3

// Когда последний раз реально сменили IP (в пределах жизни процесса)
let lastRotateAt = 0

/**
 * Смена мобильного IP перед заявкой.
 *
 * ВАЖНО: ротация — необязательный шаг. Провайдер разрешает менять IP не чаще
 * раза в 2 минуты, а менеджеры могут оформить две заявки подряд за минуту.
 * Поэтому любая неудача (рано, ошибка сети, ответ провайдера с отказом)
 * НЕ отменяет заявку — несколько заявок с одного IP допустимы.
 */
async function rotateProxyIfConfigured() {
  if (!PROXY_ROTATION_URL) return

  const minGap = Number(ROTATE_MIN_INTERVAL_MS) || 120000
  const since = Date.now() - lastRotateAt
  if (lastRotateAt && since < minGap) {
    console.log(`  · пропускаю смену IP: прошло ${Math.round(since / 1000)}с из ${Math.round(minGap / 1000)}с — заявка идёт на текущем IP`)
    return
  }

  try {
    const res = await fetch(PROXY_ROTATION_URL, { signal: AbortSignal.timeout(20000) })
    const text = (await res.text().catch(() => '')).slice(0, 200)
    // Провайдер отвечает 200 и при отказе («слишком часто»), поэтому смотрим тело
    const ok = res.ok && !/false|error|often|wait|limit/i.test(text)
    if (ok) {
      lastRotateAt = Date.now()
      await sleep(3000)   // мобильному прокси нужно время переключить IP
      console.log('  · IP прокси сменён')
    } else {
      console.log(`  · IP сменить не вышло (${res.status}: ${text || 'без тела'}) — продолжаю на текущем`)
    }
  } catch (e) {
    console.log(`  · IP сменить не вышло (${e.message}) — продолжаю на текущем`)
  }
}

async function finishJob(id, patch) {
  const { error } = await supabase
    .from('bank_link_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('  · не смог записать результат задачи:', error.message)
}

// Порядковый номер заявки — по нему выбираем прокси из пула по кругу.
// Считаем в базе, а не в памяти: тогда очередь не сбивается при перезапуске
// сервиса и работает одинаково, даже если раннеров несколько.
async function proxyStartIndex() {
  const { count, error } = await supabase
    .from('bank_link_jobs').select('*', { count: 'exact', head: true })
  if (error) return 0
  return (count || 0) % PROXY_POOL.length
}

const isProxyIssue = (msg) => /E_PROXY_CHECK_ERROR|initConnectionError|proxy|ERR_PROXY|tunnel|timed out/i.test(msg)

/** Одна попытка оформления на конкретном прокси. Возвращает ссылку. */
async function attemptWithProxy(job, proxy) {
  let profileId = null
  try {
    profileId = await createProfile({ name: `bank-${job.bank}-${job.id.slice(0, 8)}`, proxy })
    console.log('  · профиль создан:', profileId)

    const { browserWSEndpoint } = await startProfile(profileId, { headless: HEADLESS === '1' })
    console.log('  · профиль запущен, подключаю Puppeteer')

    const link = await runApplication(browserWSEndpoint, job)
    return link
  } finally {
    if (profileId) {
      await stopProfile(profileId).catch(() => {})
      try { await deleteProfile(profileId); console.log('  · профиль удалён') }
      catch (e) { console.warn('  · не удалил профиль:', e.message) }
    }
  }
}

async function processJob(job) {
  console.log(`\n▶ Задача ${job.id} — ${job.bank} — ${job.organization_name}`)

  // Ротация IP нужна только когда прокси один. Когда их пул — каждая заявка
  // и так уходит со своего адреса.
  if (PROXY_POOL.length === 1) await rotateProxyIfConfigured().catch(() => {})

  const start = await proxyStartIndex()
  const tries = Math.min(MAX_PROXY_TRIES, PROXY_POOL.length)
  let lastError = null

  for (let i = 0; i < tries; i++) {
    const proxy = PROXY_POOL[(start + i) % PROXY_POOL.length]
    const label = `${proxy.host}:${proxy.port}`
    console.log(`  · прокси ${(start + i) % PROXY_POOL.length + 1}/${PROXY_POOL.length} — ${label}`)
    try {
      const link = await attemptWithProxy(job, proxy)
      console.log('  ✓ ссылка получена:', link)
      await finishJob(job.id, { status: 'success', result_link: link, error_message: null })
      return
    } catch (e) {
      lastError = e
      console.error(`  ✗ ошибка на ${label}:`, e.message)
      // Не отвечает прокси — пробуем следующий из пула. Любая другая ошибка
      // (например, форма изменилась) с другим прокси не исправится — выходим.
      if (!isProxyIssue(e.message) || i === tries - 1) break
      console.log('  ↻ пробую следующий прокси из пула')
    }
  }

  const human = isProxyIssue(lastError?.message || '')
    ? `Не удалось подключиться через прокси (проверено ${tries} шт.) — попробуйте позже или сообщите администратору.`
    : (lastError?.message || 'Неизвестная ошибка')
  await finishJob(job.id, { status: 'error', error_message: human })
}

async function loop() {
  console.log(`Раннер "${RUNNER_ID}" запущен. Опрос очереди каждые ${POLL_INTERVAL_MS}мс.`)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const { data, error } = await supabase.rpc('claim_bank_link_job', { p_runner: RUNNER_ID })
      if (error) { console.error('claim error:', error.message); await sleep(Number(POLL_INTERVAL_MS)); continue }
      const job = Array.isArray(data) ? data[0] : data
      if (!job) { await sleep(Number(POLL_INTERVAL_MS)); continue }
      await processJob(job)
    } catch (e) {
      console.error('loop error:', e.message)
      await sleep(Number(POLL_INTERVAL_MS))
    }
  }
}

loop()
