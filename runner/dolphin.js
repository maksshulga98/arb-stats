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

async function local(path) {
  // Local API в свежих версиях Dolphin тоже принимает Bearer-токен — передаём,
  // если задан. На старых версиях лишний заголовок не мешает.
  const res = await fetch(LOCAL_BASE + path, {
    headers: TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {},
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!res.ok) {
    throw new Error(`Dolphin local ${path} → ${res.status}: ${text.slice(0, 300)}`)
  }
  return json
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

  const payload = {
    name,
    tags: ['auto-bank-link'],
    platform,
    browserType: 'anty',
    mainWebsite: '',
    useragent: { mode: 'manual', value: fp.useragent?.value || fp.userAgent || fp.useragent },
    webrtc:  { mode: 'altered' },
    canvas:  { mode: 'real' },
    webgl:   { mode: 'real' },
    webglInfo: fp.webgl ? { mode: 'manual', ...fp.webgl } : { mode: 'off' },
    timezone: { mode: 'auto' },   // берётся из IP прокси
    locale:   { mode: 'auto' },
    geolocation: { mode: 'auto' },
    cpu:    fp.cpu    ? { mode: 'manual', value: fp.cpu.value } : { mode: 'real' },
    memory: fp.memory ? { mode: 'manual', value: fp.memory.value } : { mode: 'real' },
    screen: fp.screen ? { mode: 'manual', resolution: fp.screen.resolution } : { mode: 'real' },
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
  const res = await local(`/browser_profiles/${id}/start?automation=1${headless ? '&headless=1' : ''}`)
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
