import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const supabaseAnon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: tlProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, team')
      .eq('id', user.id)
      .single()

    if (!['teamlead', 'admin'].includes(tlProfile?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { firstName, lastName, email, password } = await request.json()
    if (!firstName || !lastName || !email || !password) {
      return NextResponse.json({ error: 'Заполните все поля' }, { status: 400 })
    }

    // Проверяем, не существует ли уже профиль с таким email
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single()

    if (existingProfile) {
      return NextResponse.json({ error: 'Пользователь с таким email уже существует' }, { status: 400 })
    }

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createError) {
      // Supabase может вернуть ошибку если email уже зарегистрирован в Auth
      if (createError.message?.includes('already been registered') || createError.message?.includes('already exists')) {
        return NextResponse.json({ error: 'Пользователь с таким email уже существует' }, { status: 400 })
      }
      return NextResponse.json({ error: createError.message }, { status: 400 })
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert([{
        id: newUser.user.id,
        name: `${firstName} ${lastName}`,
        email,
        role: 'manager',
        team: tlProfile.team,
      }])

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, userId: newUser.user.id })
  } catch {
    return NextResponse.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
