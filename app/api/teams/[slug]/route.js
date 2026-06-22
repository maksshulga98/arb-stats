// DELETE /api/teams/[slug]  — удалить команду (admin only).
// Защита: нельзя удалить если в команде есть профили — сначала надо их перевести.

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

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
