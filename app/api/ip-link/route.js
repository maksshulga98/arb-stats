import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const RKO_BASE = 'https://rko-partner.com'

function getSupabaseClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !serviceKey || !anonKey) {
    throw new Error('Missing Supabase env vars')
  }

  return {
    supabaseAdmin: createClient(url, serviceKey),
    supabaseAnon: createClient(url, anonKey),
  }
}

async function authenticateUser(request) {
  const { supabaseAdmin, supabaseAnon } = getSupabaseClients()
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { error: 'Unauthorized', status: 401 }

  const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)
  if (authError || !user) return { error: 'Unauthorized', status: 401 }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, name, role, team')
    .eq('id', user.id)
    .single()

  if (!profile || !['manager', 'teamlead', 'admin'].includes(profile.role)) {
    return { error: 'Доступ запрещён', status: 403 }
  }

  return { user, profile, supabaseAdmin }
}

function validateINN12(inn) {
  if (!/^\d{12}$/.test(inn)) return false
  const d = inn.split('').map(Number)
  const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const check1 = w1.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  const check2 = w2.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  return d[10] === check1 && d[11] === check2
}

function extractCookies(response) {
  const setCookies = response.headers.getSetCookie?.() || []
  // getSetCookie may not be available in all runtimes, fallback
  if (setCookies.length === 0) {
    const raw = response.headers.get('set-cookie')
    if (raw) return raw.split(/,(?=\s*\w+=)/).map(c => c.split(';')[0].trim())
    return []
  }
  return setCookies.map(c => c.split(';')[0].trim())
}

function mergeCookies(existing, newCookies) {
  const map = {}
  for (const c of [...existing, ...newCookies]) {
    const [name] = c.split('=')
    map[name.trim()] = c
  }
  return Object.values(map)
}

async function loginToRkoPartner() {
  const email = process.env.RKO_PARTNER_EMAIL
  const password = process.env.RKO_PARTNER_PASSWORD

  if (!email || !password) {
    throw new Error('RKO_PARTNER_EMAIL or RKO_PARTNER_PASSWORD not set')
  }

  // Step 1: GET the login page to obtain CSRF token and session cookie
  const pageRes = await fetch(`${RKO_BASE}/login`, {
    headers: { Accept: 'text/html' },
    redirect: 'manual',
  })
  let cookies = extractCookies(pageRes)
  const pageHtml = await pageRes.text()

  // Extract CSRF token from meta tag or XSRF-TOKEN cookie
  let csrfToken = ''
  const metaMatch = pageHtml.match(/name="csrf-token"\s+content="([^"]+)"/)
  if (metaMatch) {
    csrfToken = metaMatch[1]
  }

  // Also try XSRF-TOKEN cookie (URL-decoded)
  const xsrfCookie = cookies.find(c => c.startsWith('XSRF-TOKEN='))
  const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.split('=').slice(1).join('=')) : ''

  // Step 2: POST /login with CSRF token
  const loginRes = await fetch(`${RKO_BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-XSRF-TOKEN': xsrfToken,
      'X-CSRF-TOKEN': csrfToken,
      Cookie: cookies.join('; '),
    },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  })

  const loginCookies = extractCookies(loginRes)
  cookies = mergeCookies(cookies, loginCookies)

  // Login may return 200, 302, or 422 (validation error)
  if (loginRes.status === 422) {
    const err = await loginRes.text()
    throw new Error(`RKO login validation error: ${err}`)
  }

  // After login, we need fresh XSRF token for API calls
  // Make a simple GET to refresh cookies
  const refreshRes = await fetch(`${RKO_BASE}/app/orders`, {
    headers: { Accept: 'text/html', Cookie: cookies.join('; ') },
    redirect: 'manual',
  })
  const refreshCookies = extractCookies(refreshRes)
  cookies = mergeCookies(cookies, refreshCookies)

  return { type: 'cookie', cookies }
}

function rkoHeaders(auth) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  const cookieStr = auth.cookies.join('; ')
  headers['Cookie'] = cookieStr

  // Extract XSRF-TOKEN for X-XSRF-TOKEN header (Laravel requires this)
  const xsrf = auth.cookies.find(c => c.startsWith('XSRF-TOKEN='))
  if (xsrf) {
    headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf.split('=').slice(1).join('='))
  }
  return headers
}

// Product ID for "Регистрация бизнеса ИП + РКО | Реферальная ссылка [РЕФ]" (Альфа-Банк)
// Obtained by intercepting the real request on rko-partner.com
const RKO_PRODUCT_ID = 520

async function createRkoApplication(auth, { fullName, inn, phone, email, city }) {
  // Create order directly via POST /api/app/orders
  // Field names must be transliterated Russian as expected by the API
  const orderRes = await fetch(`${RKO_BASE}/api/app/orders`, {
    method: 'POST',
    headers: rkoHeaders(auth),
    body: JSON.stringify({
      products: [RKO_PRODUCT_ID],
      fio_rukovoditelia: fullName,
      inn,
      elektronnaia_pocta: email,
      telefon: phone,
      gorod_obsluzivaniia: city,
    }),
  })

  if (!orderRes.ok) {
    const text = await orderRes.text()
    try {
      const errJson = JSON.parse(text)
      const msg = errJson.message || ''
      const fieldErrors = errJson.errors
        ? Object.entries(errJson.errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')
        : ''
      throw new Error(`Ошибка создания заявки (${orderRes.status}): ${msg}${fieldErrors ? ' — ' + fieldErrors : ''}`)
    } catch (parseErr) {
      if (parseErr.message.startsWith('Ошибка создания')) throw parseErr
      throw new Error(`RKO order creation failed (${orderRes.status}): ${text}`)
    }
  }

  const orderData = await orderRes.json()
  console.log('RKO order response:', JSON.stringify(orderData).slice(0, 1000))

  // Response wraps in { data: [...] } (array) or { data: {...} } (object)
  const rawData = orderData.data || orderData
  const order = Array.isArray(rawData) ? rawData[0] : rawData
  const orderId = order?.id || order?.order_id || order?.orderId

  if (!orderId) {
    throw new Error(`Не удалось получить ID заказа из ответа RKO: ${JSON.stringify(orderData).slice(0, 500)}`)
  }

  const referralLink = `${RKO_BASE}/click/${orderId}?user_id=2290`

  return { orderId, referralLink }
}

/**
 * POST /api/ip-link — создание заявки ИП и получение реферальной ссылки
 * Body: { fullName, inn, phone, email, city }
 */
export async function POST(request) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const body = await request.json()
    const { fullName, inn, phone, email, city } = body

    // Validation
    if (!fullName || !inn || !phone || !email || !city) {
      return NextResponse.json({ error: 'Все поля обязательны' }, { status: 400 })
    }

    if (!validateINN12(inn)) {
      return NextResponse.json({ error: 'Некорректный ИНН (должен быть 12 цифр с верной контрольной суммой)' }, { status: 400 })
    }

    // Create application via RKO partner API
    let rkoResult
    try {
      const rkoAuth = await loginToRkoPartner()
      rkoResult = await createRkoApplication(rkoAuth, { fullName, inn, phone, email, city })
    } catch (rkoErr) {
      console.error('RKO Partner API error:', rkoErr)

      // Save failed attempt
      await supabaseAdmin.from('ip_applications').insert([{
        manager_id: profile.id,
        team: profile.team,
        full_name: fullName,
        inn, phone, email, city,
        status: 'error',
        error_message: rkoErr.message,
      }])

      return NextResponse.json(
        { error: 'Ошибка партнёрской программы: ' + rkoErr.message },
        { status: 502 }
      )
    }

    // Save successful application
    const { error: insertError } = await supabaseAdmin.from('ip_applications').insert([{
      manager_id: profile.id,
      team: profile.team,
      full_name: fullName,
      inn, phone, email, city,
      referral_link: rkoResult.referralLink,
      rko_order_id: String(rkoResult.orderId || ''),
      rko_application_id: '',
      status: 'success',
    }])

    if (insertError) {
      console.error('Supabase insert error:', insertError)
      return NextResponse.json({
        referralLink: rkoResult.referralLink,
        warning: 'Заявка создана, но не сохранена в историю: ' + insertError.message,
      })
    }

    return NextResponse.json({ referralLink: rkoResult.referralLink })
  } catch (err) {
    console.error('POST /api/ip-link error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

/**
 * GET /api/ip-link — история заявок
 * Query: ?scope=team (для тимлидов/админов — показать всю команду/все)
 */
export async function GET(request) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope')

    let query = supabaseAdmin
      .from('ip_applications')
      .select('id, manager_id, full_name, inn, phone, email, city, referral_link, status, error_message, created_at')
      .order('created_at', { ascending: false })
      .limit(2000)

    if (scope === 'all' && profile.role === 'admin') {
      // Admin sees all
    } else if (scope === 'team' && (profile.role === 'teamlead' || profile.role === 'admin')) {
      query = query.eq('team', profile.team)
    } else {
      query = query.eq('manager_id', profile.id)
    }

    const { data, error } = await query

    if (error) {
      console.error('GET /api/ip-link error:', error)
      return NextResponse.json({ error: 'Ошибка загрузки' }, { status: 500 })
    }

    return NextResponse.json({ applications: data || [] })
  } catch (err) {
    console.error('GET /api/ip-link error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
