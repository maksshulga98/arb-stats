// Эндпоинт раздела "Задачи" — приватный таск-трекер для двух админов.
// См. docs/specs/tasks-section.md
// Доступ: только role='admin' (иначе 403).

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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

async function authenticateAdmin(request) {
  const { supabaseAdmin, supabaseAnon } = getClients()
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { error: 'Unauthorized', status: 401 }

  const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)
  if (authError || !user) return { error: 'Unauthorized', status: 401 }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, name, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return { error: 'Доступ только для админов', status: 403 }
  }
  return { user, profile, supabaseAdmin }
}

/**
 * GET /api/tasks?scope=all|mine|overdue|done
 * Список задач + имена assignee/creator одним JOIN'ом (без N+1).
 */
export async function GET(request) {
  try {
    const auth = await authenticateAdmin(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope') || 'all'

    // Базовый запрос со связкой profiles для имён
    let query = supabaseAdmin
      .from('tasks')
      .select(`
        id, title, description, deadline, status, completed_at, created_at,
        assignee_id, creator_id,
        assignee:profiles!tasks_assignee_id_fkey(name),
        creator:profiles!tasks_creator_id_fkey(name)
      `)
      .limit(500)

    if (scope === 'mine') {
      query = query.eq('assignee_id', profile.id)
    } else if (scope === 'overdue') {
      query = query.eq('status', 'pending').lt('deadline', new Date().toISOString())
    } else if (scope === 'done') {
      query = query.eq('status', 'done')
    }

    // Сортировка: pending по deadline ASC, done по completed_at DESC
    // Сортируем на клиенте — Supabase не даёт условную сортировку
    const { data, error } = await query
    if (error) {
      console.error('GET /api/tasks error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const tasks = (data || []).map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      assignee_id: t.assignee_id,
      assignee_name: t.assignee?.name || null,
      creator_id: t.creator_id,
      creator_name: t.creator?.name || null,
      deadline: t.deadline,
      status: t.status,
      completed_at: t.completed_at,
      created_at: t.created_at,
    }))

    // Сортировка: сначала pending по deadline ASC, потом done по completed_at DESC
    tasks.sort((a, b) => {
      if (a.status === 'pending' && b.status === 'done') return -1
      if (a.status === 'done' && b.status === 'pending') return 1
      if (a.status === 'pending') {
        return new Date(a.deadline) - new Date(b.deadline)
      }
      return new Date(b.completed_at || 0) - new Date(a.completed_at || 0)
    })

    return NextResponse.json({ tasks })
  } catch (err) {
    console.error('GET /api/tasks error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

/**
 * POST /api/tasks  — создание задачи.
 * Body: { title, description?, deadline (ISO), assignee_id }
 */
export async function POST(request) {
  try {
    const auth = await authenticateAdmin(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const body = await request.json()
    const { title, description, deadline, assignee_id } = body

    // Валидация title
    if (typeof title !== 'string' || title.trim().length < 1 || title.length > 200) {
      return NextResponse.json({ error: 'Заголовок: 1–200 символов' }, { status: 400 })
    }
    // Валидация deadline: валидный ISO, строго в будущем
    const deadlineDate = new Date(deadline)
    if (isNaN(deadlineDate.getTime())) {
      return NextResponse.json({ error: 'Некорректный дедлайн' }, { status: 400 })
    }
    if (deadlineDate.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Дедлайн должен быть в будущем' }, { status: 400 })
    }
    // Валидация assignee_id: существует и admin
    const { data: assigneeProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', assignee_id)
      .single()
    if (!assigneeProfile || assigneeProfile.role !== 'admin') {
      return NextResponse.json({ error: 'Ответственным может быть только админ' }, { status: 400 })
    }

    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .insert([{
        title: title.trim(),
        description: description?.trim() || null,
        deadline: deadlineDate.toISOString(),
        assignee_id,
        creator_id: profile.id,
        status: 'pending',
      }])
      .select(`
        id, title, description, deadline, status, completed_at, created_at,
        assignee_id, creator_id,
        assignee:profiles!tasks_assignee_id_fkey(name),
        creator:profiles!tasks_creator_id_fkey(name)
      `)
      .single()

    if (error) {
      console.error('POST /api/tasks error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      task: {
        ...task,
        assignee_name: task.assignee?.name,
        creator_name: task.creator?.name,
      },
    })
  } catch (err) {
    console.error('POST /api/tasks error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
