import { NextResponse } from 'next/server'
import { getSheetsClient } from '../../../../lib/google-sheets-api'
import { loginToRkoPartner, fetchAllRkoOrders, mapRkoState } from '../../../../lib/rko-partner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const CD_SPREADSHEET_ID = '1k06NL3eb98bj8t1TM1Mgziy7G-AkV6bdOHjwiFyV5p0'

// Нормализация имени для сравнения: lowercase, убираем лишние пробелы и спецсимволы
function normName(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-яa-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Цвета заливки ячейки для Sheets API
const RED_FILL = { red: 0.96, green: 0.78, blue: 0.78 }     // #F4C7C3
const GREEN_FILL = { red: 0.72, green: 0.88, blue: 0.72 }   // #B7E1B7
const WHITE_FILL = { red: 1, green: 1, blue: 1 }

/**
 * Обрабатывает один лист-месяц: читает ФИО, сопоставляет со статусами,
 * обновляет колонку E.
 */
async function processSheet(sheets, sheetTitle, sheetId, orderByFio) {
  // Читаем все строки листа
  const valRes = await sheets.spreadsheets.values.get({
    spreadsheetId: CD_SPREADSHEET_ID,
    range: `${sheetTitle}!A:E`,
  })
  const rows = valRes.data.values || []
  if (rows.length <= 1) return { sheetTitle, updates: 0 }

  const cellUpdates = []  // { rowIndex (0-based), value, color }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const fio = row[1] || ''
    if (!fio) continue
    const key = normName(fio)
    const order = orderByFio[key]
    if (!order) continue
    const mapped = mapRkoState(order.state)
    if (!mapped) continue
    const currentStatus = row[4] || ''
    if (currentStatus === mapped.text) continue  // уже проставлено
    cellUpdates.push({ rowIndex: i, value: mapped.text, color: mapped.color })
  }

  if (cellUpdates.length === 0) return { sheetTitle, updates: 0 }

  // 1) Пишем значения через values.batchUpdate
  const valueData = cellUpdates.map(u => ({
    range: `${sheetTitle}!E${u.rowIndex + 1}`,
    values: [[u.value]],
  }))
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: CD_SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data: valueData },
  })

  // 2) Красим через spreadsheets.batchUpdate
  const colorRequests = cellUpdates.map(u => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: u.rowIndex,
        endRowIndex: u.rowIndex + 1,
        startColumnIndex: 4,
        endColumnIndex: 5,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: u.color === 'red' ? RED_FILL : u.color === 'green' ? GREEN_FILL : WHITE_FILL,
        },
      },
      fields: 'userEnteredFormat.backgroundColor',
    },
  }))
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: CD_SPREADSHEET_ID,
    requestBody: { requests: colorRequests },
  })

  return { sheetTitle, updates: cellUpdates.length }
}

// GET /api/cron/check-cd-status — ежедневный крон, опрашивает rko-partner и обновляет статусы
export async function GET(request) {
  try {
    // Защита от случайных вызовов: Vercel cron шлёт заголовок x-vercel-cron или Authorization с CRON_SECRET
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    const isVercelCron = request.headers.get('x-vercel-cron') !== null
    if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 1) Логинимся в rko-partner и тянем все заявки
    const auth = await loginToRkoPartner()
    const orders = await fetchAllRkoOrders(auth)

    // 2) Строим индекс order by normalized ФИО (при коллизиях берём самый свежий)
    const orderByFio = {}
    for (const o of orders) {
      if (!o.fio) continue
      const key = normName(o.fio)
      const existing = orderByFio[key]
      if (!existing || new Date(o.created_at) > new Date(existing.created_at)) {
        orderByFio[key] = o
      }
    }

    // 3) Получаем все листы таблицы и обрабатываем каждый
    const sheets = getSheetsClient()
    const meta = await sheets.spreadsheets.get({ spreadsheetId: CD_SPREADSHEET_ID })
    const allSheets = meta.data.sheets.map(s => ({ title: s.properties.title, id: s.properties.sheetId }))

    const results = []
    for (const s of allSheets) {
      const r = await processSheet(sheets, s.title, s.id, orderByFio)
      results.push(r)
    }

    return NextResponse.json({
      ok: true,
      rkoOrdersTotal: orders.length,
      uniqueFios: Object.keys(orderByFio).length,
      results,
    })
  } catch (err) {
    console.error('GET /api/cron/check-cd-status error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
