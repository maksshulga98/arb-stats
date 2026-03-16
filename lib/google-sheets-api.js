import { google } from 'googleapis'
import { CONTACTS_SPREADSHEET_ID } from './sheets-config'

// Колонка (0-based индекс) → буква
const COLUMN_LETTERS = ['A', 'B', 'C', 'D', 'E']

/**
 * Создаёт авторизованный клиент Google Sheets API v4
 */
function getSheetsClient() {
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''

  // Убираем обрамляющие кавычки если есть (некоторые хостинги добавляют)
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1)
  }

  // Заменяем литеральные \n на реальные переносы строк
  privateKey = privateKey.replace(/\\n/g, '\n')

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  return google.sheets({ version: 'v4', auth })
}

/**
 * Читает все контакты из указанной колонки, пропуская заголовок (строка 1).
 * Возвращает массив { value, rowIndex } для непустых ячеек.
 */
export async function readColumnContacts(columnIndex) {
  const sheets = getSheetsClient()
  const col = COLUMN_LETTERS[columnIndex]

  // Читаем колонку начиная со 2-й строки (пропуск заголовка)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONTACTS_SPREADSHEET_ID,
    range: `${col}2:${col}`,
  })

  const rows = res.data.values || []
  const contacts = []

  for (let i = 0; i < rows.length; i++) {
    const value = (rows[i]?.[0] || '').trim()
    if (value) {
      contacts.push({
        value,
        rowIndex: i + 2, // +2: 0-based массив + пропуск заголовка
      })
    }
  }

  return contacts
}

/**
 * Получает доступные (невыданные) контакты.
 * claimedRowIndices — Set или массив уже выданных номеров строк.
 */
export function filterAvailableContacts(allContacts, claimedRowIndices) {
  const claimed = new Set(claimedRowIndices)
  return allContacts.filter(c => !claimed.has(c.rowIndex))
}

/**
 * Закрашивает указанные строки в колонке зелёным цветом.
 */
export async function colorRowsGreen(columnIndex, rowIndices) {
  if (!rowIndices.length) return

  const sheets = getSheetsClient()

  // Получаем sheetId первого листа
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: CONTACTS_SPREADSHEET_ID,
    fields: 'sheets.properties.sheetId',
  })
  const sheetId = spreadsheet.data.sheets[0].properties.sheetId

  // Формируем запросы на окрашивание для каждой строки
  const requests = rowIndices.map(rowIdx => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rowIdx - 1,   // 0-based
        endRowIndex: rowIdx,          // exclusive
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: {
            red: 0.7176,
            green: 0.8824,
            blue: 0.6039,
            alpha: 1,
          },
        },
      },
      fields: 'userEnteredFormat.backgroundColor',
    },
  }))

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: CONTACTS_SPREADSHEET_ID,
    requestBody: { requests },
  })
}
