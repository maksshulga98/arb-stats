'use client'
import { useState, useEffect } from 'react'
import { authFetch } from '../lib/supabase'

// Анкета «потенциал менеджера» — заполняет руководитель (админ/тимлид).
// Открывается из карточки менеджера в «Аналитике команды» по ссылке «Заполнить данные».
//
// Цвет из анкеты закрашивает карточку менеджера в аналитике. Он НЕ связан с
// зонами по заказам — зоны считаются автоматически и остаются как были.
// Смысл — видеть пересечение возможностей человека и его текущих результатов.

const QUESTIONS = [
  { key: 'free_time',      label: 'Много ли у менеджера свободного времени?', placeholder: 'например: работает только вечером, 3-4 часа' },
  { key: 'desired_income', label: 'Сколько хочет зарабатывать?',              placeholder: 'например: 80 000 ₽' },
  { key: 'age',            label: 'Сколько ему лет?',                         placeholder: 'например: 24' },
  { key: 'likes_work',     label: 'Всё ли нравится в работе?',                placeholder: 'что нравится / что нет' },
  { key: 'difficulties',   label: 'Какие сложности есть в работе?',           placeholder: 'что мешает делать результат' },
  { key: 'comments',       label: 'Дополнительные комментарии',               placeholder: 'любые заметки' },
]

export const POTENTIAL_COLORS = [
  { value: 'green',  label: 'Зелёный', hint: 'есть ресурс и настрой', dot: 'bg-green-500',  ring: 'ring-green-500'  },
  { value: 'yellow', label: 'Жёлтый',  hint: 'пока не определился',   dot: 'bg-yellow-500', ring: 'ring-yellow-500' },
  { value: 'red',    label: 'Красный', hint: 'на карандаше',          dot: 'bg-red-500',    ring: 'ring-red-500'    },
]

const emptyForm = { free_time: '', desired_income: '', age: '', likes_work: '', difficulties: '', comments: '', color: null }

export default function ManagerPotentialModal({ manager, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Тянем уже сохранённую анкету (если заполняли раньше)
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const res = await authFetch(`/api/manager-potential?manager_id=${manager.id}`)
        const data = await res.json()
        if (!alive) return
        if (res.ok && data.potential) {
          const p = data.potential
          setForm({
            free_time: p.free_time || '', desired_income: p.desired_income || '', age: p.age || '',
            likes_work: p.likes_work || '', difficulties: p.difficulties || '', comments: p.comments || '',
            color: p.color || null,
          })
        } else {
          setForm(emptyForm)
        }
      } catch (e) {
        if (alive) setError('Не удалось загрузить анкету')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [manager.id])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      const res = await authFetch('/api/manager-potential', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manager_id: manager.id, ...form }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Ошибка сохранения'); return }
      onSaved?.(data.potential)
      onClose?.()
    } catch (err) {
      console.error('save potential:', err)
      setError(err.code === 'NO_SESSION' ? 'Сессия истекла, войдите заново' : 'Ошибка сети')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        style={{ backgroundColor: '#13131f', border: '1px solid #2a2a3e' }}
        className="w-full max-w-lg max-h-[95vh] sm:max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5 sm:p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Данные менеджера</h3>
            <p className="text-gray-500 text-sm mt-0.5">{manager.name || manager.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none p-1">✕</button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-600 text-sm">Загрузка...</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-3">
            {QUESTIONS.map(q => (
              <div key={q.key}>
                <label className="text-gray-400 text-xs mb-1.5 block">{q.label}</label>
                <textarea
                  rows={2}
                  value={form[q.key]}
                  onChange={e => setForm(f => ({ ...f, [q.key]: e.target.value }))}
                  placeholder={q.placeholder}
                  className="w-full bg-gray-900 text-white px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm resize-y"
                />
              </div>
            ))}

            {/* Цвет-плашка менеджера */}
            <div className="pt-1">
              <label className="text-gray-400 text-xs mb-2 block">Цвет менеджера</label>
              <div className="grid grid-cols-3 gap-2">
                {POTENTIAL_COLORS.map(c => {
                  const active = form.color === c.value
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, color: active ? null : c.value }))}
                      style={{ backgroundColor: '#1a1a28' }}
                      className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border transition ${
                        active ? `border-transparent ring-2 ${c.ring}` : 'border-gray-700 hover:border-gray-600'
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 rounded-full ${c.dot}`} />
                      <span className="text-xs text-gray-300">{c.label}</span>
                      <span className="text-[10px] text-gray-600 leading-tight text-center">{c.hint}</span>
                    </button>
                  )
                })}
              </div>
              {form.color && (
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, color: null }))}
                  className="text-gray-500 hover:text-gray-300 text-xs mt-2 transition"
                >
                  Убрать цвет
                </button>
              )}
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm font-semibold transition"
              >
                {saving ? 'Сохраняем...' : 'Сохранить'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-lg text-sm bg-gray-800 hover:bg-gray-700 transition"
              >
                Отмена
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
