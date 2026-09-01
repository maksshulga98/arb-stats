// Создание вкладок «Сентябрь» всем активным членам команд.
//
// Отличие от прошлых месяцев: эталон НЕ из таблицы Карины (там нет Июля и
// формат старый), а АВГУСТОВСКАЯ ВКЛАДКА САМОГО МЕНЕДЖЕРА — так новый формат
// (столбец D = «Симка Билайн») переносится гарантированно, вместе с формулами
// и оформлением конкретной таблицы.
//
// Что делает для каждого менеджера:
//   1. находит свою вкладку «Август»
//   2. если «Сентябрь» уже есть — ПЕРЕИМЕНОВЫВАЕТ в «Сентябрь <год-1>» (не удаляет!),
//      чтобы не потерять исторические данные прошлого сезона
//   3. дублирует «Август» → «Сентябрь», ставит первой вкладкой
//   4. чистит данные C4:I36 и проставляет даты 01.09–30.09
//
// Запуск:  node scripts/create-september-sheets.mjs          (DRY-RUN, только план)
//          APPLY=1 node scripts/create-september-sheets.mjs   (реальное создание)

import { google } from 'googleapis'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.env.APPLY === '1'
const NEW_TAB_NAME = 'Сентябрь'
const SRC_TAB_NAME = 'Август'
const NEW_MONTH_NUM = 9
const DAYS_IN_MONTH = 30
const ARCHIVE_SUFFIX = ' 2025'   // старая сентябрьская вкладка → «Сентябрь 2025»

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = line.indexOf('='); if (i < 0) continue
  const k = line.slice(0, i).trim(); let v = line.slice(i + 1).trim()
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
  env[k] = v
}
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: (env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})
const sheets = google.sheets({ version: 'v4', auth })
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const pad2 = n => String(n).padStart(2, '0')
const dateString = day => `${pad2(day)}.${pad2(NEW_MONTH_NUM)}`

async function processManager(p) {
  const log = (msg) => console.log(`  ${p.name}: ${msg}`)
  let meta
  try {
    meta = await sheets.spreadsheets.get({ spreadsheetId: p.sheet_id, fields: 'sheets.properties(sheetId,title)' })
  } catch (e) {
    log(`✗ нет доступа к таблице: ${e.message?.slice(0, 60)}`)
    return false
  }
  const tabs = meta.data.sheets.map(s => s.properties)

  const src = tabs.find(t => t.title.trim() === SRC_TAB_NAME)
  if (!src) { log(`✗ нет вкладки «${SRC_TAB_NAME}» — пропускаю`); return false }

  const requests = []

  // Старую вкладку «Сентябрь» (прошлогоднюю) не удаляем — архивируем
  const existing = tabs.find(t => t.title.trim() === NEW_TAB_NAME)
  if (existing) {
    const archiveTitle = NEW_TAB_NAME + ARCHIVE_SUFFIX
    log(`найден старый «${NEW_TAB_NAME}» → переименую в «${archiveTitle}» (данные сохранятся)`)
    if (APPLY) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: p.sheet_id,
        requestBody: { requests: [{
          updateSheetProperties: { properties: { sheetId: existing.sheetId, title: archiveTitle }, fields: 'title' },
        }] },
      })
    }
  }

  log(`дублирую «${SRC_TAB_NAME}» → «${NEW_TAB_NAME}», чищу C4:I36, даты 01.09–${DAYS_IN_MONTH}.09`)
  if (!APPLY) return true

  // Дублируем августовскую вкладку внутри той же таблицы
  const dup = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: p.sheet_id,
    requestBody: { requests: [{ duplicateSheet: { sourceSheetId: src.sheetId, insertSheetIndex: 0 } }] },
  })
  const newSheetId = dup.data.replies[0].duplicateSheet.properties.sheetId

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: p.sheet_id,
    requestBody: { requests: [
      { updateSheetProperties: { properties: { sheetId: newSheetId, title: NEW_TAB_NAME, index: 0 }, fields: 'title,index' } },
      // очистить данные за месяц (C..I), формулы столбца A и шапка остаются
      { updateCells: { range: { sheetId: newSheetId, startRowIndex: 3, endRowIndex: 36, startColumnIndex: 2, endColumnIndex: 9 }, fields: 'userEnteredValue' } },
      // проставить даты 01.09 … 30.09
      { updateCells: {
          range: { sheetId: newSheetId, startRowIndex: 3, endRowIndex: 3 + DAYS_IN_MONTH, startColumnIndex: 1, endColumnIndex: 2 },
          fields: 'userEnteredValue',
          rows: Array.from({ length: DAYS_IN_MONTH }, (_, i) => ({ values: [{ userEnteredValue: { stringValue: dateString(i + 1) } }] })),
      } },
      // Если в прошлом месяце дней было больше (31 → 30), внизу остаётся чужая
      // дата вроде «31.08» — вычищаем хвост столбца B до конца блока.
      { updateCells: { range: { sheetId: newSheetId, startRowIndex: 3 + DAYS_IN_MONTH, endRowIndex: 36, startColumnIndex: 1, endColumnIndex: 2 }, fields: 'userEnteredValue' } },
    ] },
  })
  log('✓ готово')
  return true
}

const { data: people, error: peopleErr } = await sb.from('profiles')
  .select('name, role, team, sheet_id')
  .in('role', ['manager', 'teamlead'])
  .not('team', 'is', null)
  .not('sheet_id', 'is', null)
  .order('team')

if (peopleErr) { console.error("Ошибка запроса профилей:", peopleErr.message); process.exit(1) }
console.log(`${APPLY ? 'СОЗДАНИЕ' : 'DRY-RUN (ничего не меняю)'} — вкладки «${NEW_TAB_NAME}» для ${people.length} чел.\n`)
let ok = 0, fail = 0
for (const p of people) {
  console.log(`[${p.team}] ${p.name}`)
  const res = await processManager(p)
  res ? ok++ : fail++
}
console.log(`\nИтог: успешно ${ok}, пропущено/ошибок ${fail}${APPLY ? '' : '  (для реального запуска: APPLY=1)'}`)
