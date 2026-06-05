// Telegram-уведомления о событиях задач (созданы / выполнены / дедлайн / удалены).
// Используются из app/api/tasks/route.js (POST) и app/api/tasks/[id]/route.js (PUT, DELETE).
// Все функции fire-and-forget: ошибка только логируется, ответ API не блокируется.

import { broadcastTelegramMessage, escapeHtml } from './telegram'

function fmtDeadlineMsk(iso) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(iso))
}

function nameOrEmail(profile) {
  if (profile?.name) return profile.name
  if (profile?.email) return profile.email.split('@')[0]
  return '?'
}

function getRecipientsAndToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const recipients = [
    process.env.TELEGRAM_CHAT_ID_OWNER,
    process.env.TELEGRAM_CHAT_ID_NIKITA,
  ].filter(Boolean)
  if (!token || recipients.length === 0) return null
  return { token, recipients }
}

// Подтягивает name/email для указанных profile_id одним запросом
async function fetchProfiles(supabaseAdmin, ids) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (uniq.length === 0) return {}
  const { data } = await supabaseAdmin
    .from('profiles').select('id, name, email').in('id', uniq)
  return Object.fromEntries((data || []).map(p => [p.id, p]))
}

/**
 * ➕ Новая задача создана.
 * task: { id, title, description, deadline, assignee_id, creator_id }
 */
export async function notifyTaskCreated(task, supabaseAdmin) {
  try {
    const cfg = getRecipientsAndToken()
    if (!cfg) return
    const profs = await fetchProfiles(supabaseAdmin, [task.assignee_id, task.creator_id])
    const assigneeName = nameOrEmail(profs[task.assignee_id])
    const creatorName = nameOrEmail(profs[task.creator_id])

    const lines = ['➕ <b>Создана новая задача</b>', '', `«<b>${escapeHtml(task.title)}</b>»`]
    if (task.description) {
      lines.push('')
      lines.push(`<i>${escapeHtml(task.description.slice(0, 500))}</i>`)
    }
    lines.push('')
    lines.push(`Дедлайн: <i>${fmtDeadlineMsk(task.deadline)}</i>`)
    lines.push(`Ответственный: <b>${escapeHtml(assigneeName)}</b>`)
    if (task.creator_id && task.creator_id !== task.assignee_id) {
      lines.push(`Поставил: <b>${escapeHtml(creatorName)}</b>`)
    }

    await broadcastTelegramMessage(cfg.token, cfg.recipients, lines.join('\n'))
  } catch (err) {
    console.error('notifyTaskCreated failed:', err?.message || err)
  }
}

/**
 * ✅ Задача выполнена.
 * task: { title, assignee_id, deadline } — состояние ПОСЛЕ обновления.
 * actorId — кто отметил выполненной (если != assignee, упоминаем отдельно).
 */
export async function notifyTaskCompleted(task, actorId, supabaseAdmin) {
  try {
    const cfg = getRecipientsAndToken()
    if (!cfg) return
    const profs = await fetchProfiles(supabaseAdmin, [task.assignee_id, actorId])
    const assigneeName = nameOrEmail(profs[task.assignee_id])
    const actorName = nameOrEmail(profs[actorId])

    const lines = ['✅ <b>Задача выполнена</b>', '', `«<b>${escapeHtml(task.title)}</b>»`]
    lines.push('')
    if (actorId === task.assignee_id) {
      lines.push(`Закрыл: <b>${escapeHtml(assigneeName)}</b>`)
    } else {
      lines.push(`Закрыл: <b>${escapeHtml(actorName)}</b>`)
      lines.push(`Ответственный: <b>${escapeHtml(assigneeName)}</b>`)
    }

    await broadcastTelegramMessage(cfg.token, cfg.recipients, lines.join('\n'))
  } catch (err) {
    console.error('notifyTaskCompleted failed:', err?.message || err)
  }
}

/**
 * 📝 Изменён дедлайн.
 * task: title, assignee_id (текущее состояние)
 * oldDeadline, newDeadline — ISO
 * actorId — кто изменил
 */
export async function notifyTaskDeadlineChanged(task, oldDeadline, newDeadline, actorId, supabaseAdmin) {
  try {
    const cfg = getRecipientsAndToken()
    if (!cfg) return
    const profs = await fetchProfiles(supabaseAdmin, [task.assignee_id, actorId])
    const assigneeName = nameOrEmail(profs[task.assignee_id])
    const actorName = nameOrEmail(profs[actorId])

    const lines = ['📝 <b>Изменён дедлайн задачи</b>', '', `«<b>${escapeHtml(task.title)}</b>»`, '']
    lines.push(`Был: <i>${fmtDeadlineMsk(oldDeadline)}</i>`)
    lines.push(`Стал: <i>${fmtDeadlineMsk(newDeadline)}</i>`)
    lines.push(`Ответственный: <b>${escapeHtml(assigneeName)}</b>`)
    if (actorId && actorId !== task.assignee_id) {
      lines.push(`Изменил: <b>${escapeHtml(actorName)}</b>`)
    }

    await broadcastTelegramMessage(cfg.token, cfg.recipients, lines.join('\n'))
  } catch (err) {
    console.error('notifyTaskDeadlineChanged failed:', err?.message || err)
  }
}

/**
 * 🗑 Задача удалена.
 * task: title, assignee_id, deadline (состояние ДО удаления)
 * actorId — кто удалил
 */
export async function notifyTaskDeleted(task, actorId, supabaseAdmin) {
  try {
    const cfg = getRecipientsAndToken()
    if (!cfg) return
    const profs = await fetchProfiles(supabaseAdmin, [task.assignee_id, actorId])
    const assigneeName = nameOrEmail(profs[task.assignee_id])
    const actorName = nameOrEmail(profs[actorId])

    const lines = ['🗑 <b>Задача удалена</b>', '', `«<b>${escapeHtml(task.title)}</b>»`, '']
    if (task.deadline) {
      lines.push(`Был дедлайн: <i>${fmtDeadlineMsk(task.deadline)}</i>`)
    }
    if (actorId === task.assignee_id) {
      lines.push(`Удалил: <b>${escapeHtml(assigneeName)}</b>`)
    } else {
      lines.push(`Удалил: <b>${escapeHtml(actorName)}</b>`)
      lines.push(`Был ответственный: <b>${escapeHtml(assigneeName)}</b>`)
    }

    await broadcastTelegramMessage(cfg.token, cfg.recipients, lines.join('\n'))
  } catch (err) {
    console.error('notifyTaskDeleted failed:', err?.message || err)
  }
}
