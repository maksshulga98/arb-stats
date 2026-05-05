import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { loginToRkoPartner, createRkoApplication } from '../../../lib/rko-partner'
import { getActiveAccounts } from '../../../lib/rko-accounts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

/**
 * Round-robin: выбирает следующий аккаунт на основе количества успешных
 * заявок в БД. count % accounts.length → индекс. Получается строгое 50/50
 * между активными кабинетами.
 *
 * Race-condition: если два запроса прилетят одновременно, оба увидят
 * одинаковый count и пойдут в один кабинет. На больших объёмах это даёт
 * перекос в 1-2 заявки за день, в практике незаметно.
 */
async function pickNextAccount(supabaseAdmin) {
  const accounts = getActiveAccounts()
  if (accounts.length === 0) {
    throw new Error('Нет настроенных RKO-аккаунтов (проверь env-вары)')
  }
  if (accounts.length === 1) return accounts[0]

  const { count, error } = await supabaseAdmin
    .from('ip_applications')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'success')
    .not('rko_account', 'is', null)
  if (error) {
    console.warn('pickNextAccount: count error, fallback to account[0]:', error.message)
    return accounts[0]
  }
  return accounts[(count || 0) % accounts.length]
}

/**
 * POST /api/ip-link — создание заявки ИП и получение реферальной ссылки.
 * Body: { fullName, inn, phone, email, city }
 */
export async function POST(request) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const body = await request.json()
    const { fullName, inn, phone, email, city } = body

    if (!fullName || !inn || !phone || !email || !city) {
      return NextResponse.json({ error: 'Все поля обязательны' }, { status: 400 })
    }
    if (!validateINN12(inn)) {
      return NextResponse.json({ error: 'Некорректный ИНН (должен быть 12 цифр с верной контрольной суммой)' }, { status: 400 })
    }

    // Round-robin выбор кабинета
    const account = await pickNextAccount(supabaseAdmin)
    console.log(`/api/ip-link: маршрутизирую заявку в кабинет ${account.id} (${account.label})`)

    // Логин и создание заявки в выбранном кабинете
    let rkoResult
    try {
      const rkoAuth = await loginToRkoPartner(account)
      rkoResult = await createRkoApplication(rkoAuth, { fullName, inn, phone, email, city })
    } catch (rkoErr) {
      console.error(`RKO[${account.id}] error:`, rkoErr)

      await supabaseAdmin.from('ip_applications').insert([{
        manager_id: profile.id,
        team: profile.team,
        full_name: fullName,
        inn, phone, email, city,
        status: 'error',
        error_message: rkoErr.message,
        rko_account: account.id,
      }])

      return NextResponse.json(
        { error: 'Ошибка партнёрской программы: ' + rkoErr.message },
        { status: 502 }
      )
    }

    // Сохраняем успешную заявку — счётчик count(success) увеличивается,
    // следующая заявка автоматически уйдёт в другой кабинет.
    const { error: insertError } = await supabaseAdmin.from('ip_applications').insert([{
      manager_id: profile.id,
      team: profile.team,
      full_name: fullName,
      inn, phone, email, city,
      referral_link: rkoResult.referralLink,
      rko_order_id: String(rkoResult.orderId || ''),
      rko_application_id: '',
      status: 'success',
      rko_account: account.id,
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
 * GET /api/ip-link — история заявок.
 * Query: ?scope=all (admin), ?scope=team (teamlead/admin), иначе свои
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
      .select('id, manager_id, full_name, inn, phone, email, city, referral_link, status, error_message, rko_account, created_at')
      .order('created_at', { ascending: false })
      .limit(2000)

    if (scope === 'all' && profile.role === 'admin') {
      // Админ видит всё
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
