import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  MANAGER_SHEETS,
  MONTHS_RU,
  COL_DATE,
  COL_PRODUCTS_START,
  COL_PRODUCTS_END,
  PRODUCT_NAMES,
} from '../../../lib/sheets-config'

function parseCSV(text) {
  const rows = []
  let inQuotes = false
  let cell = ''
  let cells = []

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      cells.push(cell.trim())
      cell = ''
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++ // skip \r\n
      cells.push(cell.trim())
      if (cells.some(c => c !== '')) rows.push(cells)
      cells = []
      cell = ''
    } else {
      cell += ch
    }
  }
  // last row
  cells.push(cell.trim())
  if (cells.some(c => c !== '')) rows.push(cells)

  return rows
}

// Build set of DD.MM dates for the given range
function buildDateSet(dateFrom, dateTo) {
  const dates = new Set()
  const d = new Date(dateFrom + 'T00:00:00')
  const end = new Date(dateTo + 'T00:00:00')
  while (d <= end) {
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    dates.add(`${dd}.${mm}`)
    d.setDate(d.getDate() + 1)
  }
  return dates
}

// Get unique months (0-based) from a date range
function getMonths(dateFrom, dateTo) {
  const months = new Set()
  const d = new Date(dateFrom + 'T00:00:00')
  const end = new Date(dateTo + 'T00:00:00')
  while (d <= end) {
    months.add(d.getMonth())
    d.setMonth(d.getMonth() + 1, 1)
  }
  // also add the end month
  months.add(new Date(dateTo + 'T00:00:00').getMonth())
  return [...months]
}

function extractRow(dayRow) {
  const products = {}
  let total = 0, ip = 0, debit = 0
  for (let col = COL_PRODUCTS_START; col <= COL_PRODUCTS_END; col++) {
    const val = parseInt(dayRow[col]) || 0
    const idx = col - COL_PRODUCTS_START
    const productName = PRODUCT_NAMES[idx] || `Продукт ${idx + 1}`
    products[productName] = (products[productName] || 0) + val
    total += val
    if (idx === 0) ip += val
    else debit += val
  }
  return { total, ip, debit, products }
}

// GET /api/sheets?names=Имя1,Имя2&dateFrom=2026-03-01&dateTo=2026-03-13
// Also supports legacy: &date=2026-03-13 (single day)
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const names = searchParams.get('names')?.split(',') || []
  const dateFrom = searchParams.get('dateFrom') || searchParams.get('date')
  const dateTo = searchParams.get('dateTo') || dateFrom

  if (!dateFrom || names.length === 0) {
    return NextResponse.json({ error: 'Missing names or date' }, { status: 400 })
  }

  const targetDates = buildDateSet(dateFrom, dateTo)
  const months = getMonths(dateFrom, dateTo)

  // Validate months
  for (const m of months) {
    if (!MONTHS_RU[m]) {
      return NextResponse.json({ error: 'Invalid month' }, { status: 400 })
    }
  }

  // Look up sheet_id from DB, fallback to hardcoded config
  const dbSheetMap = {}
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('name, sheet_id')
      .in('name', names)
    if (profiles) {
      for (const p of profiles) {
        if (p.sheet_id) dbSheetMap[p.name] = p.sheet_id
      }
    }
  } catch (e) {
    console.error('GET /api/sheets DB lookup failed (using hardcoded fallback):', e?.message || e)
  }

  const results = {}

  await Promise.all(
    names.map(async (name) => {
      const spreadsheetId = dbSheetMap[name] || MANAGER_SHEETS[name]
      if (!spreadsheetId) {
        results[name] = null
        return
      }

      try {
        const acc = { total: 0, ip: 0, debit: 0, products: {} }

        // Fetch each month's sheet that falls in the range
        await Promise.all(
          months.map(async (monthIndex) => {
            const monthName = MONTHS_RU[monthIndex]
            const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(monthName)}`
            const res = await fetch(url, { next: { revalidate: 1800 } })
            if (!res.ok) return

            const text = await res.text()
            const rows = parseCSV(text)

            for (let i = 1; i < rows.length; i++) {
              const cellDate = rows[i][COL_DATE]
              if (targetDates.has(cellDate)) {
                const row = extractRow(rows[i])
                acc.total += row.total
                acc.ip += row.ip
                acc.debit += row.debit
                for (const [k, v] of Object.entries(row.products)) {
                  acc.products[k] = (acc.products[k] || 0) + v
                }
              }
            }
          })
        )

        results[name] = acc
      } catch (e) {
        console.error(`Failed to fetch sheets for "${name}":`, e?.message || e)
        results[name] = null
      }
    })
  )

  return NextResponse.json(results)
}
