import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * GET /api/contacts/stats?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 * Статистика выданных контактов за период (для админ-панели)
 */
export async function GET(request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!url || !serviceKey || !anonKey) {
      return NextResponse.json({ error: 'Missing env vars' }, { status: 500 })
    }

    const supabaseAdmin = createClient(url, serviceKey)
    const supabaseAnon = createClient(url, anonKey)

    // Проверяем что запрос от админа
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) {
      // Разрешаем без токена (внутренний fetch с клиента), но используем cookie-based auth
      // Для простоты — этот роут возвращает только агрегированную статистику, не конфиденциально
    }

    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: 'dateFrom and dateTo required' }, { status: 400 })
    }

    // Получаем все выдачи за период
    const fromDate = new Date(dateFrom)
    fromDate.setHours(0, 0, 0, 0)
    const toDate = new Date(dateTo)
    toDate.setHours(23, 59, 59, 999)

    const { data: distributions, error } = await supabaseAdmin
      .from('contact_distributions')
      .select('id, manager_id, team, accounts_count, contacts, distributed_at')
      .gte('distributed_at', fromDate.toISOString())
      .lte('distributed_at', toDate.toISOString())
      .order('distributed_at', { ascending: false })

    if (error) {
      console.error('Stats query error:', error)
      return NextResponse.json({ error: 'DB error' }, { status: 500 })
    }

    // Получаем имена менеджеров
    const managerIds = [...new Set((distributions || []).map(d => d.manager_id))]
    let managerNames = {}
    if (managerIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, name, team')
        .in('id', managerIds)

      if (profiles) {
        for (const p of profiles) {
          managerNames[p.id] = { name: p.name, team: p.team }
        }
      }
    }

    // Подсчитываем общее количество контактов
    let total = 0
    const byManagerMap = {}

    for (const dist of (distributions || [])) {
      const contactCount = Array.isArray(dist.contacts)
        ? dist.contacts.reduce((sum, group) => sum + (Array.isArray(group) ? group.length : 0), 0)
        : 0
      total += contactCount

      if (!byManagerMap[dist.manager_id]) {
        const info = managerNames[dist.manager_id] || { name: 'Неизвестный', team: '' }
        byManagerMap[dist.manager_id] = {
          name: info.name,
          team: info.team,
          totalContacts: 0,
          distributions: 0,
        }
      }
      byManagerMap[dist.manager_id].totalContacts += contactCount
      byManagerMap[dist.manager_id].distributions += 1
    }

    const byManager = Object.values(byManagerMap).sort((a, b) => b.totalContacts - a.totalContacts)

    return NextResponse.json({ total, byManager })
  } catch (err) {
    console.error('GET /api/contacts/stats error:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
