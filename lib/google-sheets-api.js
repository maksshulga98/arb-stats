import { google } from 'googleapis'
import { CONTACTS_SPREADSHEET_ID } from './sheets-config'

// Колонка (0-based индекс) → буква
const COLUMN_LETTERS = ['A', 'B', 'C', 'D', 'E']

/**
 * Создаёт авторизованный клиент Google Sheets API v4
 */
export function getSheetsClient() {
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
 * Зеленоватая ли заливка ячейки?
 * Считаем "выданным" если green > 0.5 И green преобладает над red и blue.
 * Покрывает и наш стандартный оттенок (#B7E1B7 — 0.7176/0.8824/0.6039),
 * и любые ручные оттенки зелёного, которые пользователь может поставить.
 * Белый/прозрачный/жёлтый/красный/синий — НЕ зелёный.
 */
function isGreenish(bg) {
  if (!bg) return false
  const r = bg.red ?? 0
  const g = bg.green ?? 0
  const b = bg.blue ?? 0
  return g > 0.5 && g > r && g > b
}

/**
 * Читает все контакты из указанной колонки вместе с информацией о заливке.
 * Возвращает { value, rowIndex, isClaimed } для непустых ячеек.
 *
 * isClaimed=true если ячейка залита зелёным (= уже выдавалась раньше).
 * Это позволяет ПОЛЬЗОВАТЕЛЮ сбрасывать выдачи через очистку таблицы:
 * стереть заливку → стать "свободной" автоматически, без правок в БД.
 */
export async function readColumnContacts(columnIndex) {
  const sheets = getSheetsClient()
  const col = COLUMN_LETTERS[columnIndex]

  // Читаем колонку начиная со 2-й строки (пропуск заголовка) + цвет фона
  const res = await sheets.spreadsheets.get({
    spreadsheetId: CONTACTS_SPREADSHEET_ID,
    ranges: [`${col}2:${col}`],
    fields: 'sheets(data(rowData(values(formattedValue,effectiveFormat/backgroundColor))))',
  })

  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || []
  const contacts = []

  for (let i = 0; i < rowData.length; i++) {
    const cell = rowData[i]?.values?.[0]
    const value = (cell?.formattedValue || '').trim()
    if (!value) continue
    contacts.push({
      value,
      rowIndex: i + 2, // +2: 0-based массив + пропуск заголовка
      isClaimed: isGreenish(cell?.effectiveFormat?.backgroundColor),
    })
  }

  return contacts
}

/**
 * Получает доступные (невыданные) контакты — те, где isClaimed=false.
 * claimedRowIndices больше НЕ используется как source of truth, но
 * параметр оставлен для обратной совместимости — игнорируется.
 */
export function filterAvailableContacts(allContacts /* , claimedRowIndices игнорируется */) {
  return allContacts.filter(c => !c.isClaimed)
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
