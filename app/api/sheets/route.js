// Тонкая обёртка над lib/sheets-data.js — клиентские страницы дёргают этот эндпоинт
// для команд-аналитики и зарплатной вкладки.
// Сама логика чтения Google Sheets вынесена в lib/sheets-data.js
// (там же её использует cron /api/cron/daily-summary).

import { NextResponse } from 'next/server'
import { fetchSheetsData } from '../../../lib/sheets-data'

// GET /api/sheets?names=Имя1,Имя2&dateFrom=2026-03-01&dateTo=2026-03-13
// Legacy: &date=2026-03-13 (single day)
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const names = searchParams.get('names')?.split(',').filter(Boolean) || []
  const dateFrom = searchParams.get('dateFrom') || searchParams.get('date')
  const dateTo = searchParams.get('dateTo') || dateFrom

  if (!dateFrom || names.length === 0) {
    return NextResponse.json({ error: 'Missing names or date' }, { status: 400 })
  }

  const results = await fetchSheetsData(names, dateFrom, dateTo)
  return NextResponse.json(results)
}
