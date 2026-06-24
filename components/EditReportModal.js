'use client'
import { useState, useEffect } from 'react'
import { authFetch } from '../lib/supabase'

// Модалка для редактирования цифр в отчёте менеджера.
// Подключена в admin/page.js и teamlead/page.js.
//
// props:
//   report      — текущий объект отчёта (см. таблицу reports)
//   teamType    — 'standard' | 'karina' | 'nikita' (определяет какие поля показывать)
//   onClose()   — закрыть модалку
//   onSaved(updatedReport) — после успешного PUT (родитель обновит local state)
export default function EditReportModal({ report, teamType, onClose, onSaved }) {
  const isNikita = teamType === 'nikita'

  const [form, setForm] = useState({
    ordered_ip: report.ordered_ip ?? 0,
    ordered_cards: report.ordered_cards ?? 0,
    unsubscribed: report.unsubscribed ?? 0,
    replied: report.replied ?? 0,
    people_wrote: report.people_wrote ?? 0,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Если меняется report (нажали редактировать другой) — сбрасываем форму
  useEffect(() => {
    setForm({
      ordered_ip: report.ordered_ip ?? 0,
      ordered_cards: report.ordered_cards ?? 0,
      unsubscribed: report.unsubscribed ?? 0,
      replied: report.replied ?? 0,
      people_wrote: report.people_wrote ?? 0,
    })
    setError(null)
  }, [report.id])

  function setField(name, value) {
    // Принимаем только цифры; пусто = 0
    const cleaned = value.replace(/\D/g, '')
    setForm(f => ({ ...f, [name]: cleaned === '' ? 0 : Number(cleaned) }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        ordered_ip: form.ordered_ip,
        ordered_cards: form.ordered_cards,
        unsubscribed: form.unsubscribed,
        replied: form.replied,
        people_wrote: form.people_wrote,
      }
      const res = await authFetch(`/api/reports/${report.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Ошибка'); return }
      onSaved?.(data.report)
      onClose?.()
    } catch (err) {
      console.error('save report:', err)
      setError('Ошибка сети')
    } finally {
      setSubmitting(false)
    }
  }

  const dateLabel = new Date(report.date).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center sm:items-center items-end justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }}
        className="w-full max-w-md p-5 sm:p-6 max-h-[95vh] sm:max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Редактировать отчёт за {dateLabel}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Для всех команд: ИП и Карты */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-gray-400 text-xs mb-1.5 block">Заказали ИП</label>
              <input
                type="text" inputMode="numeric" pattern="\d*"
                value={form.ordered_ip}
                onChange={e => setField('ordered_ip', e.target.value)}
                className="w-full bg-gray-900 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-gray-400 text-xs mb-1.5 block">Заказали карты</label>
              <input
                type="text" inputMode="numeric" pattern="\d*"
                value={form.ordered_cards}
                onChange={e => setField('ordered_cards', e.target.value)}
                className="w-full bg-gray-900 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm font-mono"
              />
            </div>
          </div>

          {/* Для Никиты — людей написали (вместо отписанные/ответили) */}
          {isNikita ? (
            <div>
              <label className="text-gray-400 text-xs mb-1.5 block">Людей написали</label>
              <input
                type="text" inputMode="numeric" pattern="\d*"
                value={form.people_wrote}
                onChange={e => setField('people_wrote', e.target.value)}
                className="w-full bg-gray-900 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm font-mono"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-400 text-xs mb-1.5 block">Отписавшиеся</label>
                <input
                  type="text" inputMode="numeric" pattern="\d*"
                  value={form.unsubscribed}
                  onChange={e => setField('unsubscribed', e.target.value)}
                  className="w-full bg-gray-900 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1.5 block">Ответившие</label>
                <input
                  type="text" inputMode="numeric" pattern="\d*"
                  value={form.replied}
                  onChange={e => setField('replied', e.target.value)}
                  className="w-full bg-gray-900 text-white px-3 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm font-mono"
                />
              </div>
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm font-semibold transition"
            >
              {submitting ? '...' : 'Сохранить'}
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
      </div>
    </div>
  )
}
