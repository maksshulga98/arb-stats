import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getSheetsClient } from '../../../lib/google-sheets-api'

const CD_SPREADSHEET_ID = '1k06NL3eb98bj8t1TM1Mgziy7G-AkV6bdOHjwiFyV5p0'

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

async function authenticate(request) {
  const supabaseAnon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return { error: 'Unauthorized', status: 401 }

  const { data: { user }, error } = await supabaseAnon.auth.getUser(token)
  if (error || !user) return { error: 'Unauthorized', status: 401 }

  const supabaseAdmin = getSupabaseAdmin()
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, name, role, team')
    .eq('id', user.id)
    .single()

  if (!profile || !['manager', 'teamlead', 'admin'].includes(profile.role)) {
    return { error: 'Доступ запрещён', status: 403 }
  }

  return { profile }
}

/**
 * Убеждаемся что лист с указанным именем существует в таблице.
 * Если нет — создаём и добавляем заголовок.
 * Возвращает sheetId (числовой).
 */
async function ensureMonthSheet(sheets, monthName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: CD_SPREADSHEET_ID })
  const existing = meta.data.sheets.find(s => s.properties.title === monthName)
  if (existing) return existing.properties.sheetId

  // Создаём новый лист
  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: CD_SPREADSHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: monthName } } }],
    },
  })
  const newSheetId = addRes.data.replies[0].addSheet.properties.sheetId

  // Добавляем заголовок
  await sheets.spreadsheets.values.update({
    spreadsheetId: CD_SPREADSHEET_ID,
    range: `${monthName}!A1:E1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Дата', 'ФИО', 'ИНН', 'Номер', 'Статус заявки']],
    },
  })

  return newSheetId
}

// POST /api/cd — добавить ЦД в таблицу
export async function POST(request) {
  try {
    const auth = await authenticate(request)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { fullName, inn, phone } = await request.json()

    if (!fullName || (!inn && !phone)) {
      return NextResponse.json({ error: 'Нужны ФИО и ИНН или телефон' }, { status: 400 })
    }

    const sheets = getSheetsClient()

    // Определяем лист текущего месяца по МСК
    const now = new Date()
    const mskNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }))
    const monthName = MONTHS_RU[mskNow.getMonth()]
    await ensureMonthSheet(sheets, monthName)

    // Формируем дату/время МСК
    const date = mskNow.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const time = mskNow.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    const dateStr = `${date} ${time}`

    await sheets.spreadsheets.values.append({
      spreadsheetId: CD_SPREADSHEET_ID,
      range: `${monthName}!A:E`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[dateStr, fullName, inn || '', phone || '', '']],
      },
    })

    return NextResponse.json({ ok: true, month: monthName })
  } catch (err) {
    console.error('POST /api/cd error:', err)
    return NextResponse.json({ error: 'Ошибка сервера: ' + err.message }, { status: 500 })
  }
}
