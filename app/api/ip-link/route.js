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

async function loginToRkoPartner() {
  const email = process.env.RKO_PARTNER_EMAIL
  const password = process.env.RKO_PARTNER_PASSWORD

  if (!email || !password) {
    throw new Error('RKO_PARTNER_EMAIL or RKO_PARTNER_PASSWORD not set')
  }

  const res = await fetch(`${RKO_BASE}/api/app/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`RKO login failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  // Try common token locations
  const token = data.token || data.access_token || data.data?.token || data.data?.access_token
  if (!token) {
    // If no token in JSON, check for Set-Cookie header
    const cookies = res.headers.get('set-cookie')
    if (cookies) return { type: 'cookie', value: cookies }
    throw new Error('No token in RKO login response: ' + JSON.stringify(data))
  }

  return { type: 'bearer', value: token }
}

function rkoHeaders(auth) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (auth.type === 'bearer') {
    headers['Authorization'] = `Bearer ${auth.value}`
  } else if (auth.type === 'cookie') {
    headers['Cookie'] = auth.value
  }
  return headers
}

async function createRkoApplication(auth, { fullName, inn, phone, email, city }) {
  // Step 1: Get products
  const productsRes = await fetch(
    `${RKO_BASE}/api/app/applications?filter[category_id]=11`,
    { headers: rkoHeaders(auth) }
  )

  if (!productsRes.ok) {
    throw new Error(`RKO products request failed (${productsRes.status})`)
  }

  const productsData = await productsRes.json()
  const products = productsData.data || productsData

  // Find the target product (Регистрация бизнеса ИП + РКО | Реферальная ссылка [РЕФ])
  let targetProduct = null
  if (Array.isArray(products)) {
    targetProduct = products.find(p =>
      (p.name || p.title || '').includes('Реферальная ссылка') &&
      (p.name || p.title || '').includes('ИП')
    )
    // Fallback: 3rd item (index 2) as described
    if (!targetProduct && products.length >= 3) {
      targetProduct = products[2]
    }
  }

  if (!targetProduct) {
    throw new Error('Target product not found in RKO products list')
  }

  const productId = targetProduct.id || targetProduct.product_id

  // Step 2: Create application with client data
  const [lastName, firstName, middleName] = fullName.split(' ')
  const appRes = await fetch(`${RKO_BASE}/api/app/applications`, {
    method: 'POST',
    headers: rkoHeaders(auth),
    body: JSON.stringify({
      product_id: productId,
      last_name: lastName || '',
      first_name: firstName || '',
      middle_name: middleName || '',
      full_name: fullName,
      inn,
      phone,
      email,
      city,
    }),
  })

  if (!appRes.ok) {
    const text = await appRes.text()
    throw new Error(`RKO application creation failed (${appRes.status}): ${text}`)
  }

  const appData = await appRes.json()
  const applicationId = appData.id || appData.data?.id

  // Step 3: Create order (finalize)
  const orderRes = await fetch(`${RKO_BASE}/api/app/orders`, {
    method: 'POST',
    headers: rkoHeaders(auth),
    body: JSON.stringify({
      application_id: applicationId,
    }),
  })

  if (!orderRes.ok) {
    const text = await orderRes.text()
    throw new Error(`RKO order creation failed (${orderRes.status}): ${text}`)
  }

  const orderData = await orderRes.json()
  const orderId = orderData.id || orderData.data?.id
  const referralLink = orderData.link || orderData.data?.link ||
    `${RKO_BASE}/click/${orderId}?user_id=2290`

  return { applicationId, orderId, referralLink }
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
      rko_application_id: String(rkoResult.applicationId || ''),
      status: 'success',
    }])

    if (insertError) {
      console.error('Supabase insert error:', insertError)
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
      .limit(100)

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
