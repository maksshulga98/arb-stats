import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getSheetsClient } from '../../../lib/google-sheets-api'
import { TG_ACCOUNTS_SPREADSHEET_ID } from '../../../lib/sheets-config'

function getAuthClients() {
  return {
    admin: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY),
    anon: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  }
}

async function authenticate(request) {
  const { admin, anon } = getAuthClients()
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await anon.auth.getUser(token)
  if (!user) return null
  const { data: profile } = await admin.from('profiles').select('role, team, name').eq('id', user.id).single()
  return profile
}

// GET — list all TG accounts from Google Sheets
export async function GET(request) {
  try {
    const caller = await authenticate(request)
    if (!caller || !['admin', 'teamlead'].includes(caller.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sheets = getSheetsClient()
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: TG_ACCOUNTS_SPREADSHEET_ID,
      range: 'A2:E',
    })

    const rows = res.data.values || []
    const accounts = rows.map((row, i) => ({
      rowIndex: i + 2,
      phone: (row[0] || '').trim(),
      tgLink: (row[1] || '').trim(),
      email: (row[2] || '').trim(),
      emailPassword: (row[3] || '').trim(),
      assignedTo: (row[4] || '').trim(),
    })).filter(a => a.phone) // skip empty rows

    return NextResponse.json({ accounts })
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Ошибка загрузки' }, { status: 500 })
  }
}

// PUT — assign/unassign account
export async function PUT(request) {
  try {
    const caller = await authenticate(request)
    if (!caller || !['admin', 'teamlead'].includes(caller.role)) {
      return NextResponse.json({ error: 'Нет доступа' }, { status: 403 })
    }

    const { rowIndex, assignedTo } = await request.json()
    if (!rowIndex) return NextResponse.json({ error: 'rowIndex required' }, { status: 400 })

    const sheets = getSheetsClient()
    await sheets.spreadsheets.values.update({
      spreadsheetId: TG_ACCOUNTS_SPREADSHEET_ID,
      range: `E${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[assignedTo || '']] },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Ошибка обновления' }, { status: 500 })
  }
}
