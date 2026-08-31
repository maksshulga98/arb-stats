// Клиент двух API Dolphin Anty.
//
//  • Remote (облако)  — https://dolphin-anty-api.com, Bearer-токен.
//    Создаёт/удаляет профили, привязывает прокси. Доступен откуда угодно.
//  • Local (десктоп)  — http://localhost:3001/v1.0.
//    Запускает/останавливает профиль и отдаёт wsEndpoint для Puppeteer.
//    Работает ТОЛЬКО на машине, где открыт Dolphin Anty.
//
// Док: https://docs.dolphin-anty-cdn.com  (+ Postman Remote API Docs)

const REMOTE_BASE = process.env.DOLPHIN_REMOTE_URL || 'https://dolphin-anty-api.com'
const LOCAL_BASE  = (process.env.DOLPHIN_LOCAL_URL || 'http://localhost:3001') + '/v1.0'
const TOKEN       = process.env.DOLPHIN_API_TOKEN || ''

async function remote(path, { method = 'GET', body } = {}) {
  const res = await fetch(REMOTE_BASE + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!res.ok) {
    throw new Error(`Dolphin remote ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  }
  return json
}

// Local API авторизуется ОДИН раз через login-with-token: кладёт remote JWT внутрь
// Local API, после чего /start и /stop не требуют заголовка (в OpenAPI у них
// security:[]). Это официальный порядок из спека Dolphin — Bearer в заголовке
// сам по себе Local API не авторизует (отдаёт "invalid session token").
let _localLoggedIn = false
async function localLogin() {
  const res = await fetch(LOCAL_BASE + '/auth/login-with-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.success) {
    throw new Error(`Dolphin login-with-token → ${res.status}: ${JSON.stringify(j).slice(0, 200)}. Открыт ли десктоп Dolphin и залогинен ли аккаунт токена?`)
  }
  _localLoggedIn = true
}

async function local(path, { method = 'GET', timeoutMs = 30000 } = {}) {
  if (!_localLoggedIn) await localLogin()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(LOCAL_BASE + path, { method, signal: ctrl.signal })
    const text = await res.text()
    let json
    try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
    if (!res.ok) throw new Error(`Dolphin local ${path} → ${res.status}: ${text.slice(0, 300)}`)
    return json
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Запросить готовый отпечаток у облака Dolphin (чтобы не собирать вручную).
 * Возвращает объект, который кладётся в payload создания профиля.
 */
export async function getFingerprint({ platform = 'windows', browserVersion = '126' } = {}) {
  const qs = new URLSearchParams({
    platform,
    browser_type: 'anty',
    browser_version: browserVersion,
    type: 'fingerprint',
  })
  return remote(`/fingerprints/fingerprint?${qs.toString()}`)
}

/**
 * Создать профиль с привязанным прокси.
 * proxy: { type:'http'|'socks5', host, port, login, password }
 * Возвращает id созданного профиля.
 *
 * ВНИМАНИЕ: набор полей fingerprint зависит от версии Dolphin. Ниже — рабочий
 * минимум; при несовпадении API вернёт 4xx с подсказкой, какого поля не хватает.
 */
export async function createProfile({ name, proxy, platform = 'windows', browserVersion = '126' }) {
  const fp = await getFingerprint({ platform, browserVersion })

  // Маппинг под реальную схему создания профиля (OpenAPI Dolphin):
  //   cpu/memory — { mode:'manual', value:<число> }; screen — resolution 'WxH';
  //   webglInfo — { mode:'manual', vendor, renderer }. fingerprint отдаёт userAgent,
  //   hardwareConcurrency (ядра), deviceMemory (ГБ), webgl.unmaskedVendor/Renderer.
  const uaValue = fp.userAgent || fp.useragent?.value || ''
  const screenRes = fp.screen?.width ? `${fp.screen.width}x${fp.screen.height}` : '1920x1080'

  const payload = {
    name,
    tags: ['auto-bank-link'],
    platform,
    browserType: 'anty',
    mainWebsite: '',
    // Отключаем автозаполнение/сохранение адресов и паролей Chrome — попапы
    // «Сохранить адрес?» это UI браузера, автоматизацией их не закрыть.
    args: [
      '--disable-features=AutofillEnableAccountWalletStorage,AutofillServerCommunication',
      '--disable-save-password-bubble',
    ],
    useragent: { mode: 'manual', value: uaValue },
    webrtc:  { mode: 'altered', ipAddress: '' },
    canvas:  { mode: 'real' },
    webgl:   { mode: 'real' },
    webglInfo: {
      mode: 'manual',
      vendor: fp.webgl?.unmaskedVendor || 'Google Inc. (NVIDIA)',
      renderer: fp.webgl?.unmaskedRenderer || 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    },
    timezone: { mode: 'auto' },   // берётся из IP прокси
    locale:   { mode: 'auto' },
    geolocation: { mode: 'auto' },
    cpu:    { mode: 'manual', value: fp.hardwareConcurrency || 8 },
    memory: { mode: 'manual', value: fp.deviceMemory || 8 },
    screen: { mode: 'manual', resolution: screenRes },
    proxy: {
      type: proxy.type || 'http',
      host: proxy.host,
      port: Number(proxy.port),
      login: proxy.login || '',
      password: proxy.password || '',
    },
  }

  const res = await remote('/browser_profiles', { method: 'POST', body: payload })
  const id = res?.browserProfileId || res?.data?.id || res?.id
  if (!id) throw new Error('Dolphin: не удалось получить id созданного профиля: ' + JSON.stringify(res).slice(0, 300))
  return id
}

/**
 * Найти профили пула по префиксу имени.
 *
 * Пул нужен, чтобы НЕ создавать профиль на каждую заявку: у Dolphin есть
 * месячный лимит именно на создание профилей, и при 150-200 заявках в месяц
 * мы в него упирались. Постоянные профили создаются один раз, а дальше им
 * просто подменяется прокси.
 */
export async function findPoolProfiles(prefix) {
  const found = []
  for (let page = 1; page <= 10; page++) {
    const res = await remote(`/browser_profiles?limit=50&page=${page}`)
    const rows = res?.data || []
    for (const r of rows) if (String(r.name || '').startsWith(prefix)) found.push({ id: r.id, name: r.name })
    if (rows.length < 50) break
  }
  return found.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
}

/** Подменить прокси у существующего профиля (вместо создания нового). */
export async function setProfileProxy(id, proxy) {
  return remote(`/browser_profiles/${id}`, {
    method: 'PATCH',
    body: {
      proxy: {
        type: proxy.type || 'http',
        host: proxy.host,
        port: Number(proxy.port),
        login: proxy.login || '',
        password: proxy.password || '',
      },
    },
  })
}

/** Удалить профиль (чистим после каждой заявки). */
export async function deleteProfile(id) {
  const qs = new URLSearchParams()
  qs.append('ids[]', String(id))
  return remote(`/browser_profiles?${qs.toString()}`, { method: 'DELETE' })
}

/**
 * Запустить профиль в режиме автоматизации.
 * Возвращает { port, wsEndpoint } для puppeteer.connect.
 */
export async function startProfile(id, { headless = true } = {}) {
  // Старт может занять до ~2 мин (скачивание data-dir + запуск Chromium) → большой таймаут.
  const res = await local(`/browser_profiles/${id}/start?automation=1${headless ? '&headless=1' : ''}`, { timeoutMs: 150000 })
  const auto = res.automation || res
  const port = auto.port
  const wsEndpoint = auto.wsEndpoint || auto.ws || ''
  if (!port) throw new Error('Dolphin local: не пришёл port автоматизации: ' + JSON.stringify(res).slice(0, 300))
  // wsEndpoint у Dolphin — это путь (/devtools/browser/xxxx); собираем полный ws-URL
  const browserWSEndpoint = wsEndpoint.startsWith('ws')
    ? wsEndpoint
    : `ws://127.0.0.1:${port}${wsEndpoint}`
  return { port, wsEndpoint, browserWSEndpoint }
}

/** Остановить профиль. */
export async function stopProfile(id) {
  try { return await local(`/browser_profiles/${id}/stop`) }
  catch (e) { console.warn('stopProfile warn:', e.message); return null }
}
