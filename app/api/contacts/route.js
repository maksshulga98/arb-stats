import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { TEAM_CONTACT_COLUMN, CONTACTS_PER_ACCOUNT, COOLDOWN_HOURS } from '../../../lib/sheets-config'
import { readColumnContacts, filterAvailableContacts, colorRowsGreen } from '../../../lib/google-sheets-api'

function getSupabaseClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !serviceKey || !anonKey) {
    const missing = []
    if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL')
    if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
    if (!anonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    throw new Error(`Missing env vars: ${missing.join(', ')}`)
  }

  const supabaseAdmin = createClient(url, serviceKey)
  const supabaseAnon = createClient(url, anonKey)
  return { supabaseAdmin, supabaseAnon }
}

async function authenticateUser(request) {
  const { supabaseAdmin, supabaseAnon } = getSupabaseClients()
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { error: 'Unauthorized', status: 401 }

  const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)
  if (authError || !user) return { error: 'Unauthorized', status: 401 }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, name, role, team')
    .eq('id', user.id)
    .single()

  const isManager = profile?.role === 'manager'
  const isKarinaTeamlead = profile?.role === 'teamlead' && profile?.name === 'Карина Калинина'
  if (!profile || (!isManager && !isKarinaTeamlead)) {
    return { error: 'Только менеджеры могут запрашивать контакты', status: 403 }
  }

  return { user, profile, supabaseAdmin }
}

/**
 * POST /api/contacts — выдача контактов менеджеру
 * Body: { accountsCount: 1 | 2 | 3 }
 */
export async function POST(request) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const { accountsCount } = await request.json()

    // Валидация
    if (![1, 2, 3].includes(accountsCount)) {
      return NextResponse.json({ error: 'accountsCount должен быть 1, 2 или 3' }, { status: 400 })
    }

    const columnIndex = TEAM_CONTACT_COLUMN[profile.team]
    if (columnIndex === undefined) {
      return NextResponse.json(
        { error: 'Для вашей команды выдача контактов не доступна' },
        { status: 400 }
      )
    }

    const vacancyColumn = columnIndex === 0 ? 'A' : 'B'

    // Проверка кулдауна 12 часов
    const cooldownThreshold = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()
    const { data: recentDist } = await supabaseAdmin
      .from('contact_distributions')
      .select('distributed_at')
      .eq('manager_id', profile.id)
      .gte('distributed_at', cooldownThreshold)
      .order('distributed_at', { ascending: false })
      .limit(1)

    if (recentDist && recentDist.length > 0) {
      const nextAvailableAt = new Date(
        new Date(recentDist[0].distributed_at).getTime() + COOLDOWN_HOURS * 60 * 60 * 1000
      )
      return NextResponse.json(
        {
          error: 'Кулдаун активен. Вы уже получали контакты менее 12 часов назад.',
          nextAvailableAt: nextAvailableAt.toISOString(),
        },
        { status: 429 }
      )
    }

    // Собираем все уже выданные строки для этой колонки (source of truth)
    const { data: allDists } = await supabaseAdmin
      .from('contact_distributions')
      .select('row_indices')
      .eq('vacancy_column', vacancyColumn)

    const claimedRows = []
    if (allDists) {
      for (const dist of allDists) {
        if (Array.isArray(dist.row_indices)) {
          claimedRows.push(...dist.row_indices)
        }
      }
    }

    // Читаем контакты из Google Sheets
    const allContacts = await readColumnContacts(columnIndex)
    const available = filterAvailableContacts(allContacts, claimedRows)

    const totalNeeded = accountsCount * CONTACTS_PER_ACCOUNT
    if (available.length < totalNeeded) {
      return NextResponse.json(
        {
          error: `Недостаточно контактов. Доступно: ${available.length}, запрошено: ${totalNeeded}`,
          available: available.length,
        },
        { status: 400 }
      )
    }

    // Берём нужное количество
    const selected = available.slice(0, totalNeeded)
    const rowIndices = selected.map(c => c.rowIndex)

    // Разбиваем на группы по 20
    const contactGroups = []
    for (let i = 0; i < accountsCount; i++) {
      const start = i * CONTACTS_PER_ACCOUNT
      contactGroups.push(
        selected.slice(start, start + CONTACTS_PER_ACCOUNT).map(c => c.value)
      )
    }

    // Сохраняем в БД (через service role — обходит RLS)
    const { error: insertError } = await supabaseAdmin
      .from('contact_distributions')
      .insert([{
        manager_id: profile.id,
        team: profile.team,
        vacancy_column: vacancyColumn,
        accounts_count: accountsCount,
        contacts: contactGroups,
        row_indices: rowIndices,
      }])

    if (insertError) {
      console.error('Insert error:', insertError)
      return NextResponse.json({ error: 'Ошибка сохранения' }, { status: 500 })
    }

    // Закрашиваем ячейки зелёным (best-effort, не блокируем ответ при ошибке)
    try {
      await colorRowsGreen(columnIndex, rowIndices)
    } catch (colorErr) {
      console.error('Ошибка окрашивания ячеек:', colorErr)
      // Контакты уже выданы и сохранены, окрашивание — визуальный индикатор
    }

    return NextResponse.json({
      contacts: contactGroups,
      accountsCount,
      totalContacts: totalNeeded,
      distributedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('POST /api/contacts error:', err?.message || err, err?.stack)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

/**
 * GET /api/contacts — история выдач текущего менеджера
 */
export async function GET(request) {
  try {
    const auth = await authenticateUser(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth

    const { data: distributions, error } = await supabaseAdmin
      .from('contact_distributions')
      .select('id, accounts_count, contacts, distributed_at')
      .eq('manager_id', profile.id)
      .order('distributed_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('GET /api/contacts error:', error)
      return NextResponse.json({ error: 'Ошибка загрузки' }, { status: 500 })
    }

    // Определяем статус кулдауна
    let cooldownUntil = null
    if (distributions && distributions.length > 0) {
      const lastDistTime = new Date(distributions[0].distributed_at).getTime()
      const cooldownEnd = lastDistTime + COOLDOWN_HOURS * 60 * 60 * 1000
      if (cooldownEnd > Date.now()) {
        cooldownUntil = new Date(cooldownEnd).toISOString()
      }
    }

    return NextResponse.json({
      distributions: distributions || [],
      cooldownUntil,
    })
  } catch (err) {
    console.error('GET /api/contacts error:', err)
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 })
  }
}
