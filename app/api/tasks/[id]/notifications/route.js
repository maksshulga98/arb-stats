// GET /api/tasks/[id]/notifications
// История уведомлений по конкретной задаче — отображается в модалке.

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

async function authenticateAdmin(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !serviceKey || !anonKey) return { error: 'Missing env', status: 500 }

  const supabaseAdmin = createClient(url, serviceKey)
  const supabaseAnon = createClient(url, anonKey)
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { error: 'Unauthorized', status: 401 }

  const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)
  if (authError || !user) return { error: 'Unauthorized', status: 401 }

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return { error: 'Доступ только для админов', status: 403 }
  }
  return { supabaseAdmin }
}

export async function GET(request, { params }) {
  try {
    const auth = await authenticateAdmin(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { id } = await params
    const { data, error } = await auth.supabaseAdmin
      .from('task_notifications')
      .select('threshold, sent_at')
      .eq('task_id', id)
      .order('sent_at', { ascending: true })

    if (error) {
      console.error('GET /api/tasks/[id]/notifications error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ notifications: data || [] })
  } catch (err) {
    console.error('GET /api/tasks/[id]/notifications error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
