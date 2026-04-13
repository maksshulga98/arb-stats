import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const LINKS = [
  'https://trk.ppdu.ru/click/dM45mQlM?erid=erid&siteId=12145',
  'https://trk.ppdu.ru/click/E027A77f?erid=erid&siteId=12145',
  'https://trk.ppdu.ru/click/vZCaZuoe?erid=erid&siteId=12145',
  'https://trk.ppdu.ru/click/yNxoVUsX?erid=erid&siteId=12145',
  'https://trk.ppdu.ru/click/iFEVe4ih?erid=erid&siteId=12145',
  'https://trk.ppdu.ru/click/bWBRtE3K?erid=erid&siteId=12145',
  'https://trk.ppdu.ru/click/KRuX6qBP?erid=erid&siteId=12145',
  'https://trk.ppdu.ru/click/oOZVivR2?erid=erid&siteId=12145',
  'https://trk.ppdu.ru/click/5sYOpWYO?erid=erid&siteId=12145',
  'https://trk.ppdu.ru/click/qxaXOSeM?erid=erid&siteId=12145',
  'https://trk.ppdu.ru/click/x2KUcRso?erid=erid&siteId=12145',
  'https://trk.ppdu.ru/click/dEwBbdoW?erid=erid&siteId=12145',
]

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return {
    supabaseAdmin: createClient(url, serviceKey),
    supabaseAnon: createClient(url, anonKey),
  }
}

async function authenticate(request) {
  const { supabaseAdmin, supabaseAnon } = getSupabaseAdmin()
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { error: 'Unauthorized', status: 401 }

  const { data: { user }, error } = await supabaseAnon.auth.getUser(token)
  if (error || !user) return { error: 'Unauthorized', status: 401 }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, name, role, team')
    .eq('id', user.id)
    .single()

  if (!profile || !['manager', 'teamlead', 'admin'].includes(profile.role)) {
    return { error: 'Доступ запрещён', status: 403 }
  }

  return { user, profile, supabaseAdmin }
}

// POST /api/ip-application — создать заявку
export async function POST(request) {
  try {
    const auth = await authenticate(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const { fullName, phone, email, city } = await request.json()

    if (!fullName || !phone || !email || !city) {
      return NextResponse.json({ error: 'Все поля обязательны' }, { status: 400 })
    }

    // Round-robin: pick next link based on total count
    const { count } = await supabaseAdmin
      .from('ip_requests')
      .select('*', { count: 'exact', head: true })

    const linkIndex = (count || 0) % LINKS.length
    const linkUrl = LINKS[linkIndex]

    const { error: insertError } = await supabaseAdmin.from('ip_requests').insert([{
      manager_id: profile.id,
      manager_name: profile.name,
      team: profile.team,
      full_name: fullName,
      phone,
      email,
      city,
      link_index: linkIndex + 1,
      link_url: linkUrl,
    }])

    if (insertError) {
      console.error('ip_requests insert error:', insertError)
      return NextResponse.json({ error: 'Ошибка сохранения: ' + insertError.message }, { status: 500 })
    }

    return NextResponse.json({ linkUrl, linkIndex: linkIndex + 1 })
  } catch (err) {
    console.error('POST /api/ip-application error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

// GET /api/ip-application — история заявок
export async function GET(request) {
  try {
    const auth = await authenticate(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { profile, supabaseAdmin } = auth
    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope')

    let query = supabaseAdmin
      .from('ip_requests')
      .select('id, manager_id, manager_name, team, full_name, phone, email, city, link_index, link_url, created_at')
      .order('created_at', { ascending: false })
      .limit(500)

    if (scope === 'all' && profile.role === 'admin') {
      // admin sees all
    } else if (scope === 'team' && (profile.role === 'teamlead' || profile.role === 'admin')) {
      query = query.eq('team', profile.team)
    } else {
      query = query.eq('manager_id', profile.id)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: 'Ошибка загрузки' }, { status: 500 })

    return NextResponse.json({ applications: data || [] })
  } catch (err) {
    console.error('GET /api/ip-application error:', err)
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}
