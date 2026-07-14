// Эндпоинт авто-оформления банковского продукта через антидетект-браузер.
//
// В отличие от /api/account-link (server-to-server к rko-partner), здесь нет
// прямого API банка. Ссылку добывает РЕАЛЬНЫЙ браузер (Dolphin Anty + Puppeteer),
// который крутится на отдельной машине-раннере. Поэтому:
//   POST — только КЛАДЁТ задачу в очередь bank_link_jobs (status='queued') и
//          сразу возвращает { jobId }. Ничего долгого тут не происходит.
//   GET  — поллинг статуса конкретной задачи (?jobId=...) и история заявок.
//
// Auth-паттерн 1:1 как в account-link.

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getActiveBanks, getBankById } from '../../../lib/bank-links'

export const dynamic = 'force-dynamic'

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
  const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const c1 = w1.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  const c2 = w2.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  return d[10] === c1 && d[11] === c2
}

/**
 * POST /api/bank-link — поставить задачу на оформление в очередь.
 * Body: { bank, organizationName, inn, legalAddress, city, contactPerson, email, phone }
 * Возвращает: { jobId } — по нему фронт опрашивает статус через GET ?jobId=.
 */
export async function POST(request) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const body = await request.json()
    const { bank, organizationName, inn, legalAddress, city, contactPerson, email, phone } = body

    if (!bank || !organizationName || !inn || !legalAddress || !city || !contactPerson || !email || !phone) {
      return NextResponse.json({ error: 'Все поля обязательны' }, { status: 400 })
    }
    if (!validateINN(inn)) {
      return NextResponse.json({ error: 'Некорректный ИНН (10 цифр для ООО, 12 для ИП, с верной контрольной суммой)' }, { status: 400 })
    }

    const bankCfg = getBankById(bank)
    if (!bankCfg) {
      return NextResponse.json({ error: 'Неизвестный или не настроенный банк' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('bank_link_jobs')
      .insert([{
        manager_id: profile.id,
        team: profile.team,
        bank: bankCfg.id,
        source_url: bankCfg.sourceUrl,
        organization_name: organizationName,
        inn, legal_address: legalAddress, city,
        contact_person: contactPerson, email, phone,
        status: 'queued',
      }])
      .select('id')
      .single()

    if (error) {
      console.error('POST /api/bank-link insert error:', error)
      return NextResponse.json({ error: 'Не удалось поставить задачу: ' + error.message }, { status: 500 })
    }

    return NextResponse.json({ jobId: data.id })
  } catch (err) {
    console.error('POST /api/bank-link error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

/**
 * GET /api/bank-link
 *   ?jobId=UUID           — статус одной задачи (поллинг после отправки формы)
 *   ?scope=all|team|(свои)— история задач
 *   ?banks=1              — список доступных банков для формы
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    // Список банков не требует тяжёлой авторизации сверх обычной проверки токена
    if (searchParams.get('banks')) {
      const auth = await authenticateUser(request)
      if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })
      return NextResponse.json({ banks: getActiveBanks().map(b => ({ id: b.id, label: b.label })) })
    }

    const auth = await authenticateUser(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const { profile, supabaseAdmin } = auth

    const jobId = searchParams.get('jobId')
    if (jobId) {
      const { data, error } = await supabaseAdmin
        .from('bank_link_jobs')
        .select('id, manager_id, team, bank, status, result_link, error_message, created_at')
        .eq('id', jobId)
        .single()
      if (error || !data) return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })
      // Менеджер может опрашивать только свою задачу; тимлид — свою команду; админ — любую
      const allowed =
        data.manager_id === profile.id ||
        (profile.role === 'teamlead' && data.team === profile.team) ||
        profile.role === 'admin'
      if (!allowed) return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
      return NextResponse.json({ job: data })
    }

    const scope = searchParams.get('scope')
    let query = supabaseAdmin
      .from('bank_link_jobs')
      .select('id, manager_id, bank, organization_name, inn, city, contact_person, phone, status, result_link, error_message, created_at')
      .order('created_at', { ascending: false })
      .limit(2000)

    if (scope === 'all' && profile.role === 'admin') {
      // всё
    } else if (scope === 'team' && (profile.role === 'teamlead' || profile.role === 'admin')) {
      query = query.eq('team', profile.team)
    } else {
      query = query.eq('manager_id', profile.id)
    }

    const { data, error } = await query
    if (error) {
      console.error('GET /api/bank-link error:', error)
      return NextResponse.json({ error: 'Ошибка загрузки' }, { status: 500 })
    }
    return NextResponse.json({ jobs: data || [] })
  } catch (err) {
    console.error('GET /api/bank-link error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
