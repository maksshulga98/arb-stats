// Предупреждения менеджерам (выдают вручную admin/teamlead).
// POST  — выдать предупреждение менеджеру
// GET   — список предупреждений (фильтры по scope)

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { broadcastTelegramMessage, escapeHtml } from '../../../lib/telegram'

export const dynamic = 'force-dynamic'

const TEAM_NAMES = {
  olya: 'Оли',
  karina: 'Карины',
  nikita: 'Никиты',
}

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
    .from('profiles')
    .select('id, name, role, team, email')
    .eq('id', user.id)
    .single()
  if (!profile) return { error: 'Профиль не найден', status: 404 }

  return { user, profile, supabaseAdmin }
}

// 1-е число текущего МСК-месяца в ISO
function startOfMonthMskIso() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date())
  // today = YYYY-MM-DD
  const ym = today.slice(0, 7) // YYYY-MM
  return new Date(`${ym}-01T00:00:00+03:00`).toISOString()
}

// Сколько предупреждений у менеджера за текущий месяц
async function countWarningsThisMonth(supabaseAdmin, managerId) {
  const start = startOfMonthMskIso()
  const { count } = await supabaseAdmin
    .from('manager_warnings')
    .select('*', { count: 'exact', head: true })
    .eq('manager_id', managerId)
    .gte('issued_at', start)
  return count || 0
}

// TG: «надо увольнять» при 3-м предупреждении за месяц
async function notifyThirdWarning(supabaseAdmin, managerProfile, issuedByName) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN
    const recipients = [
      process.env.TELEGRAM_CHAT_ID_OWNER,
      process.env.TELEGRAM_CHAT_ID_NIKITA,
    ].filter(Boolean)
    if (!token || recipients.length === 0) return

    const name = managerProfile.name || managerProfile.email?.split('@')[0] || '?'
    const teamLabel = TEAM_NAMES[managerProfile.team] || managerProfile.team || '?'

    const msg =
      `⚠️ <b>Менеджер достиг 3 предупреждений за месяц</b>\n\n` +
      `<b>${escapeHtml(name)}</b> (команда ${escapeHtml(teamLabel)})\n` +
      `\n` +
      `Это уже 3-е предупреждение за текущий месяц — пора рассматривать увольнение.\n` +
      `\n` +
      `Последнее предупреждение выдал: <i>${escapeHtml(issuedByName)}</i>`

    await broadcastTelegramMessage(token, recipients, msg)
  } catch (err) {
    console.error('notifyThirdWarning failed:', err?.message || err)
  }
}

/**
 * POST /api/manager-warnings  — выдать предупреждение
 * Body: { manager_id }
 *
 * Доступ:
 *   - admin: любому менеджеру
 *   - teamlead: только менеджеру СВОЕЙ команды
 *   - manager: 403
 */
export async function POST(request) {
  try {
    const auth = await authenticate(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    if (!['admin', 'teamlead'].includes(profile.role)) {
      return NextResponse.json({ error: 'Только админы и тимлиды могут выдавать предупреждения' }, { status: 403 })
    }

    const body = await request.json()
    const { manager_id } = body
    if (!manager_id) {
      return NextResponse.json({ error: 'manager_id обязателен' }, { status: 400 })
    }

    // Проверяем что target существует и это менеджер
    const { data: target } = await supabaseAdmin
      .from('profiles')
      .select('id, name, role, team, email')
      .eq('id', manager_id)
      .single()
    if (!target) {
      return NextResponse.json({ error: 'Менеджер не найден' }, { status: 404 })
    }
    if (target.role !== 'manager') {
      return NextResponse.json({ error: 'Предупреждение можно выдать только менеджеру' }, { status: 400 })
    }

    // Тимлид — только своей команды
    if (profile.role === 'teamlead' && target.team !== profile.team) {
      return NextResponse.json({ error: 'Тимлид может предупреждать только свою команду' }, { status: 403 })
    }

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('manager_warnings')
      .insert([{ manager_id, issued_by_id: profile.id }])
      .select('id, issued_at')
      .single()
    if (insertErr) {
      console.error('POST /api/manager-warnings insert error:', insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    // Считаем сколько за текущий месяц
    const monthCount = await countWarningsThisMonth(supabaseAdmin, manager_id)

    // Если ровно 3 — слаём TG (fire-and-forget)
    if (monthCount === 3) {
      const issuedByName = profile.name || profile.email?.split('@')[0] || '?'
      notifyThirdWarning(supabaseAdmin, target, issuedByName).catch(() => {})
    }

    return NextResponse.json({
      warning: { id: inserted.id, manager_id, issued_at: inserted.issued_at },
      monthCount,
    })
  } catch (err) {
    console.error('POST /api/manager-warnings error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

/**
 * GET /api/manager-warnings  — список + счётчики за месяц
 *
 * Query:
 *   ?manager_id=UUID — все предупреждения конкретного менеджера (с историей)
 *   без параметра  — все за текущий месяц, сгруппированные по manager_id
 *
 * Доступ:
 *   - admin: всё
 *   - teamlead: своя команда
 *   - manager: только свои (manager_id игнорируется, всегда self)
 */
export async function GET(request) {
  try {
    const auth = await authenticate(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const { searchParams } = new URL(request.url)
    const managerId = searchParams.get('manager_id')

    // === Конкретный менеджер (история) ===
    if (managerId) {
      // Проверка доступа
      if (profile.role === 'manager' && managerId !== profile.id) {
        return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
      }
      if (profile.role === 'teamlead') {
        const { data: m } = await supabaseAdmin
          .from('profiles').select('team').eq('id', managerId).single()
        if (!m || m.team !== profile.team) {
          return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
        }
      }

      const { data, error } = await supabaseAdmin
        .from('manager_warnings')
        .select(`
          id, issued_at,
          issued_by:profiles!manager_warnings_issued_by_id_fkey(id, name, email)
        `)
        .eq('manager_id', managerId)
        .order('issued_at', { ascending: false })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      const start = startOfMonthMskIso()
      const monthCount = (data || []).filter(w => w.issued_at >= start).length

      return NextResponse.json({
        warnings: (data || []).map(w => ({
          id: w.id,
          issued_at: w.issued_at,
          issued_by_name: w.issued_by?.name || w.issued_by?.email?.split('@')[0] || '?',
        })),
        monthCount,
      })
    }

    // === Все за текущий месяц — счётчики по manager_id ===
    const start = startOfMonthMskIso()

    let query = supabaseAdmin
      .from('manager_warnings')
      .select('manager_id, issued_at')
      .gte('issued_at', start)

    // Тимлид — только своей команды (через подзапрос managers команды)
    if (profile.role === 'teamlead') {
      const { data: teamMgrs } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('team', profile.team)
        .eq('role', 'manager')
      const ids = (teamMgrs || []).map(m => m.id)
      if (ids.length === 0) return NextResponse.json({ counts: {} })
      query = query.in('manager_id', ids)
    } else if (profile.role === 'manager') {
      query = query.eq('manager_id', profile.id)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const counts = {}
    for (const w of (data || [])) {
      counts[w.manager_id] = (counts[w.manager_id] || 0) + 1
    }
    return NextResponse.json({ counts })
  } catch (err) {
    console.error('GET /api/manager-warnings error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
