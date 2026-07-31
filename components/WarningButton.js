'use client'
import { useState } from 'react'
import { authFetch } from '../lib/supabase'

// Маленькая кнопка ⚠ + счётчик "N/3" на карточке менеджера.
// Поведение:
//  - клик → inline-подтверждение "Выдать предупреждение?" → POST
//  - если уже 3 — счётчик красный, можно выдать ещё (TG-уведомления больше не будет)
//
// props:
//   managerId        — кому
//   monthCount       — текущий счётчик за месяц (из state родителя)
//   onIssued(newCount, payload) — callback после успешного POST'а
export default function WarningButton({ managerId, monthCount, onIssued }) {
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function issue(e) {
    e.stopPropagation()
    setSubmitting(true)
    try {
      const res = await authFetch('/api/manager-warnings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manager_id: managerId }),
      })
      const data = await res.json()
      if (res.ok) {
        onIssued?.(data.monthCount, data.warning)
        setConfirming(false)
      } else {
        alert(data.error || 'Ошибка')
      }
    } catch (err) {
      console.error('issue warning:', err)
      alert('Ошибка сети')
    } finally {
      setSubmitting(false)
    }
  }

  const color =
    monthCount >= 3 ? 'text-red-600 bg-red-50 border-red-200'
    : monthCount === 2 ? 'text-amber-700 bg-amber-50 border-amber-200'
    : monthCount === 1 ? 'text-orange-700 bg-orange-50 border-orange-200'
    : 'text-gray-500 bg-slate-100 border-gray-300'

  if (confirming) {
    return (
      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <button
          onClick={issue}
          disabled={submitting}
          className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs px-2 py-1 rounded-md font-semibold"
        >
          {submitting ? '...' : 'Выдать'}
        </button>
        <button
          onClick={e => { e.stopPropagation(); setConfirming(false) }}
          disabled={submitting}
          className="bg-slate-100 hover:bg-slate-200 text-gray-700 text-xs px-2 py-1 rounded-md"
        >
          Нет
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); setConfirming(true) }}
      title={`Предупреждений за месяц: ${monthCount}/3. Кликни чтобы выдать ещё одно.`}
      className={`flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium transition ${color} hover:brightness-125`}
    >
      <span>⚠</span>
      <span>{monthCount}/3</span>
    </button>
  )
}
