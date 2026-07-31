// Анкета «потенциал менеджера» (свободное время, запрос по деньгам, сложности)
// + цвет-плашка, которую руководитель ставит вручную.
//
// GET  /api/manager-potential            — все доступные анкеты (для подсветки карточек)
//      ?manager_id=UUID                  — одна анкета
// PUT  /api/manager-potential            — сохранить (upsert) анкету одного менеджера
//
// Права: админ — любой менеджер; тимлид — только своя команда.
// Менеджер к этим данным доступа не имеет (внутренняя оценка руководителя).

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const FIELDS = ['free_time', 'desired_income', 'age', 'likes_work', 'difficulties', 'comments']
const COLORS = ['green', 'yellow', 'red']

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

async function authenticate(request) {
  const { supabaseAdmin, supabaseAnon } = getSupabaseClients()
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { error: 'Unauthorized', status: 401 }

  const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)
  if (authError || !user) return { error: 'Unauthorized', status: 401 }

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('id, role, team').eq('id', user.id).single()

  if (!profile || !['teamlead', 'admin'].includes(profile.role)) {
    return { error: 'Доступ запрещён', status: 403 }
  }
  return { profile, supabaseAdmin }
}

// Тимлид может смотреть/править только своих; админ — всех.
async function canManage(supabaseAdmin, profile, managerId) {
  if (profile.role === 'admin') return true
  const { data: target } = await supabaseAdmin
    .from('profiles').select('team').eq('id', managerId).single()
  return !!target && target.team === profile.team
}

export async function GET(request) {
  try {
    const auth = await authenticate(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const { profile, supabaseAdmin } = auth

    const { searchParams } = new URL(request.url)
    const managerId = searchParams.get('manager_id')

    if (managerId) {
      if (!(await canManage(supabaseAdmin, profile, managerId))) {
        return NextResponse.json({ error: 'Нет доступа к этому менеджеру' }, { status: 403 })
      }
      const { data, error } = await supabaseAdmin
        .from('manager_potential').select('*').eq('manager_id', managerId).maybeSingle()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ potential: data || null })
    }

    // Список: админ — всё; тимлид — только по своей команде
    let query = supabaseAdmin.from('manager_potential').select('*')
    if (profile.role === 'teamlead') {
      const { data: teamMembers } = await supabaseAdmin
        .from('profiles').select('id').eq('team', profile.team)
      query = query.in('manager_id', (teamMembers || []).map(m => m.id))
    }
    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ potentials: data || [] })
  } catch (err) {
    console.error('GET /api/manager-potential error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

export async function PUT(request) {
  try {
    const auth = await authenticate(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const { profile, supabaseAdmin } = auth

    const body = await request.json()
    const managerId = body.manager_id
    if (!managerId) return NextResponse.json({ error: 'Не указан менеджер' }, { status: 400 })
    if (!(await canManage(supabaseAdmin, profile, managerId))) {
      return NextResponse.json({ error: 'Нет доступа к этому менеджеру' }, { status: 403 })
    }

    const row = {
      manager_id: managerId,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    }
    for (const f of FIELDS) {
      if (f in body) row[f] = body[f] === '' ? null : String(body[f]).slice(0, 2000)
    }
    if ('color' in body) {
      if (body.color !== null && !COLORS.includes(body.color)) {
        return NextResponse.json({ error: `Цвет должен быть: ${COLORS.join(', ')}` }, { status: 400 })
      }
      row.color = body.color
    }

    const { data, error } = await supabaseAdmin
      .from('manager_potential')
      .upsert(row, { onConflict: 'manager_id' })
      .select('*')
      .single()
    if (error) {
      console.error('PUT /api/manager-potential upsert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ potential: data })
  } catch (err) {
    console.error('PUT /api/manager-potential error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
