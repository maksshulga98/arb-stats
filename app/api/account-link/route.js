// Эндпоинт создания заявки на РКО (product_id=533, "Короткая заявка с смс-подтверждением РЕФ").
// Архитектурно — точная копия /api/ip-link:
//   - Round-robin между активными кабинетами A/B по count(success) в account_applications
//   - Каждый кабинет ходит ИСКЛЮЧИТЕЛЬНО через свой прокси (защита от связки в rko-partner)
//   - При успехе пишем в Supabase, при ошибке тоже пишем со status='error'
//
// Отличия от ip-link:
//   - Другой набор полей формы (7 полей вместо 5)
//   - Поле "наименование организации" идёт обычной строкой —
//     rko-partner сам подбирает ИП по ИНН среди дублей ФИО.

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { loginToRkoPartner, createRkoAccountApplication } from '../../../lib/rko-partner'
import { getActiveAccounts } from '../../../lib/rko-accounts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getSupabaseClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !serviceKey || !anonKey) throw new Error('Missing Supabase env vars')
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

// ИНН: 12 цифр для ИП или 10 для ООО, с правильными контрольными суммами
function validateINN(inn) {
  if (!/^\d{10}$/.test(inn) && !/^\d{12}$/.test(inn)) return false
  const d = inn.split('').map(Number)
  if (inn.length === 10) {
    const w = [2, 4, 10, 3, 5, 9, 4, 6, 8]
    const check = w.reduce((s, x, i) => s + x * d[i], 0) % 11 % 10
    return d[9] === check
  }
  // 12 цифр (ИП)
  const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const c1 = w1.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  const c2 = w2.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  return d[10] === c1 && d[11] === c2
}

// Round-robin — отдельный счётчик по таблице account_applications
async function pickNextAccount(supabaseAdmin) {
  const accounts = getActiveAccounts()
  if (accounts.length === 0) throw new Error('Нет настроенных RKO-аккаунтов (проверь env)')
  if (accounts.length === 1) return accounts[0]

  const { count, error } = await supabaseAdmin
    .from('account_applications')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'success')
    .not('rko_account', 'is', null)
  if (error) {
    console.warn('pickNextAccount[acc]: count error, fallback to accounts[0]:', error.message)
    return accounts[0]
  }
  return accounts[(count || 0) % accounts.length]
}

/**
 * POST /api/account-link — создание заявки на РКО и получение ссылки.
 * Body: { organizationName, inn, legalAddress, city, contactPerson, email, phone }
 */
export async function POST(request) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const body = await request.json()
    const { organizationName, inn, legalAddress, city, contactPerson, email, phone } = body

    // Валидация
    if (!organizationName || !inn || !legalAddress || !city || !contactPerson || !email || !phone) {
      return NextResponse.json({ error: 'Все поля обязательны' }, { status: 400 })
    }
    if (!validateINN(inn)) {
      return NextResponse.json({ error: 'Некорректный ИНН (10 цифр для ООО, 12 для ИП, с верной контрольной суммой)' }, { status: 400 })
    }

    // Round-robin выбор кабинета
    const account = await pickNextAccount(supabaseAdmin)
    console.log(`/api/account-link: маршрутизирую заявку в кабинет ${account.id} (${account.label})`)

    let rkoResult
    try {
      const rkoAuth = await loginToRkoPartner(account)
      rkoResult = await createRkoAccountApplication(rkoAuth, {
        organizationName, inn, legalAddress, city, contactPerson, email, phone,
      })
    } catch (rkoErr) {
      console.error(`RKO[${account.id}] account-error:`, rkoErr)
      await supabaseAdmin.from('account_applications').insert([{
        manager_id: profile.id,
        team: profile.team,
        organization_name: organizationName,
        inn, legal_address: legalAddress, city,
        contact_person: contactPerson, email, phone,
        status: 'error',
        error_message: rkoErr.message,
        rko_account: account.id,
      }])
      return NextResponse.json(
        { error: 'Ошибка партнёрской программы: ' + rkoErr.message },
        { status: 502 }
      )
    }

    const { error: insertError } = await supabaseAdmin.from('account_applications').insert([{
      manager_id: profile.id,
      team: profile.team,
      organization_name: organizationName,
      inn, legal_address: legalAddress, city,
      contact_person: contactPerson, email, phone,
      referral_link: rkoResult.referralLink,
      rko_order_id: String(rkoResult.orderId || ''),
      status: 'success',
      rko_account: account.id,
    }])

    if (insertError) {
      console.error('Supabase account insert error:', insertError)
      return NextResponse.json({
        referralLink: rkoResult.referralLink,
        warning: 'Заявка создана, но не сохранена в историю: ' + insertError.message,
      })
    }

    return NextResponse.json({ referralLink: rkoResult.referralLink })
  } catch (err) {
    console.error('POST /api/account-link error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

/**
 * GET /api/account-link — история заявок.
 * Query: ?scope=all (admin) | ?scope=team (teamlead/admin) | иначе свои
 */
export async function GET(request) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope')

    let query = supabaseAdmin
      .from('account_applications')
      .select('id, manager_id, organization_name, inn, legal_address, city, contact_person, email, phone, referral_link, status, error_message, rko_account, created_at')
      .order('created_at', { ascending: false })
      .limit(2000)

    if (scope === 'all' && profile.role === 'admin') {
      // админ — всё
    } else if (scope === 'team' && (profile.role === 'teamlead' || profile.role === 'admin')) {
      query = query.eq('team', profile.team)
    } else {
      query = query.eq('manager_id', profile.id)
    }

    const { data, error } = await query
    if (error) {
      console.error('GET /api/account-link error:', error)
      return NextResponse.json({ error: 'Ошибка загрузки' }, { status: 500 })
    }
    return NextResponse.json({ applications: data || [] })
  } catch (err) {
    console.error('GET /api/account-link error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
