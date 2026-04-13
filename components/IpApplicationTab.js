'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const EMPTY_FORM = { fullName: '', phone: '', email: '', city: '' }

export default function IpApplicationTab({ profile, scope }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const url = scope ? `/api/ip-application?scope=${scope}` : '/api/ip-application'
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (res.ok) setHistory(data.applications || [])
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }, [scope])

  useEffect(() => { loadHistory() }, [loadHistory])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/ip-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Ошибка')
      } else {
        window.open(data.linkUrl, '_blank')
        setSuccess(true)
        setForm(EMPTY_FORM)
        await loadHistory()
        setTimeout(() => { setSuccess(false); setShowForm(false) }, 3000)
      }
    } catch {
      setError('Ошибка сети')
    }
    setSubmitting(false)
  }

  const downloadCSV = () => {
    const isAdmin = scope === 'all'
    const headers = isAdmin
      ? ['Дата', 'Время', 'Менеджер', 'Команда', 'ФИО клиента', 'Телефон', 'Email', 'Город', '№ ссылки']
      : ['Дата', 'Время', 'ФИО клиента', 'Телефон', 'Email', 'Город', '№ ссылки']

    const rows = history.map(app => {
      const dt = new Date(app.created_at)
      const date = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
      const time = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      if (isAdmin) {
        return [date, time, app.manager_name || '', app.team || '', app.full_name, app.phone, app.email, app.city, app.link_index]
      }
      return [date, time, app.full_name, app.phone, app.email, app.city, app.link_index]
    })

    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const bom = '\uFEFF'
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `заявки_ип_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isAdmin = scope === 'all'
  const isTeamlead = scope === 'team'

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-base font-semibold text-gray-200">Заявка ИП</h2>
        <div className="flex gap-2">
          {history.length > 0 && (
            <button
              onClick={downloadCSV}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              Скачать CSV
            </button>
          )}
          <button
            onClick={() => { setShowForm(true); setSuccess(false); setError(null) }}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-semibold transition"
          >
            + Новая заявка
          </button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl p-5 mb-4">
          {success ? (
            <div className="bg-green-950/40 border border-green-700 rounded-xl p-4 text-center">
              <p className="text-green-300 font-semibold text-sm">Заявка сохранена! Сайт банка открыт в новой вкладке.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs mb-1.5 block">ФИО клиента</label>
                  <input
                    type="text" required
                    value={form.fullName}
                    onChange={e => setForm({ ...form, fullName: e.target.value })}
                    placeholder="Иванов Иван Иванович"
                    className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1.5 block">Телефон</label>
                  <input
                    type="tel" required
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="+7 999 123 45 67"
                    className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1.5 block">Email</label>
                  <input
                    type="email" required
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="client@example.com"
                    className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1.5 block">Город обслуживания</label>
                  <input
                    type="text" required
                    value={form.city}
                    onChange={e => setForm({ ...form, city: e.target.value })}
                    placeholder="Москва"
                    className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
              </div>
              {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
              <div className="flex gap-2 mt-4">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-6 py-2.5 rounded-lg text-sm font-semibold transition"
                >
                  {submitting ? 'Сохраняем...' : 'Отправить заявку'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setError(null) }}
                  className="px-4 py-2.5 rounded-lg text-sm bg-gray-800 hover:bg-gray-700 transition"
                >
                  Отмена
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* History table */}
      <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl overflow-hidden overflow-x-auto">
        {loading ? (
          <div className="text-center py-12 text-gray-600 text-sm">Загрузка...</div>
        ) : history.length === 0 ? (
          <div className="text-center py-12 text-gray-600 text-sm">Нет заявок</div>
        ) : (
          <table className="w-full min-w-[640px]">
            <thead>
              <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Дата и время</th>
                {isAdmin && <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Менеджер</th>}
                {isAdmin && <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Команда</th>}
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ФИО клиента</th>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Телефон</th>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Email</th>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Город</th>
                <th className="text-left px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">№</th>
              </tr>
            </thead>
            <tbody>
              {history.map(app => (
                <tr key={app.id} style={{ borderTop: '1px solid #1a1a28' }} className="hover:bg-white/[0.02] transition">
                  <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">
                    {new Date(app.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  {isAdmin && <td className="px-4 py-3 text-sm text-gray-300">{app.manager_name || '—'}</td>}
                  {isAdmin && <td className="px-4 py-3 text-sm text-gray-500">{app.team || '—'}</td>}
                  <td className="px-4 py-3 text-sm text-gray-200">{app.full_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{app.phone}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{app.email}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{app.city}</td>
                  <td className="px-4 py-3 text-sm text-blue-400 font-medium">#{app.link_index}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
