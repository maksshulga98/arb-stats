'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

// ── Team config ──────────────────────────────────────────────────────────────
const TEAMS = [
  { id: 'anastasia', name: 'Анастасии', type: 'standard' },
  { id: 'yasmin',    name: 'Ясмин',     type: 'standard' },
  { id: 'olya',      name: 'Оли',       type: 'standard' },
  { id: 'karina',    name: 'Карины',    type: 'standard' },
  { id: 'nikita',    name: 'Никиты',    type: 'nikita'   },
]

// ── Color helpers ─────────────────────────────────────────────────────────────
function getIPForPeriod(reports, daysStart, daysEnd) {
  const now = new Date()
  now.setHours(23, 59, 59, 999)
  const end = new Date(now); end.setDate(end.getDate() - daysStart)
  const start = new Date(now); start.setDate(start.getDate() - daysEnd); start.setHours(0, 0, 0, 0)
  return reports
    .filter(r => { const d = new Date(r.date); return d >= start && d <= end })
    .reduce((sum, r) => sum + (r.ordered_ip || 0), 0)
}

function getIPLast7Days(reports) { return getIPForPeriod(reports, 0, 7) }

function isRedFor14Days(reports, createdAt) {
  if (createdAt) {
    const ago14 = new Date(); ago14.setDate(ago14.getDate() - 14)
    if (new Date(createdAt) > ago14) return false
  }
  return getIPForPeriod(reports, 0, 7) < 10 && getIPForPeriod(reports, 7, 14) < 10
}

function getZoneKey(ip) {
  if (ip < 10) return 'red'
  if (ip <= 15) return 'yellow'
  return 'green'
}

const ZONE = {
  red:    { card: 'border-red-800 bg-red-950/25',    badge: 'bg-red-900/50 text-red-300 border border-red-800',    text: 'text-red-400',    label: 'Красная зона' },
  yellow: { card: 'border-yellow-700 bg-yellow-950/25', badge: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700', text: 'text-yellow-400', label: 'Жёлтая зона' },
  green:  { card: 'border-green-800 bg-green-950/25',  badge: 'bg-green-900/50 text-green-300 border border-green-800',  text: 'text-green-400',  label: 'Зелёная зона' },
}

// Personal zone (for the teamlead's own indicator strip)
function getPersonalZone(ip) {
  const key = getZoneKey(ip)
  const map = {
    red:    { bg: 'bg-red-950/40',    border: 'border-red-700',    text: 'text-red-400',    badge: 'bg-red-900/60 text-red-300 border border-red-700',    label: 'Красная зона' },
    yellow: { bg: 'bg-yellow-950/40', border: 'border-yellow-600', text: 'text-yellow-400', badge: 'bg-yellow-900/60 text-yellow-300 border border-yellow-600', label: 'Жёлтая зона' },
    green:  { bg: 'bg-green-950/40',  border: 'border-green-700',  text: 'text-green-400',  badge: 'bg-green-900/60 text-green-300 border border-green-700',  label: 'Зелёная зона' },
  }
  return map[key]
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function BellIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  )
}

function CloseIcon({ size = 5 }) {
  return (
    <svg className={`w-${size} h-${size}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TeamleadPage() {
  const [user, setUser]         = useState(null)
  const [profile, setProfile]   = useState(null)
  const [myReports, setMyReports]     = useState([])
  const [managers, setManagers]       = useState([])
  const [teamReports, setTeamReports] = useState([])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('analytics')
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().split('T')[0])

  // Personal report form
  const [showReportForm, setShowReportForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reportForm, setReportForm] = useState({
    date: new Date().toISOString().split('T')[0],
    unsubscribed: '', replied: '', ordered_ip: '', people_wrote: '',
  })

  // Team manager detail modal
  const [selectedManager, setSelectedManager] = useState(null)
  const [deletingReport, setDeletingReport]   = useState(null) // report id being deleted

  // Add manager modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm]   = useState({ firstName: '', lastName: '', email: '', password: '' })
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')

  // Delete manager confirm
  const [deleteConfirm, setDeleteConfirm] = useState(null) // manager id
  const [deleting, setDeleting] = useState(false)

  // Bell
  const [showBell, setShowBell] = useState(false)
  const bellRef = useRef(null)

  const router = useRouter()

  useEffect(() => { init() }, [])
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') { setSelectedManager(null); setShowAddModal(false) } }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  // ── Data loading ────────────────────────────────────────────────────────────
  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    setUser(user)

    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (!p || p.role !== 'teamlead') {
      router.push(p?.role === 'admin' ? '/admin' : '/dashboard')
      return
    }
    setProfile(p)

    await Promise.all([loadMyReports(user.id), loadTeamData(p.team)])
    setLoading(false)
  }

  const loadMyReports = async (userId) => {
    const { data } = await supabase.from('reports').select('*').eq('manager_id', userId).order('date', { ascending: false })
    setMyReports(data || [])
  }

  const loadTeamData = async (team) => {
    const { data: mgrs } = await supabase.from('profiles').select('*').eq('role', 'manager').eq('team', team)
    const list = mgrs || []
    setManagers(list)

    if (list.length > 0) {
      const ids = list.map(m => m.id)
      const { data: reps } = await supabase.from('reports').select('*').in('manager_id', ids).order('date', { ascending: false })
      setTeamReports(reps || [])
    } else {
      setTeamReports([])
    }
  }

  // ── Personal report submit ──────────────────────────────────────────────────
  const handleSubmitReport = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    const teamType = TEAMS.find(t => t.id === profile?.team)?.type || 'standard'
    const record = { manager_id: user.id, date: reportForm.date, ordered_ip: parseInt(reportForm.ordered_ip) || 0 }
    if (teamType === 'nikita') {
      record.people_wrote = parseInt(reportForm.people_wrote) || 0
    } else {
      record.unsubscribed = parseInt(reportForm.unsubscribed) || 0
      record.replied      = parseInt(reportForm.replied) || 0
    }
    const { error } = await supabase.from('reports').insert([record])
    if (!error) {
      setShowReportForm(false)
      setReportForm({ date: new Date().toISOString().split('T')[0], unsubscribed: '', replied: '', ordered_ip: '', people_wrote: '' })
      await loadMyReports(user.id)
    }
    setSubmitting(false)
  }

  // ── Delete report ────────────────────────────────────────────────────────────
  const handleDeleteReport = async (reportId, isMyReport) => {
    setDeletingReport(reportId)
    const { error } = await supabase.from('reports').delete().eq('id', reportId)
    if (!error) {
      if (isMyReport) {
        await loadMyReports(user.id)
      } else {
        await loadTeamData(profile.team)
        // Refresh selected manager reports in modal
        if (selectedManager) {
          // teamReports state will be updated by loadTeamData
        }
      }
    }
    setDeletingReport(null)
  }

  // ── Create manager ──────────────────────────────────────────────────────────
  const handleCreateManager = async (e) => {
    e.preventDefault()
    setAddLoading(true)
    setAddError('')
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/managers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify(addForm),
    })
    const data = await res.json()
    if (data.success) {
      setShowAddModal(false)
      setAddForm({ firstName: '', lastName: '', email: '', password: '' })
      await loadTeamData(profile.team)
    } else {
      setAddError(data.error || 'Ошибка создания')
    }
    setAddLoading(false)
  }

  // ── Delete manager ──────────────────────────────────────────────────────────
  const handleDeleteManager = async (managerId) => {
    setDeleting(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/managers/${managerId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    })
    const data = await res.json()
    if (data.success) {
      setDeleteConfirm(null)
      if (selectedManager?.id === managerId) setSelectedManager(null)
      await loadTeamData(profile.team)
    }
    setDeleting(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">Загрузка...</div>
  }

  const teamInfo  = TEAMS.find(t => t.id === profile?.team)
  const isNikita  = teamInfo?.type === 'nikita'
  const myWeekIP  = getIPLast7Days(myReports)
  const myZone    = getPersonalZone(myWeekIP)

  const mgr7Reps  = (id) => teamReports.filter(r => r.manager_id === id)
  const redManagers = managers.filter(m => isRedFor14Days(mgr7Reps(m.id), m.created_at))

  const modalReports  = selectedManager ? teamReports.filter(r => r.manager_id === selectedManager.id) : []
  const modalIsNikita = TEAMS.find(t => t.id === selectedManager?.team)?.type === 'nikita'

  const TABS = [
    { id: 'analytics', label: 'Аналитика команды' },
    { id: 'daily',     label: 'Дневной отчёт' },
    { id: 'salary',    label: 'Расчёт ЗП' },
    { id: 'telegram',  label: 'Аккаунты Телеграмм' },
  ]

  // ── Render ───────────────────────────────────────────────────────────────────
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
                    activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {/* Bell */}
            <div className="relative" ref={bellRef}>
              <button
                onClick={() => setShowBell(v => !v)}
                className="relative p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition"
              >
                <BellIcon />
                {redManagers.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                    {redManagers.length}
                  </span>
                )}
              </button>

              {showBell && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowBell(false)} />
                  <div style={{ backgroundColor: '#13131f', border: '1px solid #2a2a3e' }}
                    className="absolute right-0 top-12 rounded-2xl p-4 w-72 z-50 shadow-2xl"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-200">Уведомления</h3>
                      <button onClick={() => setShowBell(false)} className="text-gray-500 hover:text-white transition"><CloseIcon /></button>
                    </div>
                    {redManagers.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-4">Нет уведомлений</p>
                    ) : (
                      <div className="space-y-2">
                        {redManagers.map(m => (
                          <div
                            key={m.id}
                            className="bg-red-950/40 border border-red-800 rounded-xl p-3 cursor-pointer hover:bg-red-950/60 transition"
                            onClick={() => { setSelectedManager(m); setShowBell(false) }}
                          >
                            <p className="text-red-300 text-sm font-semibold">{m.name}</p>
                            <p className="text-gray-500 text-xs mt-0.5">14 дней в красной зоне</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <span className="w-px h-5 bg-gray-800" />
            <span className="text-gray-500 text-sm">{profile?.name}</span>
            <button onClick={handleLogout} className="text-gray-500 hover:text-white text-sm transition">Выйти</button>
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="max-w-6xl mx-auto px-6 py-8">

        {activeTab === 'analytics' && (
          <div className="space-y-10">

            {/* ─── Personal reports ─── */}
            <section>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-base font-semibold text-gray-200">Мои отчёты</h2>
                <span className="text-gray-600 text-sm">тимлид</span>
              </div>

              {/* Zone strip */}
              <div className={`${myZone.bg} border ${myZone.border} rounded-2xl p-4 mb-4 flex items-center justify-between`}>
                <div>
                  <p className="text-gray-400 text-xs mb-1">Мои результаты за последние 7 дней</p>
                  <p className={`text-2xl font-bold ${myZone.text}`}>{myWeekIP} <span className="text-sm font-normal">ИП</span></p>
                </div>
                <span className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${myZone.badge}`}>{myZone.label}</span>
              </div>

              <div className="flex justify-end mb-3">
                <button
                  onClick={() => setShowReportForm(v => !v)}
                  className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-semibold transition"
                >
                  + Добавить отчёт
                </button>
              </div>

              {/* Report form */}
              {showReportForm && (
                <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl p-5 mb-4">
                  <form onSubmit={handleSubmitReport}>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-gray-400 text-xs mb-1.5 block">Дата</label>
                        <input type="date" value={reportForm.date} onChange={e => setReportForm({ ...reportForm, date: e.target.value })}
                          className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" required />
                      </div>
                      {!isNikita && (
                        <>
                          <div>
                            <label className="text-gray-400 text-xs mb-1.5 block">Отписанные</label>
                            <input type="number" min="0" value={reportForm.unsubscribed} onChange={e => setReportForm({ ...reportForm, unsubscribed: e.target.value })}
                              placeholder="0" className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                          </div>
                          <div>
                            <label className="text-gray-400 text-xs mb-1.5 block">Ответившие</label>
                            <input type="number" min="0" value={reportForm.replied} onChange={e => setReportForm({ ...reportForm, replied: e.target.value })}
                              placeholder="0" className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                          </div>
                        </>
                      )}
                      {isNikita && (
                        <div>
                          <label className="text-gray-400 text-xs mb-1.5 block">Написало людей</label>
                          <input type="number" min="0" value={reportForm.people_wrote} onChange={e => setReportForm({ ...reportForm, people_wrote: e.target.value })}
                            placeholder="0" className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                        </div>
                      )}
                      <div>
                        <label className="text-gray-400 text-xs mb-1.5 block">Заказали ИП</label>
                        <input type="number" min="0" value={reportForm.ordered_ip} onChange={e => setReportForm({ ...reportForm, ordered_ip: e.target.value })}
                          placeholder="0" required className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                      </div>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <button type="submit" disabled={submitting}
                        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-5 py-2 rounded-lg text-sm font-semibold transition">
                        {submitting ? 'Сохраняем...' : 'Сохранить'}
                      </button>
                      <button type="button" onClick={() => setShowReportForm(false)}
                        className="bg-gray-800 hover:bg-gray-700 px-5 py-2 rounded-lg text-sm transition">Отмена</button>
                    </div>
                  </form>
                </div>
              )}

              {/* My reports table */}
              <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl overflow-hidden">
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
                      {isNikita && <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Написало людей</th>}
                      <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказали ИП</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {myReports.length === 0 ? (
                      <tr><td colSpan={isNikita ? 4 : 5} className="text-center py-12 text-gray-600 text-sm">Нет данных — добавьте первый отчёт</td></tr>
                    ) : myReports.map(r => (
                      <tr key={r.id} style={{ borderTop: '1px solid #1a1a28' }} className="hover:bg-white/[0.02] group">
                        <td className="px-5 py-3 text-sm text-gray-300">{new Date(r.date).toLocaleDateString('ru-RU')}</td>
                        {!isNikita && (
                          <>
                            <td className="px-5 py-3 text-sm text-gray-300">{r.unsubscribed ?? '—'}</td>
                            <td className="px-5 py-3 text-sm text-gray-300">{r.replied ?? '—'}</td>
                          </>
                        )}
                        {isNikita && <td className="px-5 py-3 text-sm text-gray-300">{r.people_wrote ?? '—'}</td>}
                        <td className="px-5 py-3 text-sm font-semibold text-blue-400">{r.ordered_ip ?? '—'}</td>
                        <td className="pr-4 py-3 text-right">
                          <button
                            onClick={() => handleDeleteReport(r.id, true)}
                            disabled={deletingReport === r.id}
                            className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition disabled:opacity-30"
                            title="Удалить отчёт"
                          >
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ─── Team section ─── */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold text-gray-200">
                    Команда {teamInfo?.name ?? profile?.team}
                  </h2>
                  <span className="text-gray-600 text-sm">{managers.length} менеджеров</span>
                </div>
                <button
                  onClick={() => { setShowAddModal(true); setAddError('') }}
                  className="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 px-4 py-2 rounded-lg text-sm font-medium transition"
                >
                  + Добавить менеджера
                </button>
              </div>

              {managers.length === 0 ? (
                <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-xl p-8 text-center text-gray-600 text-sm">
                  В команде нет менеджеров — добавьте первого
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {managers.map(manager => {
                    const mRep    = mgr7Reps(manager.id)
                    const ip7     = getIPLast7Days(mRep)
                    const zKey    = getZoneKey(ip7)
                    const z       = ZONE[zKey]
                    const alert14 = isRedFor14Days(mRep, manager.created_at)
                    const isDeletePending = deleteConfirm === manager.id

                    return (
                      <div
                        key={manager.id}
                        className={`border rounded-2xl p-4 transition-all ${z.card} ${!isDeletePending ? 'cursor-pointer hover:scale-[1.02]' : ''}`}
                        onClick={() => !isDeletePending && setSelectedManager(manager)}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <span className="font-medium text-white text-sm leading-tight">{manager.name}</span>
                          <div className="flex items-center gap-1 ml-1">
                            {alert14 && <span className="text-red-400 text-sm" title="14 дней в красной зоне">⚠</span>}
                            {!isDeletePending && (
                              <button
                                onClick={e => { e.stopPropagation(); setDeleteConfirm(manager.id) }}
                                className="text-gray-700 hover:text-red-400 transition opacity-0 group-hover:opacity-100 p-0.5"
                                title="Удалить менеджера"
                              >
                                <TrashIcon />
                              </button>
                            )}
                          </div>
                        </div>

                        {!isDeletePending ? (
                          <>
                            <div className="mb-3">
                              <span className={`text-2xl font-bold ${z.text}`}>{ip7}</span>
                              <span className="text-gray-500 text-xs ml-1">ИП / 7 дн</span>
                            </div>
                            <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-medium ${z.badge}`}>{z.label}</span>
                          </>
                        ) : (
                          <div onClick={e => e.stopPropagation()}>
                            <p className="text-gray-400 text-xs mb-3">Удалить менеджера?</p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleDeleteManager(manager.id)}
                                disabled={deleting}
                                className="bg-red-600 hover:bg-red-500 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                              >
                                {deleting ? '...' : 'Удалить'}
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-xs transition"
                              >
                                Отмена
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ─── Daily report tab ─── */}
        {activeTab === 'daily' && (() => {
          const teamMembers = [profile, ...managers]
          const allReports = [...myReports, ...teamReports]
          const dayReports = allReports.filter(r => r.date === dailyDate)

          const rows = teamMembers.map(member => {
            const report = dayReports.find(r => r.manager_id === member.id)
            return { member, report }
          })

          const totals = {
            unsubscribed: rows.reduce((s, r) => s + (r.report?.unsubscribed || 0), 0),
            replied:      rows.reduce((s, r) => s + (r.report?.replied || 0), 0),
            ordered_ip:   rows.reduce((s, r) => s + (r.report?.ordered_ip || 0), 0),
            people_wrote: rows.reduce((s, r) => s + (r.report?.people_wrote || 0), 0),
          }

          return (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <label className="text-gray-400 text-sm">Дата:</label>
                <input
                  type="date"
                  value={dailyDate}
                  onChange={e => setDailyDate(e.target.value)}
                  className="bg-gray-900 text-white px-4 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>

              <section>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-base font-semibold text-gray-200">Команда {teamInfo?.name ?? profile?.team}</h2>
                  <span className="text-gray-600 text-sm">{teamMembers.length} чел.</span>
                </div>

                <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                        <th className="text-left px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Менеджер</th>
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
                      {rows.map(({ member, report }) => (
                        <tr key={member.id} style={{ borderTop: '1px solid #1a1a28' }} className="hover:bg-white/[0.02] transition">
                          <td className="px-5 py-3 text-sm text-gray-300">
                            {member.name || member.email}
                            {member.role === 'teamlead' && <span className="ml-2 text-xs text-gray-600">(тимлид)</span>}
                          </td>
                          {!isNikita && (
                            <>
                              <td className="px-5 py-3 text-sm text-gray-300">{report ? report.unsubscribed : '—'}</td>
                              <td className="px-5 py-3 text-sm text-gray-300">{report ? report.replied : '—'}</td>
                            </>
                          )}
                          {isNikita && (
                            <td className="px-5 py-3 text-sm text-gray-300">{report ? report.people_wrote : '—'}</td>
                          )}
                          <td className="px-5 py-3 text-sm font-semibold text-blue-400">{report ? report.ordered_ip : '—'}</td>
                        </tr>
                      ))}
                      {rows.some(r => r.report) && (
                        <tr style={{ borderTop: '2px solid #2a2a3e' }} className="bg-white/[0.02]">
                          <td className="px-5 py-3 text-sm font-semibold text-gray-200">Итого</td>
                          {!isNikita && (
                            <>
                              <td className="px-5 py-3 text-sm font-semibold text-gray-200">{totals.unsubscribed}</td>
                              <td className="px-5 py-3 text-sm font-semibold text-gray-200">{totals.replied}</td>
                            </>
                          )}
                          {isNikita && (
                            <td className="px-5 py-3 text-sm font-semibold text-gray-200">{totals.people_wrote}</td>
                          )}
                          <td className="px-5 py-3 text-sm font-bold text-blue-400">{totals.ordered_ip}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )
        })()}

        {activeTab === 'salary' && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="text-5xl mb-4">💰</div>
            <p className="text-gray-300 font-medium text-lg">Расчёт заработной платы</p>
            <p className="text-gray-600 text-sm mt-2">Раздел в разработке</p>
          </div>
        )}

        {activeTab === 'telegram' && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="text-5xl mb-4">✈️</div>
            <p className="text-gray-300 font-medium text-lg">Аккаунты Телеграмм</p>
            <p className="text-gray-600 text-sm mt-2">Раздел в разработке</p>
          </div>
        )}

      </main>

      {/* ── Manager Detail Modal ── */}
      {selectedManager && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedManager(null)}>
          <div style={{ backgroundColor: '#13131f', border: '1px solid #2a2a3e' }}
            className="rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div style={{ borderBottom: '1px solid #1f1f2e' }} className="px-6 py-5 flex justify-between items-start">
              <div>
                <h2 className="text-lg font-bold">{selectedManager.name}</h2>
                <p className="text-gray-500 text-sm mt-0.5">{modalReports.length} отчётов</p>
              </div>
              <button onClick={() => setSelectedManager(null)} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-white/5 transition"><CloseIcon /></button>
            </div>

            {/* Zone summary */}
            {(() => {
              const ip7  = getIPForPeriod(modalReports, 0, 7)
              const ip14 = getIPForPeriod(modalReports, 7, 14)
              return (
                <div className="px-6 pt-4 pb-2 flex gap-3">
                  {[{ ip: ip7, label: 'Последние 7 дней' }, { ip: ip14, label: 'Предыдущие 7 дней' }].map(({ ip, label }) => {
                    const z = ZONE[getZoneKey(ip)]
                    return (
                      <div key={label} className={`flex-1 border rounded-xl px-4 py-3 ${z.card}`}>
                        <p className="text-gray-500 text-xs mb-1">{label}</p>
                        <p className={`text-xl font-bold ${z.text}`}>{ip} ИП</p>
                        <span className={`text-xs ${z.badge} inline-block px-2 py-0.5 rounded-md mt-1`}>{z.label}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

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
                    {modalIsNikita && <th className="text-left py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wider">Написало людей</th>}
                    <th className="text-left py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказали ИП</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {modalReports.length === 0 ? (
                    <tr><td colSpan={modalIsNikita ? 4 : 5} className="text-center py-10 text-gray-600 text-sm">Нет отчётов</td></tr>
                  ) : modalReports.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid #1a1a28' }} className="hover:bg-white/[0.02] group">
                      <td className="py-2.5 text-sm text-gray-300">{new Date(r.date).toLocaleDateString('ru-RU')}</td>
                      {!modalIsNikita && (
                        <>
                          <td className="py-2.5 text-sm text-gray-300">{r.unsubscribed ?? '—'}</td>
                          <td className="py-2.5 text-sm text-gray-300">{r.replied ?? '—'}</td>
                        </>
                      )}
                      {modalIsNikita && <td className="py-2.5 text-sm text-gray-300">{r.people_wrote ?? '—'}</td>}
                      <td className="py-2.5 text-sm font-semibold text-blue-400">{r.ordered_ip ?? '—'}</td>
                      <td className="py-2.5 pr-1 text-right">
                        <button
                          onClick={() => handleDeleteReport(r.id, false)}
                          disabled={deletingReport === r.id}
                          className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition disabled:opacity-30"
                          title="Удалить отчёт"
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Manager Modal ── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowAddModal(false)}>
          <div style={{ backgroundColor: '#13131f', border: '1px solid #2a2a3e' }}
            className="rounded-2xl w-full max-w-md shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div style={{ borderBottom: '1px solid #1f1f2e' }} className="px-6 py-5 flex justify-between items-center">
              <div>
                <h2 className="text-base font-bold">Добавить менеджера</h2>
                <p className="text-gray-500 text-sm mt-0.5">Команда {teamInfo?.name ?? profile?.team} · подставляется автоматически</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-white/5 transition"><CloseIcon /></button>
            </div>

            <form onSubmit={handleCreateManager} className="p-6 space-y-4">
              {addError && (
                <div className="bg-red-950/40 border border-red-800 text-red-300 px-4 py-3 rounded-lg text-sm">{addError}</div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-xs mb-1.5 block">Имя</label>
                  <input
                    type="text" value={addForm.firstName} required
                    onChange={e => setAddForm({ ...addForm, firstName: e.target.value })}
                    placeholder="Иван"
                    className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1.5 block">Фамилия</label>
                  <input
                    type="text" value={addForm.lastName} required
                    onChange={e => setAddForm({ ...addForm, lastName: e.target.value })}
                    placeholder="Петров"
                    className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-gray-400 text-xs mb-1.5 block">Email</label>
                <input
                  type="email" value={addForm.email} required
                  onChange={e => setAddForm({ ...addForm, email: e.target.value })}
                  placeholder="ivan@example.com"
                  className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>

              <div>
                <label className="text-gray-400 text-xs mb-1.5 block">Пароль</label>
                <input
                  type="password" value={addForm.password} required minLength={6}
                  onChange={e => setAddForm({ ...addForm, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={addLoading}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-2.5 rounded-lg text-sm font-semibold transition">
                  {addLoading ? 'Создаём...' : 'Создать менеджера'}
                </button>
                <button type="button" onClick={() => setShowAddModal(false)}
                  className="bg-gray-800 hover:bg-gray-700 px-5 py-2.5 rounded-lg text-sm transition">Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
