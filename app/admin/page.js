'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

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
  const [reports,  setReports]            = useState([])
  const [loading,  setLoading]            = useState(true)
  const [activeTab, setActiveTab]         = useState('analytics')
  const [selectedManager, setSelectedManager] = useState(null)
  const [deletingReport, setDeletingReport]   = useState(null)
  const [showBell, setShowBell]           = useState(false)
  const bellRef = useRef(null)
  const router  = useRouter()

  useEffect(() => { checkAdmin() }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSelectedManager(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const checkAdmin = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') { router.push('/dashboard'); return }

    await loadData()
  }

  const loadData = async () => {
    const [{ data: mgrs }, { data: reps }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'manager'),
      supabase.from('reports').select('*').order('date', { ascending: false }),
    ])
    setManagers(mgrs || [])
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
    { id: 'salary',    label: 'Расчёт ЗП' },
    { id: 'telegram',  label: 'Аккаунты Телеграмм' },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Header ── */}
      <header
        style={{ backgroundColor: '#111118', borderBottom: '1px solid #1f1f2e' }}
        className="px-6 py-3 sticky top-0 z-40"
      >
        <div className="max-w-7xl mx-auto flex justify-between items-center">
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

          <div className="flex items-center gap-3">
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
                    className="absolute right-0 top-12 rounded-2xl p-4 w-80 z-50 shadow-2xl"
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
                            <p className="text-red-300 text-sm font-semibold">{m.name || m.email}</p>
                            <p className="text-gray-500 text-xs mt-0.5">
                              {TEAMS.find(t => t.id === m.team)?.name
                                ? `Команда ${TEAMS.find(t => t.id === m.team).name} · `
                                : ''
                              }
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
      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* ─── Analytics tab ─── */}
        {activeTab === 'analytics' && (
          <div className="space-y-10">
            {TEAMS.map(team => {
              const teamManagers = managers.filter(m => m.team === team.id)

              return (
                <section key={team.id}>
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-base font-semibold text-gray-200">
                      Команда {team.name}
                    </h2>
                    <span className="text-gray-600 text-sm">
                      {teamManagers.length} {teamManagers.length === 1 ? 'менеджер' : 'менеджеров'}
                    </span>
                  </div>

                  {teamManagers.length === 0 ? (
                    <div
                      style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }}
                      className="rounded-xl p-6 text-gray-600 text-sm"
                    >
                      Нет менеджеров — назначьте team в профиле пользователя
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {teamManagers.map(manager => {
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
            className="rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
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
