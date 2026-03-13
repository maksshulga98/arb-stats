'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

const TEAMS = {
  anastasia: { name: 'Анастасии', type: 'standard' },
  yasmin:    { name: 'Ясмин',     type: 'standard' },
  olya:      { name: 'Оли',       type: 'standard' },
  karina:    { name: 'Карины',    type: 'standard' },
  nikita:    { name: 'Никиты',    type: 'nikita'   },
}

function getIPLast7Days(reports) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)
  cutoff.setHours(0, 0, 0, 0)
  return reports
    .filter(r => new Date(r.date) >= cutoff)
    .reduce((sum, r) => sum + (r.ordered_ip || 0), 0)
}

function getZone(ip) {
  if (ip < 10) return {
    bg: 'bg-red-950/40', border: 'border-red-700',
    text: 'text-red-400', badge: 'bg-red-900/60 text-red-300 border border-red-700', label: 'Красная зона'
  }
  if (ip <= 15) return {
    bg: 'bg-yellow-950/40', border: 'border-yellow-600',
    text: 'text-yellow-400', badge: 'bg-yellow-900/60 text-yellow-300 border border-yellow-600', label: 'Жёлтая зона'
  }
  return {
    bg: 'bg-green-950/40', border: 'border-green-700',
    text: 'text-green-400', badge: 'bg-green-900/60 text-green-300 border border-green-700', label: 'Зелёная зона'
  }
}

export default function DashboardPage() {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('analytics')
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

  const TABS = [
    { id: 'analytics', label: 'Аналитика команды' },
    { id: 'salary',    label: 'Расчёт ЗП' },
    { id: 'telegram',  label: 'Аккаунты Телеграмм' },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Header ── */}
      <header style={{ backgroundColor: '#111118', borderBottom: '1px solid #1f1f2e' }} className="px-6 py-3 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-8">
            <span className="text-base font-bold tracking-tight">Arb Stats</span>
            <nav className="flex gap-1">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-500 text-sm">{profile?.name || user?.email}</span>
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
      <main className="max-w-6xl mx-auto px-6 py-8">

        {/* ─── Analytics tab ─── */}
        {activeTab === 'analytics' && (
          <>
            {/* Zone indicator */}
            <div className={`${zone.bg} border ${zone.border} rounded-2xl p-5 mb-6 flex items-center justify-between`}>
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
                  <div className="grid grid-cols-2 gap-4">

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
                      <label className="text-gray-400 text-xs mb-1.5 block">Заказали ИП</label>
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
              className="rounded-2xl overflow-hidden"
            >
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                    <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Дата</th>
                    {!isNikita && (
                      <>
                        <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Отписанные</th>
                        <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Ответившие</th>
                      </>
                    )}
                    {isNikita && (
                      <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Написало людей</th>
                    )}
                    <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказали ИП</th>
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
                        <td className="px-5 py-3 text-sm text-gray-300">
                          {new Date(r.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </td>
                        {!isNikita && (
                          <>
                            <td className="px-5 py-3 text-sm text-gray-300">{r.unsubscribed ?? '—'}</td>
                            <td className="px-5 py-3 text-sm text-gray-300">{r.replied ?? '—'}</td>
                          </>
                        )}
                        {isNikita && (
                          <td className="px-5 py-3 text-sm text-gray-300">{r.people_wrote ?? '—'}</td>
                        )}
                        <td className="px-5 py-3 text-sm font-semibold text-blue-400">{r.ordered_ip ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ─── Salary tab ─── */}
        {activeTab === 'salary' && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="text-5xl mb-4">💰</div>
            <p className="text-gray-300 font-medium text-lg">Расчёт заработной платы</p>
            <p className="text-gray-600 text-sm mt-2">Раздел в разработке</p>
          </div>
        )}

        {/* ─── Telegram tab ─── */}
        {activeTab === 'telegram' && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="text-5xl mb-4">✈️</div>
            <p className="text-gray-300 font-medium text-lg">Аккаунты Телеграмм</p>
            <p className="text-gray-600 text-sm mt-2">Раздел в разработке</p>
          </div>
        )}

      </main>
    </div>
  )
}
