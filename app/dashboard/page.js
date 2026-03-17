'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'
import { getMissingReportAlerts } from '../../lib/notifications'

const TEAMS = {
  anastasia: { name: 'Анастасии', type: 'standard' },
  yasmin:    { name: 'Ясмин',     type: 'standard' },
  olya:      { name: 'Оли',       type: 'standard' },
  karina:    { name: 'Карины',    type: 'standard' },
  nikita:    { name: 'Никиты',    type: 'nikita'   },
}

// Команды с доступом к выдаче номеров
const CONTACT_TEAMS = ['yasmin', 'karina', 'anastasia', 'olya']

function getIPLast7Days(reports) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)
  cutoff.setHours(0, 0, 0, 0)
  return reports
    .filter(r => new Date(r.date) >= cutoff)
    .reduce((sum, r) => sum + (r.ordered_ip || 0), 0)
}

function getZone(ip) {
  if (ip < 15) return {
    bg: 'bg-red-950/40', border: 'border-red-700',
    text: 'text-red-400', badge: 'bg-red-900/60 text-red-300 border border-red-700', label: 'Красная зона'
  }
  if (ip <= 30) return {
    bg: 'bg-yellow-950/40', border: 'border-yellow-600',
    text: 'text-yellow-400', badge: 'bg-yellow-900/60 text-yellow-300 border border-yellow-600', label: 'Жёлтая зона'
  }
  return {
    bg: 'bg-green-950/40', border: 'border-green-700',
    text: 'text-green-400', badge: 'bg-green-900/60 text-green-300 border border-green-700', label: 'Зелёная зона'
  }
}

function formatTimeLeft(ms) {
  if (ms <= 0) return null
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 0) return `${hours} ч ${mins} мин`
  return `${mins} мин`
}

export default function DashboardPage() {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    unsubscribed: '',
    replied: '',
    ordered_ip: '',
    people_wrote: '',
  })
  const router = useRouter()

  // ── Вкладки ──
  const [activeTab, setActiveTab] = useState('report')

  // ── Состояние выдачи контактов ──
  const [accountsCount, setAccountsCount] = useState(1)
  const [distributedContacts, setDistributedContacts] = useState(null)
  const [distributing, setDistributing] = useState(false)
  const [distributions, setDistributions] = useState([])
  const [cooldownUntil, setCooldownUntil] = useState(null)
  const [cooldownLeft, setCooldownLeft] = useState(null)
  const [copiedIdx, setCopiedIdx] = useState(null)
  const [contactsError, setContactsError] = useState(null)
  const [contactsLoading, setContactsLoading] = useState(false)
  const [expandedDistId, setExpandedDistId] = useState(null)

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    setUser(user)

    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (profileData?.role === 'teamlead') { router.push('/teamlead'); return }
    if (profileData?.role === 'admin') { router.push('/admin'); return }

    setProfile(profileData)

    await loadReports(user.id)
  }

  const loadReports = async (userId) => {
    const { data } = await supabase
      .from('reports')
      .select('*')
      .eq('manager_id', userId)
      .order('date', { ascending: false })
    setReports(data || [])
    setLoading(false)
  }

  // ── Загрузка истории контактов ──
  const loadContactHistory = useCallback(async () => {
    if (!user) return
    setContactsLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/contacts', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (res.ok) {
        setDistributions(data.distributions || [])
        setCooldownUntil(data.cooldownUntil ? new Date(data.cooldownUntil) : null)
      }
    } catch (err) {
      console.error('Ошибка загрузки истории:', err)
    }
    setContactsLoading(false)
  }, [user])

  // Загружаем историю при переключении на вкладку контактов
  useEffect(() => {
    if (activeTab === 'contacts' && user) {
      loadContactHistory()
    }
  }, [activeTab, user, loadContactHistory])

  // ── Таймер кулдауна ──
  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownLeft(null)
      return
    }
    const updateTimer = () => {
      const diff = cooldownUntil.getTime() - Date.now()
      if (diff <= 0) {
        setCooldownUntil(null)
        setCooldownLeft(null)
      } else {
        setCooldownLeft(diff)
      }
    }
    updateTimer()
    const interval = setInterval(updateTimer, 30000) // обновляем каждые 30 сек
    return () => clearInterval(interval)
  }, [cooldownUntil])

  // ── Запрос контактов ──
  const handleRequestContacts = async () => {
    setDistributing(true)
    setContactsError(null)
    setDistributedContacts(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ accountsCount }),
      })
      const data = await res.json()

      if (!res.ok) {
        setContactsError(data.error || 'Ошибка')
        if (data.nextAvailableAt) {
          setCooldownUntil(new Date(data.nextAvailableAt))
        }
      } else {
        setDistributedContacts(data.contacts)
        setCooldownUntil(new Date(
          new Date(data.distributedAt).getTime() + 12 * 60 * 60 * 1000
        ))
        // Перезагружаем историю
        await loadContactHistory()
      }
    } catch (err) {
      setContactsError('Ошибка сети. Попробуйте ещё раз.')
    }
    setDistributing(false)
  }

  // ── Копирование списка ──
  const handleCopy = async (contacts, idx) => {
    try {
      await navigator.clipboard.writeText(contacts.join('\n'))
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    } catch {
      // fallback
      const text = contacts.join('\n')
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)

    const teamType = profile?.team ? (TEAMS[profile.team]?.type || 'standard') : 'standard'
    const record = {
      manager_id: user.id,
      date: form.date,
      ordered_ip: parseInt(form.ordered_ip) || 0,
    }
    if (teamType === 'nikita') {
      record.people_wrote = parseInt(form.people_wrote) || 0
    } else {
      record.unsubscribed = parseInt(form.unsubscribed) || 0
      record.replied      = parseInt(form.replied) || 0
    }

    const { error } = await supabase.from('reports').insert([record])
    if (!error) {
      setShowForm(false)
      setForm({
        date: new Date().toISOString().split('T')[0],
        unsubscribed: '', replied: '', ordered_ip: '', people_wrote: '',
      })
      await loadReports(user.id)
    }
    setSubmitting(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">
        Загрузка...
      </div>
    )
  }

  const teamType  = profile?.team ? (TEAMS[profile.team]?.type || 'standard') : 'standard'
  const isNikita  = teamType === 'nikita'
  const weeklyIP  = getIPLast7Days(reports)
  const zone      = getZone(weeklyIP)
  const { missing: myMissing } = getMissingReportAlerts(
    profile ? [profile] : [],
    reports
  )
  const hasContactsAccess = CONTACT_TEAMS.includes(profile?.team)

  const TABS = [
    { id: 'report', label: 'Отчёт' },
    ...(hasContactsAccess ? [{ id: 'contacts', label: 'Выдача номеров' }] : []),
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Header ── */}
      <header style={{ backgroundColor: '#111118', borderBottom: '1px solid #1f1f2e' }} className="px-4 sm:px-6 py-3 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3 sm:gap-8">
            <span className="text-base font-bold tracking-tight">Arb Stats</span>
            <div className="flex gap-1">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-sm font-medium transition ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="text-gray-500 text-sm hidden sm:inline">{profile?.name || user?.email}</span>
            <button
              onClick={handleLogout}
              className="text-gray-500 hover:text-white text-sm transition"
            >
              Выйти
            </button>
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* ─── Report tab ─── */}
        {activeTab === 'report' && (
          <>
            {/* Zone indicator */}
            <div className={`${zone.bg} border ${zone.border} rounded-2xl p-4 sm:p-5 mb-6 flex items-center justify-between`}>
              <div>
                <p className="text-gray-400 text-sm mb-1">Результаты за последние 7 дней</p>
                <p className={`text-3xl font-bold ${zone.text}`}>
                  {weeklyIP} <span className="text-lg font-normal">ИП</span>
                </p>
              </div>
              <span className={`px-4 py-2 rounded-xl text-sm font-semibold ${zone.badge}`}>
                {zone.label}
              </span>
            </div>

            {/* Missing report notification */}
            {myMissing.length > 0 && (
              <div className="bg-orange-950/40 border border-orange-700 rounded-2xl p-4 sm:p-5 mb-6 flex items-start gap-3">
                <span className="text-orange-400 text-lg leading-none mt-0.5">!</span>
                <div>
                  <p className="text-orange-300 text-sm font-semibold">Вы не сдали отчёт</p>
                  <p className="text-gray-400 text-xs mt-1">
                    Нет отчёта за {myMissing[0].dateFormatted}. Добавьте отчёт, чтобы уведомление исчезло.
                  </p>
                </div>
              </div>
            )}

            {/* Header row */}
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-semibold text-gray-200">Мои отчёты</h2>
              <button
                onClick={() => setShowForm(v => !v)}
                className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-semibold transition"
              >
                + Добавить отчёт
              </button>
            </div>

            {/* Form */}
            {showForm && (
              <div
                style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }}
                className="rounded-2xl p-6 mb-6"
              >
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Новый отчёт</h3>
                <form onSubmit={handleSubmit}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                    <div>
                      <label className="text-gray-400 text-xs mb-1.5 block">Дата</label>
                      <input
                        type="date"
                        value={form.date}
                        onChange={e => setForm({ ...form, date: e.target.value })}
                        className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                        required
                      />
                    </div>

                    {!isNikita && (
                      <>
                        <div>
                          <label className="text-gray-400 text-xs mb-1.5 block">Отписанные</label>
                          <input
                            type="number" min="0"
                            value={form.unsubscribed}
                            onChange={e => setForm({ ...form, unsubscribed: e.target.value })}
                            placeholder="0"
                            className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-gray-400 text-xs mb-1.5 block">Ответившие</label>
                          <input
                            type="number" min="0"
                            value={form.replied}
                            onChange={e => setForm({ ...form, replied: e.target.value })}
                            placeholder="0"
                            className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                          />
                        </div>
                      </>
                    )}

                    {isNikita && (
                      <div>
                        <label className="text-gray-400 text-xs mb-1.5 block">Написало людей</label>
                        <input
                          type="number" min="0"
                          value={form.people_wrote}
                          onChange={e => setForm({ ...form, people_wrote: e.target.value })}
                          placeholder="0"
                          className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                        />
                      </div>
                    )}

                    <div>
                      <label className="text-gray-400 text-xs mb-1.5 block">Заказано карт</label>
                      <input
                        type="number" min="0"
                        value={form.ordered_ip}
                        onChange={e => setForm({ ...form, ordered_ip: e.target.value })}
                        placeholder="0"
                        className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                        required
                      />
                    </div>

                  </div>

                  <div className="flex gap-3 mt-5">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-6 py-2 rounded-lg text-sm font-semibold transition"
                    >
                      {submitting ? 'Сохраняем...' : 'Сохранить'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="bg-gray-800 hover:bg-gray-700 px-6 py-2 rounded-lg text-sm transition"
                    >
                      Отмена
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Reports table */}
            <div
              style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }}
              className="rounded-2xl overflow-hidden overflow-x-auto"
            >
              <table className="w-full min-w-[400px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                    <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Дата</th>
                    {!isNikita && (
                      <>
                        <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Отписанные</th>
                        <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Ответившие</th>
                      </>
                    )}
                    {isNikita && (
                      <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Написало людей</th>
                    )}
                    <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказано карт</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.length === 0 ? (
                    <tr>
                      <td
                        colSpan={isNikita ? 3 : 4}
                        className="text-center py-16 text-gray-600 text-sm"
                      >
                        Нет данных — добавьте первый отчёт
                      </td>
                    </tr>
                  ) : (
                    reports.map(r => (
                      <tr
                        key={r.id}
                        style={{ borderTop: '1px solid #1a1a28' }}
                        className="hover:bg-white/[0.02] transition"
                      >
                        <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">
                          {new Date(r.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </td>
                        {!isNikita && (
                          <>
                            <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{r.unsubscribed ?? '—'}</td>
                            <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{r.replied ?? '—'}</td>
                          </>
                        )}
                        {isNikita && (
                          <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{r.people_wrote ?? '—'}</td>
                        )}
                        <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-blue-400">{r.ordered_ip ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ─── Contacts tab ─── */}
        {activeTab === 'contacts' && hasContactsAccess && (
          <>
            {/* Кулдаун */}
            {cooldownLeft && (
              <div className="bg-orange-950/40 border border-orange-700 rounded-2xl p-4 sm:p-5 mb-6 flex items-start gap-3">
                <svg className="w-5 h-5 text-orange-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-orange-300 text-sm font-semibold">Кулдаун активен</p>
                  <p className="text-gray-400 text-xs mt-1">
                    Следующая выдача доступна через {formatTimeLeft(cooldownLeft)}
                  </p>
                </div>
              </div>
            )}

            {/* Запрос контактов */}
            <div
              style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }}
              className="rounded-2xl p-5 sm:p-6 mb-6"
            >
              <h2 className="text-base font-semibold text-gray-200 mb-4">Получить контакты</h2>

              <div className="mb-4">
                <label className="text-gray-400 text-xs mb-2 block">Количество аккаунтов</label>
                <div className="flex gap-2">
                  {[1, 2, 3].map(n => (
                    <button
                      key={n}
                      onClick={() => setAccountsCount(n)}
                      className={`px-5 py-2.5 rounded-lg text-sm font-medium transition ${
                        accountsCount === n
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                      }`}
                    >
                      {n} {n === 1 ? 'аккаунт' : n < 5 ? 'аккаунта' : 'аккаунтов'}
                    </button>
                  ))}
                </div>
                <p className="text-gray-500 text-xs mt-2">
                  Будет выдано {accountsCount * 20} контактов ({accountsCount} {accountsCount === 1 ? 'список' : accountsCount < 5 ? 'списка' : 'списков'} по 20)
                </p>
              </div>

              <button
                onClick={handleRequestContacts}
                disabled={distributing || !!cooldownLeft}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2.5 rounded-lg text-sm font-semibold transition"
              >
                {distributing ? 'Загрузка...' : 'Получить номера'}
              </button>

              {contactsError && (
                <p className="text-red-400 text-sm mt-3">{contactsError}</p>
              )}
            </div>

            {/* Результат выдачи */}
            {distributedContacts && (
              <div className="mb-6">
                <h3 className="text-base font-semibold text-gray-200 mb-3">Ваши контакты</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {distributedContacts.map((group, idx) => (
                    <div
                      key={idx}
                      style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }}
                      className="rounded-2xl p-4 sm:p-5"
                    >
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-sm font-semibold text-gray-300">
                          Аккаунт {idx + 1}
                        </span>
                        <button
                          onClick={() => handleCopy(group, idx)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                            copiedIdx === idx
                              ? 'bg-green-900/60 text-green-300 border border-green-700'
                              : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                          }`}
                        >
                          {copiedIdx === idx ? 'Скопировано!' : 'Копировать'}
                        </button>
                      </div>
                      <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
                        {group.map((contact, cIdx) => (
                          <div key={cIdx} className="flex gap-2 text-xs">
                            <span className="text-gray-600 w-5 text-right shrink-0">{cIdx + 1}.</span>
                            <span className="text-gray-300 break-all">{contact}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* История выдач */}
            <div>
              <h3 className="text-base font-semibold text-gray-200 mb-3">История выдач</h3>
              <div
                style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }}
                className="rounded-2xl overflow-hidden"
              >
                {contactsLoading ? (
                  <div className="text-center py-12 text-gray-600 text-sm">Загрузка...</div>
                ) : distributions.length === 0 ? (
                  <div className="text-center py-12 text-gray-600 text-sm">
                    Вы ещё не получали контакты
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                        <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Дата</th>
                        <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Аккаунтов</th>
                        <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Контактов</th>
                        <th className="px-3 sm:px-5 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {distributions.map(dist => {
                        const totalContacts = Array.isArray(dist.contacts)
                          ? dist.contacts.reduce((sum, g) => sum + (Array.isArray(g) ? g.length : 0), 0)
                          : 0
                        const isExpanded = expandedDistId === dist.id

                        return (
                          <tr key={dist.id}>
                            <td colSpan={4} className="p-0">
                              <div>
                                <div
                                  style={{ borderTop: '1px solid #1a1a28' }}
                                  className="flex items-center hover:bg-white/[0.02] transition cursor-pointer"
                                  onClick={() => setExpandedDistId(isExpanded ? null : dist.id)}
                                >
                                  <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">
                                    {new Date(dist.distributed_at).toLocaleDateString('ru-RU', {
                                      day: '2-digit', month: '2-digit', year: 'numeric',
                                      hour: '2-digit', minute: '2-digit',
                                    })}
                                  </td>
                                  <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{dist.accounts_count}</td>
                                  <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-blue-400">{totalContacts}</td>
                                  <td className="px-3 sm:px-5 py-3 text-right">
                                    <span className="text-gray-500 text-xs">{isExpanded ? '▲' : '▼'}</span>
                                  </td>
                                </div>
                                {isExpanded && Array.isArray(dist.contacts) && (
                                  <div className="px-3 sm:px-5 pb-4 pt-1">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                      {dist.contacts.map((group, gIdx) => (
                                        <div key={gIdx} className="bg-gray-900/50 rounded-lg p-3">
                                          <div className="flex justify-between items-center mb-2">
                                            <span className="text-xs font-medium text-gray-400">Аккаунт {gIdx + 1}</span>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleCopy(group, `hist-${dist.id}-${gIdx}`) }}
                                              className={`px-2 py-1 rounded text-xs transition ${
                                                copiedIdx === `hist-${dist.id}-${gIdx}`
                                                  ? 'bg-green-900/60 text-green-300'
                                                  : 'bg-gray-800 text-gray-500 hover:text-white'
                                              }`}
                                            >
                                              {copiedIdx === `hist-${dist.id}-${gIdx}` ? 'Скопировано!' : 'Копировать'}
                                            </button>
                                          </div>
                                          <div className="space-y-0.5">
                                            {Array.isArray(group) && group.map((c, cIdx) => (
                                              <div key={cIdx} className="text-xs text-gray-400 break-all">
                                                {cIdx + 1}. {c}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}

      </main>
    </div>
  )
}
