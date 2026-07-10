// Читает структуру шаблона "Апрель" из таблицы Карины Калининой,
// чтобы понять что именно копировать в "Май".
// Запуск: node --env-file=.env.local scripts/inspect-template.mjs

import { google } from 'googleapis'

const TEMPLATE_SPREADSHEET_ID = '17Bc_DRAjCO7551ovSfWkXnmNM-HssEORUMQFw3H4X9Q'

function getSheetsClient() {
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1)
  }
  privateKey = privateKey.replace(/\\n/g, '\n')

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  return google.sheets({ version: 'v4', auth })
}

async function main() {
  const sheets = getSheetsClient()

  // 1. Список вкладок
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: TEMPLATE_SPREADSHEET_ID,
    fields: 'sheets.properties',
  })
  console.log('=== ВКЛАДКИ ===')
  for (const s of meta.data.sheets) {
    const p = s.properties
    console.log(`  "${p.title}"  (id=${p.sheetId}, rows=${p.gridProperties.rowCount}, cols=${p.gridProperties.columnCount})`)
  }

  const aprilSheet = meta.data.sheets.find(s => s.properties.title === 'Апрель')
  if (!aprilSheet) {
    console.log('Нет вкладки "Апрель"!')
    return
  }
  const aprilSheetId = aprilSheet.properties.sheetId

  // 2. Значения и формулы из A1:J40
  const valsRes = await sheets.spreadsheets.values.get({
    spreadsheetId: TEMPLATE_SPREADSHEET_ID,
    range: `Апрель!A1:J40`,
    valueRenderOption: 'FORMULA',
  })
  console.log('\n=== ФОРМУЛЫ/ЗНАЧЕНИЯ A1:J40 (Апрель) ===')
  const rows = valsRes.data.values || []
  rows.forEach((r, i) => {
    console.log(`Row ${i + 1}:`, r.map(c => (c === '' ? '·' : c)).join(' | '))
  })

  // 3. Полная структура листа (формат, мерджи, ширины) для одной первой строки данных
  const fullRes = await sheets.spreadsheets.get({
    spreadsheetId: TEMPLATE_SPREADSHEET_ID,
    ranges: [`Апрель!A1:J40`],
    includeGridData: true,
    fields: 'sheets(properties,merges,data(rowData(values(userEnteredValue,userEnteredFormat,effectiveValue,formattedValue))))',
  })
  const aprilFull = fullRes.data.sheets.find(s => s.properties.title === 'Апрель')
  console.log('\n=== МЕРДЖИ ===')
  console.log(JSON.stringify(aprilFull.merges || [], null, 2))

  // 4. Проверим формулу в A4 (первая строка данных)
  const data = aprilFull.data?.[0]?.rowData || []
  console.log('\n=== ЯЧЕЙКА A4 (формула суммы) ===')
  console.log(JSON.stringify(data[3]?.values?.[0]?.userEnteredValue, null, 2))
  console.log('\n=== ЯЧЕЙКА B4 (дата) ===')
  console.log(JSON.stringify(data[3]?.values?.[1]?.userEnteredValue, null, 2))
  console.log('\n=== ЯЧЕЙКА I1 (заголовок Фора-банк) ===')
  console.log(JSON.stringify(data[0]?.values?.[8], null, 2))
  console.log('\n=== ЯЧЕЙКА I2 (текст инструкции) ===')
  console.log(JSON.stringify(data[1]?.values?.[8]?.userEnteredValue, null, 2))
}

main().catch(err => {
  console.error('FAIL:', err?.message || err)
  process.exit(1)
})
