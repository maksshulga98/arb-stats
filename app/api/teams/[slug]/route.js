// PATCH  /api/teams/[slug]  — переименовать команду / сменить тип (admin only).
// DELETE /api/teams/[slug]  — удалить команду (admin only).
// Защита DELETE: нельзя удалить если в команде есть профили — сначала перевести.

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const TEAM_TYPES = ['standard', 'karina', 'nikita']

// Общая проверка: вернуть { supabaseAdmin } если caller = admin, иначе { error, status }
async function requireAdmin(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !serviceKey || !anonKey) return { error: 'Missing env', status: 500 }
  const supabaseAdmin = createClient(url, serviceKey)
  const supabaseAnon = createClient(url, anonKey)

  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { error: 'Unauthorized', status: 401 }
  const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(token)
  if (authErr || !user) return { error: 'Unauthorized', status: 401 }

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return { error: 'Изменять команды может только admin', status: 403 }
  }
  return { supabaseAdmin }
}

/**
 * PATCH /api/teams/[slug]  — обновить название и/или тип команды.
 * Body: { name?, type? }. slug не меняется (он завязан на profiles.team).
 */
export async function PATCH(request, { params }) {
  try {
    const auth = await requireAdmin(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })
    const { supabaseAdmin } = auth
    const { slug } = await params
    const body = await request.json()

    const updates = {}
    if ('name' in body) {
      const name = String(body.name || '').trim()
      if (name.length < 1 || name.length > 60) {
        return NextResponse.json({ error: 'Название: 1-60 символов' }, { status: 400 })
      }
      updates.name = name
    }
    if ('type' in body) {
      if (!TEAM_TYPES.includes(body.type)) {
        return NextResponse.json({ error: `Тип должен быть: ${TEAM_TYPES.join(', ')}` }, { status: 400 })
      }
      updates.type = body.type
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Нечего обновлять' }, { status: 400 })
    }

    const { data: team, error } = await supabaseAdmin
      .from('teams').update(updates).eq('slug', slug)
      .select('slug, name, type').single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!team) {
      return NextResponse.json({ error: 'Команда не найдена' }, { status: 404 })
    }
    return NextResponse.json({ team })
  } catch (err) {
    console.error('PATCH /api/teams/[slug] error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

export async function DELETE(request, { params }) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !serviceKey || !anonKey) {
      return NextResponse.json({ error: 'Missing env' }, { status: 500 })
    }
    const supabaseAdmin = createClient(url, serviceKey)
    const supabaseAnon = createClient(url, anonKey)

    // Auth
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(token)
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabaseAdmin
      .from('profiles').select('role').eq('id', user.id).single()
    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Удалять команды может только admin' }, { status: 403 })
    }

    const { slug } = await params

    // Проверка: в команде должно быть пусто (есть профили — нельзя удалить)
    const { data: members } = await supabaseAdmin
      .from('profiles')
      .select('id, name, role')
      .eq('team', slug)
      .in('role', ['manager', 'teamlead'])
    if (members && members.length > 0) {
      const names = members.map(m => m.name || m.id).slice(0, 5).join(', ')
      return NextResponse.json({
        error: `В команде ещё ${members.length} чел. (${names}). Сначала переведи их в другую команду или сними команду.`
      }, { status: 409 })
    }

    const { error: delErr } = await supabaseAdmin
      .from('teams').delete().eq('slug', slug)
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/teams/[slug] error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
