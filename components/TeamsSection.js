'use client'
import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../lib/supabase'

// Раздел "Команды" для админ-кабинета.
// Доступ: только role='admin' (контролируется на бэке).
// Возможности:
//   - список текущих команд + сколько в них людей
//   - создать новую команду + сразу назначить тимлида из существующих менеджеров
//   - удалить пустую команду

const TEAM_TYPE_OPTIONS = [
  { value: 'standard', label: 'Стандартная (ИП-метрика основная)' },
  { value: 'karina',   label: 'Карты-основная (как у бывшей Карины)' },
  { value: 'nikita',   label: 'Никита-тип (людей-пишут вместо отп/отв)' },
]

// Транслит для авто-slug. Дублирует lib/teams.js, чтобы не делать SSR-загрузку модуля.
const TRANSLIT = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',
  к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
  х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
}
function slugifyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/команды?|команду|команд|тимы?/gi, '')
    .trim()
    .split(/\s+/)[0]
    .split('').map(c => TRANSLIT[c] ?? c).join('')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 30)
}

export default function TeamsSection({ allManagers }) {
  const [teams, setTeams] = useState([])
  const [memberCounts, setMemberCounts] = useState({}) // team_slug → count
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    name: '',
    slug: '',
    slugTouched: false,
    type: 'standard',
    teamlead_id: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null) // slug команды
  const [deleting, setDeleting] = useState(false)
  // Редактирование названия
  const [editSlug, setEditSlug] = useState(null)   // slug редактируемой команды
  const [editName, setEditName] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/teams')
      const data = await res.json()
      if (res.ok) setTeams(data.teams || [])
    } catch (err) {
      console.error('load teams:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Считаем кол-во людей по командам (на клиенте по props allManagers)
  useEffect(() => {
    const counts = {}
    for (const m of (allManagers || [])) {
      if (!m.team) continue
      counts[m.team] = (counts[m.team] || 0) + 1
    }
    setMemberCounts(counts)
  }, [allManagers])

  function openCreate() {
    setForm({ name: '', slug: '', slugTouched: false, type: 'standard', teamlead_id: '' })
    setError(null)
    setShowModal(true)
  }

  function onNameChange(name) {
    setForm(f => ({
      ...f,
      name,
      // slug автогенерируется пока пользователь его не трогал
      slug: f.slugTouched ? f.slug : slugifyName(name),
    }))
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        type: form.type,
        teamlead_id: form.teamlead_id || undefined,
      }
      const res = await authFetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Ошибка'); return }
      setShowModal(false)
      await load()
      // Если назначили тимлида — желательно чтобы родитель перезагрузил
      // данные. Используем window.location.reload() — это самый надёжный способ
      // обновить TEAMS массив и счётчики в Аналитике без сложной шины событий.
      window.location.reload()
    } catch (err) {
      console.error('create team:', err)
      setError('Ошибка сети')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(slug) {
    setDeleting(true)
    try {
      const res = await authFetch(`/api/teams/${slug}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(data.error || 'Не удалось удалить')
      } else {
        setDeleteConfirm(null)
        await load()
        window.location.reload()
      }
    } catch (err) {
      console.error('delete team:', err)
      alert('Ошибка сети')
    } finally {
      setDeleting(false)
    }
  }

  // Сохранить новое название команды (PATCH). slug не меняется.
  async function handleSaveName(slug) {
    const name = editName.trim()
    if (name.length < 1) { alert('Введите название'); return }
    setSavingEdit(true)
    try {
      const res = await authFetch(`/api/teams/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { alert(data.error || 'Не удалось переименовать'); return }
      // Обновляем локально + перезагружаем чтобы имя обновилось везде (аналитика, сводка)
      setTeams(prev => prev.map(t => t.slug === slug ? { ...t, name } : t))
      setEditSlug(null); setEditName('')
      window.location.reload()
    } catch (err) {
      console.error('rename team:', err)
      alert('Ошибка сети')
    } finally {
      setSavingEdit(false)
    }
  }

  const onlyManagers = (allManagers || []).filter(m => m.role === 'manager')

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-base font-semibold text-gray-200">Команды</h2>
        <button
          onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-semibold transition"
        >
          + Новая команда
        </button>
      </div>

      <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-600 text-sm">Загрузка...</div>
        ) : teams.length === 0 ? (
          <div className="text-center py-12 text-gray-600 text-sm">Команд пока нет.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Название</th>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Slug</th>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Тип</th>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Человек</th>
                <th className="text-right px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody>
              {teams.map(t => {
                const cnt = memberCounts[t.slug] || 0
                const isDeleting = deleteConfirm === t.slug
                const isEditing = editSlug === t.slug
                return (
                  <tr key={t.slug} style={{ borderTop: '1px solid #1a1a28' }} className="hover:bg-white/[0.02] transition">
                    <td className="px-4 py-3 text-sm text-gray-200 font-medium">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">Команда</span>
                          <input
                            type="text" autoFocus maxLength={60}
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveName(t.slug); if (e.key === 'Escape') { setEditSlug(null); setEditName('') } }}
                            className="bg-gray-900 text-white px-2 py-1 rounded-md border border-gray-700 focus:outline-none focus:border-blue-500 text-sm w-48"
                          />
                        </div>
                      ) : (
                        <>Команда {t.name}</>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono">{t.slug}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">{t.type}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={cnt === 0 ? 'text-gray-600' : 'text-gray-300'}>{cnt}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => handleSaveName(t.slug)}
                            disabled={savingEdit}
                            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs px-2 py-1 rounded-md font-semibold"
                          >
                            {savingEdit ? '...' : 'Сохранить'}
                          </button>
                          <button
                            onClick={() => { setEditSlug(null); setEditName('') }}
                            disabled={savingEdit}
                            className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-2 py-1 rounded-md"
                          >
                            Отмена
                          </button>
                        </div>
                      ) : isDeleting ? (
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-gray-400 text-xs">Удалить?</span>
                          <button
                            onClick={() => handleDelete(t.slug)}
                            disabled={deleting}
                            className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs px-2 py-1 rounded-md font-semibold"
                          >
                            {deleting ? '...' : 'Да'}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            disabled={deleting}
                            className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-2 py-1 rounded-md"
                          >
                            Нет
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 justify-end">
                          <button
                            onClick={() => { setEditSlug(t.slug); setEditName(t.name); setDeleteConfirm(null) }}
                            title="Переименовать команду"
                            className="text-gray-600 hover:text-blue-400 transition text-xs"
                          >
                            ✏
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(t.slug)}
                            disabled={cnt > 0}
                            title={cnt > 0 ? 'Сначала переведи всех в другую команду' : 'Удалить команду'}
                            className="text-gray-600 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed text-xs"
                          >
                            🗑
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Модалка создания команды */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div
            style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }}
            className="rounded-2xl w-full max-w-md p-5 sm:p-6 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Новая команда</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-white text-lg">✕</button>
            </div>

            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="text-gray-400 text-xs mb-1.5 block">Название команды</label>
                <input
                  type="text" required maxLength={60}
                  value={form.name}
                  onChange={e => onNameChange(e.target.value)}
                  placeholder="Олега"
                  className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                />
                <p className="text-gray-600 text-xs mt-1">Будет показано как «Команда Олега».</p>
              </div>

              <div>
                <label className="text-gray-400 text-xs mb-1.5 block">Slug (внутренний id)</label>
                <input
                  type="text" required minLength={2} maxLength={30}
                  pattern="[a-z0-9_-]+"
                  value={form.slug}
                  onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase(), slugTouched: true }))}
                  placeholder="oleg"
                  className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm font-mono"
                />
                <p className="text-gray-600 text-xs mt-1">Автогенерируется из названия. Менять обычно не нужно. a-z, 0-9, _, -.</p>
              </div>

              <div>
                <label className="text-gray-400 text-xs mb-1.5 block">Тип</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                >
                  {TEAM_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-gray-400 text-xs mb-1.5 block">Тимлид (опционально)</label>
                <select
                  value={form.teamlead_id}
                  onChange={e => setForm(f => ({ ...f, teamlead_id: e.target.value }))}
                  className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                >
                  <option value="">— назначу позже —</option>
                  {onlyManagers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.email} {m.team ? `(сейчас в ${m.team})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-gray-600 text-xs mt-1">Выбранный менеджер станет тимлидом этой команды (role: manager → teamlead).</p>
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm font-semibold transition"
                >
                  {submitting ? '...' : 'Создать'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 rounded-lg text-sm bg-gray-800 hover:bg-gray-700 transition"
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
