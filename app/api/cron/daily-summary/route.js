// Ежедневная сводка по командам в Telegram.
// Cron: 18:00 UTC = 21:00 МСК (vercel.json).
//
// Метрики на менеджера: отписанные, ответившие, заказали ИП, заказали карты,
// ЦД ИП (из Google Sheets), ЦД дебетовые (из Google Sheets), взято номеров
// (из contact_distributions). Плюс итоги за день, за месяц и сравнение со вчера.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { broadcastTelegramMessage, escapeHtml } from '../../../../lib/telegram'
import { fetchSheetsData } from '../../../../lib/sheets-data'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Команды — синхронизировано с TEAMS в app/admin/page.js
const TEAMS = [
  // 04.06.2026: команда Анастасии расформирована
  { id: 'olya',      name: 'Оли',       type: 'standard' },
  { id: 'karina',    name: 'Карины',    type: 'karina'   },
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
    const { data: allReports, error: rErr } = await supabase
      .from('reports')
      .select('manager_id, date, unsubscribed, replied, ordered_ip, ordered_cards, people_wrote')
      .gte('date', monthStart)
      .lte('date', today)
    if (rErr) throw new Error(`reports: ${rErr.message}`)

    const repsTodayByMgr = new Map()   // id → {ip, cards, unsub, repl, wrote}
    const repsYestByMgr  = new Map()
    const repsMonthByMgr = new Map()
    for (const r of (allReports || [])) {
      const entry = { ip: r.ordered_ip||0, cards: r.ordered_cards||0, unsub: r.unsubscribed||0, repl: r.replied||0, wrote: r.people_wrote||0 }
      if (r.date === today) repsTodayByMgr.set(r.manager_id, entry)
      if (r.date === yesterday) repsYestByMgr.set(r.manager_id, entry)
      // Месячная сумма — аккумулируем
      const m = repsMonthByMgr.get(r.manager_id) || { ip:0, cards:0, unsub:0, repl:0, wrote:0 }
      m.ip+=entry.ip; m.cards+=entry.cards; m.unsub+=entry.unsub; m.repl+=entry.repl; m.wrote+=entry.wrote
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

    let totIpDay=0,totIpYest=0,totCardsDay=0,totCardsYest=0,totCdIpDay=0,totCdCardsDay=0,totNumDay=0
    let totIpMonth=0,totCardsMonth=0,totCdIpMonth=0,totCdCardsMonth=0,totNumMonth=0
    const missing = []

    for (const team of TEAMS) {
      const teamMgrs = mgrsByTeam.get(team.id) || []
      if (teamMgrs.length === 0) continue
      const isNikita = team.type === 'nikita'
      const isKarina = team.type === 'karina'

      // Команда: суммы за сегодня (для заголовка + цвет зоны)
      let ipDay=0,cardsDay=0,ipYestTeam=0,cardsYestTeam=0
      for (const m of teamMgrs) {
        const t = repsTodayByMgr.get(m.id) || { ip:0, cards:0 }
        const y = repsYestByMgr.get(m.id)  || { ip:0, cards:0 }
        ipDay+=t.ip; cardsDay+=t.cards; ipYestTeam+=y.ip; cardsYestTeam+=y.cards
      }
      totIpDay+=ipDay; totCardsDay+=cardsDay; totIpYest+=ipYestTeam; totCardsYest+=cardsYestTeam

      const mainValue = isKarina ? cardsDay : ipDay
      const emoji = zoneEmoji(mainValue, team.type)
      lines.push(`${emoji} <b>Команда ${escapeHtml(team.name)}</b> — ${ipDay} ИП (${fmtSigned(ipDay-ipYestTeam)}), ${cardsDay} карт (${fmtSigned(cardsDay-cardsYestTeam)})`)

      // Сортируем по основной метрике убыв
      const sorted = [...teamMgrs].sort((a, b) => {
        const va = (repsTodayByMgr.get(a.id) || { ip:0, cards:0 })[isKarina?'cards':'ip']
        const vb = (repsTodayByMgr.get(b.id) || { ip:0, cards:0 })[isKarina?'cards':'ip']
        return (vb - va) || a.name.localeCompare(b.name, 'ru')
      })

      for (const m of sorted) {
        const t = repsTodayByMgr.get(m.id)
        const sheetT = cdToday[m.name] || { ip:0, debit:0 }
        const nT = numbersToday.get(m.id) || 0
        // Месячные данные собираем тут же — пригодятся для тотала
        const monthRep = repsMonthByMgr.get(m.id) || { ip:0, cards:0 }
        const sheetM = cdMonth[m.name] || { ip:0, debit:0 }
        const nM = numbersMonth.get(m.id) || 0
        totIpMonth+=monthRep.ip; totCardsMonth+=monthRep.cards
        totCdIpMonth+=sheetM.ip; totCdCardsMonth+=sheetM.debit; totNumMonth+=nM
        if (t) { totCdIpDay+=sheetT.ip; totCdCardsDay+=sheetT.debit; totNumDay+=nT }

        if (!t) {
          // Не сдал отчёт — пишем серую строку без цифр reports, но с ЦД/номерами если есть
          lines.push(`   ○ <i>${escapeHtml(m.name)}</i> — отчёт не сдан${sheetT.ip||sheetT.debit||nT ? ` (ЦД ИП ${sheetT.ip} · ЦД карт ${sheetT.debit} · ном ${nT})` : ''}`)
          missing.push({ name: m.name, team: team.name })
          continue
        }

        // Никита: вместо отп/отв пишем "людей"
        const firstPart = isNikita
          ? `людей ${t.wrote}`
          : `отп ${t.unsub} · отв ${t.repl}`
        // Сама строка менеджера — в одну если короткая, иначе с переносом
        lines.push(`   • <b>${escapeHtml(m.name)}</b>`)
        lines.push(`      ${firstPart} · ИП ${t.ip} · карт ${t.cards}`)
        lines.push(`      ЦД ИП ${sheetT.ip} · ЦД карт ${sheetT.debit} · ном ${nT}`)
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
    lines.push(`<b>ИТОГО за день:</b> ${totIpDay} ИП (${fmtSigned(totIpDay-totIpYest)}), ${totCardsDay} карт (${fmtSigned(totCardsDay-totCardsYest)}) / ${totCdIpDay} ЦД ИП, ${totCdCardsDay} ЦД карт, ${totNumDay} ном`)
    lines.push(`<b>Итого за месяц (${escapeHtml(monthName)}):</b> ${totIpMonth} ИП заказ, ${totCardsMonth} карт заказ / ${totCdIpMonth} ЦД ИП, ${totCdCardsMonth} ЦД карт, ${totNumMonth} ном`)

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
