// Создаёт лист "Июль" во всех таблицах активных менеджеров.
// Эталон — лист "Июнь" в таблице Карины Калининой (она шаблон-носитель формата).
// Копируем через Sheets API copyTo (форматы, цвета, формулы сохраняются), потом:
//   - переименовываем "Копия Июнь" → "Июль"
//   - перемещаем на 1-ю позицию
//   - чистим C4:I36
//   - проставляем даты 01.07 … 31.07 в B4:B34
//   - если "Июль" уже есть — удаляем и создаём заново
//
// 30.06.2026: Софа Толмачева пропускается — у неё нет sheet_id
// (она "менеджер друга", только берёт номера, не ведёт отчёты).
//
// Запуск:
//   node --env-file=.env.local scripts/create-july-sheets.mjs --dry
//   node --env-file=.env.local scripts/create-july-sheets.mjs --manager "Анна Петрова"
//   node --env-file=.env.local scripts/create-july-sheets.mjs --all

import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { MANAGER_SHEETS } from '../lib/sheets-config.js'

const TEMPLATE_SPREADSHEET_ID = '17Bc_DRAjCO7551ovSfWkXnmNM-HssEORUMQFw3H4X9Q' // Карина Калинина
const TEMPLATE_TAB_NAME = 'Июнь'
const NEW_TAB_NAME = 'Июль'
const NEW_MONTH_NUM = 7
const DAYS_IN_MONTH = 31 // в июле 31 день

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
  // role='deleted' и team=null не попадут.
  const { data, error } = await supabase
    .from('profiles')
    .select('name, role, team, sheet_id')
    .in('role', ['manager', 'teamlead'])
    .not('team', 'is', null)
  if (error) throw error
  return data
}

async function migrateManager(sheets, name, spreadsheetId) {
  const log = (m) => console.log(`  [${name}] ${m}`)

  // 1) Читаем вкладки таблицы менеджера
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

  // 2) Если "Июнь" уже есть — удаляем
  const existingJune = tabs.find(t => t.title === NEW_TAB_NAME)
  if (existingJune) {
    log(`нашёл существующий "${NEW_TAB_NAME}" (id=${existingJune.sheetId}) — удаляю`)
    if (!isDry) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId: existingJune.sheetId } }] },
      })
    }
  }

  // 3) Копируем эталонный "Май" из Карины в таблицу менеджера
  log(`копирую эталон "${TEMPLATE_TAB_NAME}" из шаблона Карины`)
  let newSheetId
  if (!isDry) {
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

  // 4) Один батч: переименовать, переместить, очистить, проставить даты
  log(`переименовываю → "${NEW_TAB_NAME}", index=0, чищу C4:I36, ставлю даты 01.${String(NEW_MONTH_NUM).padStart(2,'0')}–${DAYS_IN_MONTH}.${String(NEW_MONTH_NUM).padStart(2,'0')}`)
  if (!isDry) {
    const requests = [
      {
        updateSheetProperties: {
          properties: { sheetId: newSheetId, title: NEW_TAB_NAME, index: 0 },
          fields: 'title,index',
        },
      },
      // Очистить C4:I36
      {
        updateCells: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 3, endRowIndex: 36,
            startColumnIndex: 2, endColumnIndex: 9,
          },
          fields: 'userEnteredValue',
        },
      },
      // Проставить даты B4:B33 (30 дней июня)
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
      // Строка ниже 31.07 (B35) — очищаем на случай если из шаблона Июнь там
      // осталось значение (в июне было 30 дней, у нас 31 — сдвиг не должен
      // ничего лишнего оставить, но перестрахуемся).
      {
        updateCells: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 34, endRowIndex: 35,
            startColumnIndex: 1, endColumnIndex: 2,
          },
          fields: 'userEnteredValue',
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
  console.log(`Эталон: ${TEMPLATE_SPREADSHEET_ID} / лист "${TEMPLATE_TAB_NAME}"`)
  console.log()

  const sheets = getSheetsClient()
  const activeManagers = await getActiveManagers()

  let toProcess = activeManagers
    .map(m => ({
      name: m.name,
      role: m.role,
      team: m.team,
      spreadsheetId: m.sheet_id || MANAGER_SHEETS[m.name] || null,
    }))
    .filter(m => !!m.spreadsheetId)

  if (onlyManager) {
    toProcess = toProcess.filter(m => m.name === onlyManager || m.name?.trim() === onlyManager?.trim())
    if (toProcess.length === 0) {
      console.error(`Менеджер "${onlyManager}" не найден.`)
      console.error(`Доступны: ${activeManagers.map(m => `"${m.name}"`).join(', ')}`)
      process.exit(1)
    }
  }

  console.log(`К обработке: ${toProcess.length} человек`)
  for (const m of toProcess) {
    console.log(`  • [${m.role}/${m.team}] ${m.name} → ${m.spreadsheetId.slice(0, 20)}...`)
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
    console.log(`\n→ ${m.name}`)
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
