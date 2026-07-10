// Проверяет содержимое нового листа "Май" у указанного менеджера.
// node --env-file=.env.local scripts/verify-may.mjs <spreadsheetId>

import { google } from 'googleapis'

const spreadsheetId = process.argv[2]
if (!spreadsheetId) { console.error('usage: verify-may.mjs <spreadsheetId>'); process.exit(1) }

function getSheetsClient() {
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1)
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

const sheets = getSheetsClient()

// Список вкладок и их порядок
const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' })
console.log('=== ВКЛАДКИ ===')
for (const s of meta.data.sheets) {
  const p = s.properties
  console.log(`  [idx ${p.index}] "${p.title}" (id=${p.sheetId})`)
}

// Читаем содержимое Май
const v = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: `Май!A1:J40`,
  valueRenderOption: 'FORMULA',
})
console.log('\n=== Май!A1:J40 ===')
;(v.data.values || []).forEach((r, i) => {
  console.log(`Row ${(i + 1).toString().padStart(2)}:`, r.map(c => c === '' ? '·' : c).join(' | '))
})
