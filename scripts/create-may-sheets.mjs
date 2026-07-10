// Создаёт лист "Май" во всех таблицах активных менеджеров.
// Берёт за эталон лист "Апрель" из таблицы Карины Калининой
// (17Bc_DRAjCO7551ovSfWkXnmNM-HssEORUMQFw3H4X9Q) и копирует его
// в каждую таблицу через Sheets API copyTo (формат, цвета, формулы — всё сохранится).
// Потом:
//   - переименовывает лист "Копия Апрель" → "Май"
//   - перемещает на первую позицию
//   - очищает руками заполняемые ячейки C4:I36
//   - проставляет даты 01.05 … 31.05 в B4:B34
//   - переименовывает заголовок I1 "Фора-банк" → "ОТП"
//   - заменяет инструкцию в I2 на текст для ОТП
//   - если "Май" уже существует — удаляет старый и пересоздаёт.
//
// Запуск:
//   node --env-file=.env.local scripts/create-may-sheets.mjs --dry             # показать список без изменений
//   node --env-file=.env.local scripts/create-may-sheets.mjs --manager "Карина Калинина"
//   node --env-file=.env.local scripts/create-may-sheets.mjs --all
//
// Требуемые env: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
//                NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { MANAGER_SHEETS } from '../lib/sheets-config.js'

const TEMPLATE_SPREADSHEET_ID = '17Bc_DRAjCO7551ovSfWkXnmNM-HssEORUMQFw3H4X9Q'
const TEMPLATE_TAB_NAME = 'Апрель'
const NEW_TAB_NAME = 'Май'
const NEW_MONTH_NUM = 5     // май
const DAYS_IN_MONTH = 31    // в мае 31 день

// I-колонка (бывш. Фора-банк) — переименовать
const I_HEADER_NEW = 'ОТП'
const I_INSTRUCTION_NEW = 'Покупка на 100р+ одним чеком в магазине \n\nЕсли человек не может в магазине купить, то делаем 110-120р через вб/озон'

// ─── Args ───
const args = process.argv.slice(2)
const isDry = args.includes('--dry')
const isAll = args.includes('--all')
const managerArgIdx = args.indexOf('--manager')
const onlyManager = managerArgIdx >= 0 ? args[managerArgIdx + 1] : null

if (!isDry && !isAll && !onlyManager) {
  console.error('Укажи режим: --dry, --all, или --manager "Имя Фамилия"')
  process.exit(1)
}

// ─── Clients ───
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
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  return google.sheets({ version: 'v4', auth })
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

// ─── Helpers ───
function pad2(n) { return String(n).padStart(2, '0') }
function dateString(day) { return `${pad2(day)}.${pad2(NEW_MONTH_NUM)}` }

async function getActiveManagers() {
  // role IN ('manager','teamlead') — все, кто видны в "Анализ команды".
  // Уволенные имеют role='deleted' и не попадут в выборку.
  const { data, error } = await supabase
    .from('profiles')
    .select('name, role, team, sheet_id')
    .in('role', ['manager', 'teamlead'])
  if (error) throw error
  return data
}

async function migrateManager(sheets, name, spreadsheetId) {
  const log = (m) => console.log(`  [${name}] ${m}`)

  // 1. Читаем все вкладки целевой таблицы
  let meta
  try {
    meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    })
  } catch (err) {
    log(`✗ ОШИБКА доступа: ${err?.message || err}`)
    return false
  }

  const tabs = meta.data.sheets.map(s => s.properties)
  const existingMay = tabs.find(t => t.title === NEW_TAB_NAME)

  // 2. Если "Май" уже есть — удаляем
  if (existingMay) {
    log(`нашёл существующий "${NEW_TAB_NAME}" (id=${existingMay.sheetId}) — удаляю`)
    if (!isDry) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ deleteSheet: { sheetId: existingMay.sheetId } }],
        },
      })
    }
  }

  // 3. Копируем эталонный "Апрель" из шаблона Карины в эту таблицу
  log(`копирую эталон "${TEMPLATE_TAB_NAME}" из шаблона Карины`)
  let newSheetId
  if (!isDry) {
    // Получаем sheetId эталона
    const tplMeta = await sheets.spreadsheets.get({
      spreadsheetId: TEMPLATE_SPREADSHEET_ID,
      fields: 'sheets.properties',
    })
    const tplTab = tplMeta.data.sheets.find(s => s.properties.title === TEMPLATE_TAB_NAME)
    if (!tplTab) {
      log(`✗ В эталоне нет вкладки "${TEMPLATE_TAB_NAME}"`)
      return false
    }

    const copyRes = await sheets.spreadsheets.sheets.copyTo({
      spreadsheetId: TEMPLATE_SPREADSHEET_ID,
      sheetId: tplTab.properties.sheetId,
      requestBody: { destinationSpreadsheetId: spreadsheetId },
    })
    newSheetId = copyRes.data.sheetId
  }

  // 4. Один большой batchUpdate: переименовать, переместить, очистить, проставить даты, заголовок, инструкцию
  log(`переименовываю → "${NEW_TAB_NAME}", перемещаю на 1 позицию, чищу C4:I36, ставлю даты, обновляю I1/I2`)
  if (!isDry) {
    const requests = [
      // Переименовать новый лист
      {
        updateSheetProperties: {
          properties: { sheetId: newSheetId, title: NEW_TAB_NAME, index: 0 },
          fields: 'title,index',
        },
      },
      // Очистить руками заполняемые числа в C4:I36
      {
        updateCells: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 3,        // строка 4
            endRowIndex: 36,         // до 36 включительно (exclusive 36)
            startColumnIndex: 2,     // C
            endColumnIndex: 9,       // I (exclusive 9)
          },
          fields: 'userEnteredValue',
          // rows не передаём — это очистит значения в каждой ячейке диапазона
        },
      },
      // Переименовать заголовок I1: Фора-банк → ОТП
      {
        updateCells: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 0, endRowIndex: 1,
            startColumnIndex: 8, endColumnIndex: 9,
          },
          fields: 'userEnteredValue',
          rows: [{ values: [{ userEnteredValue: { stringValue: I_HEADER_NEW } }] }],
        },
      },
      // Заменить инструкцию I2
      {
        updateCells: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 1, endRowIndex: 2,
            startColumnIndex: 8, endColumnIndex: 9,
          },
          fields: 'userEnteredValue',
          rows: [{ values: [{ userEnteredValue: { stringValue: I_INSTRUCTION_NEW } }] }],
        },
      },
      // Проставить даты в B4:B34
      {
        updateCells: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 3, endRowIndex: 3 + DAYS_IN_MONTH,
            startColumnIndex: 1, endColumnIndex: 2,
          },
          fields: 'userEnteredValue',
          rows: Array.from({ length: DAYS_IN_MONTH }, (_, i) => ({
            values: [{ userEnteredValue: { stringValue: dateString(i + 1) } }],
          })),
        },
      },
    ]

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    })
  }

  log(`✓ готово`)
  return true
}

async function main() {
  console.log(`Режим: ${isDry ? 'DRY-RUN' : isAll ? 'ALL' : `ONLY "${onlyManager}"`}`)
  console.log(`Эталон: ${TEMPLATE_SPREADSHEET_ID} / ${TEMPLATE_TAB_NAME}`)
  console.log()

  const sheets = getSheetsClient()
  const activeManagers = await getActiveManagers()

  // Источник истины — profiles.sheet_id, иначе fallback в статический MANAGER_SHEETS.
  // Берём только тех у кого есть таблица.
  let toProcess = activeManagers
    .map(m => ({
      name: m.name,
      role: m.role,
      team: m.team,
      spreadsheetId: m.sheet_id || MANAGER_SHEETS[m.name] || null,
    }))
    .filter(m => !!m.spreadsheetId)

  if (onlyManager) {
    toProcess = toProcess.filter(m => m.name === onlyManager)
    if (toProcess.length === 0) {
      console.error(`Менеджер "${onlyManager}" не найден среди активных или у него нет таблицы.`)
      console.error(`Доступны: ${activeManagers.map(m => m.name).join(', ')}`)
      process.exit(1)
    }
  }

  console.log(`К обработке: ${toProcess.length} человек`)
  for (const m of toProcess) {
    console.log(`  • [${m.role}/${m.team}] ${m.name} → ${m.spreadsheetId}`)
  }
  console.log()

  const noSheet = activeManagers.filter(m => !m.sheet_id && !MANAGER_SHEETS[m.name])
  if (noSheet.length) {
    console.log(`(БЕЗ таблицы — пропускаю: ${noSheet.map(m => `${m.name} [${m.role}]`).join(', ')})\n`)
  }

  if (isDry) {
    console.log('DRY-RUN — реальных изменений не делаю.')
    return
  }

  let ok = 0, fail = 0
  for (const m of toProcess) {
    console.log(`\n→ ${m.name} (${m.spreadsheetId})`)
    try {
      const success = await migrateManager(sheets, m.name, m.spreadsheetId)
      if (success) ok++; else fail++
    } catch (err) {
      console.error(`  [${m.name}] ✗ ИСКЛЮЧЕНИЕ:`, err?.message || err)
      fail++
    }
  }

  console.log(`\n=== ИТОГО ===`)
  console.log(`Успешно: ${ok}`)
  console.log(`Ошибок:  ${fail}`)
}

main().catch(err => {
  console.error('FAIL:', err?.message || err, err?.stack)
  process.exit(1)
})
