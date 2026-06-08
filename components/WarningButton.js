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
    monthCount >= 3 ? 'text-red-400 bg-red-950/40 border-red-800'
    : monthCount === 2 ? 'text-yellow-300 bg-yellow-950/40 border-yellow-800'
    : monthCount === 1 ? 'text-orange-300 bg-orange-950/40 border-orange-800'
    : 'text-gray-500 bg-gray-800/40 border-gray-700'

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
          className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-2 py-1 rounded-md"
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
