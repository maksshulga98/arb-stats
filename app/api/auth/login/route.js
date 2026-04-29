import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Серверный прокси для логина. Клиент Supabase в браузере у некоторых
// российских пользователей не может достучаться до supabase.co напрямую
// (шейпинг провайдером, ECH-блокировки и т.п.) — отваливается по таймауту.
// Тут запрос делает Vercel-функция в том же регионе что и Supabase, а
// клиент стучится только на наш домен arb-stats-eta.vercel.app, который
// отдаётся через Vercel Edge и обычно не блокируется.
export async function POST(request) {
  try {
    const { email, password } = await request.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Заполните email и пароль' }, { status: 400 })
    }

    const supabaseAnon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    )
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    const { data: authData, error: authError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password,
    })

    if (authError || !authData?.session) {
      return NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 })
    }

    // Профиль грузим service-role'ом — обходим RLS, отвечает мгновенно.
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role, team, name')
      .eq('id', authData.user.id)
      .single()

    return NextResponse.json({
      session: authData.session,
      user: authData.user,
      role: profile?.role || 'manager',
      team: profile?.team || null,
      name: profile?.name || null,
    })
  } catch (err) {
    console.error('login proxy failed:', err?.message || err)
    return NextResponse.json({ error: 'Ошибка сервера. Попробуйте ещё раз.' }, { status: 500 })
  }
}
