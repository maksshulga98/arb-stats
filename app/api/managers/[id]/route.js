import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function DELETE(request, { params }) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const supabaseAnon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  try {
    const { id } = await params

    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, team')
      .eq('id', user.id)
      .single()

    if (!['teamlead', 'admin'].includes(callerProfile?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, team')
      .eq('id', id)
      .single()

    if (!targetProfile) {
      return NextResponse.json({ error: 'Менеджер не найден' }, { status: 404 })
    }

    // Teamlead can only delete managers from their own team
    if (callerProfile.role === 'teamlead') {
      if (targetProfile.team !== callerProfile.team || targetProfile.role !== 'manager') {
        return NextResponse.json({ error: 'Нет доступа к этому менеджеру' }, { status: 403 })
      }
    }

    // Soft-delete: clear team and mark as deleted so FK references in reports stay intact
    await supabaseAdmin
      .from('profiles')
      .update({ team: null, role: 'deleted' })
      .eq('id', id)

    // Also revoke login by deleting the auth user
    await supabaseAdmin.auth.admin.deleteUser(id)

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}

export async function PUT(request, { params }) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const supabaseAnon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  try {
    const { id } = await params

    const token = request.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, team')
      .eq('id', user.id)
      .single()

    if (!['teamlead', 'admin'].includes(callerProfile?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, team')
      .eq('id', id)
      .single()

    if (!targetProfile) {
      return NextResponse.json({ error: 'Менеджер не найден' }, { status: 404 })
    }

    // Teamlead can only edit managers from their own team
    if (callerProfile.role === 'teamlead') {
      if (targetProfile.team !== callerProfile.team || targetProfile.role !== 'manager') {
        return NextResponse.json({ error: 'Нет доступа к этому менеджеру' }, { status: 403 })
      }
    }

    const body = await request.json()
    const { sheetUrl, paymentInfo } = body
    const updateFields = {}

    // Sheet URL handling
    if ('sheetUrl' in body) {
      let sheetId = null
      if (sheetUrl && sheetUrl.trim()) {
        const urlMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/)
        sheetId = urlMatch ? urlMatch[1] : sheetUrl.trim()
      }
      updateFields.sheet_id = sheetId
    }

    // Payment info handling (admin only)
    if ('paymentInfo' in body) {
      if (callerProfile.role !== 'admin') {
        return NextResponse.json({ error: 'Только админ может менять реквизиты' }, { status: 403 })
      }
      updateFields.payment_info = paymentInfo || null
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json({ error: 'Нет данных для обновления' }, { status: 400 })
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update(updateFields)
      .eq('id', id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, sheetId: updateFields.sheet_id, paymentInfo: updateFields.payment_info })
  } catch {
    return NextResponse.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
