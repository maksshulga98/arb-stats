// CRUD команд.
//   GET  — список (любой авторизованный, нужно для рендера UI)
//   POST — создать команду (только admin) + опционально назначить тимлида

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { fetchTeamsFromDb, isValidSlug, TEAM_TYPES } from '../../../lib/teams'

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
    .from('profiles').select('id, role').eq('id', user.id).single()
  if (!profile) return { error: 'Профиль не найден', status: 404 }

  return { user, profile, supabaseAdmin }
}

/**
 * GET /api/teams  — список команд для UI/cron.
 * Доступ: любой авторизованный.
 */
export async function GET(request) {
  try {
    const auth = await authenticate(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const teams = await fetchTeamsFromDb(auth.supabaseAdmin)
    return NextResponse.json({ teams })
  } catch (err) {
    console.error('GET /api/teams error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

/**
 * POST /api/teams  — создать команду (admin only) + опционально назначить тимлида.
 *
 * Body: { slug, name, type, teamlead_id? }
 *
 * Если teamlead_id указан — этот менеджер промоутится в teamlead и team=slug.
 * Если нет — команда создаётся пустой, тимлид назначается позже отдельной операцией.
 */
export async function POST(request) {
  try {
    const auth = await authenticate(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })
    if (auth.profile.role !== 'admin') {
      return NextResponse.json({ error: 'Только admin может создавать команды' }, { status: 403 })
    }

    const { supabaseAdmin } = auth
    const body = await request.json()
    const { slug, name, type, teamlead_id } = body

    // Валидация
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: 'slug: 2-30 символов, только a-z, 0-9, _, -' }, { status: 400 })
    }
    if (typeof name !== 'string' || name.trim().length < 1 || name.length > 60) {
      return NextResponse.json({ error: 'Имя команды: 1-60 символов' }, { status: 400 })
    }
    const teamType = TEAM_TYPES.includes(type) ? type : 'standard'

    // Проверка уникальности slug
    const { data: existing } = await supabaseAdmin
      .from('teams').select('slug').eq('slug', slug).maybeSingle()
    if (existing) {
      return NextResponse.json({ error: `Команда с slug="${slug}" уже существует` }, { status: 409 })
    }

    // Если задан teamlead — проверяем что это существующий менеджер
    let teamleadProfile = null
    if (teamlead_id) {
      const { data: tl } = await supabaseAdmin
        .from('profiles').select('id, name, role').eq('id', teamlead_id).single()
      if (!tl) {
        return NextResponse.json({ error: 'Тимлид не найден' }, { status: 404 })
      }
      if (tl.role !== 'manager') {
        return NextResponse.json({
          error: `Тимлидом можно назначить только менеджера (текущая роль: ${tl.role})`
        }, { status: 400 })
      }
      teamleadProfile = tl
    }

    // 1) Вставляем команду
    const { data: team, error: insertErr } = await supabaseAdmin
      .from('teams')
      .insert([{ slug, name: name.trim(), type: teamType }])
      .select('slug, name, type, created_at')
      .single()
    if (insertErr) {
      console.error('POST /api/teams insert error:', insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    // 2) Если указан тимлид — промоутим
    if (teamleadProfile) {
      const { error: promoteErr } = await supabaseAdmin
        .from('profiles')
        .update({ role: 'teamlead', team: slug })
        .eq('id', teamleadProfile.id)
      if (promoteErr) {
        console.error('POST /api/teams promote error:', promoteErr)
        // Команда уже создана, но тимлид не назначен — возвращаем warning
        return NextResponse.json({
          team,
          warning: `Команда создана, но не удалось назначить тимлида: ${promoteErr.message}`,
        })
      }
    }

    return NextResponse.json({ team, teamlead: teamleadProfile })
  } catch (err) {
    console.error('POST /api/teams error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
