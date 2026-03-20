'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'
import { getMissingReportAlerts } from '../../lib/notifications'
import { MANAGER_SHEETS, MONTHS_RU } from '../../lib/sheets-config'

const TEAMS = [
  { id: 'anastasia', name: 'Анастасии', type: 'standard' },
  { id: 'yasmin',    name: 'Ясмин',     type: 'standard' },
  { id: 'olya',      name: 'Оли',       type: 'standard' },
  { id: 'karina',    name: 'Карины',    type: 'karina'   },
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

function getZoneKey(value, teamType) {
  if (teamType === 'karina') {
    if (value < 15) return 'red'
    if (value <= 30) return 'yellow'
    return 'green'
  }
  if (value < 10) return 'red'
  if (value <= 15) return 'yellow'
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
  const [deletedMembers, setDeletedMembers] = useState([])
  // Salary tab state
  const now = new Date()
  const [salaryMonth, setSalaryMonth]     = useState(now.getMonth())
  const [salaryYear, setSalaryYear]       = useState(now.getFullYear())
  const [salaryHalf, setSalaryHalf]       = useState(now.getDate() <= 15 ? 1 : 2)
  const [salarySheetsData, setSalarySheetsData] = useState({})
  const [salaryLoading, setSalaryLoading] = useState(false)
  const [salaryCalculated, setSalaryCalculated] = useState(false)
  const [paymentEditing, setPaymentEditing] = useState({})
  const [paymentSaving, setPaymentSaving]   = useState({})
  // Sheet binding state
  const [sheetEditing, setSheetEditing] = useState(false)
  const [sheetUrlInput, setSheetUrlInput] = useState('')
  const [sheetSaving, setSheetSaving] = useState(false)
  // IP Link tab state
  const [showIpModal, setShowIpModal] = useState(false)
  const [ipForm, setIpForm] = useState({ fullName: '', inn: '', phone: '', email: '', city: '' })
  const [ipSubmitting, setIpSubmitting] = useState(false)
  const [ipError, setIpError] = useState(null)
  const [ipResult, setIpResult] = useState(null)
  const [ipHistory, setIpHistory] = useState([])
  const [ipHistoryLoading, setIpHistoryLoading] = useState(false)
  const [copiedIpLink, setCopiedIpLink] = useState(null)
  const [user, setUser] = useState(null)

  // Telegram tab state
  const [tgAccounts, setTgAccounts]         = useState([])
  const [tgLoading, setTgLoading]           = useState(false)
  const [tgCodeLoading, setTgCodeLoading]   = useState({})
  const [tgCode, setTgCode]                 = useState(null) // { code, receivedAt, phone }
  const [tgAssigning, setTgAssigning]       = useState({}) // { rowIndex: true }
  const [tgAssignSelect, setTgAssignSelect] = useState({}) // { rowIndex: name }
  const bellRef = useRef(null)
  const router  = useRouter()

  useEffect(() => { checkAdmin() }, [])
  useEffect(() => { setSheetEditing(false); setSheetUrlInput('') }, [selectedManager?.id])

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
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) { router.push('/login'); return }
    setUser(u)

    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', u.id).single()
    const isAdmin = profile?.role === 'admin' || ADMIN_EMAILS.includes(u.email)
    if (!isAdmin) { router.push('/dashboard'); return }

    await loadData()
    loadTgAccountsInit()
  }

  const loadData = async () => {
    const [{ data: mgrs }, { data: tls }, { data: reps }, { data: deleted }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'manager'),
      supabase.from('profiles').select('*').eq('role', 'teamlead'),
      supabase.from('reports').select('*').order('date', { ascending: false }),
      supabase.from('profiles').select('*').eq('role', 'deleted'),
    ])
    setManagers(mgrs || [])
    setTeamleads(tls || [])
    setReports(reps || [])
    setDeletedMembers(deleted || [])
    setLoading(false)
  }

  const loadTgAccountsInit = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/telegram-accounts', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      setTgAccounts(data.accounts || [])
    } catch { /* ignore */ }
  }

  // ── IP Link functions ──
  const loadIpHistory = useCallback(async () => {
    if (!user) return
    setIpHistoryLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/ip-link?scope=all', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      if (res.ok) setIpHistory(data.applications || [])
    } catch (err) {
      console.error('Ошибка загрузки истории ИП:', err)
    }
    setIpHistoryLoading(false)
  }, [user])

  useEffect(() => {
    if (activeTab === 'ip-link' && user) loadIpHistory()
  }, [activeTab, user, loadIpHistory])

  const validateINN12 = (inn) => {
    if (!/^\d{12}$/.test(inn)) return false
    const d = inn.split('').map(Number)
    const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
    const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
    const check1 = w1.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
    const check2 = w2.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
    return d[10] === check1 && d[11] === check2
  }

  const handleCreateIpLink = async (e) => {
    e.preventDefault()
    if (!validateINN12(ipForm.inn)) { setIpError('Некорректный ИНН'); return }
    setIpSubmitting(true); setIpError(null); setIpResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/ip-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(ipForm),
      })
      const data = await res.json()
      if (!res.ok) { setIpError(data.error || 'Ошибка') }
      else { setIpResult(data); await loadIpHistory() }
    } catch { setIpError('Ошибка сети') }
    setIpSubmitting(false)
  }

  const handleCopyIpLink = async (link, id) => {
    try { await navigator.clipboard.writeText(link) } catch {
      const ta = document.createElement('textarea')
      ta.value = link; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopiedIpLink(id)
    setTimeout(() => setCopiedIpLink(null), 2000)
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
  const modalIsKarina = modalTeam?.type === 'karina'

  const TABS = [
    { id: 'analytics', label: 'Аналитика команды' },
    { id: 'daily',     label: 'Дневной отчёт' },
    { id: 'salary',    label: 'Расчёт ЗП' },
    { id: 'telegram',  label: 'Аккаунты Телеграмм' },
    { id: 'ip-link',   label: 'Ссылка ИП' },
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
                        const isKarinaTeam = team.type === 'karina'
                        const value7  = isKarinaTeam
                          ? mRep.filter(r => { const d = new Date(r.date); const now = new Date(); now.setHours(23,59,59,999); const start = new Date(now); start.setDate(start.getDate()-7); start.setHours(0,0,0,0); return d >= start && d <= now }).reduce((s, r) => s + (r.ordered_cards || 0), 0)
                          : getIPForPeriod(mRep, 0, 7)
                        const zKey    = getZoneKey(value7, team.type)
                        const z       = ZONE[zKey]
                        const alert14 = !isKarinaTeam && isRedFor14Days(mRep, manager.created_at)

                        return (
                          <button
                            key={manager.id}
                            onClick={() => setSelectedManager(manager)}
                            className={`border rounded-2xl p-4 text-left transition-all hover:scale-[1.02] hover:shadow-lg cursor-pointer ${z.card}`}
                          >
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${(manager.sheet_id || MANAGER_SHEETS[manager.name]) ? 'bg-green-500' : 'bg-gray-600'}`}
                                  title={(manager.sheet_id || MANAGER_SHEETS[manager.name]) ? 'Таблица привязана' : 'Таблица не привязана'} />
                              <span className="font-medium text-white text-sm leading-tight truncate">
                                {manager.name || manager.email}
                                {manager.role === 'teamlead' && <span className="text-xs text-blue-400 ml-1">(ТЛ)</span>}
                              </span>
                              </div>
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
                              <span className={`text-3xl font-bold ${z.text}`}>{value7}</span>
                              <span className="text-gray-500 text-xs ml-1">{isKarinaTeam ? 'карт' : 'ИП'} / 7 дн</span>
                            </div>

                            <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-medium ${z.badge}`}>
                              {z.label}
                            </span>
                            {(() => {
                              const accs = tgAccounts.filter(a => a.assignedTo === (manager.name || manager.email))
                              if (accs.length === 0) return null
                              return (
                                <div className="mt-2 pt-2 border-t border-white/5">
                                  <p className="text-gray-500 text-xs mb-1">TG аккаунтов: <span className="text-gray-300 font-medium">{accs.length}</span></p>
                                  {accs.map((a, i) => (
                                    <p key={i} className="text-gray-500 text-xs truncate">{a.phone}{a.tgLink ? ` · ${a.tgLink}` : ''}</p>
                                  ))}
                                </div>
                              )
                            })()}
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
              const totalOrderedCards = dayReports.reduce((s, r) => s + (r.ordered_cards || 0), 0)
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
                      <p className="text-gray-500 text-xs mb-1">Написало людей</p>
                      <p className="text-xl font-bold text-gray-200">{totalPeopleWrote}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Заказали ИП</p>
                      <p className="text-xl font-bold text-blue-400">{totalOrdered}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Заказано дебетовых карт</p>
                      <p className="text-xl font-bold text-purple-400">{totalOrderedCards}</p>

                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">ЦД ИП</p>
                      <p className="text-xl font-bold text-emerald-400">
                        {sheetsLoading ? '...' : Object.values(sheetsData).reduce((s, v) => s + (v?.ip || 0), 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">ЦД дебетовые</p>
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
              const isKarina = team.type === 'karina'
              const teamMembers = [
                ...managers.filter(m => m.team === team.id),
                ...teamleads.filter(t => t.team === team.id),
              ]
              const dayReports = reports.filter(r => r.date >= dateFrom && r.date <= dateTo)

              const rows = teamMembers.map(member => {
                const memberReports = dayReports.filter(r => r.manager_id === member.id)
                const report = memberReports.length > 0 ? {
                  unsubscribed:  memberReports.reduce((s, r) => s + (r.unsubscribed || 0), 0),
                  replied:       memberReports.reduce((s, r) => s + (r.replied || 0), 0),
                  ordered_ip:    memberReports.reduce((s, r) => s + (r.ordered_ip || 0), 0),
                  ordered_cards: memberReports.reduce((s, r) => s + (r.ordered_cards || 0), 0),
                  people_wrote:  memberReports.reduce((s, r) => s + (r.people_wrote || 0), 0),
                } : null
                return { member, report }
              })

              const totals = {
                unsubscribed:  rows.reduce((s, r) => s + (r.report?.unsubscribed || 0), 0),
                replied:       rows.reduce((s, r) => s + (r.report?.replied || 0), 0),
                ordered_ip:    rows.reduce((s, r) => s + (r.report?.ordered_ip || 0), 0),
                ordered_cards: rows.reduce((s, r) => s + (r.report?.ordered_cards || 0), 0),
                people_wrote:  rows.reduce((s, r) => s + (r.report?.people_wrote || 0), 0),
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
                          {isKarina ? (
                            <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказано карт</th>
                          ) : (
                            <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказали ИП</th>
                          )}
                          <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ЦД ИП</th>
                          <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ЦД дебетовые</th>
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
                                  {isKarina ? (
                                    <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-purple-400">{report ? report.ordered_cards : '—'}</td>
                                  ) : (
                                    <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-blue-400">{report ? report.ordered_ip : '—'}</td>
                                  )}
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
                                {isKarina ? (
                                  <td className="px-3 sm:px-5 py-3 text-sm font-bold text-purple-400">{totals.ordered_cards}</td>
                                ) : (
                                  <td className="px-3 sm:px-5 py-3 text-sm font-bold text-blue-400">{totals.ordered_ip}</td>
                                )}
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
        {activeTab === 'salary' && (() => {
          const RATES = { MANAGER_IP: 1000, MANAGER_DEBIT: 300, TL_BONUS_IP: 150, TL_BONUS_DEBIT: 50 }
          const lastDay = new Date(salaryYear, salaryMonth + 1, 0).getDate()
          const dateFrom = `${salaryYear}-${String(salaryMonth + 1).padStart(2, '0')}-${salaryHalf === 1 ? '01' : '16'}`
          const dateTo   = `${salaryYear}-${String(salaryMonth + 1).padStart(2, '0')}-${salaryHalf === 1 ? '15' : String(lastDay).padStart(2, '0')}`

          const fetchSalaryData = async () => {
            setSalaryLoading(true)
            setSalaryCalculated(false)
            try {
              const allPeople = [...managers, ...teamleads, ...deletedMembers]
              const namesWithSheets = allPeople.filter(m => m.sheet_id || MANAGER_SHEETS[m.name]).map(m => m.name)
              if (namesWithSheets.length === 0) { setSalarySheetsData({}); setSalaryCalculated(true); return }
              const res = await fetch(`/api/sheets?names=${encodeURIComponent(namesWithSheets.join(','))}&dateFrom=${dateFrom}&dateTo=${dateTo}`)
              const data = await res.json()
              setSalarySheetsData(data)
              setSalaryCalculated(true)
            } catch { setSalarySheetsData({}); setSalaryCalculated(true) }
            finally { setSalaryLoading(false) }
          }

          const fmt = (n) => n.toLocaleString('ru-RU') + ' \u20bd'

          // Build salary data per team
          const salaryTeams = TEAMS.map(team => {
            const teamMgrs = managers.filter(m => m.team === team.id)
            const teamTLs  = team.id !== 'nikita' ? teamleads.filter(t => t.team === team.id) : []
            const teamDeleted = deletedMembers.filter(m => MANAGER_SHEETS[m.name] || m.sheet_id) // show deleted who had sheets
            // Filter deleted that were in this team - we check by MANAGER_SHEETS grouping or fallback
            const allMembers = [...teamTLs, ...teamMgrs]

            const memberRows = allMembers.map(member => {
              const sd = salarySheetsData[member.name] || {}
              const ip = sd.ip || 0
              const debit = sd.debit || 0
              const ownSalary = ip * RATES.MANAGER_IP + debit * RATES.MANAGER_DEBIT

              let teamBonus = 0
              if (member.role === 'teamlead') {
                teamBonus = teamMgrs.reduce((sum, mgr) => {
                  const msd = salarySheetsData[mgr.name] || {}
                  return sum + (msd.ip || 0) * RATES.TL_BONUS_IP + (msd.debit || 0) * RATES.TL_BONUS_DEBIT
                }, 0)
              }

              return {
                id: member.id,
                name: member.name || member.email,
                role: member.role,
                ip, debit,
                ownSalary,
                teamBonus,
                total: ownSalary + teamBonus,
                paymentInfo: member.payment_info || '',
                deleted: false,
              }
            })

            const subtotal = memberRows.reduce((s, r) => s + r.total, 0)
            const subtotalIp = memberRows.reduce((s, r) => s + r.ip, 0)
            const subtotalDebit = memberRows.reduce((s, r) => s + r.debit, 0)

            return { team, memberRows, subtotal, subtotalIp, subtotalDebit }
          })

          const grandTotal = salaryTeams.reduce((s, t) => s + t.subtotal, 0)
          const grandIp = salaryTeams.reduce((s, t) => s + t.subtotalIp, 0)
          const grandDebit = salaryTeams.reduce((s, t) => s + t.subtotalDebit, 0)

          const savePaymentInfo = async (profileId, value) => {
            setPaymentSaving(prev => ({ ...prev, [profileId]: true }))
            try {
              const { data: { session } } = await supabase.auth.getSession()
              const res = await fetch(`/api/managers/${profileId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({ paymentInfo: value }),
              })
              if (res.ok) {
                setManagers(prev => prev.map(m => m.id === profileId ? { ...m, payment_info: value } : m))
                setTeamleads(prev => prev.map(t => t.id === profileId ? { ...t, payment_info: value } : t))
              }
            } catch {} finally {
              setPaymentSaving(prev => ({ ...prev, [profileId]: false }))
              setPaymentEditing(prev => { const n = { ...prev }; delete n[profileId]; return n })
            }
          }

          return (
            <div className="space-y-6">
              {/* Period selector */}
              <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl p-5">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="text-gray-500 text-xs mb-1.5 block">Месяц</label>
                    <select value={salaryMonth} onChange={e => { setSalaryMonth(+e.target.value); setSalaryCalculated(false) }}
                      className="bg-gray-900 text-white px-3 py-2 rounded-lg border border-gray-700 text-sm focus:outline-none focus:border-blue-500">
                      {MONTHS_RU.map((m, i) => <option key={i} value={i}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs mb-1.5 block">Год</label>
                    <select value={salaryYear} onChange={e => { setSalaryYear(+e.target.value); setSalaryCalculated(false) }}
                      className="bg-gray-900 text-white px-3 py-2 rounded-lg border border-gray-700 text-sm focus:outline-none focus:border-blue-500">
                      {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-500 text-xs mb-1.5 block">Период</label>
                    <div className="flex rounded-lg overflow-hidden border border-gray-700">
                      <button onClick={() => { setSalaryHalf(1); setSalaryCalculated(false) }}
                        className={`px-4 py-2 text-sm font-medium transition ${salaryHalf === 1 ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-white'}`}>
                        1 – 15
                      </button>
                      <button onClick={() => { setSalaryHalf(2); setSalaryCalculated(false) }}
                        className={`px-4 py-2 text-sm font-medium transition ${salaryHalf === 2 ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:text-white'}`}>
                        16 – {lastDay}
                      </button>
                    </div>
                  </div>
                  <button onClick={fetchSalaryData} disabled={salaryLoading}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-6 py-2 rounded-lg text-sm font-semibold transition">
                    {salaryLoading ? 'Загрузка...' : 'Рассчитать'}
                  </button>
                </div>
                {salaryCalculated && (
                  <p className="text-gray-600 text-xs mt-3">Период: {dateFrom} — {dateTo}</p>
                )}
              </div>

              {/* Grand total card */}
              {salaryCalculated && (
                <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl p-5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Всего ЦД ИП</p>
                      <p className="text-xl font-bold text-emerald-400">{grandIp}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Всего ЦД Карт</p>
                      <p className="text-xl font-bold text-purple-400">{grandDebit}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-gray-500 text-xs mb-1">Итого к выплате</p>
                      <p className="text-2xl font-bold text-white">{fmt(grandTotal)}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Per-team tables */}
              {salaryCalculated && salaryTeams.map(({ team, memberRows, subtotal, subtotalIp, subtotalDebit }) => {
                if (memberRows.length === 0) return null
                // Skip teams with no ЦД data at all
                const hasData = memberRows.some(r => r.ip > 0 || r.debit > 0 || r.paymentInfo)
                return (
                  <section key={team.id}>
                    <div className="flex items-center gap-3 mb-3">
                      <h2 className="text-base font-semibold text-gray-200">Команда {team.name}</h2>
                      <span className="text-gray-600 text-sm">{fmt(subtotal)}</span>
                    </div>

                    <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl overflow-hidden overflow-x-auto">
                      <table className="w-full min-w-[700px]">
                        <thead>
                          <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                            <th className="text-left px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Имя</th>
                            <th className="text-right px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ЦД ИП</th>
                            <th className="text-right px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ЦД Карта</th>
                            <th className="text-right px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ЗП за ИП</th>
                            <th className="text-right px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ЗП за карты</th>
                            <th className="text-right px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Бонус команды</th>
                            <th className="text-right px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Итого</th>
                            <th className="text-left px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Реквизиты</th>
                          </tr>
                        </thead>
                        <tbody>
                          {memberRows.map(row => (
                            <tr key={row.id} style={{ borderTop: '1px solid #1a1a28' }} className="hover:bg-white/[0.02] transition">
                              <td className="px-3 sm:px-4 py-3 text-sm text-gray-300">
                                {row.name}
                                {row.role === 'teamlead' && <span className="text-xs text-blue-400 ml-1">(ТЛ)</span>}
                                {row.deleted && <span className="text-xs text-gray-600 ml-1">(удалён)</span>}
                              </td>
                              <td className="px-3 sm:px-4 py-3 text-sm text-right text-emerald-400 font-medium">{row.ip}</td>
                              <td className="px-3 sm:px-4 py-3 text-sm text-right text-purple-400 font-medium">{row.debit}</td>
                              <td className="px-3 sm:px-4 py-3 text-sm text-right text-gray-300">{fmt(row.ip * RATES.MANAGER_IP)}</td>
                              <td className="px-3 sm:px-4 py-3 text-sm text-right text-gray-300">{fmt(row.debit * RATES.MANAGER_DEBIT)}</td>
                              <td className="px-3 sm:px-4 py-3 text-sm text-right">
                                {row.role === 'teamlead' ? (
                                  <span className="text-yellow-400 font-medium">{fmt(row.teamBonus)}</span>
                                ) : (
                                  <span className="text-gray-700">—</span>
                                )}
                              </td>
                              <td className="px-3 sm:px-4 py-3 text-sm text-right font-bold text-white">{fmt(row.total)}</td>
                              <td className="px-3 sm:px-4 py-3 text-sm text-left min-w-[160px]">
                                {paymentEditing[row.id] !== undefined ? (
                                  <input
                                    autoFocus
                                    value={paymentEditing[row.id]}
                                    onChange={e => setPaymentEditing(prev => ({ ...prev, [row.id]: e.target.value }))}
                                    onBlur={() => savePaymentInfo(row.id, paymentEditing[row.id])}
                                    onKeyDown={e => { if (e.key === 'Enter') savePaymentInfo(row.id, paymentEditing[row.id]); if (e.key === 'Escape') setPaymentEditing(prev => { const n = { ...prev }; delete n[row.id]; return n }) }}
                                    disabled={paymentSaving[row.id]}
                                    className="w-full bg-black/30 border border-blue-500 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none"
                                    placeholder="Номер карты / телефон..."
                                  />
                                ) : (
                                  <button
                                    onClick={() => setPaymentEditing(prev => ({ ...prev, [row.id]: row.paymentInfo }))}
                                    className="text-left text-xs text-gray-500 hover:text-gray-300 transition w-full truncate"
                                    title={row.paymentInfo || 'Нажмите чтобы добавить реквизиты'}
                                  >
                                    {paymentSaving[row.id] ? '...' : (row.paymentInfo || '+ реквизиты')}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                          {/* Subtotal row */}
                          <tr style={{ borderTop: '2px solid #2a2a3e' }} className="bg-white/[0.02]">
                            <td className="px-3 sm:px-4 py-3 text-sm font-semibold text-gray-200">Итого</td>
                            <td className="px-3 sm:px-4 py-3 text-sm text-right font-semibold text-emerald-400">{subtotalIp}</td>
                            <td className="px-3 sm:px-4 py-3 text-sm text-right font-semibold text-purple-400">{subtotalDebit}</td>
                            <td colSpan="3" />
                            <td className="px-3 sm:px-4 py-3 text-sm text-right font-bold text-white">{fmt(subtotal)}</td>
                            <td />
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </section>
                )
              })}

              {salaryCalculated && grandTotal === 0 && (
                <div className="text-center py-16 text-gray-600">
                  <p className="text-lg mb-1">Нет данных за выбранный период</p>
                  <p className="text-sm">Проверьте, что у менеджеров привязаны Google Таблицы</p>
                </div>
              )}
            </div>
          )
        })()}

        {/* ─── Telegram tab ─── */}
        {activeTab === 'telegram' && (() => {
          const loadTgAccounts = async () => {
            setTgLoading(true)
            try {
              const { data: { session } } = await supabase.auth.getSession()
              const res = await fetch('/api/telegram-accounts', {
                headers: { Authorization: `Bearer ${session.access_token}` },
              })
              const data = await res.json()
              setTgAccounts(data.accounts || [])
            } catch { setTgAccounts([]) }
            finally { setTgLoading(false) }
          }

          const fetchCode = async (acc) => {
            setTgCodeLoading(prev => ({ ...prev, [acc.rowIndex]: true }))
            try {
              const { data: { session } } = await supabase.auth.getSession()
              const res = await fetch('/api/telegram-accounts/code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({ email: acc.email, password: acc.emailPassword }),
              })
              const data = await res.json()
              if (res.ok) {
                setTgCode({ code: data.code, receivedAt: data.receivedAt, phone: acc.phone, tgLink: acc.tgLink })
              } else {
                setTgCode({ error: data.error, phone: acc.phone })
              }
            } catch (e) {
              setTgCode({ error: e.message, phone: acc.phone })
            } finally {
              setTgCodeLoading(prev => ({ ...prev, [acc.rowIndex]: false }))
            }
          }

          const assignAccount = async (rowIndex, name) => {
            setTgAssigning(prev => ({ ...prev, [rowIndex]: true }))
            try {
              const { data: { session } } = await supabase.auth.getSession()
              await fetch('/api/telegram-accounts', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({ rowIndex, assignedTo: name }),
              })
              setTgAccounts(prev => prev.map(a => a.rowIndex === rowIndex ? { ...a, assignedTo: name } : a))
              setTgAssignSelect(prev => { const n = { ...prev }; delete n[rowIndex]; return n })
            } catch {} finally {
              setTgAssigning(prev => ({ ...prev, [rowIndex]: false }))
            }
          }

          const allPeople = [...teamleads, ...managers].sort((a, b) => (a.name || '').localeCompare(b.name || ''))

          // Auto-load on first render
          if (tgAccounts.length === 0 && !tgLoading) {
            loadTgAccounts()
          }

          return (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-200">Аккаунты Телеграмм</h2>
                <button onClick={loadTgAccounts} disabled={tgLoading}
                  className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm transition">
                  {tgLoading ? 'Загрузка...' : 'Обновить'}
                </button>
              </div>

              {/* Code modal */}
              {tgCode && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setTgCode(null)}>
                  <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }}
                    className="rounded-2xl p-6 max-w-sm w-full text-center">
                    {tgCode.error ? (
                      <>
                        <p className="text-red-400 text-lg font-semibold mb-2">Ошибка</p>
                        <p className="text-gray-400 text-sm">{tgCode.error}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-gray-400 text-sm mb-1">Код для {tgCode.phone}</p>
                        <p className="text-4xl font-bold text-white tracking-widest my-4">{tgCode.code}</p>
                        {tgCode.receivedAt && (
                          <p className="text-gray-600 text-xs">Получено: {new Date(tgCode.receivedAt).toLocaleString('ru-RU')}</p>
                        )}
                      </>
                    )}
                    <button onClick={() => setTgCode(null)}
                      className="mt-4 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm transition">
                      Закрыть
                    </button>
                  </div>
                </div>
              )}

              {/* Table */}
              {tgLoading && tgAccounts.length === 0 ? (
                <div className="text-center py-16 text-gray-600">Загрузка аккаунтов...</div>
              ) : tgAccounts.length === 0 ? (
                <div className="text-center py-16 text-gray-600">Нет аккаунтов в таблице</div>
              ) : (
                <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl overflow-hidden overflow-x-auto">
                  <table className="w-full min-w-[800px]">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                        <th className="text-left px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Телефон</th>
                        <th className="text-left px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ТГ</th>
                        <th className="text-left px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Почта</th>
                        <th className="text-left px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Кому выдан</th>
                        <th className="text-left px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tgAccounts.map(acc => (
                        <tr key={acc.rowIndex} style={{ borderTop: '1px solid #1a1a28' }} className="hover:bg-white/[0.02] transition">
                          <td className="px-3 sm:px-4 py-3 text-sm text-gray-300 font-mono">{acc.phone}</td>
                          <td className="px-3 sm:px-4 py-3 text-sm text-blue-400">{acc.tgLink}</td>
                          <td className="px-3 sm:px-4 py-3 text-sm text-gray-400 text-xs">{acc.email}</td>
                          <td className="px-3 sm:px-4 py-3 text-sm">
                            {tgAssignSelect[acc.rowIndex] !== undefined ? (
                              <div className="flex items-center gap-1">
                                <select
                                  value={tgAssignSelect[acc.rowIndex]}
                                  onChange={e => setTgAssignSelect(prev => ({ ...prev, [acc.rowIndex]: e.target.value }))}
                                  className="bg-black/30 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                                >
                                  <option value="">— Свободен —</option>
                                  {allPeople.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                                </select>
                                <button
                                  onClick={() => assignAccount(acc.rowIndex, tgAssignSelect[acc.rowIndex])}
                                  disabled={tgAssigning[acc.rowIndex]}
                                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-2 py-1 rounded text-xs transition"
                                >
                                  {tgAssigning[acc.rowIndex] ? '...' : 'OK'}
                                </button>
                                <button
                                  onClick={() => setTgAssignSelect(prev => { const n = { ...prev }; delete n[acc.rowIndex]; return n })}
                                  className="text-gray-600 hover:text-gray-400 text-xs transition"
                                >
                                  Отмена
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${acc.assignedTo ? 'bg-green-500' : 'bg-gray-600'}`} />
                                <span className={acc.assignedTo ? 'text-gray-200' : 'text-gray-600'}>{acc.assignedTo || 'Свободен'}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-3 sm:px-4 py-3 text-sm">
                            <div className="flex gap-2">
                              <button
                                onClick={() => fetchCode(acc)}
                                disabled={tgCodeLoading[acc.rowIndex]}
                                className="bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 disabled:opacity-50 px-2.5 py-1 rounded-lg text-xs font-medium transition"
                              >
                                {tgCodeLoading[acc.rowIndex] ? '...' : 'Код'}
                              </button>
                              <button
                                onClick={() => setTgAssignSelect(prev => ({ ...prev, [acc.rowIndex]: acc.assignedTo || '' }))}
                                className="bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded-lg text-xs transition"
                              >
                                {acc.assignedTo ? 'Изменить' : 'Назначить'}
                              </button>
                              {acc.assignedTo && (
                                <button
                                  onClick={() => assignAccount(acc.rowIndex, '')}
                                  disabled={tgAssigning[acc.rowIndex]}
                                  className="text-red-400/70 hover:text-red-400 text-xs transition"
                                >
                                  Освободить
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="text-gray-700 text-xs">
                Всего: {tgAccounts.length} аккаунтов · Выдано: {tgAccounts.filter(a => a.assignedTo).length} · Свободно: {tgAccounts.filter(a => !a.assignedTo).length}
              </div>
            </div>
          )
        })()}

        {/* ─── IP Link tab ─── */}
        {activeTab === 'ip-link' && (
          <>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-semibold text-gray-200">Ссылка ИП</h2>
              <button
                onClick={() => { setShowIpModal(true); setIpResult(null); setIpError(null); setIpForm({ fullName: '', inn: '', phone: '', email: '', city: '' }) }}
                className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-semibold transition"
              >
                + Создать заявку
              </button>
            </div>

            <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl overflow-hidden overflow-x-auto">
              {ipHistoryLoading ? (
                <div className="text-center py-12 text-gray-600 text-sm">Загрузка...</div>
              ) : ipHistory.length === 0 ? (
                <div className="text-center py-12 text-gray-600 text-sm">Нет заявок</div>
              ) : (
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                      <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Дата</th>
                      <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ФИО</th>
                      <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ИНН</th>
                      <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Город</th>
                      <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Ссылка</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ipHistory.map(app => (
                      <tr key={app.id} style={{ borderTop: '1px solid #1a1a28' }} className="hover:bg-white/[0.02] transition">
                        <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">
                          {new Date(app.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{app.full_name}</td>
                        <td className="px-3 sm:px-5 py-3 text-sm text-gray-400 font-mono">{app.inn}</td>
                        <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{app.city}</td>
                        <td className="px-3 sm:px-5 py-3 text-sm">
                          {app.status === 'error' ? (
                            <span className="text-red-400 text-xs">Ошибка</span>
                          ) : app.referral_link ? (
                            <button
                              onClick={() => handleCopyIpLink(app.referral_link, app.id)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                                copiedIpLink === app.id
                                  ? 'bg-green-900/60 text-green-300 border border-green-700'
                                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                              }`}
                            >
                              {copiedIpLink === app.id ? 'Скопировано!' : 'Копировать'}
                            </button>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

      </main>

      {/* ── Модалка создания заявки ИП ── */}
      {showIpModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowIpModal(false)}>
          <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Создать заявку ИП</h3>
              <button onClick={() => setShowIpModal(false)} className="text-gray-500 hover:text-white text-lg">✕</button>
            </div>
            {ipResult ? (
              <div>
                <div className="bg-green-950/40 border border-green-700 rounded-lg p-4 mb-4">
                  <p className="text-green-300 text-sm font-semibold mb-2">Ссылка создана!</p>
                  <div className="flex items-center gap-2">
                    <input readOnly value={ipResult.referralLink} className="flex-1 bg-gray-900 text-sm text-gray-300 px-3 py-2 rounded-lg border border-gray-700 truncate" />
                    <button onClick={() => handleCopyIpLink(ipResult.referralLink, 'modal')}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition shrink-0 ${copiedIpLink === 'modal' ? 'bg-green-900/60 text-green-300' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>
                      {copiedIpLink === 'modal' ? 'Скопировано!' : 'Копировать'}
                    </button>
                  </div>
                </div>
                <button onClick={() => { setShowIpModal(false); setIpResult(null) }} className="w-full bg-gray-800 hover:bg-gray-700 px-4 py-2.5 rounded-lg text-sm transition">Закрыть</button>
              </div>
            ) : (
              <form onSubmit={handleCreateIpLink}>
                <div className="space-y-3">
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">ФИО</label>
                    <input type="text" required value={ipForm.fullName} onChange={e => setIpForm({ ...ipForm, fullName: e.target.value })} placeholder="Иванов Иван Иванович"
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">ИНН</label>
                    <input type="text" required maxLength={12} value={ipForm.inn} onChange={e => setIpForm({ ...ipForm, inn: e.target.value.replace(/\D/g, '') })} placeholder="123456789012"
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm font-mono" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">Телефон</label>
                    <input type="tel" required value={ipForm.phone} onChange={e => setIpForm({ ...ipForm, phone: e.target.value })} placeholder="+7 999 123 45 67"
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">Email</label>
                    <input type="email" required value={ipForm.email} onChange={e => setIpForm({ ...ipForm, email: e.target.value })} placeholder="client@example.com"
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">Город</label>
                    <input type="text" required value={ipForm.city} onChange={e => setIpForm({ ...ipForm, city: e.target.value })} placeholder="Введите город"
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                </div>
                {ipError && <p className="text-red-400 text-sm mt-3">{ipError}</p>}
                <button type="submit" disabled={ipSubmitting}
                  className="w-full mt-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-6 py-2.5 rounded-lg text-sm font-semibold transition">
                  {ipSubmitting ? 'Создаём заявку...' : 'Получить ссылку'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

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
              const isModalKarina = modalTeam?.type === 'karina'
              const field = isModalKarina ? 'ordered_cards' : 'ordered_ip'
              const unitLabel = isModalKarina ? 'карт' : 'ИП'
              const val7  = isModalKarina
                ? modalReports.filter(r => { const d = new Date(r.date); const now = new Date(); now.setHours(23,59,59,999); const start = new Date(now); start.setDate(start.getDate()-7); start.setHours(0,0,0,0); return d >= start && d <= now }).reduce((s, r) => s + (r[field] || 0), 0)
                : getIPForPeriod(modalReports, 0, 7)
              const val14 = isModalKarina
                ? modalReports.filter(r => { const d = new Date(r.date); const now = new Date(); now.setHours(23,59,59,999); const end = new Date(now); end.setDate(end.getDate()-7); const start = new Date(now); start.setDate(start.getDate()-14); start.setHours(0,0,0,0); return d >= start && d <= end }).reduce((s, r) => s + (r[field] || 0), 0)
                : getIPForPeriod(modalReports, 7, 14)
              const zKey = getZoneKey(val7, modalTeam?.type)
              const z    = ZONE[zKey]
              return (
                <div className="px-6 pt-4 pb-2 flex gap-4">
                  <div className={`flex-1 border rounded-xl px-4 py-3 ${z.card}`}>
                    <p className="text-gray-500 text-xs mb-1">Последние 7 дней</p>
                    <p className={`text-xl font-bold ${z.text}`}>{val7} {unitLabel}</p>
                    <span className={`text-xs ${z.badge} inline-block px-2 py-0.5 rounded-md mt-1`}>{z.label}</span>
                  </div>
                  <div className={`flex-1 border rounded-xl px-4 py-3 ${ZONE[getZoneKey(val14, modalTeam?.type)].card}`}>
                    <p className="text-gray-500 text-xs mb-1">Предыдущие 7 дней</p>
                    <p className={`text-xl font-bold ${ZONE[getZoneKey(val14, modalTeam?.type)].text}`}>{val14} {unitLabel}</p>
                    <span className={`text-xs ${ZONE[getZoneKey(val14, modalTeam?.type)].badge} inline-block px-2 py-0.5 rounded-md mt-1`}>{ZONE[getZoneKey(val14, modalTeam?.type)].label}</span>
                  </div>
                </div>
              )
            })()}

            {/* Sheet binding */}
            <div className="px-6 pt-2 pb-2">
              {sheetEditing ? (
                <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-3 space-y-2">
                  <p className="text-gray-400 text-xs font-medium">Ссылка на Google Таблицу</p>
                  <input
                    type="text"
                    value={sheetUrlInput}
                    onChange={e => setSheetUrlInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setSheetSaving(true)
                        try {
                          const { data: { session } } = await supabase.auth.getSession()
                          const res = await fetch(`/api/managers/${selectedManager.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                            body: JSON.stringify({ sheetUrl: sheetUrlInput }),
                          })
                          const result = await res.json()
                          if (res.ok) {
                            setManagers(prev => prev.map(m => m.id === selectedManager.id ? { ...m, sheet_id: result.sheetId } : m))
                            setSelectedManager(prev => ({ ...prev, sheet_id: result.sheetId }))
                            setSheetEditing(false)
                          }
                        } catch {} finally { setSheetSaving(false) }
                      }}
                      disabled={sheetSaving}
                      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                    >
                      {sheetSaving ? '...' : 'Сохранить'}
                    </button>
                    <button
                      onClick={() => { setSheetEditing(false); setSheetUrlInput('') }}
                      className="bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-xs transition"
                    >
                      Отмена
                    </button>
                    {selectedManager.sheet_id && (
                      <button
                        onClick={async () => {
                          setSheetSaving(true)
                          try {
                            const { data: { session } } = await supabase.auth.getSession()
                            const res = await fetch(`/api/managers/${selectedManager.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                              body: JSON.stringify({ sheetUrl: '' }),
                            })
                            if (res.ok) {
                              setManagers(prev => prev.map(m => m.id === selectedManager.id ? { ...m, sheet_id: null } : m))
                              setSelectedManager(prev => ({ ...prev, sheet_id: null }))
                              setSheetEditing(false)
                              setSheetUrlInput('')
                            }
                          } catch {} finally { setSheetSaving(false) }
                        }}
                        disabled={sheetSaving}
                        className="text-red-400 hover:text-red-300 text-xs transition ml-auto"
                      >
                        Отвязать
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {(selectedManager.sheet_id || MANAGER_SHEETS[selectedManager.name]) ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                      <span className="text-green-400 text-sm">Таблица привязана</span>
                      <button
                        onClick={() => { setSheetEditing(true); setSheetUrlInput(selectedManager.sheet_id ? `https://docs.google.com/spreadsheets/d/${selectedManager.sheet_id}/edit` : '') }}
                        className="text-gray-500 hover:text-white text-xs ml-auto transition"
                      >
                        Изменить
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-gray-600 flex-shrink-0" />
                      <span className="text-gray-500 text-sm">Таблица не привязана</span>
                      <button
                        onClick={() => setSheetEditing(true)}
                        className="text-blue-400 hover:text-blue-300 text-xs ml-auto transition"
                      >
                        Привязать
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

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
                    {modalIsKarina ? (
                      <th className="text-left py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказано карт</th>
                    ) : (
                      <th className="text-left py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказали ИП</th>
                    )}
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
                        {modalIsKarina ? (
                          <td className="py-2.5 text-sm font-semibold text-purple-400">{r.ordered_cards ?? '—'}</td>
                        ) : (
                          <td className="py-2.5 text-sm font-semibold text-blue-400">{r.ordered_ip ?? '—'}</td>
                        )}
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
