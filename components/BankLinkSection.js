'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { authFetch } from '../lib/supabase'

// UI-секция «Заявка в банк» — таб с историей + модалка создания.
// В отличие от «Счёт ИП», ссылку добывает раннер (Dolphin Anty) асинхронно:
// POST кладёт задачу в очередь и возвращает jobId, дальше опрашиваем статус.
// scope: undefined (свои) | 'team' (тимлид) | 'all' (админ).

function validateINN(inn) {
  if (!/^\d{10}$/.test(inn) && !/^\d{12}$/.test(inn)) return false
  const d = inn.split('').map(Number)
  if (inn.length === 10) {
    const w = [2, 4, 10, 3, 5, 9, 4, 6, 8]
    const c = w.reduce((s, x, i) => s + x * d[i], 0) % 11 % 10
    return d[9] === c
  }
  const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const c1 = w1.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  const c2 = w2.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  return d[10] === c1 && d[11] === c2
}

const STATUS_LABEL = {
  queued:     { text: 'В очереди',  cls: 'text-yellow-400' },
  processing: { text: 'В работе…',  cls: 'text-blue-400' },
  success:    { text: 'Готово',     cls: 'text-green-400' },
  error:      { text: 'Ошибка',     cls: 'text-red-400' },
}

const emptyForm = { bank: '', organizationName: '', inn: '', legalAddress: '', city: '', contactPerson: '', email: '', phone: '' }

export default function BankLinkSection({ scope, showManagerColumn = false, managerNameById = {} }) {
  const [banks, setBanks] = useState([])
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)   // включает время ожидания раннера
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)            // { link }
  const [copiedId, setCopiedId] = useState(null)
  const pollRef = useRef(null)

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const url = scope ? `/api/bank-link?scope=${scope}` : '/api/bank-link'
      const res = await authFetch(url)
      const data = await res.json()
      if (res.ok) setHistory(data.jobs || [])
    } catch (err) {
      console.error('Ошибка загрузки истории заявок в банк:', err)
    } finally {
      setHistoryLoading(false)
    }
  }, [scope])

  useEffect(() => { loadHistory() }, [loadHistory])

  // Список доступных банков для селекта
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/bank-link?banks=1')
        const data = await res.json()
        if (res.ok) setBanks(data.banks || [])
      } catch { /* ignore */ }
    })()
  }, [])

  // Чистим интервал поллинга при размонтировании
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  function pollJob(jobId) {
    const startedAt = Date.now()
    const MAX_MS = 120000  // ждём результата раннера максимум 2 минуты
    pollRef.current = setInterval(async () => {
      try {
        const res = await authFetch(`/api/bank-link?jobId=${jobId}`)
        const data = await res.json()
        const job = data.job
        if (!res.ok || !job) return
        if (job.status === 'processing') setStatusText('Браузер оформляет заявку…')
        if (job.status === 'success') {
          clearInterval(pollRef.current); pollRef.current = null
          setSubmitting(false); setResult({ link: job.result_link }); loadHistory()
        } else if (job.status === 'error') {
          clearInterval(pollRef.current); pollRef.current = null
          setSubmitting(false); setError(job.error_message || 'Раннер вернул ошибку'); loadHistory()
        } else if (Date.now() - startedAt > MAX_MS) {
          clearInterval(pollRef.current); pollRef.current = null
          setSubmitting(false)
          setError('Раннер не ответил вовремя. Проверьте, что он запущен и Dolphin открыт. Заявка осталась в истории.')
          loadHistory()
        }
      } catch { /* транзиентная ошибка сети — продолжаем поллинг */ }
    }, 2500)
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.bank) { setError('Выберите банк'); return }
    if (!validateINN(form.inn)) { setError('Некорректный ИНН (10 для ООО, 12 для ИП)'); return }
    setSubmitting(true); setError(null); setResult(null); setStatusText('Ставим задачу в очередь…')
    try {
      const res = await authFetch('/api/bank-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Ошибка'); setSubmitting(false); return }
      setStatusText('Задача взята в работу, ждём ссылку…')
      loadHistory()
      pollJob(data.jobId)
    } catch (err) {
      console.error('Bank link create failed:', err)
      setError(err.code === 'NO_SESSION' ? 'Сессия истекла, войдите заново' : 'Ошибка сети')
      setSubmitting(false)
    }
  }

  async function handleCopy(link, id) {
    try { await navigator.clipboard.writeText(link) }
    catch {
      const ta = document.createElement('textarea')
      ta.value = link; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const bankLabel = (id) => banks.find(b => b.id === id)?.label || id

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-base font-semibold text-gray-200">Заявка в банк</h2>
        <button
          onClick={() => { setShowModal(true); setResult(null); setError(null); setStatusText(''); setForm(emptyForm) }}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-semibold transition"
        >
          + Оформить заявку
        </button>
      </div>

      <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl overflow-hidden overflow-x-auto">
        {historyLoading ? (
          <div className="text-center py-12 text-gray-600 text-sm">Загрузка...</div>
        ) : history.length === 0 ? (
          <div className="text-center py-12 text-gray-600 text-sm">Нет заявок — оформите первую</div>
        ) : (
          <table className="w-full min-w-[760px]">
            <thead>
              <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Дата</th>
                {showManagerColumn && (
                  <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Менеджер</th>
                )}
                <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Банк</th>
                <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Организация</th>
                <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ИНН</th>
                <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Статус</th>
                <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Ссылка</th>
              </tr>
            </thead>
            <tbody>
              {history.map(job => {
                const st = STATUS_LABEL[job.status] || STATUS_LABEL.queued
                return (
                  <tr key={job.id} style={{ borderTop: '1px solid #1a1a28' }} className="hover:bg-white/[0.02] transition">
                    <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">
                      {new Date(job.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    {showManagerColumn && (
                      <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{managerNameById[job.manager_id] || '—'}</td>
                    )}
                    <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{bankLabel(job.bank)}</td>
                    <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{job.organization_name}</td>
                    <td className="px-3 sm:px-5 py-3 text-sm text-gray-400 font-mono">{job.inn}</td>
                    <td className="px-3 sm:px-5 py-3 text-sm">
                      <span className={`text-xs font-medium ${st.cls}`} title={job.status === 'error' ? job.error_message : ''}>{st.text}</span>
                    </td>
                    <td className="px-3 sm:px-5 py-3 text-sm">
                      {job.result_link ? (
                        <button
                          onClick={() => handleCopy(job.result_link, job.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                            copiedId === job.id
                              ? 'bg-green-900/60 text-green-300 border border-green-700'
                              : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                          }`}
                        >
                          {copiedId === job.id ? 'Скопировано!' : 'Копировать'}
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Модалка */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => { if (!submitting) setShowModal(false) }}>
          <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Оформить заявку в банк</h3>
              <button onClick={() => { if (!submitting) setShowModal(false) }} className="text-gray-500 hover:text-white text-lg">✕</button>
            </div>

            {result ? (
              <div>
                <div className="bg-green-950/40 border border-green-700 rounded-lg p-4 mb-4">
                  <p className="text-green-300 text-sm font-semibold mb-2">Ссылка получена!</p>
                  <div className="flex items-center gap-2">
                    <input readOnly value={result.link} className="flex-1 bg-gray-900 text-sm text-gray-300 px-3 py-2 rounded-lg border border-gray-700 truncate" />
                    <button
                      onClick={() => handleCopy(result.link, 'modal')}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition shrink-0 ${
                        copiedId === 'modal' ? 'bg-green-900/60 text-green-300' : 'bg-blue-600 hover:bg-blue-500 text-white'
                      }`}
                    >
                      {copiedId === 'modal' ? 'Скопировано!' : 'Копировать'}
                    </button>
                  </div>
                </div>
                <button onClick={() => { setShowModal(false); setResult(null) }} className="w-full bg-gray-800 hover:bg-gray-700 px-4 py-2.5 rounded-lg text-sm transition">
                  Закрыть
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreate}>
                <div className="space-y-3">
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">Банк</label>
                    <select required value={form.bank}
                      onChange={e => setForm({ ...form, bank: e.target.value })}
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm">
                      <option value="">— выберите банк —</option>
                      {banks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                    </select>
                    {banks.length === 0 && <p className="text-yellow-500/80 text-xs mt-1">Банки не настроены (нет ссылок оформления в env).</p>}
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">Наименование организации</label>
                    <input type="text" required value={form.organizationName}
                      onChange={e => setForm({ ...form, organizationName: e.target.value })}
                      placeholder="ИП Иванов Иван Иванович"
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">ИНН (10 для ООО, 12 для ИП)</label>
                    <input type="text" required maxLength={12} value={form.inn}
                      onChange={e => setForm({ ...form, inn: e.target.value.replace(/\D/g, '') })}
                      placeholder="123456789012"
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm font-mono" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">Юридический адрес</label>
                    <input type="text" required value={form.legalAddress}
                      onChange={e => setForm({ ...form, legalAddress: e.target.value })}
                      placeholder="г Москва, ул Тверская, д 1"
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">Город обслуживания</label>
                    <input type="text" required value={form.city}
                      onChange={e => setForm({ ...form, city: e.target.value })}
                      placeholder="Москва"
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">Контактное лицо</label>
                    <input type="text" required value={form.contactPerson}
                      onChange={e => setForm({ ...form, contactPerson: e.target.value })}
                      placeholder="Иванов И.И."
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">Электронная почта</label>
                    <input type="email" required value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                      placeholder="client@example.com"
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">Телефон</label>
                    <input type="tel" required value={form.phone}
                      onChange={e => setForm({ ...form, phone: e.target.value })}
                      placeholder="+7 999 123 45 67"
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                </div>

                {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
                {submitting && <p className="text-blue-300 text-sm mt-3 flex items-center gap-2"><span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />{statusText}</p>}

                <button type="submit" disabled={submitting}
                  className="w-full mt-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-6 py-2.5 rounded-lg text-sm font-semibold transition">
                  {submitting ? 'Оформляем…' : 'Получить ссылку'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
