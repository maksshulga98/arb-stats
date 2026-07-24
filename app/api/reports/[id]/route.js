// Редактирование отчёта менеджера (для admin/teamlead).
// Тимлид правит ТОЛЬКО отчёты менеджеров своей команды.
// Админ — любые.
//
// Поля: ordered_ip, ordered_cards, unsubscribed, replied, people_wrote.
// Все целочисленные, >= 0. Любое можно опустить — обновится только то что прислали.

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function getClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !serviceKey || !anonKey) throw new Error('Missing Supabase env vars')
  return {
    supabaseAdmin: createClient(url, serviceKey),
    supabaseAnon: createClient(url, anonKey),
  }
}

async function authenticate(request) {
  const { supabaseAdmin, supabaseAnon } = getClients()
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { error: 'Unauthorized', status: 401 }

  const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)
  if (authError || !user) return { error: 'Unauthorized', status: 401 }

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('id, role, team').eq('id', user.id).single()
  if (!profile) return { error: 'Профиль не найден', status: 404 }

  return { user, profile, supabaseAdmin }
}

// Поля которые можно править + правила валидации
const EDITABLE_FIELDS = ['ordered_ip', 'ordered_cards', 'unsubscribed', 'replied', 'people_wrote', 'ordered_simka']

function parseIntSafe(v) {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n < 1_000_000 ? n : NaN
}

/**
 * PUT /api/reports/[id]  — частичное обновление отчёта.
 * Body: { ordered_ip?, ordered_cards?, unsubscribed?, replied?, people_wrote? }
 *
 * Доступ:
 *   - admin: любой отчёт
 *   - teamlead: только отчёты менеджеров СВОЕЙ команды
 *   - manager: 403 (свои отчёты редактирует сам через свой dashboard, не этот endpoint)
 */
export async function PUT(request, { params }) {
  try {
    const auth = await authenticate(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const { id } = await params

    // Проверка роли
    if (!['admin', 'teamlead'].includes(profile.role)) {
      return NextResponse.json({ error: 'Только admin или teamlead' }, { status: 403 })
    }

    // Подтягиваем отчёт + manager.team для проверки доступа тимлида
    const { data: report, error: rErr } = await supabaseAdmin
      .from('reports')
      .select('id, manager_id, manager:profiles!reports_manager_id_fkey(team)')
      .eq('id', id)
      .single()
    if (rErr || !report) {
      return NextResponse.json({ error: 'Отчёт не найден' }, { status: 404 })
    }

    // Тимлид — только своя команда
    if (profile.role === 'teamlead') {
      const reportTeam = report.manager?.team
      if (!reportTeam || reportTeam !== profile.team) {
        return NextResponse.json({ error: 'Тимлид может править отчёты только своей команды' }, { status: 403 })
      }
    }

    // Парсим body, оставляем только разрешённые поля
    const body = await request.json()
    const updates = {}
    for (const f of EDITABLE_FIELDS) {
      if (f in body) {
        const parsed = parseIntSafe(body[f])
        if (Number.isNaN(parsed)) {
          return NextResponse.json({ error: `${f}: целое неотрицательное число до 1_000_000` }, { status: 400 })
        }
        updates[f] = parsed
      }
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }

    const { data: updated, error: upErr } = await supabaseAdmin
      .from('reports')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single()
    if (upErr) {
      console.error('PUT /api/reports/[id] error:', upErr)
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    }
    return NextResponse.json({ report: updated })
  } catch (err) {
    console.error('PUT /api/reports/[id] error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
