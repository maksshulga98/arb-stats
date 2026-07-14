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
  DOLPHIN_PROXY_TYPE = 'http',
  DOLPHIN_PROXY_HOST,
  DOLPHIN_PROXY_PORT,
  DOLPHIN_PROXY_LOGIN,
  DOLPHIN_PROXY_PASSWORD,
  PROXY_ROTATION_URL,          // опц.: GET по этому URL меняет мобильный IP
  RUNNER_ID = 'runner-local',
  POLL_INTERVAL_MS = '4000',
  HEADLESS = '1',
} = process.env

if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Нет NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env')
  process.exit(1)
}
if (!DOLPHIN_PROXY_HOST || !DOLPHIN_PROXY_PORT) {
  console.error('Нет данных прокси (DOLPHIN_PROXY_HOST/PORT) в .env')
  process.exit(1)
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const proxy = {
  type: DOLPHIN_PROXY_TYPE,
  host: DOLPHIN_PROXY_HOST,
  port: DOLPHIN_PROXY_PORT,
  login: DOLPHIN_PROXY_LOGIN,
  password: DOLPHIN_PROXY_PASSWORD,
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function rotateProxyIfConfigured() {
  if (!PROXY_ROTATION_URL) return
  try {
    await fetch(PROXY_ROTATION_URL)
    // мобильному прокси нужно время «переключить» IP
    await sleep(3000)
    console.log('  · IP прокси ротирован')
  } catch (e) {
    console.warn('  · не удалось ротировать IP:', e.message)
  }
}

async function finishJob(id, patch) {
  const { error } = await supabase
    .from('bank_link_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('  · не смог записать результат задачи:', error.message)
}

async function processJob(job) {
  console.log(`\n▶ Задача ${job.id} — ${job.bank} — ${job.organization_name}`)
  let profileId = null
  try {
    await rotateProxyIfConfigured()

    profileId = await createProfile({ name: `bank-${job.bank}-${job.id.slice(0, 8)}`, proxy })
    console.log('  · профиль создан:', profileId)

    const { browserWSEndpoint } = await startProfile(profileId, { headless: HEADLESS === '1' })
    console.log('  · профиль запущен, подключаю Puppeteer')

    const link = await runApplication(browserWSEndpoint, job)
    console.log('  ✓ ссылка получена:', link)

    await finishJob(job.id, { status: 'success', result_link: link, error_message: null })
  } catch (e) {
    console.error('  ✗ ошибка:', e.message)
    await finishJob(job.id, { status: 'error', error_message: e.message })
  } finally {
    if (profileId) {
      await stopProfile(profileId)
      try { await deleteProfile(profileId); console.log('  · профиль удалён') }
      catch (e) { console.warn('  · не удалил профиль:', e.message) }
    }
  }
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
