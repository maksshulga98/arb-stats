import { NextResponse } from 'next/server'
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

// GET /api/sheets?names=Имя1,Имя2&date=2026-03-13
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const names = searchParams.get('names')?.split(',') || []
  const dateStr = searchParams.get('date') // YYYY-MM-DD

  if (!dateStr || names.length === 0) {
    return NextResponse.json({ error: 'Missing names or date' }, { status: 400 })
  }

  const [year, month] = dateStr.split('-')
  const monthIndex = parseInt(month) - 1
  const monthName = MONTHS_RU[monthIndex]
  if (!monthName) {
    return NextResponse.json({ error: 'Invalid month' }, { status: 400 })
  }

  // Target date in DD.MM format (as used in the sheets)
  const day = dateStr.split('-')[2]
  const targetDate = `${day}.${month}`

  const results = {}

  await Promise.all(
    names.map(async (name) => {
      const spreadsheetId = MANAGER_SHEETS[name]
      if (!spreadsheetId) {
        results[name] = null
        return
      }

      try {
        const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(monthName)}`
        const res = await fetch(url, { next: { revalidate: 300 } }) // cache 5 min
        if (!res.ok) {
          results[name] = null
          return
        }

        const text = await res.text()
        const rows = parseCSV(text)
        if (rows.length < 2) {
          results[name] = null
          return
        }

        // Find the row matching the target date
        let dayRow = null
        for (let i = 1; i < rows.length; i++) {
          const cellDate = rows[i][COL_DATE]
          if (cellDate === targetDate) {
            dayRow = rows[i]
            break
          }
        }

        if (!dayRow) {
          results[name] = { total: 0, ip: 0, debit: 0, products: {} }
          return
        }

        // Extract product values
        // Col 2 (index 0) = Альфа ИП → ip
        // Cols 3-7 (indices 1-5) = дебетовые карты → debit
        const products = {}
        let total = 0
        let ip = 0
        let debit = 0
        for (let col = COL_PRODUCTS_START; col <= COL_PRODUCTS_END; col++) {
          const val = parseInt(dayRow[col]) || 0
          const idx = col - COL_PRODUCTS_START
          const productName = PRODUCT_NAMES[idx] || `Продукт ${idx + 1}`
          products[productName] = val
          total += val
          if (idx === 0) ip += val
          else debit += val
        }

        results[name] = { total, ip, debit, products }
      } catch {
        results[name] = null
      }
    })
  )

  return NextResponse.json(results)
}
