// PUT /api/tasks/[id] и DELETE /api/tasks/[id]
// См. docs/specs/tasks-section.md

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
 * PUT /api/tasks/[id] — частичное обновление.
 * Body может содержать любое из: title, description, deadline, assignee_id, status.
 * При смене deadline — чистим task_notifications для этой задачи.
 * При status='done' — выставляем completed_at, при возврате на pending — обнуляем.
 */
export async function PUT(request, { params }) {
  try {
    const auth = await authenticateAdmin(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { supabaseAdmin } = auth
    const { id } = await params
    const body = await request.json()
    const updates = {}

    // title
    if ('title' in body) {
      const t = body.title
      if (typeof t !== 'string' || t.trim().length < 1 || t.length > 200) {
        return NextResponse.json({ error: 'Заголовок: 1–200 символов' }, { status: 400 })
      }
      updates.title = t.trim()
    }
    // description
    if ('description' in body) {
      updates.description = body.description?.trim() || null
    }
    // deadline
    let deadlineChanged = false
    if ('deadline' in body) {
      const d = new Date(body.deadline)
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Некорректный дедлайн' }, { status: 400 })
      }
      updates.deadline = d.toISOString()
      deadlineChanged = true
    }
    // assignee_id
    if ('assignee_id' in body) {
      const { data: p } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('id', body.assignee_id)
        .single()
      if (!p || p.role !== 'admin') {
        return NextResponse.json({ error: 'Ответственным может быть только админ' }, { status: 400 })
      }
      updates.assignee_id = body.assignee_id
    }
    // status — done выставляет completed_at, обратный переход обнуляет
    if ('status' in body) {
      if (!['pending', 'done'].includes(body.status)) {
        return NextResponse.json({ error: 'status должен быть pending или done' }, { status: 400 })
      }
      updates.status = body.status
      updates.completed_at = body.status === 'done' ? new Date().toISOString() : null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }

    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select(`
        id, title, description, deadline, status, completed_at, created_at,
        assignee_id, creator_id,
        assignee:profiles!tasks_assignee_id_fkey(name),
        creator:profiles!tasks_creator_id_fkey(name)
      `)
      .single()

    if (error) {
      console.error('PUT /api/tasks/[id] error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!task) {
      return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })
    }

    // При изменении deadline — сбрасываем уведомления, чтобы cron пересчитал
    if (deadlineChanged) {
      await supabaseAdmin.from('task_notifications').delete().eq('task_id', id)
    }

    return NextResponse.json({
      task: {
        ...task,
        assignee_name: task.assignee?.name,
        creator_name: task.creator?.name,
      },
    })
  } catch (err) {
    console.error('PUT /api/tasks/[id] error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

/**
 * DELETE /api/tasks/[id] — удаление задачи.
 * task_notifications уходят каскадом через FK ON DELETE CASCADE.
 */
export async function DELETE(request, { params }) {
  try {
    const auth = await authenticateAdmin(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { supabaseAdmin } = auth
    const { id } = await params

    const { error } = await supabaseAdmin.from('tasks').delete().eq('id', id)
    if (error) {
      console.error('DELETE /api/tasks/[id] error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/tasks/[id] error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
