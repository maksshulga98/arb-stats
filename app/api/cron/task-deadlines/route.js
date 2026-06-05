// Cron каждый час: проверяет дедлайны pending-задач и шлёт уведомления
// в Telegram (обоим админам), если задача попала в один из порогов
// 48h / 24h / 6h / overdue и для этого порога ещё не было отправки.
//
// См. docs/specs/tasks-section.md разделы 5 и 7.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { broadcastTelegramMessage, escapeHtml } from '../../../../lib/telegram'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const THRESHOLDS = ['48h', '24h', '6h', 'overdue']

// Какие пороги пора срабатывать для данного hoursLeft?
function pickThresholds(hoursLeft) {
  const out = []
  if (hoursLeft <= 48 && hoursLeft > 24) out.push('48h')
  if (hoursLeft <= 24 && hoursLeft > 6) out.push('24h')
  if (hoursLeft <= 6 && hoursLeft > 0) out.push('6h')
  if (hoursLeft <= 0) out.push('overdue')
  return out
}

// Если cron долго не работал, нужно отправить все пропущенные пороги.
// Например, задача создана с дедлайном через 50 ч, cron упал на 30 ч —
// при следующем запуске hoursLeft=20. Тогда надо отправить и 48h и 24h.
function pickThresholdsCatchingUp(hoursLeft) {
  // Возвращает ВСЕ пороги где задача уже пересекла время порога:
  //   48h:     hoursLeft <= 48
  //   24h:     hoursLeft <= 24
  //   6h:      hoursLeft <= 6
  //   overdue: hoursLeft <= 0
  const out = []
  if (hoursLeft <= 48) out.push('48h')
  if (hoursLeft <= 24) out.push('24h')
  if (hoursLeft <= 6) out.push('6h')
  if (hoursLeft <= 0) out.push('overdue')
  return out
}

function fmtDeadline(iso) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(iso))
}

function buildMessage(threshold, task) {
  const title = escapeHtml(task.title)
  const assignee = escapeHtml(task.assignee_name || '?')
  const deadline = fmtDeadline(task.deadline)

  if (threshold === '48h') {
    return `⏰ <b>Задача с приближающимся дедлайном</b>\n\n«<b>${title}</b>»\n\nДедлайн через 2 дня — <i>${deadline}</i>\nОтветственный: <b>${assignee}</b>`
  }
  if (threshold === '24h') {
    return `🔔 <b>Напоминание о задаче</b>\n\n«<b>${title}</b>»\n\nОстался 1 день до дедлайна — <i>${deadline}</i>\nОтветственный: <b>${assignee}</b>`
  }
  if (threshold === '6h') {
    return `🚨 <b>Срочно: задача горит</b>\n\n«<b>${title}</b>»\n\nДо дедлайна 6 часов — <i>${deadline}</i>\nОтветственный: <b>${assignee}</b>`
  }
  // overdue
  const hoursLate = Math.max(1, Math.round((Date.now() - new Date(task.deadline).getTime()) / 3_600_000))
  return `❌ <b>Задача просрочена</b>\n\n«<b>${title}</b>»\n\nДедлайн был <i>${deadline}</i> (${hoursLate} ч назад)\nОтветственный: <b>${assignee}</b>`
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
    if (!token) {
      return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN не задан' }, { status: 500 })
    }
    const recipients = [
      process.env.TELEGRAM_CHAT_ID_OWNER,
      process.env.TELEGRAM_CHAT_ID_NIKITA,
    ].filter(Boolean)
    if (recipients.length === 0) {
      return NextResponse.json({ error: 'Нет TELEGRAM_CHAT_ID_*' }, { status: 500 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // 1) Все pending задачи с именем assignee
    const { data: tasks, error: tasksErr } = await supabase
      .from('tasks')
      .select(`
        id, title, deadline,
        assignee:profiles!tasks_assignee_id_fkey(name)
      `)
      .eq('status', 'pending')
    if (tasksErr) throw new Error(`tasks: ${tasksErr.message}`)
    if (!tasks || tasks.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, sent: [] })
    }

    // 2) Все уведомления одним запросом → Map<task_id, Set<threshold>>
    const taskIds = tasks.map(t => t.id)
    const { data: notif } = await supabase
      .from('task_notifications')
      .select('task_id, threshold')
      .in('task_id', taskIds)

    const alreadySent = new Map()
    for (const n of (notif || [])) {
      if (!alreadySent.has(n.task_id)) alreadySent.set(n.task_id, new Set())
      alreadySent.get(n.task_id).add(n.threshold)
    }

    // 3) Перебираем задачи, отправляем недоставленные пороги
    const sent = []
    const now = Date.now()

    for (const t of tasks) {
      const hoursLeft = (new Date(t.deadline).getTime() - now) / 3_600_000
      const thresholdsNow = pickThresholdsCatchingUp(hoursLeft)
      const sentSet = alreadySent.get(t.id) || new Set()

      for (const threshold of thresholdsNow) {
        if (sentSet.has(threshold)) continue

        const taskWithName = { ...t, assignee_name: t.assignee?.name }
        const message = buildMessage(threshold, taskWithName)
        const results = await broadcastTelegramMessage(token, recipients, message)
        const allOk = results.every(r => r.ok)
        console.log(`task-deadlines: ${threshold} task=${t.id} "${t.title.slice(0,40)}" → ${allOk ? 'OK' : 'PARTIAL'}`)

        // Пишем в БД ВСЕГДА (даже если broadcast вернул false) — иначе будем спамить попытками
        const { error: insertErr } = await supabase
          .from('task_notifications')
          .insert([{ task_id: t.id, threshold }])
        if (insertErr && !insertErr.message?.includes('duplicate')) {
          console.error(`task-deadlines insert err: ${insertErr.message}`)
        }

        sent.push({
          task_id: t.id,
          threshold,
          recipients: results.map(r => ({ chatId: r.chatId, ok: r.ok })),
        })
      }
    }

    return NextResponse.json({ ok: true, processed: tasks.length, sent })
  } catch (err) {
    console.error('task-deadlines error:', err?.message || err)
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 })
  }
}
