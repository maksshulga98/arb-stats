// Ежедневная сводка по командам в Telegram.
// Cron: 18:00 UTC = 21:00 МСК (vercel.json).
//
// 06.2026: формат отчётов упрощён до 2 полей — написавшие (people_wrote)
// и заказали РКО (ordered_ip). Старые отписанные/ответившие/карты остаются
// в БД но в сводку не идут.
// Метрики на менеджера: написавшие, заказали РКО, ЦД ИП (из Google Sheets),
// ЦД дебетовые (из Google Sheets), взято номеров (из contact_distributions).
// Плюс итоги за день, за месяц и сравнение со вчера.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { broadcastTelegramMessage, escapeHtml } from '../../../../lib/telegram'
import { fetchSheetsData } from '../../../../lib/sheets-data'
import { fetchTeamsFromDb } from '../../../../lib/teams'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Используется ТОЛЬКО если таблица teams в БД пустая или недоступна
// (например миграция ещё не применена). В норме сам список команд грузится
// в GET() через fetchTeamsFromDb и кладётся в локальную переменную.
const STATIC_TEAMS_FALLBACK = [
  { id: 'olya',      name: 'Оли',       type: 'standard' },
  { id: 'nikita',    name: 'Никиты',    type: 'nikita'   },
]

// Пороги зон — те же что в admin/page.js getZoneKey().
function zoneEmoji(value, teamType) {
  if (teamType === 'karina') return value < 15 ? '🔴' : value <= 30 ? '🟡' : '🟢'
  return value < 10 ? '🔴' : value <= 15 ? '🟡' : '🟢'
}

const MONTHS_GEN = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
const WEEKDAYS   = ['вс','пн','вт','ср','чт','пт','сб']
const MONTHS_GEN_LC = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']

// YYYY-MM-DD в МСК
function mskDate(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(d)
}

// 1-е число текущего месяца в МСК (YYYY-MM-01)
function firstDayOfMonthMsk() {
  const today = mskDate(0)
  return today.slice(0, 7) + '-01'
}

function fmtSigned(n) {
  if (n === 0) return '±0'
  return n > 0 ? `+${n}` : String(n)
}

function fmtDateHuman(yyyyMmDd) {
  const [y, m, day] = yyyyMmDd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day))
  return `${day} ${MONTHS_GEN_LC[m - 1]} (${WEEKDAYS[dt.getUTCDay()]})`
}

function currentMonthName(yyyyMmDd) {
  const m = Number(yyyyMmDd.slice(5, 7))
  return MONTHS_GEN[m - 1]
}

// Сумма по полю с фильтром даты
function sumByField(rows, field) {
  return (rows || []).reduce((s, r) => s + (r[field] || 0), 0)
}

// Подсчёт "взято номеров" — длина всех contacts[] флэт
function countContacts(distributions) {
  let n = 0
  for (const d of (distributions || [])) {
    if (Array.isArray(d.contacts)) {
      for (const g of d.contacts) if (Array.isArray(g)) n += g.length
    }
  }
  return n
}

export async function GET(request) {
  try {
    // Auth — как в check-cd-status
    const authHeader = request.headers.get('authorization')
    const isVercelCron = request.headers.get('x-vercel-cron') !== null
    const cronSecret = process.env.CRON_SECRET
    if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN не задан' }, { status: 500 })
    const recipients = [
      process.env.TELEGRAM_CHAT_ID_OWNER,
      process.env.TELEGRAM_CHAT_ID_NIKITA,
    ].filter(Boolean)
    if (recipients.length === 0) {
      return NextResponse.json({ error: 'Нет TELEGRAM_CHAT_ID_*' }, { status: 500 })
    }

    // Выбор "сегодня" для сводки:
    //   - ?date=YYYY-MM-DD     — конкретная дата (отладка / бэкфилл)
    //   - ?offset=N            — N дней назад (используется утренним cron'ом: offset=-1)
    //   - по умолчанию         — текущий день в МСК
    // Ограничение offset: -7..0 (защита от случайных гигантских сводок).
    const url = new URL(request.url)
    const overrideDate = url.searchParams.get('date')
    const rawOffset = parseInt(url.searchParams.get('offset')) || 0
    const offset = Math.max(-7, Math.min(0, rawOffset))
    const isMorningRecap = offset === -1   // для заголовка сводки
    const today = overrideDate && /^\d{4}-\d{2}-\d{2}$/.test(overrideDate)
      ? overrideDate
      : mskDate(offset)

    // yesterday/monthStart вычисляем относительно today
    const yesterdayDt = new Date(`${today}T12:00:00Z`)
    yesterdayDt.setUTCDate(yesterdayDt.getUTCDate() - 1)
    const yesterday  = yesterdayDt.toISOString().slice(0, 10)
    const monthStart = today.slice(0, 7) + '-01'
    const monthName  = currentMonthName(today)

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // Подгружаем актуальный список команд из БД. Если таблицы нет или пусто —
    // остаёмся на STATIC_TEAMS_FALLBACK. Локальная переменная — чтобы не было
    // race condition'а между параллельными вызовами cron'а в serverless.
    const teamsFromDb = await fetchTeamsFromDb(supabase)
    const TEAMS = teamsFromDb.length > 0
      ? teamsFromDb.map(t => ({ id: t.slug, name: t.name, type: t.type }))
      : STATIC_TEAMS_FALLBACK

    // 1) Активные менеджеры
    const { data: managers, error: mErr } = await supabase
      .from('profiles')
      .select('id, name, team')
      .eq('role', 'manager')
      .not('team', 'is', null)
    if (mErr) throw new Error(`profiles: ${mErr.message}`)

    const managerNames = (managers || []).map(m => m.name).filter(Boolean)
    const mgrsByTeam = new Map()
    for (const m of (managers || [])) {
      if (!mgrsByTeam.has(m.team)) mgrsByTeam.set(m.team, [])
      mgrsByTeam.get(m.team).push(m)
    }

    // 2) reports — сегодня, вчера и весь месяц (для итога за месяц)
    // 06.2026: только 2 поля — people_wrote (Написавшие) и ordered_ip (Заказали РКО).
    // Старые колонки в БД остаются, но в сводку не идут.
    const { data: allReports, error: rErr } = await supabase
      .from('reports')
      .select('manager_id, date, ordered_ip, ordered_simka, people_wrote')
      .gte('date', monthStart)
      .lte('date', today)
    if (rErr) throw new Error(`reports: ${rErr.message}`)

    const repsTodayByMgr = new Map()   // id → {ip, wrote}
    const repsYestByMgr  = new Map()
    const repsMonthByMgr = new Map()
    for (const r of (allReports || [])) {
      const entry = { ip: r.ordered_ip||0, simka: r.ordered_simka||0, wrote: r.people_wrote||0 }
      if (r.date === today) repsTodayByMgr.set(r.manager_id, entry)
      if (r.date === yesterday) repsYestByMgr.set(r.manager_id, entry)
      const m = repsMonthByMgr.get(r.manager_id) || { ip:0, wrote:0 }
      m.ip+=entry.ip; m.wrote+=entry.wrote
      repsMonthByMgr.set(r.manager_id, m)
    }

    // 3) contact_distributions — сегодня и за месяц
    // distributed_at — timestamptz, фильтруем по диапазону дней МСК
    const todayStartIso = new Date(`${today}T00:00:00+03:00`).toISOString()
    const todayEndIso   = new Date(`${today}T23:59:59+03:00`).toISOString()
    const monthStartIso = new Date(`${monthStart}T00:00:00+03:00`).toISOString()

    const [todayContactsRes, monthContactsRes] = await Promise.all([
      supabase.from('contact_distributions')
        .select('manager_id, contacts, accounts_count')
        .gte('distributed_at', todayStartIso).lte('distributed_at', todayEndIso),
      supabase.from('contact_distributions')
        .select('manager_id, contacts, accounts_count')
        .gte('distributed_at', monthStartIso).lte('distributed_at', todayEndIso),
    ])
    if (todayContactsRes.error) throw new Error(`contacts today: ${todayContactsRes.error.message}`)
    if (monthContactsRes.error) throw new Error(`contacts month: ${monthContactsRes.error.message}`)

    const numbersToday = new Map() // id → count
    const numbersMonth = new Map()
    for (const d of (todayContactsRes.data || [])) {
      const cnt = countContacts([d])
      numbersToday.set(d.manager_id, (numbersToday.get(d.manager_id) || 0) + cnt)
    }
    for (const d of (monthContactsRes.data || [])) {
      const cnt = countContacts([d])
      numbersMonth.set(d.manager_id, (numbersMonth.get(d.manager_id) || 0) + cnt)
    }

    // 4) ЦД из Google Sheets — параллельно за сегодня и за месяц
    const [cdToday, cdMonth] = await Promise.all([
      fetchSheetsData(managerNames, today, today),
      fetchSheetsData(managerNames, monthStart, today),
    ])

    // 5) Собираем сообщение
    const lines = []
    lines.push(isMorningRecap
      ? `🌅 <b>Финальная сводка за ${fmtDateHuman(today)}</b> <i>(включая отчёты, сданные утром)</i>`
      : `📊 <b>Сводка за ${fmtDateHuman(today)}</b>`)
    lines.push('')

    // 06.2026: метрики упрощены до 2 — Написавшие (wrote) и Заказали РКО (ip).
    let totIpDay=0,totIpYest=0,totWroteDay=0,totCdIpDay=0,totCdCardsDay=0,totNumDay=0
    let totIpMonth=0,totWroteMonth=0,totCdIpMonth=0,totCdCardsMonth=0,totNumMonth=0
    const missing = []

    for (const team of TEAMS) {
      const teamMgrs = mgrsByTeam.get(team.id) || []
      if (teamMgrs.length === 0) continue

      // Команда: суммы за сегодня + вчера для дельты
      let ipDay=0,wroteDay=0,ipYestTeam=0
      for (const m of teamMgrs) {
        const t = repsTodayByMgr.get(m.id) || { ip:0, wrote:0 }
        const y = repsYestByMgr.get(m.id)  || { ip:0, wrote:0 }
        ipDay+=t.ip; wroteDay+=t.wrote; ipYestTeam+=y.ip
      }
      totIpDay+=ipDay; totWroteDay+=wroteDay; totIpYest+=ipYestTeam

      const emoji = zoneEmoji(ipDay, 'standard')
      lines.push(`${emoji} <b>Команда ${escapeHtml(team.name)}</b> — ${ipDay} РКО (${fmtSigned(ipDay-ipYestTeam)}), ${wroteDay} написавших`)

      // Сортируем по РКО убыв
      const sorted = [...teamMgrs].sort((a, b) => {
        const va = (repsTodayByMgr.get(a.id) || { ip:0 }).ip
        const vb = (repsTodayByMgr.get(b.id) || { ip:0 }).ip
        return (vb - va) || a.name.localeCompare(b.name, 'ru')
      })

      for (const m of sorted) {
        const t = repsTodayByMgr.get(m.id)
        const sheetT = cdToday[m.name] || { ip:0, debit:0, simka:0 }
        const nT = numbersToday.get(m.id) || 0
        const monthRep = repsMonthByMgr.get(m.id) || { ip:0, wrote:0 }
        const sheetM = cdMonth[m.name] || { ip:0, debit:0 }
        const nM = numbersMonth.get(m.id) || 0
        totIpMonth+=monthRep.ip; totWroteMonth+=monthRep.wrote
        totCdIpMonth+=sheetM.ip; totCdCardsMonth+=sheetM.debit; totNumMonth+=nM
        if (t) { totCdIpDay+=sheetT.ip; totCdCardsDay+=sheetT.debit; totNumDay+=nT }

        if (!t) {
          lines.push(`   ○ <i>${escapeHtml(m.name)}</i> — отчёт не сдан${sheetT.ip||sheetT.debit||nT ? ` (ЦД ИП ${sheetT.ip} · ЦД карт ${sheetT.debit} · ном ${nT})` : ''}`)
          missing.push({ name: m.name, team: team.name })
          continue
        }

        lines.push(`   • <b>${escapeHtml(m.name)}</b>`)
        lines.push(`      написавших ${t.wrote} · РКО ${t.ip} · Симка ${t.simka}`)
        lines.push(`      ЦД ИП ${sheetT.ip} · ЦД Симка ${sheetT.simka||0} · ном ${nT}`)
      }
      lines.push('')
    }

    // Кто не сдал
    if (missing.length > 0) {
      lines.push(`❗ <b>Не сдали отчёт сегодня (${missing.length})</b>`)
      for (const m of missing) {
        lines.push(`   • ${escapeHtml(m.name)} <i>(команда ${escapeHtml(m.team)})</i>`)
      }
      lines.push('')
    } else {
      lines.push(`✅ <b>Все сдали отчёт</b>`)
      lines.push('')
    }

    // Итоги
    lines.push(`<b>ИТОГО за день:</b> ${totIpDay} РКО (${fmtSigned(totIpDay-totIpYest)}), ${totWroteDay} написавших / ${totCdIpDay} ЦД ИП, ${totCdCardsDay} ЦД карт, ${totNumDay} ном`)
    lines.push(`<b>Итого за месяц (${escapeHtml(monthName)}):</b> ${totIpMonth} РКО, ${totWroteMonth} написавших / ${totCdIpMonth} ЦД ИП, ${totCdCardsMonth} ЦД карт, ${totNumMonth} ном`)

    const text = lines.join('\n')

    // Шлём. Telegram лимит — 4096 символов; если длиннее — разрезаем по двойному переводу.
    const chunks = splitForTelegram(text, 4000)
    const allResults = []
    for (const chunk of chunks) {
      const r = await broadcastTelegramMessage(token, recipients, chunk)
      allResults.push(...r)
    }

    return NextResponse.json({
      ok: true,
      date: today,
      messageLength: text.length,
      chunks: chunks.length,
      recipients: allResults,
    })
  } catch (e) {
    console.error('daily-summary error:', e?.message || e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}

// Разрезает длинный текст по строкам, чтобы каждый кусок ≤ maxLen
function splitForTelegram(text, maxLen) {
  if (text.length <= maxLen) return [text]
  const out = []
  let buf = ''
  for (const line of text.split('\n')) {
    if ((buf + '\n' + line).length > maxLen) {
      if (buf) out.push(buf)
      buf = line
    } else {
      buf = buf ? buf + '\n' + line : line
    }
  }
  if (buf) out.push(buf)
  return out
}
