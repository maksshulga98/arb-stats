'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'
import { getMissingReportAlerts } from '../../lib/notifications'
import { MANAGER_SHEETS } from '../../lib/sheets-config'

const TEAMS = [
  { id: 'anastasia', name: 'Анастасии', type: 'standard' },
  { id: 'yasmin',    name: 'Ясмин',     type: 'standard' },
  { id: 'olya',      name: 'Оли',       type: 'standard' },
  { id: 'karina',    name: 'Карины',    type: 'standard' },
  { id: 'nikita',    name: 'Никиты',    type: 'nikita'   },
]

function getIPForPeriod(reports, daysStart, daysEnd) {
  const now = new Date()
  now.setHours(23, 59, 59, 999)
  const end = new Date(now)
  end.setDate(end.getDate() - daysStart)
  const start = new Date(now)
  start.setDate(start.getDate() - daysEnd)
  start.setHours(0, 0, 0, 0)

  return reports
    .filter(r => {
      const d = new Date(r.date)
      return d >= start && d <= end
    })
    .reduce((sum, r) => sum + (r.ordered_ip || 0), 0)
}

function getZoneKey(ip) {
  if (ip < 10) return 'red'
  if (ip <= 15) return 'yellow'
  return 'green'
}

function isRedFor14Days(reports, createdAt) {
  // Manager must have existed for more than 14 days
  if (createdAt) {
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
    if (new Date(createdAt) > fourteenDaysAgo) return false
  }
  const week1 = getIPForPeriod(reports, 0, 7)
  const week2 = getIPForPeriod(reports, 7, 14)
  return week1 < 10 && week2 < 10
}

const ZONE = {
  red: {
    card:  'border-red-800 bg-red-950/25',
    badge: 'bg-red-900/50 text-red-300 border border-red-800',
    label: 'Красная зона',
    bar:   'bg-red-600',
    text:  'text-red-400',
  },
  yellow: {
    card:  'border-yellow-700 bg-yellow-950/25',
    badge: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
    label: 'Жёлтая зона',
    bar:   'bg-yellow-500',
    text:  'text-yellow-400',
  },
  green: {
    card:  'border-green-800 bg-green-950/25',
    badge: 'bg-green-900/50 text-green-300 border border-green-800',
    label: 'Зелёная зона',
    bar:   'bg-green-500',
    text:  'text-green-400',
  },
}

function BellIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function CdValue({ value, loading, color = 'text-emerald-400' }) {
  if (loading) return <span className="text-gray-600">...</span>
  if (value === null || value === undefined) return <span className="text-gray-600">—</span>
  if (value === 0) return <span className="text-gray-600">0</span>
  return <span className={`font-semibold ${color}`}>{value}</span>
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

export default function AdminPage() {
  const [managers, setManagers]           = useState([])
  const [teamleads, setTeamleads]        = useState([])
  const [reports,  setReports]            = useState([])
  const [loading,  setLoading]            = useState(true)
  const [activeTab, setActiveTab]         = useState('analytics')
  const [dateFrom, setDateFrom]          = useState(new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo]              = useState(new Date().toISOString().split('T')[0])
  const [selectedManager, setSelectedManager] = useState(null)
  const [deletingReport, setDeletingReport]   = useState(null)
  const [showBell, setShowBell]           = useState(false)
  const [sheetsData, setSheetsData]       = useState({})
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [contactStats, setContactStats]   = useState({ total: 0, byManager: [] })
  const [contactsLoading, setContactsLoading] = useState(false)
  const bellRef = useRef(null)
  const router  = useRouter()

  useEffect(() => { checkAdmin() }, [])

  // Fetch Google Sheets ЦД data when daily tab is active
  useEffect(() => {
    if (activeTab !== 'daily' || managers.length === 0) return
    const allMembers = [...managers, ...teamleads]
    const namesWithSheets = allMembers.filter(m => m.sheet_id || MANAGER_SHEETS[m.name]).map(m => m.name)
    if (namesWithSheets.length === 0) { setSheetsData({}); return }
    setSheetsLoading(true)
    fetch(`/api/sheets?names=${encodeURIComponent(namesWithSheets.join(','))}&dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then(r => r.json())
      .then(data => setSheetsData(data))
      .catch(() => setSheetsData({}))
      .finally(() => setSheetsLoading(false))
  }, [activeTab, dateFrom, dateTo, managers])

  // Fetch contact distribution stats when daily tab is active
  useEffect(() => {
    if (activeTab !== 'daily') return
    setContactsLoading(true)
    fetch(`/api/contacts/stats?dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then(r => r.json())
      .then(data => setContactStats(data || { total: 0, byManager: [], byManagerId: {} }))
      .catch(() => setContactStats({ total: 0, byManager: [], byManagerId: {} }))
      .finally(() => setContactsLoading(false))
  }, [activeTab, dateFrom, dateTo])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSelectedManager(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ADMIN_EMAILS = ['nikita.tatarintsev@arbteam.ru']

  const checkAdmin = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    const isAdmin = profile?.role === 'admin' || ADMIN_EMAILS.includes(user.email)
    if (!isAdmin) { router.push('/dashboard'); return }

    await loadData()
  }

  const loadData = async () => {
    const [{ data: mgrs }, { data: tls }, { data: reps }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'manager'),
      supabase.from('profiles').select('*').eq('role', 'teamlead'),
      supabase.from('reports').select('*').order('date', { ascending: false }),
    ])
    setManagers(mgrs || [])
    setTeamleads(tls || [])
    setReports(reps || [])
    setLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const managerReports = (id) => reports.filter(r => r.manager_id === id)

  const handleDeleteReport = async (reportId) => {
    setDeletingReport(reportId)
    await supabase.from('reports').delete().eq('id', reportId)
    setReports(prev => prev.filter(r => r.id !== reportId))
    setDeletingReport(null)
  }

  const redManagers = managers.filter(m => isRedFor14Days(managerReports(m.id), m.created_at))

  // Missing report notifications (all managers across all teams)
  const { missing: missingAlerts, streaks: streakAlerts } = getMissingReportAlerts(managers, reports)
  const totalNotifications = redManagers.length + missingAlerts.length + streakAlerts.length

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">
        Загрузка...
      </div>
    )
  }

  const modalReports  = selectedManager ? managerReports(selectedManager.id) : []
  const modalTeam     = selectedManager ? TEAMS.find(t => t.id === selectedManager.team) : null
  const modalIsNikita = modalTeam?.type === 'nikita'

  const TABS = [
    { id: 'analytics', label: 'Аналитика команды' },
    { id: 'daily',     label: 'Дневной отчёт' },
    { id: 'salary',    label: 'Расчёт ЗП' },
    { id: 'telegram',  label: 'Аккаунты Телеграмм' },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Header ── */}
      <header
        style={{ backgroundColor: '#111118', borderBottom: '1px solid #1f1f2e' }}
        className="px-4 sm:px-6 py-3 sticky top-0 z-40"
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0">
          <div className="flex items-center justify-between sm:justify-start gap-3 sm:gap-8">
            <span className="text-base font-bold tracking-tight">Arb Stats</span>
            <div className="flex items-center gap-2 sm:hidden">
              {/* Mobile bell + logout */}
              <div className="relative" ref={bellRef}>
                <button
                  onClick={() => setShowBell(v => !v)}
                  className="relative p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition"
                >
                  <BellIcon />
                  {totalNotifications > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                      {totalNotifications}
                    </span>
                  )}
                </button>
              </div>
              <button
                onClick={handleLogout}
                className="text-gray-500 hover:text-white text-sm transition"
              >
                Выйти
              </button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-1 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="hidden sm:flex items-center gap-3">
            {/* Bell */}
            <div className="relative" ref={bellRef}>
              <button
                onClick={() => setShowBell(v => !v)}
                className="relative p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition"
              >
                <BellIcon />
                {redManagers.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                    {redManagers.length}
                  </span>
                )}
              </button>

              {showBell && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowBell(false)}
                  />
                  <div
                    style={{ backgroundColor: '#13131f', border: '1px solid #2a2a3e' }}
                    className="absolute right-0 top-12 rounded-2xl p-4 w-72 sm:w-80 z-50 shadow-2xl"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-200">Уведомления</h3>
                      <button
                        onClick={() => setShowBell(false)}
                        className="text-gray-500 hover:text-white transition"
                      >
                        <CloseIcon />
                      </button>
                    </div>
                    {totalNotifications === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-4">Нет уведомлений</p>
                    ) : (
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {streakAlerts.map(m => (
                          <div
                            key={`streak-${m.id}`}
                            className="bg-orange-950/40 border border-orange-700 rounded-xl p-3 cursor-pointer hover:bg-orange-950/60 transition"
                            onClick={() => { setSelectedManager(managers.find(x => x.id === m.id)); setShowBell(false) }}
                          >
                            <p className="text-orange-300 text-sm font-semibold">{m.name}</p>
                            <p className="text-gray-500 text-xs mt-0.5">
                              {TEAMS.find(t => t.id === m.team)?.name ? `Команда ${TEAMS.find(t => t.id === m.team).name} · ` : ''}
                              Не сдавал отчёт {m.days} дн. подряд
                            </p>
                          </div>
                        ))}
                        {missingAlerts.filter(m => !streakAlerts.find(s => s.id === m.id)).map(m => (
                          <div
                            key={`missing-${m.id}`}
                            className="bg-yellow-950/40 border border-yellow-700 rounded-xl p-3 cursor-pointer hover:bg-yellow-950/60 transition"
                            onClick={() => { setSelectedManager(managers.find(x => x.id === m.id)); setShowBell(false) }}
                          >
                            <p className="text-yellow-300 text-sm font-semibold">{m.name}</p>
                            <p className="text-gray-500 text-xs mt-0.5">
                              {TEAMS.find(t => t.id === m.team)?.name ? `Команда ${TEAMS.find(t => t.id === m.team).name} · ` : ''}
                              Не сдал отчёт за {m.dateFormatted}
                            </p>
                          </div>
                        ))}
                        {redManagers.map(m => (
                          <div
                            key={`red-${m.id}`}
                            className="bg-red-950/40 border border-red-800 rounded-xl p-3 cursor-pointer hover:bg-red-950/60 transition"
                            onClick={() => { setSelectedManager(m); setShowBell(false) }}
                          >
                            <p className="text-red-300 text-sm font-semibold">{m.name || m.email}</p>
                            <p className="text-gray-500 text-xs mt-0.5">
                              {TEAMS.find(t => t.id === m.team)?.name ? `Команда ${TEAMS.find(t => t.id === m.team).name} · ` : ''}
                              14 дней в красной зоне
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <span className="w-px h-5 bg-gray-800" />
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* ─── Analytics tab ─── */}
        {activeTab === 'analytics' && (
          <div className="space-y-10">
            {TEAMS.map(team => {
              const teamManagers = managers.filter(m => m.team === team.id)
              const teamTLs = team.id !== 'nikita' ? teamleads.filter(t => t.team === team.id) : []
              const teamAll = [...teamTLs, ...teamManagers]

              return (
                <section key={team.id}>
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-base font-semibold text-gray-200">
                      Команда {team.name}
                    </h2>
                    <span className="text-gray-600 text-sm">
                      {teamAll.length} {teamAll.length === 1 ? 'менеджер' : 'менеджеров'}
                    </span>
                  </div>

                  {teamAll.length === 0 ? (
                    <div
                      style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }}
                      className="rounded-xl p-6 text-gray-600 text-sm"
                    >
                      Нет менеджеров — назначьте team в профиле пользователя
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {teamAll.map(manager => {
                        const mRep    = managerReports(manager.id)
                        const ip7     = getIPForPeriod(mRep, 0, 7)
                        const zKey    = getZoneKey(ip7)
                        const z       = ZONE[zKey]
                        const alert14 = isRedFor14Days(mRep, manager.created_at)

                        return (
                          <button
                            key={manager.id}
                            onClick={() => setSelectedManager(manager)}
                            className={`border rounded-2xl p-4 text-left transition-all hover:scale-[1.02] hover:shadow-lg cursor-pointer ${z.card}`}
                          >
                            <div className="flex justify-between items-start mb-3">
                              <span className="font-medium text-white text-sm leading-tight">
                                {manager.name || manager.email}
                                {manager.role === 'teamlead' && <span className="text-xs text-blue-400 ml-1">(ТЛ)</span>}
                              </span>
                              {alert14 && (
                                <span
                                  title="14 дней в красной зоне"
                                  className="text-red-400 text-base leading-none ml-1 flex-shrink-0"
                                >
                                  ⚠
                                </span>
                              )}
                            </div>

                            <div className="mb-3">
                              <span className={`text-3xl font-bold ${z.text}`}>{ip7}</span>
                              <span className="text-gray-500 text-xs ml-1">ИП / 7 дн</span>
                            </div>

                            <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-medium ${z.badge}`}>
                              {z.label}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}

        {/* ─── Daily report tab ─── */}
        {activeTab === 'daily' && (
          <div className="space-y-8">
            <div className="flex items-center gap-4 flex-wrap">
              <label className="text-gray-400 text-sm">С:</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); if (e.target.value > dateTo) setDateTo(e.target.value) }}
                className="bg-gray-900 text-white px-4 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
              />
              <label className="text-gray-400 text-sm">По:</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); if (e.target.value < dateFrom) setDateFrom(e.target.value) }}
                className="bg-gray-900 text-white px-4 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>

            {/* Overall summary */}
            {(() => {
              const dayReports = reports.filter(r => r.date >= dateFrom && r.date <= dateTo)
              const allMembers = [...managers, ...teamleads]
              const totalUnsubscribed = dayReports.reduce((s, r) => s + (r.unsubscribed || 0), 0)
              const totalReplied      = dayReports.reduce((s, r) => s + (r.replied || 0), 0)
              const totalOrdered      = dayReports.reduce((s, r) => s + (r.ordered_ip || 0), 0)
              const totalPeopleWrote  = dayReports.reduce((s, r) => s + (r.people_wrote || 0), 0)
              const reported = new Set(dayReports.map(r => r.manager_id))
              const totalMembers = allMembers.length
              const reportedCount = allMembers.filter(m => reported.has(m.id)).length

              return (
                <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-gray-200">Сводка за период</h2>
                    <span className="text-gray-600 text-xs">{reportedCount} из {totalMembers} сдали отчёт</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Отписанные</p>
                      <p className="text-xl font-bold text-gray-200">{totalUnsubscribed}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Ответившие</p>
                      <p className="text-xl font-bold text-gray-200">{totalReplied}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Заказали ИП</p>
                      <p className="text-xl font-bold text-blue-400">{totalOrdered}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Написало людей</p>
                      <p className="text-xl font-bold text-gray-200">{totalPeopleWrote}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">ЦД ИП</p>
                      <p className="text-xl font-bold text-emerald-400">
                        {sheetsLoading ? '...' : Object.values(sheetsData).reduce((s, v) => s + (v?.ip || 0), 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Дебетовые</p>
                      <p className="text-xl font-bold text-purple-400">
                        {sheetsLoading ? '...' : Object.values(sheetsData).reduce((s, v) => s + (v?.debit || 0), 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Выдано номеров</p>
                      <p className="text-xl font-bold text-orange-400">
                        {contactsLoading ? '...' : contactStats.total}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })()}

            {TEAMS.map(team => {
              const isNikita = team.type === 'nikita'
              const teamMembers = [
                ...managers.filter(m => m.team === team.id),
                ...teamleads.filter(t => t.team === team.id),
              ]
              const dayReports = reports.filter(r => r.date >= dateFrom && r.date <= dateTo)

              const rows = teamMembers.map(member => {
                const memberReports = dayReports.filter(r => r.manager_id === member.id)
                const report = memberReports.length > 0 ? {
                  unsubscribed: memberReports.reduce((s, r) => s + (r.unsubscribed || 0), 0),
                  replied:      memberReports.reduce((s, r) => s + (r.replied || 0), 0),
                  ordered_ip:   memberReports.reduce((s, r) => s + (r.ordered_ip || 0), 0),
                  people_wrote: memberReports.reduce((s, r) => s + (r.people_wrote || 0), 0),
                } : null
                return { member, report }
              })

              const totals = {
                unsubscribed: rows.reduce((s, r) => s + (r.report?.unsubscribed || 0), 0),
                replied:      rows.reduce((s, r) => s + (r.report?.replied || 0), 0),
                ordered_ip:   rows.reduce((s, r) => s + (r.report?.ordered_ip || 0), 0),
                people_wrote: rows.reduce((s, r) => s + (r.report?.people_wrote || 0), 0),
              }

              return (
                <section key={team.id}>
                  <div className="flex items-center gap-3 mb-3">
                    <h2 className="text-base font-semibold text-gray-200">Команда {team.name}</h2>
                    <span className="text-gray-600 text-sm">{teamMembers.length} чел.</span>
                  </div>

                  <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl overflow-hidden overflow-x-auto">
                    <table className="w-full min-w-[480px]">
                      <thead>
                        <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                          <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Менеджер</th>
                          {!isNikita && (
                            <>
                              <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Отписанные</th>
                              <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Ответившие</th>
                            </>
                          )}
                          {isNikita && (
                            <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Написало людей</th>
                          )}
                          <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказали ИП</th>
                          <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ЦД ИП</th>
                          <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Дебетовые</th>
                          {!isNikita && (
                            <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Взято номеров</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr>
                            <td colSpan={isNikita ? 5 : 7} className="text-center py-8 text-gray-600 text-sm">
                              Нет участников в команде
                            </td>
                          </tr>
                        ) : (
                          <>
                            {rows.map(({ member, report }) => {
                              const sd = sheetsData[member.name]
                              return (
                                <tr key={member.id} style={{ borderTop: '1px solid #1a1a28' }} className="hover:bg-white/[0.02] transition">
                                  <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">
                                    {member.name || member.email}
                                    {member.role === 'teamlead' && <span className="ml-2 text-xs text-gray-600">(тимлид)</span>}
                                  </td>
                                  {!isNikita && (
                                    <>
                                      <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{report ? report.unsubscribed : '—'}</td>
                                      <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{report ? report.replied : '—'}</td>
                                    </>
                                  )}
                                  {isNikita && (
                                    <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{report ? report.people_wrote : '—'}</td>
                                  )}
                                  <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-blue-400">{report ? report.ordered_ip : '—'}</td>
                                  <td className="px-3 sm:px-5 py-3 text-sm">
                                    <CdValue value={sd ? sd.ip : null} loading={sheetsLoading && sd === undefined} />
                                  </td>
                                  <td className="px-3 sm:px-5 py-3 text-sm">
                                    <CdValue value={sd ? sd.debit : null} loading={sheetsLoading && sd === undefined} color="text-purple-400" />
                                  </td>
                                  {!isNikita && (
                                    <td className="px-3 sm:px-5 py-3 text-sm">
                                      <CdValue value={contactStats.byManagerId?.[member.id] ?? null} loading={contactsLoading} color="text-orange-400" />
                                    </td>
                                  )}
                                </tr>
                              )
                            })}
                            {(rows.some(r => r.report) || Object.values(sheetsData).some(v => v?.total)) && (
                              <tr style={{ borderTop: '2px solid #2a2a3e' }} className="bg-white/[0.02]">
                                <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-gray-200">Итого</td>
                                {!isNikita && (
                                  <>
                                    <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-gray-200">{totals.unsubscribed}</td>
                                    <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-gray-200">{totals.replied}</td>
                                  </>
                                )}
                                {isNikita && (
                                  <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-gray-200">{totals.people_wrote}</td>
                                )}
                                <td className="px-3 sm:px-5 py-3 text-sm font-bold text-blue-400">{totals.ordered_ip}</td>
                                <td className="px-3 sm:px-5 py-3 text-sm font-bold text-emerald-400">
                                  {rows.reduce((s, { member }) => s + (sheetsData[member.name]?.ip || 0), 0)}
                                </td>
                                <td className="px-3 sm:px-5 py-3 text-sm font-bold text-purple-400">
                                  {rows.reduce((s, { member }) => s + (sheetsData[member.name]?.debit || 0), 0)}
                                </td>
                                {!isNikita && (
                                  <td className="px-3 sm:px-5 py-3 text-sm font-bold text-orange-400">
                                    {rows.reduce((s, { member }) => s + (contactStats.byManagerId?.[member.id] || 0), 0)}
                                  </td>
                                )}
                              </tr>
                            )}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )
            })}
          </div>
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

      {/* ── Manager Modal ── */}
      {selectedManager && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedManager(null)}
        >
          <div
            style={{ backgroundColor: '#13131f', border: '1px solid #2a2a3e' }}
            className="rounded-2xl w-full max-w-2xl max-h-[90vh] sm:max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              style={{ borderBottom: '1px solid #1f1f2e' }}
              className="px-6 py-5 flex justify-between items-start"
            >
              <div>
                <h2 className="text-lg font-bold text-white">{selectedManager.name || selectedManager.email}</h2>
                <p className="text-gray-500 text-sm mt-0.5">
                  {modalTeam ? `Команда ${modalTeam.name}` : 'Команда не задана'}
                  {' · '}
                  {modalReports.length} отчётов
                </p>
              </div>
              <button
                onClick={() => setSelectedManager(null)}
                className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-white/5 transition"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Zone summary strip */}
            {(() => {
              const ip7  = getIPForPeriod(modalReports, 0, 7)
              const ip14 = getIPForPeriod(modalReports, 7, 14)
              const zKey = getZoneKey(ip7)
              const z    = ZONE[zKey]
              return (
                <div className="px-6 pt-4 pb-2 flex gap-4">
                  <div className={`flex-1 border rounded-xl px-4 py-3 ${z.card}`}>
                    <p className="text-gray-500 text-xs mb-1">Последние 7 дней</p>
                    <p className={`text-xl font-bold ${z.text}`}>{ip7} ИП</p>
                    <span className={`text-xs ${z.badge} inline-block px-2 py-0.5 rounded-md mt-1`}>{z.label}</span>
                  </div>
                  <div className={`flex-1 border rounded-xl px-4 py-3 ${ZONE[getZoneKey(ip14)].card}`}>
                    <p className="text-gray-500 text-xs mb-1">Предыдущие 7 дней</p>
                    <p className={`text-xl font-bold ${ZONE[getZoneKey(ip14)].text}`}>{ip14} ИП</p>
                    <span className={`text-xs ${ZONE[getZoneKey(ip14)].badge} inline-block px-2 py-0.5 rounded-md mt-1`}>{ZONE[getZoneKey(ip14)].label}</span>
                  </div>
                </div>
              )
            })()}

            {/* Reports table */}
            <div className="flex-1 overflow-auto px-6 pb-6 mt-2">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                    <th className="text-left py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wider">Дата</th>
                    {!modalIsNikita && (
                      <>
                        <th className="text-left py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wider">Отписанные</th>
                        <th className="text-left py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wider">Ответившие</th>
                      </>
                    )}
                    {modalIsNikita && (
                      <th className="text-left py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wider">Написало людей</th>
                    )}
                    <th className="text-left py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказали ИП</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {modalReports.length === 0 ? (
                    <tr>
                      <td
                        colSpan={modalIsNikita ? 4 : 5}
                        className="text-center py-12 text-gray-600 text-sm"
                      >
                        Нет отчётов
                      </td>
                    </tr>
                  ) : (
                    modalReports.map(r => (
                      <tr
                        key={r.id}
                        style={{ borderTop: '1px solid #1a1a28' }}
                        className="hover:bg-white/[0.02] transition group"
                      >
                        <td className="py-2.5 text-sm text-gray-300">
                          {new Date(r.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </td>
                        {!modalIsNikita && (
                          <>
                            <td className="py-2.5 text-sm text-gray-300">{r.unsubscribed ?? '—'}</td>
                            <td className="py-2.5 text-sm text-gray-300">{r.replied ?? '—'}</td>
                          </>
                        )}
                        {modalIsNikita && (
                          <td className="py-2.5 text-sm text-gray-300">{r.people_wrote ?? '—'}</td>
                        )}
                        <td className="py-2.5 text-sm font-semibold text-blue-400">{r.ordered_ip ?? '—'}</td>
                        <td className="py-2.5 pr-1 text-right">
                          <button
                            onClick={() => handleDeleteReport(r.id)}
                            disabled={deletingReport === r.id}
                            className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition disabled:opacity-30"
                            title="Удалить отчёт"
                          >
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
