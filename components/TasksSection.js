'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { authFetch } from '../lib/supabase'

// Раздел "Задачи" для админ-кабинета (только role='admin').
// См. docs/specs/tasks-section.md

const THRESHOLD_EMOJI = { '48h': '⏰', '24h': '🔔', '6h': '🚨', 'overdue': '❌' }

function fmtDeadline(iso) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  })
}

function fmtRelative(iso) {
  const ms = new Date(iso).getTime() - Date.now()
  const hours = ms / 3_600_000
  if (hours < 0) {
    const h = Math.abs(Math.round(hours))
    if (h < 24) return `просрочено на ${h}ч`
    return `просрочено на ${Math.round(h / 24)}д`
  }
  if (hours < 1) return `через ${Math.max(1, Math.round(hours * 60))}м`
  if (hours < 24) return `через ${Math.round(hours)}ч`
  const days = hours / 24
  if (days < 7) return `через ${Math.round(days)}д`
  return `через ${Math.round(days)} дн`
}

function fmtNotifSent(iso) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Moscow',
  })
}

// Имя для отображения: name из profiles, иначе часть email до @
function displayName(adminOrTask) {
  if (adminOrTask?.name) return adminOrTask.name
  const email = adminOrTask?.email || adminOrTask?.assignee_email
  if (email) return email.split('@')[0]
  return 'Без имени'
}

// Цветной кружок статуса по дедлайну
function StatusDot({ task }) {
  if (task.status === 'done') return <span title="Выполнено">✅</span>
  const hoursLeft = (new Date(task.deadline).getTime() - Date.now()) / 3_600_000
  if (hoursLeft <= 6) return <span title="Просрочено или <6ч" className="text-red-400">🔴</span>
  if (hoursLeft <= 24) return <span title="<24ч">🟡</span>
  if (hoursLeft <= 48) return <span title="<48ч">🟠</span>
  return <span title=">48ч" className="opacity-60">⚪</span>
}

// Дефолт дедлайна для новой задачи: now + 2 дня @ 12:00 МСК
function defaultDeadlineForInput() {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  // Получаем 12:00 в МСК — выводим в формате datetime-local
  // datetime-local — в локальной TZ браузера; пользователь увидит в своём TZ.
  // Берём просто +2д с округлением минут.
  d.setHours(12, 0, 0, 0)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ISO → значение для <input type="datetime-local">
function isoToDateTimeLocal(iso) {
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function TasksSection({ currentUserId, admins }) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all') // all | mine | other | overdue | done
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({
    title: '', description: '', deadline: defaultDeadlineForInput(), assignee_id: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [notifications, setNotifications] = useState([])

  // Имя ID -> name из admins (для отображения и для "Никиты"/"Другого")
  const otherAdmin = admins.find(a => a.id !== currentUserId)

  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/tasks?scope=all')
      const data = await res.json()
      if (res.ok) setTasks(data.tasks || [])
    } catch (err) {
      console.error('loadTasks:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])

  // Фильтрованный список (на клиенте — счётчики и фильтры одно и то же)
  const filteredTasks = useMemo(() => {
    const now = Date.now()
    return tasks.filter(t => {
      if (filter === 'all') return true
      if (filter === 'mine') return t.assignee_id === currentUserId
      if (filter === 'other') return otherAdmin && t.assignee_id === otherAdmin.id
      if (filter === 'overdue') return t.status === 'pending' && new Date(t.deadline).getTime() < now
      if (filter === 'done') return t.status === 'done'
      return true
    })
  }, [tasks, filter, currentUserId, otherAdmin])

  // Счётчики
  const counts = useMemo(() => {
    const now = Date.now()
    return {
      all: tasks.length,
      mine: tasks.filter(t => t.assignee_id === currentUserId).length,
      other: otherAdmin ? tasks.filter(t => t.assignee_id === otherAdmin.id).length : 0,
      overdue: tasks.filter(t => t.status === 'pending' && new Date(t.deadline).getTime() < now).length,
      done: tasks.filter(t => t.status === 'done').length,
    }
  }, [tasks, currentUserId, otherAdmin])

  function openCreateModal() {
    setEditingId(null)
    setError(null)
    setDeleteConfirm(false)
    setNotifications([])
    setForm({
      title: '',
      description: '',
      deadline: defaultDeadlineForInput(),
      assignee_id: currentUserId,
    })
    setShowModal(true)
  }

  async function openEditModal(task) {
    setEditingId(task.id)
    setError(null)
    setDeleteConfirm(false)
    setForm({
      title: task.title,
      description: task.description || '',
      deadline: isoToDateTimeLocal(task.deadline),
      assignee_id: task.assignee_id,
    })
    setShowModal(true)
    // Подгружаем историю уведомлений
    try {
      const res = await authFetch(`/api/tasks/${task.id}/notifications`)
      const data = await res.json()
      if (res.ok) setNotifications(data.notifications || [])
    } catch (err) {
      console.error('load notifications:', err)
    }
  }

  function closeModal() {
    setShowModal(false)
    setEditingId(null)
    setError(null)
    setDeleteConfirm(false)
    setNotifications([])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        title: form.title,
        description: form.description,
        deadline: new Date(form.deadline).toISOString(),
        assignee_id: form.assignee_id,
      }
      const res = await authFetch(
        editingId ? `/api/tasks/${editingId}` : '/api/tasks',
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Ошибка'); return }
      closeModal()
      await loadTasks()
    } catch (err) {
      console.error('submit task:', err)
      setError('Ошибка сети')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggleStatus(task, e) {
    e.stopPropagation()
    const newStatus = task.status === 'done' ? 'pending' : 'done'
    try {
      const res = await authFetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) await loadTasks()
    } catch (err) {
      console.error('toggle status:', err)
    }
  }

  async function handleDelete() {
    if (!editingId) return
    setSubmitting(true)
    try {
      const res = await authFetch(`/api/tasks/${editingId}`, { method: 'DELETE' })
      if (res.ok) {
        closeModal()
        await loadTasks()
      }
    } catch (err) {
      console.error('delete task:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const filterBtns = [
    { id: 'all',     label: 'Все',         count: counts.all },
    { id: 'mine',    label: 'Мои',         count: counts.mine },
    { id: 'other',   label: otherAdmin ? (displayName(otherAdmin).split(' ')[0]) : '—', count: counts.other },
    { id: 'overdue', label: 'Просрочены',  count: counts.overdue },
    { id: 'done',    label: 'Выполнены',   count: counts.done },
  ]

  return (
    <>
      {/* Шапка: на мобильном — заголовок + кнопка на одной строке, фильтры на второй
          На десктопе — всё в один ряд */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-3 sm:mb-0 sm:hidden">
          <h2 className="text-base font-semibold text-gray-200">Задачи</h2>
          <button
            onClick={openCreateModal}
            className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 px-4 py-2 rounded-lg text-sm font-semibold transition"
          >
            + Задача
          </button>
        </div>

        {/* Десктопная шапка (один ряд) */}
        <div className="hidden sm:flex justify-between items-center flex-wrap gap-3">
          <h2 className="text-base font-semibold text-gray-200">Задачи</h2>
          <div className="flex gap-2 flex-wrap items-center">
            {filterBtns.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  filter === f.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {f.label} <span className="opacity-60">{f.count}</span>
              </button>
            ))}
            <button
              onClick={openCreateModal}
              className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-semibold transition ml-2"
            >
              + Новая задача
            </button>
          </div>
        </div>

        {/* Мобильные фильтры — горизонтальный скролл-ряд */}
        <div className="sm:hidden -mx-4 px-4 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="flex gap-2 pb-1" style={{ minWidth: 'max-content' }}>
            {filterBtns.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                  filter === f.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400'
                }`}
              >
                {f.label} <span className="opacity-60">{f.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Список */}
      <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-600 text-sm">Загрузка...</div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-center py-12 text-gray-600 text-sm">
            {filter === 'all' ? 'Задач пока нет — создайте первую' : 'В этом разделе пусто'}
          </div>
        ) : (
          <>
            {/* Мобильные карточки (sm и ниже) */}
            <div className="sm:hidden">
              {filteredTasks.map((t, i) => (
                <div
                  key={t.id}
                  onClick={() => openEditModal(t)}
                  style={i > 0 ? { borderTop: '1px solid #1a1a28' } : {}}
                  className="flex items-start gap-3 px-4 py-3 active:bg-white/[0.04] cursor-pointer"
                >
                  <div className="text-base flex-shrink-0 pt-0.5"><StatusDot task={t} /></div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${t.status === 'done' ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
                      {t.title}
                    </div>
                    <div className="text-xs mt-1">
                      {t.status === 'done' ? (
                        <span className="text-gray-500">выполнено {t.completed_at ? fmtDeadline(t.completed_at) : ''}</span>
                      ) : (
                        <>
                          <span className="text-gray-400">{fmtDeadline(t.deadline)}</span>
                          <span className="text-gray-600"> · {fmtRelative(t.deadline)}</span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {t.assignee_name || displayName({ email: t.assignee_email }) || '—'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={t.status === 'done'}
                    onChange={e => handleToggleStatus(t, e)}
                    onClick={e => e.stopPropagation()}
                    className="w-5 h-5 cursor-pointer flex-shrink-0 mt-1"
                  />
                </div>
              ))}
            </div>

            {/* Десктопная таблица (sm и выше) */}
            <table className="hidden sm:table w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                  <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider w-12"></th>
                  <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Задача</th>
                  <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Дедлайн</th>
                  <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Ответственный</th>
                  <th className="text-right px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map(t => (
                  <tr
                    key={t.id}
                    onClick={() => openEditModal(t)}
                    style={{ borderTop: '1px solid #1a1a28' }}
                    className="hover:bg-white/[0.02] transition cursor-pointer"
                  >
                    <td className="px-4 py-3 text-lg"><StatusDot task={t} /></td>
                    <td className="px-4 py-3 text-sm text-gray-200 max-w-md truncate">{t.title}</td>
                    <td className="px-4 py-3 text-sm">
                      {t.status === 'done' ? (
                        <span className="text-gray-500">выполнено {t.completed_at ? fmtDeadline(t.completed_at) : ''}</span>
                      ) : (
                        <>
                          <span className="text-gray-300">{fmtDeadline(t.deadline)}</span>{' '}
                          <span className="text-gray-500 text-xs">({fmtRelative(t.deadline)})</span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">{t.assignee_name || displayName({ email: t.assignee_email }) || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="checkbox"
                        checked={t.status === 'done'}
                        onChange={e => handleToggleStatus(t, e)}
                        onClick={e => e.stopPropagation()}
                        className="w-4 h-4 cursor-pointer"
                        title={t.status === 'done' ? 'Вернуть в pending' : 'Отметить выполненной'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Модалка */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center sm:items-center items-end justify-center p-0 sm:p-4" onClick={closeModal}>
          <div
            style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }}
            className="w-full max-w-md p-5 sm:p-6 max-h-[95vh] sm:max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">
                {editingId ? 'Редактировать задачу' : 'Новая задача'}
              </h3>
              <button onClick={closeModal} className="text-gray-500 hover:text-white text-lg">✕</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="space-y-3">
                <div>
                  <label className="text-gray-400 text-xs mb-1.5 block">Заголовок</label>
                  <input
                    type="text" required maxLength={200}
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder="Что нужно сделать"
                    className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1.5 block">Описание (необязательно)</label>
                  <textarea
                    rows={4}
                    value={form.description}
                    onChange={e => setForm({ ...form, description: e.target.value })}
                    placeholder="Детали, ссылки, контекст"
                    className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1.5 block">Дедлайн</label>
                  <input
                    type="datetime-local" required
                    value={form.deadline}
                    onChange={e => setForm({ ...form, deadline: e.target.value })}
                    className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1.5 block">Ответственный</label>
                  <select
                    required
                    value={form.assignee_id}
                    onChange={e => setForm({ ...form, assignee_id: e.target.value })}
                    className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                  >
                    {!form.assignee_id && <option value="">— выбрать —</option>}
                    {admins.map(a => (
                      <option key={a.id} value={a.id}>
                        {displayName(a)}{a.id === currentUserId ? ' (я)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* История уведомлений (только в режиме редактирования) */}
              {editingId && notifications.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <p className="text-gray-400 text-xs mb-2">История уведомлений:</p>
                  <ul className="space-y-1 text-xs text-gray-500">
                    {notifications.map((n, i) => (
                      <li key={i}>
                        {THRESHOLD_EMOJI[n.threshold]} {n.threshold} — отправлено {fmtNotifSent(n.sent_at)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

              <div className="flex gap-2 mt-4">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm font-semibold transition"
                >
                  {submitting ? '...' : (editingId ? 'Сохранить' : 'Создать')}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2.5 rounded-lg text-sm bg-gray-800 hover:bg-gray-700 transition"
                >
                  Отмена
                </button>
              </div>

              {editingId && (
                <div className="mt-3 pt-3 border-t border-gray-800">
                  {deleteConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-sm flex-1">Точно удалить?</span>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={submitting}
                        className="bg-red-600 hover:bg-red-500 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                      >
                        Да, удалить
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(false)}
                        className="px-3 py-1.5 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 transition"
                      >
                        Отмена
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(true)}
                      className="text-gray-500 hover:text-red-400 text-sm transition"
                    >
                      Удалить задачу
                    </button>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  )
}
