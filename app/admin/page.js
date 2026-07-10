'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase, authFetch } from '../../lib/supabase'
import { useRouter } from 'next/navigation'
import { getMissingReportAlerts } from '../../lib/notifications'

// Normalize latin lookalikes to cyrillic for name comparison
const CYR_MAP = { a:'а',b:'в',c:'с',e:'е',h:'н',k:'к',m:'м',o:'о',p:'р',t:'т',x:'х',y:'у' }
const normName = s => (s||'').trim().replace(/\s+/g,' ').toLowerCase().replace(/[a-z]/g, c => CYR_MAP[c] || c)
import { MANAGER_SHEETS, MONTHS_RU } from '../../lib/sheets-config'
import AccountLinkSection from '../../components/AccountLinkSection'
import TasksSection from '../../components/TasksSection'
import WarningButton from '../../components/WarningButton'
import WarningsList from '../../components/WarningsList'
import TeamsSection from '../../components/TeamsSection'
import EditReportModal from '../../components/EditReportModal'

// Транслит названия команды → slug (дублирует lib/teams.js slugifyName,
// чтобы не тянуть серверный модуль в клиентский бандл). "Пети" → "peti".
const TEAM_TRANSLIT = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',
  к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
  х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
}
function slugifyTeamName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/команды?|команду|команд|тимы?/gi, '')
    .trim()
    .split(/\s+/)[0]
    .split('').map(c => TEAM_TRANSLIT[c] ?? c).join('')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 30)
}

// Fallback пока /api/teams ещё грузится — отображает что-то, чтобы не было flash'а
// пустоты. После загрузки заменяется на актуальный список из БД (таблица teams).
const STATIC_TEAMS_FALLBACK = [
  { id: 'olya',      name: 'Оли',       type: 'standard' },
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

// Аналог getIPForPeriod для дебетовых карт.
// Используется на карточках менеджеров в "Аналитика команды" — там нужны
// обе метрики одновременно (ИП + карты), а не только основная по типу команды.
function getCardsForPeriod(reports, daysStart, daysEnd) {
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
    .reduce((sum, r) => sum + (r.ordered_cards || 0), 0)
}

// Написавшие (people_wrote) за период N дней — для расчёта конверсии.
function getWroteForPeriod(reports, daysStart, daysEnd) {
  const now = new Date()
  now.setHours(23, 59, 59, 999)
  const end = new Date(now)
  end.setDate(end.getDate() - daysStart)
  const start = new Date(now)
  start.setDate(start.getDate() - daysEnd)
  start.setHours(0, 0, 0, 0)
  return reports
    .filter(r => { const d = new Date(r.date); return d >= start && d <= end })
    .reduce((sum, r) => sum + (r.people_wrote || 0), 0)
}

// Конверсия = заказали РКО / написавшие * 100, до десятых (напр. "5.8%").
// Если написавших 0 — делить нельзя, показываем "—".
function convStr(orders, writers) {
  if (!writers || writers <= 0) return '—'
  return (orders / writers * 100).toFixed(1) + '%'
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
  // Удаление менеджера: deleteConfirm — id того, по которому идёт подтверждение
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [deleting, setDeleting]           = useState(false)
  // Перенос менеджера между командами (только в модалке выбранного)
  const [editingTeam, setEditingTeam] = useState(false)
  const [newTeamValue, setNewTeamValue] = useState('')
  const [savingTeam, setSavingTeam] = useState(false)
  // Создание новой команды с назначением этого менеджера тимлидом
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [savingNewTeam, setSavingNewTeam] = useState(false)
  const [newTeamError, setNewTeamError] = useState(null)
  const [showBell, setShowBell]           = useState(false)
  const [sheetsData, setSheetsData]       = useState({})
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [contactStats, setContactStats]   = useState({ total: 0, byManager: [] })
  const [contactsLoading, setContactsLoading] = useState(false)
  const [deletedMembers, setDeletedMembers] = useState([])
  const [admins, setAdmins] = useState([])  // для раздела "Задачи"
  const [warningCounts, setWarningCounts] = useState({})  // manager_id → N за текущий месяц
  // Динамический список команд из БД. Маппится в API-структуру { id, name, type }
  // (id = slug). При наличии таблицы teams в БД заменяет STATIC_TEAMS_FALLBACK.
  const [TEAMS, setTEAMS] = useState(STATIC_TEAMS_FALLBACK)
  // Редактирование отчёта (только в детальной модалке менеджера)
  const [editingReport, setEditingReport] = useState(null)
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

  // ── Состояние "Добавить ЦД" ──
  const [showCdModal, setShowCdModal] = useState(false)
  const [cdForm, setCdForm] = useState({ fullName: '', inn: '', phone: '' })
  const [cdSubmitting, setCdSubmitting] = useState(false)
  const [cdError, setCdError] = useState(null)
  const [cdSuccess, setCdSuccess] = useState(false)

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
  // Закрываем редакторы команды при смене выбранного менеджера/закрытии модалки
  useEffect(() => {
    setEditingTeam(false); setNewTeamValue('')
    setCreatingTeam(false); setNewTeamName(''); setNewTeamError(null)
  }, [selectedManager?.id])

  // Fetch Google Sheets ЦД data when daily tab is active
  useEffect(() => {
    if (activeTab !== 'daily' || managers.length === 0) return
    const allMembers = [...managers, ...teamleads, ...deletedMembers]
    const namesWithSheets = allMembers.filter(m => m.sheet_id || MANAGER_SHEETS[m.name]).map(m => m.name)
    if (namesWithSheets.length === 0) { setSheetsData({}); return }
    setSheetsLoading(true)
    fetch(`/api/sheets?names=${encodeURIComponent(namesWithSheets.join(','))}&dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then(r => r.json())
      .then(data => setSheetsData(data))
      .catch(() => setSheetsData({}))
      .finally(() => setSheetsLoading(false))
  }, [activeTab, dateFrom, dateTo, managers, deletedMembers])

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
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const u = session?.user
      if (!u) { router.push('/login'); return }
      setUser(u)

      const profilePromise = supabase.from('profiles').select('*').eq('id', u.id).single()
      const dataPromise = loadData()
      const tgPromise = loadTgAccountsInit()

      const { data: profile } = await profilePromise
      const isAdmin = profile?.role === 'admin' || ADMIN_EMAILS.includes(u.email)
      if (!isAdmin) { router.push('/dashboard'); return }

      // Каждый промис обёрнут в race с таймаутом — если один зависает,
      // страница всё равно покажется через 12 сек.
      const withTimeout = (p, name, ms = 12000) => Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)),
      ]).catch(e => console.error(`${name} failed:`, e?.message || e))

      await Promise.allSettled([
        withTimeout(dataPromise, 'loadData'),
        withTimeout(tgPromise, 'tg'),
      ])
    } catch (e) {
      console.error('admin checkAdmin failed:', e)
    } finally {
      setLoading(false)
    }
  }

  const loadData = async () => {
    const dateLimit = new Date()
    dateLimit.setDate(dateLimit.getDate() - 180)
    const dateLimitStr = dateLimit.toISOString().split('T')[0]

    const [mgrsRes, tlsRes, repsRes, deletedRes, admsRes] = await Promise.allSettled([
      supabase.from('profiles').select('*').eq('role', 'manager'),
      supabase.from('profiles').select('*').eq('role', 'teamlead'),
      supabase.from('reports').select('*').gte('date', dateLimitStr).order('date', { ascending: false }),
      supabase.from('profiles').select('*').eq('role', 'deleted'),
      supabase.from('profiles').select('id, name, email').eq('role', 'admin'),
    ])
    setManagers(mgrsRes.status === 'fulfilled' ? (mgrsRes.value.data || []) : [])
    setTeamleads(tlsRes.status === 'fulfilled' ? (tlsRes.value.data || []) : [])
    setReports(repsRes.status === 'fulfilled' ? (repsRes.value.data || []) : [])
    setDeletedMembers(deletedRes.status === 'fulfilled' ? (deletedRes.value.data || []) : [])
    setAdmins(admsRes.status === 'fulfilled' ? (admsRes.value.data || []) : [])

    // Счётчики предупреждений за текущий месяц
    try {
      const warnRes = await authFetch('/api/manager-warnings')
      const warnData = await warnRes.json()
      if (warnRes.ok) setWarningCounts(warnData.counts || {})
    } catch (e) {
      console.error('loadData: warnings counts failed:', e?.message || e)
    }

    // Список команд из БД (таблица teams). Если ещё не настроена — оставляем fallback.
    try {
      const teamsRes = await authFetch('/api/teams')
      const teamsData = await teamsRes.json()
      if (teamsRes.ok && Array.isArray(teamsData.teams) && teamsData.teams.length > 0) {
        // Мапим slug → id для обратной совместимости со старым кодом
        setTEAMS(teamsData.teams.map(t => ({ id: t.slug, name: t.name, type: t.type })))
      }
    } catch (e) {
      console.error('loadData: teams load failed (using fallback):', e?.message || e)
    }
  }

  const loadTgAccountsInit = async () => {
    try {
      // authFetch имеет таймаут 15 сек — иначе если Google Sheets зависает, страница висит до 5 мин
      const res = await authFetch('/api/telegram-accounts')
      const data = await res.json()
      setTgAccounts(data.accounts || [])
    } catch (e) { console.error('TG accounts initial load failed:', e?.message || e) }
  }

  // ── IP Link functions ──
  const loadIpHistory = useCallback(async () => {
    if (!user) return
    setIpHistoryLoading(true)
    try {
      const res = await authFetch('/api/ip-link?scope=all')
      const data = await res.json()
      if (res.ok) setIpHistory(data.applications || [])
    } catch (e) {
      console.error('loadIpHistory:', e)
    } finally {
      setIpHistoryLoading(false)
    }
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
      const res = await authFetch('/api/ip-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ipForm),
      })
      const data = await res.json()
      if (!res.ok) { setIpError(data.error || 'Ошибка') }
      else { setIpResult(data); await loadIpHistory() }
    } catch (err) {
      console.error('handleCreateIpLink:', err)
      setIpError(err.code === 'NO_SESSION' ? 'Сессия истекла, войдите заново' : 'Ошибка сети')
    } finally {
      setIpSubmitting(false)
    }
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

  const handleCdSubmit = async (e) => {
    e.preventDefault()
    setCdSubmitting(true)
    setCdError(null)
    try {
      const res = await authFetch('/api/cd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cdForm),
      })
      const data = await res.json()
      if (!res.ok) {
        setCdError(data.error || 'Ошибка')
      } else {
        setCdSuccess(true)
        setCdForm({ fullName: '', inn: '', phone: '' })
        setTimeout(() => { setCdSuccess(false); setShowCdModal(false) }, 2500)
      }
    } catch (err) {
      console.error('handleCdSubmit:', err)
      setCdError(err.code === 'NO_SESSION' ? 'Сессия истекла, войдите заново' : 'Ошибка сети')
    } finally {
      setCdSubmitting(false)
    }
  }

  // ── Мемоизированные индексы для быстрого поиска (избегаем O(n²) на каждом рендере) ──
  const reportsByManager = useMemo(() => {
    const m = new Map()
    for (const r of reports) {
      const arr = m.get(r.manager_id)
      if (arr) arr.push(r)
      else m.set(r.manager_id, [r])
    }
    return m
  }, [reports])

  const managerReports = (id) => reportsByManager.get(id) || []

  // Отчёты в выбранном диапазоне дат, сгруппированные по manager_id
  const dayReportsByManager = useMemo(() => {
    const m = new Map()
    for (const r of reports) {
      if (r.date >= dateFrom && r.date <= dateTo) {
        const arr = m.get(r.manager_id)
        if (arr) arr.push(r)
        else m.set(r.manager_id, [r])
      }
    }
    return m
  }, [reports, dateFrom, dateTo])

  // Менеджеры по командам — индекс
  const managersByTeam = useMemo(() => {
    const m = new Map()
    for (const mgr of managers) {
      const arr = m.get(mgr.team)
      if (arr) arr.push(mgr)
      else m.set(mgr.team, [mgr])
    }
    return m
  }, [managers])

  // Сводка по всей компании для панели вверху "Аналитика команды".
  // По каждой команде: кол-во людей (менеджеры + тимлид) и РКО за текущие
  // 7 дней / предыдущие 7 дней. Плюс общие итоги по всем командам.
  const companySummary = useMemo(() => {
    const rows = TEAMS.map(team => {
      const teamManagers = managersByTeam.get(team.id) || []
      const teamTLs = team.id !== 'nikita' ? teamleads.filter(t => t.team === team.id) : []
      const members = [...teamTLs, ...teamManagers]
      let cur = 0, prev = 0, wroteCur = 0
      for (const m of members) {
        const rep = reportsByManager.get(m.id) || []
        cur  += getIPForPeriod(rep, 0, 7)
        prev += getIPForPeriod(rep, 7, 14)
        wroteCur += getWroteForPeriod(rep, 0, 7)
      }
      return { id: team.id, name: team.name, people: members.length, cur, prev, wroteCur }
    })
    const totals = rows.reduce((acc, r) => {
      acc.people += r.people; acc.cur += r.cur; acc.prev += r.prev; acc.wroteCur += r.wroteCur
      return acc
    }, { people: 0, cur: 0, prev: 0, wroteCur: 0 })
    return { rows, totals, teamCount: TEAMS.length }
  }, [TEAMS, managersByTeam, teamleads, reportsByManager])

  // TG аккаунты по нормализованному имени
  const tgByName = useMemo(() => {
    const m = new Map()
    for (const a of tgAccounts) {
      const key = normName(a.assignedTo)
      if (!key) continue
      const arr = m.get(key)
      if (arr) arr.push(a)
      else m.set(key, [a])
    }
    return m
  }, [tgAccounts])

  const handleDeleteReport = async (reportId) => {
    setDeletingReport(reportId)
    await supabase.from('reports').delete().eq('id', reportId)
    setReports(prev => prev.filter(r => r.id !== reportId))
    setDeletingReport(null)
  }

  // ── Перенос менеджера в другую команду ─────────────────────────────────────
  // PUT /api/managers/[id] с { team }. Бэкенд проверяет что caller=admin
  // и target=manager (тимлидов/админов не двигаем).
  const handleTransferTeam = async (managerId, newTeam) => {
    setSavingTeam(true)
    try {
      const res = await authFetch(`/api/managers/${managerId}`, {
        method: 'PUT',
        body: JSON.stringify({ team: newTeam }),
      })
      const data = await res.json()
      if (data.success) {
        // Обновляем менеджера в локальном стейте — без full reload
        setManagers(prev => prev.map(m => m.id === managerId ? { ...m, team: newTeam } : m))
        setSelectedManager(prev => prev && prev.id === managerId ? { ...prev, team: newTeam } : prev)
        setEditingTeam(false)
        setNewTeamValue('')
      } else {
        alert(`Не удалось перенести: ${data.error || 'неизвестная ошибка'}`)
      }
    } catch (e) {
      console.error('handleTransferTeam:', e)
      alert('Сетевая ошибка при переносе')
    } finally {
      setSavingTeam(false)
    }
  }

  // ── Создать команду и назначить менеджера тимлидом ─────────────────────────
  // POST /api/teams { name, slug, type:'standard', teamlead_id }. Бэкенд создаёт
  // команду и промоутит менеджера в teamlead + team=slug одной операцией.
  // slug генерируется транслитом из названия автоматически.
  const handleCreateTeamForManager = async (managerId) => {
    const name = newTeamName.trim()
    if (name.length < 1) { setNewTeamError('Введите название команды'); return }
    const slug = slugifyTeamName(name)
    if (!slug) { setNewTeamError('Не удалось сгенерировать slug из названия — используйте латиницу/кириллицу'); return }

    setSavingNewTeam(true)
    setNewTeamError(null)
    try {
      const res = await authFetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, type: 'standard', teamlead_id: managerId }),
      })
      const data = await res.json()
      if (!res.ok) { setNewTeamError(data.error || 'Ошибка создания команды'); return }
      // Команда создана + менеджер стал тимлидом. Перезагружаем, чтобы обновились
      // TEAMS, аналитика и роль в списках (проще и надёжнее ручной синхронизации).
      window.location.reload()
    } catch (e) {
      console.error('handleCreateTeamForManager:', e)
      setNewTeamError('Сетевая ошибка')
    } finally {
      setSavingNewTeam(false)
    }
  }

  // ── Soft-delete менеджера ──────────────────────────────────────────────────
  // Бэкенд: DELETE /api/managers/[id]. Меняет role: manager → deleted,
  // удаляет auth-пользователя (отзывает логин) и чистит TG-привязки в Google Sheets.
  // Профиль сохраняется, чтобы исторические отчёты продолжали учитываться
  // в командной аналитике (через массив deletedMembers).
  const handleDeleteManager = async (managerId) => {
    setDeleting(true)
    try {
      const res = await authFetch(`/api/managers/${managerId}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setDeleteConfirm(null)
        if (selectedManager?.id === managerId) setSelectedManager(null)
        // Перемещаем менеджера из активных в удалённые без перезагрузки всех данных
        setManagers(prev => prev.filter(m => m.id !== managerId))
        setDeletedMembers(prev => {
          // если профиль уже есть в активных — добавляем его сюда с role=deleted
          const moved = (prev.find(m => m.id === managerId)) ? prev : [
            ...prev,
            ...((() => {
              const found = managers.find(m => m.id === managerId)
              return found ? [{ ...found, role: 'deleted' }] : []
            })()),
          ]
          return moved
        })
      } else {
        alert(`Не удалось удалить: ${data.error || 'неизвестная ошибка'}`)
      }
    } catch (e) {
      console.error('handleDeleteManager:', e)
      alert('Сетевая ошибка при удалении')
    } finally {
      setDeleting(false)
    }
  }

  const redManagers = useMemo(
    () => managers.filter(m => isRedFor14Days(reportsByManager.get(m.id) || [], m.created_at)),
    [managers, reportsByManager]
  )

  // Missing report notifications (all managers across all teams)
  const { missing: missingAlerts, streaks: streakAlerts } = useMemo(
    () => getMissingReportAlerts(managers, reports),
    [managers, reports]
  )
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
    { id: 'tasks',     label: 'Задачи' },
    { id: 'daily',     label: 'Дневной отчёт' },
    { id: 'salary',    label: 'Расчёт ЗП' },
    { id: 'telegram',  label: 'Аккаунты Телеграмм' },
    // { id: 'ip-link',   label: 'Ссылка ИП' },  // временно скрыто — заменён на "Счёт ИП"
    { id: 'account-link', label: 'Счёт ИП' },
    // { id: 'add-cd',    label: 'Добавить ЦД' },  // временно скрыто (07.2026) — код рендера ниже сохранён
    { id: 'teams',     label: 'Команды' },
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
            {/* Сводка по всей компании (только админ-кабинет) */}
            <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl p-5">
              <h2 className="text-base font-semibold text-gray-200 mb-4">Сводка по компании</h2>

              {/* Верхние счётчики */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-5">
                <div>
                  <p className="text-gray-500 text-xs mb-1">Команд</p>
                  <p className="text-2xl font-bold text-gray-100">{companySummary.teamCount}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">Людей в командах</p>
                  <p className="text-2xl font-bold text-gray-100">{companySummary.totals.people}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">РКО за 7 дней</p>
                  <p className="text-2xl font-bold text-blue-400">{companySummary.totals.cur}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">РКО за пред. 7 дней</p>
                  <p className="text-2xl font-bold text-gray-300">{companySummary.totals.prev}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">Конверсия за 7 дней</p>
                  <p className="text-2xl font-bold text-cyan-400">{convStr(companySummary.totals.cur, companySummary.totals.wroteCur)}</p>
                </div>
              </div>

              {/* Разбивка по командам */}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                      <th className="text-left py-2 text-gray-500 text-xs font-medium uppercase tracking-wider">Команда</th>
                      <th className="text-right py-2 text-gray-500 text-xs font-medium uppercase tracking-wider">Людей</th>
                      <th className="text-right py-2 text-gray-500 text-xs font-medium uppercase tracking-wider">РКО 7 дн</th>
                      <th className="text-right py-2 text-gray-500 text-xs font-medium uppercase tracking-wider">РКО пред. 7 дн</th>
                      <th className="text-right py-2 text-gray-500 text-xs font-medium uppercase tracking-wider">Δ</th>
                      <th className="text-right py-2 text-gray-500 text-xs font-medium uppercase tracking-wider">Конв. 7 дн</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companySummary.rows.map(r => {
                      const delta = r.cur - r.prev
                      return (
                        <tr key={r.id} style={{ borderTop: '1px solid #1a1a28' }}>
                          <td className="py-2 text-sm text-gray-300">Команда {r.name}</td>
                          <td className="py-2 text-sm text-gray-400 text-right">{r.people}</td>
                          <td className="py-2 text-sm font-semibold text-blue-400 text-right">{r.cur}</td>
                          <td className="py-2 text-sm text-gray-400 text-right">{r.prev}</td>
                          <td className={`py-2 text-sm text-right font-medium ${delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-gray-600'}`}>
                            {delta > 0 ? `+${delta}` : delta}
                          </td>
                          <td className="py-2 text-sm text-right font-medium text-cyan-400">{convStr(r.cur, r.wroteCur)}</td>
                        </tr>
                      )
                    })}
                    <tr style={{ borderTop: '2px solid #2a2a3e' }} className="bg-white/[0.02]">
                      <td className="py-2 text-sm font-semibold text-gray-200">Итого</td>
                      <td className="py-2 text-sm font-semibold text-gray-200 text-right">{companySummary.totals.people}</td>
                      <td className="py-2 text-sm font-bold text-blue-400 text-right">{companySummary.totals.cur}</td>
                      <td className="py-2 text-sm font-semibold text-gray-300 text-right">{companySummary.totals.prev}</td>
                      <td className={`py-2 text-sm text-right font-bold ${
                        companySummary.totals.cur - companySummary.totals.prev > 0 ? 'text-green-400'
                        : companySummary.totals.cur - companySummary.totals.prev < 0 ? 'text-red-400' : 'text-gray-600'
                      }`}>
                        {(() => { const d = companySummary.totals.cur - companySummary.totals.prev; return d > 0 ? `+${d}` : d })()}
                      </td>
                      <td className="py-2 text-sm text-right font-bold text-cyan-400">{convStr(companySummary.totals.cur, companySummary.totals.wroteCur)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {TEAMS.map(team => {
              const teamManagers = managersByTeam.get(team.id) || []
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
                        // 06.2026: единая метрика для всех команд — РКО (ordered_ip).
                        const value7  = getIPForPeriod(mRep, 0, 7)
                        const wrote7  = getWroteForPeriod(mRep, 0, 7)
                        const zKey    = getZoneKey(value7, 'standard')
                        const z       = ZONE[zKey]
                        const alert14 = isRedFor14Days(mRep, manager.created_at)
                        const isDeletePending = deleteConfirm === manager.id
                        // Тимлидов в админке не удаляем — только менеджеров
                        const canDelete = manager.role === 'manager'

                        return (
                          <div
                            key={manager.id}
                            onClick={() => !isDeletePending && setSelectedManager(manager)}
                            className={`group border rounded-2xl p-4 text-left transition-all ${z.card} ${!isDeletePending ? 'hover:scale-[1.02] hover:shadow-lg cursor-pointer' : ''}`}
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
                              <div className="flex items-center gap-1 ml-1 flex-shrink-0">
                                {alert14 && (
                                  <span title="14 дней в красной зоне" className="text-red-400 text-base leading-none">⚠</span>
                                )}
                                {canDelete && !isDeletePending && (
                                  <WarningButton
                                    managerId={manager.id}
                                    monthCount={warningCounts[manager.id] || 0}
                                    onIssued={(newCount) => setWarningCounts(prev => ({ ...prev, [manager.id]: newCount }))}
                                  />
                                )}
                                {canDelete && !isDeletePending && (
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
                                <div className="mb-2">
                                  <span className={`text-3xl font-bold ${z.text}`}>{value7}</span>
                                  <span className="text-gray-500 text-xs ml-1">РКО / 7 дн</span>
                                </div>
                                <p className="text-gray-500 text-xs mb-3">
                                  Конверсия: <span className="text-cyan-400 font-medium">{convStr(value7, wrote7)}</span>
                                </p>

                                <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-medium ${z.badge}`}>
                                  {z.label}
                                </span>
                                {(() => {
                                  const mName = normName(manager.name || manager.email)
                                  const accs = tgByName.get(mName) || []
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
                              </>
                            ) : (
                              <div onClick={e => e.stopPropagation()}>
                                <p className="text-gray-400 text-xs mb-3">Удалить менеджера? История отчётов сохранится в командной аналитике.</p>
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
                                    disabled={deleting}
                                    className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 px-3 py-1.5 rounded-lg text-xs transition"
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Написавшие</p>
                      <p className="text-xl font-bold text-gray-200">{totalPeopleWrote}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Заказали РКО</p>
                      <p className="text-xl font-bold text-blue-400">{totalOrdered}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">Конверсия</p>
                      <p className="text-xl font-bold text-cyan-400">{convStr(totalOrdered, totalPeopleWrote)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs mb-1">ЦД ИП</p>
                      <p className="text-xl font-bold text-emerald-400">
                        {sheetsLoading ? '...' : Object.values(sheetsData).reduce((s, v) => s + (v?.ip || 0), 0)}
                      </p>
                    </div>
                    {/* Скрыто 07.2026 — ЦД дебетовые и Выдано номеров (код сохранён)
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
                    */}
                  </div>
                </div>
              )
            })()}

            {TEAMS.map(team => {
              const isNikita = team.type === 'nikita'
              const isKarina = team.type === 'karina'
              const teamMembers = [
                ...(managersByTeam.get(team.id) || []),
                ...teamleads.filter(t => t.team === team.id),
              ]
              const teamDeletedMembers = deletedMembers.filter(m => m.team === team.id)

              const rows = teamMembers.map(member => {
                const allMemberReports = dayReportsByManager.get(member.id) || []
                const memberReports = allMemberReports
                const report = memberReports.length > 0 ? {
                  unsubscribed:  memberReports.reduce((s, r) => s + (r.unsubscribed || 0), 0),
                  replied:       memberReports.reduce((s, r) => s + (r.replied || 0), 0),
                  ordered_ip:    memberReports.reduce((s, r) => s + (r.ordered_ip || 0), 0),
                  ordered_cards: memberReports.reduce((s, r) => s + (r.ordered_cards || 0), 0),
                  people_wrote:  memberReports.reduce((s, r) => s + (r.people_wrote || 0), 0),
                } : null
                return { member, report }
              })

              // Include deleted members' reports in totals
              const deletedTotals = teamDeletedMembers.reduce((acc, member) => {
                const memberReports = dayReportsByManager.get(member.id) || []
                memberReports.forEach(r => {
                  acc.unsubscribed += r.unsubscribed || 0
                  acc.replied += r.replied || 0
                  acc.ordered_ip += r.ordered_ip || 0
                  acc.ordered_cards += r.ordered_cards || 0
                  acc.people_wrote += r.people_wrote || 0
                })
                return acc
              }, { unsubscribed: 0, replied: 0, ordered_ip: 0, ordered_cards: 0, people_wrote: 0 })

              const totals = {
                unsubscribed:  rows.reduce((s, r) => s + (r.report?.unsubscribed || 0), 0) + deletedTotals.unsubscribed,
                replied:       rows.reduce((s, r) => s + (r.report?.replied || 0), 0) + deletedTotals.replied,
                ordered_ip:    rows.reduce((s, r) => s + (r.report?.ordered_ip || 0), 0) + deletedTotals.ordered_ip,
                ordered_cards: rows.reduce((s, r) => s + (r.report?.ordered_cards || 0), 0) + deletedTotals.ordered_cards,
                people_wrote:  rows.reduce((s, r) => s + (r.report?.people_wrote || 0), 0) + deletedTotals.people_wrote,
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
                          <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Написавшие</th>
                          <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказали РКО</th>
                          <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Конверсия</th>
                          <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ЦД ИП</th>
                          {/* Скрыто 07.2026 (код сохранён):
                          <th ...>ЦД дебетовые</th>
                          <th ...>Взято номеров</th> */}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="text-center py-8 text-gray-600 text-sm">
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
                                  <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{report ? report.people_wrote : '—'}</td>
                                  <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-blue-400">{report ? report.ordered_ip : '—'}</td>
                                  <td className="px-3 sm:px-5 py-3 text-sm text-cyan-400 font-medium">
                                    {report ? convStr(report.ordered_ip, report.people_wrote) : '—'}
                                  </td>
                                  <td className="px-3 sm:px-5 py-3 text-sm">
                                    <CdValue value={sd ? sd.ip : null} loading={sheetsLoading && sd === undefined} />
                                  </td>
                                  {/* Скрыто 07.2026 (код сохранён):
                                  <td><CdValue value={sd ? sd.debit : null} color="text-purple-400" /></td>
                                  <td><CdValue value={contactStats.byManagerId?.[member.id] ?? null} color="text-orange-400" /></td> */}
                                </tr>
                              )
                            })}
                            {(rows.some(r => r.report) || Object.values(sheetsData).some(v => v?.total)) && (
                              <tr style={{ borderTop: '2px solid #2a2a3e' }} className="bg-white/[0.02]">
                                <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-gray-200">Итого</td>
                                <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-gray-200">{totals.people_wrote}</td>
                                <td className="px-3 sm:px-5 py-3 text-sm font-bold text-blue-400">{totals.ordered_ip}</td>
                                <td className="px-3 sm:px-5 py-3 text-sm font-bold text-cyan-400">{convStr(totals.ordered_ip, totals.people_wrote)}</td>
                                <td className="px-3 sm:px-5 py-3 text-sm font-bold text-emerald-400">
                                  {rows.reduce((s, { member }) => s + (sheetsData[member.name]?.ip || 0), 0) + teamDeletedMembers.reduce((s, m) => s + (sheetsData[m.name]?.ip || 0), 0)}
                                </td>
                                {/* Скрыто 07.2026 (код сохранён): ЦД дебетовые + Взято номеров */}
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
          // Бонус тимлида за ЦД ИП менеджера: с июля 2026 — 300₽, раньше — 150₽.
          // Ставка зависит от ВЫБРАННОГО месяца, чтобы прошлые расчёты не менялись.
          const isJuly2026OrLater = salaryYear > 2026 || (salaryYear === 2026 && salaryMonth >= 6)
          const RATES = {
            MANAGER_IP: 1000,
            MANAGER_DEBIT: 300,
            TL_BONUS_IP: isJuly2026OrLater ? 300 : 150,
            TL_BONUS_DEBIT: 50,
          }
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
            const teamMgrs = managersByTeam.get(team.id) || []
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
              const res = await authFetch(`/api/managers/${profileId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentInfo: value }),
              })
              if (res.ok) {
                setManagers(prev => prev.map(m => m.id === profileId ? { ...m, payment_info: value } : m))
                setTeamleads(prev => prev.map(t => t.id === profileId ? { ...t, payment_info: value } : t))
              }
            } catch (e) {
              console.error('savePaymentInfo:', e)
            } finally {
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
                  <p className="text-gray-600 text-xs mt-3">
                    Период: {dateFrom} — {dateTo}
                    {' · '}Бонус ТЛ за ЦД ИП: {RATES.TL_BONUS_IP} ₽/шт
                  </p>
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
              const res = await authFetch('/api/telegram-accounts')
              const data = await res.json()
              setTgAccounts(data.accounts || [])
            } catch (e) {
              console.error('loadTgAccounts:', e)
              setTgAccounts([])
            } finally {
              setTgLoading(false)
            }
          }

          const fetchCode = async (acc) => {
            setTgCodeLoading(prev => ({ ...prev, [acc.rowIndex]: true }))
            try {
              const res = await authFetch('/api/telegram-accounts/code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: acc.email, password: acc.emailPassword }),
              })
              const data = await res.json()
              if (res.ok) {
                setTgCode({ code: data.code, receivedAt: data.receivedAt, phone: acc.phone, tgLink: acc.tgLink })
              } else {
                setTgCode({ error: data.error, phone: acc.phone })
              }
            } catch (e) {
              console.error('fetchCode:', e)
              setTgCode({ error: e.code === 'NO_SESSION' ? 'Сессия истекла, войдите заново' : (e.message || 'Ошибка сети'), phone: acc.phone })
            } finally {
              setTgCodeLoading(prev => ({ ...prev, [acc.rowIndex]: false }))
            }
          }

          const assignAccount = async (rowIndex, name) => {
            setTgAssigning(prev => ({ ...prev, [rowIndex]: true }))
            try {
              await authFetch('/api/telegram-accounts', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rowIndex, assignedTo: name }),
              })
              setTgAccounts(prev => prev.map(a => a.rowIndex === rowIndex ? { ...a, assignedTo: name } : a))
              setTgAssignSelect(prev => { const n = { ...prev }; delete n[rowIndex]; return n })
            } catch (e) {
              console.error('assignAccount:', e)
            } finally {
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

        {/* ─── Задачи (приватный таск-трекер для админов) ─── */}
        {activeTab === 'tasks' && user && (
          <TasksSection currentUserId={user.id} admins={admins} />
        )}

        {/* ─── Счёт ИП (РКО, оффер 533) ─── */}
        {activeTab === 'account-link' && (
          <AccountLinkSection
            scope="all"
            showManagerColumn
            managerNameById={Object.fromEntries(managers.map(m => [m.id, m.name]))}
          />
        )}

        {/* ─── IP Link tab (временно скрыт) ─── */}
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

        {/* ── Вкладка "Добавить ЦД" ── */}
        {activeTab === 'add-cd' && (
          <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl p-6 max-w-xl">
            <h2 className="text-base font-semibold text-gray-200 mb-2">Добавить ЦД</h2>
            <p className="text-gray-500 text-xs mb-5">Введите данные ЦД — они попадут в сводную таблицу ЦД за текущий месяц.</p>
            <button
              onClick={() => { setShowCdModal(true); setCdSuccess(false); setCdError(null) }}
              className="bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-lg text-sm font-semibold transition"
            >
              + Добавить ЦД
            </button>
          </div>
        )}

        {/* ─── Команды (создание/удаление, назначение тимлида) ─── */}
        {activeTab === 'teams' && (
          <TeamsSection allManagers={[...managers, ...teamleads]} />
        )}

      </main>

      {/* ── Модалка "Добавить ЦД" ── */}
      {showCdModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowCdModal(false)}>
          <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            {cdSuccess ? (
              <div className="bg-green-950/40 border border-green-700 rounded-xl p-5 text-center">
                <p className="text-green-300 font-semibold text-sm">ЦД добавлен в таблицу</p>
              </div>
            ) : (
              <>
                <h3 className="text-base font-semibold text-gray-200 mb-4">Добавить ЦД</h3>
                <form onSubmit={handleCdSubmit} className="space-y-3">
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">ФИО</label>
                    <input type="text" required value={cdForm.fullName} onChange={e => setCdForm({ ...cdForm, fullName: e.target.value })}
                      placeholder="Иванов Иван Иванович" className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">ИНН (12 цифр)</label>
                    <input type="text" value={cdForm.inn} onChange={e => setCdForm({ ...cdForm, inn: e.target.value })}
                      placeholder="123456789012" className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <div className="text-center text-gray-600 text-xs">— или —</div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1.5 block">Номер телефона</label>
                    <input type="tel" value={cdForm.phone} onChange={e => setCdForm({ ...cdForm, phone: e.target.value })}
                      placeholder="+7 999 123 45 67" className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                  </div>
                  <p className="text-gray-600 text-xs">Достаточно заполнить ФИО и одно из: ИНН или телефон.</p>
                  {cdError && <p className="text-red-400 text-sm">{cdError}</p>}
                  <div className="flex gap-2 pt-2">
                    <button type="submit" disabled={cdSubmitting}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm font-semibold transition">
                      {cdSubmitting ? 'Добавляем...' : 'Добавить'}
                    </button>
                    <button type="button" onClick={() => { setShowCdModal(false); setCdError(null) }}
                      className="px-4 py-2.5 rounded-lg text-sm bg-gray-800 hover:bg-gray-700 transition">
                      Отмена
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

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
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-white">{selectedManager.name || selectedManager.email}</h2>
                {/* Команда: при role=manager и НЕ в режиме редактирования — клик по имени команды
                    открывает выпадающий select для переноса в другую команду. */}
                <div className="text-gray-500 text-sm mt-0.5 flex items-center gap-2 flex-wrap">
                  {selectedManager.role === 'manager' && editingTeam ? (
                    <>
                      <span>Команда:</span>
                      <select
                        value={newTeamValue}
                        onChange={e => setNewTeamValue(e.target.value)}
                        disabled={savingTeam}
                        style={{ backgroundColor: '#1a1a28', border: '1px solid #2a2a3e' }}
                        className="text-gray-200 text-xs rounded-md px-2 py-1"
                      >
                        {TEAMS.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleTransferTeam(selectedManager.id, newTeamValue)}
                        disabled={savingTeam || newTeamValue === selectedManager.team}
                        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-2.5 py-1 rounded-md text-xs text-white transition"
                      >
                        {savingTeam ? '...' : 'Перенести'}
                      </button>
                      <button
                        onClick={() => { setEditingTeam(false); setNewTeamValue('') }}
                        disabled={savingTeam}
                        className="text-gray-500 hover:text-gray-300 text-xs transition"
                      >
                        Отмена
                      </button>
                    </>
                  ) : (
                    <>
                      <span>{modalTeam ? `Команда ${modalTeam.name}` : 'Команда не задана'}</span>
                      {selectedManager.role === 'manager' && (
                        <button
                          onClick={() => { setEditingTeam(true); setNewTeamValue(selectedManager.team || '') }}
                          className="text-blue-400 hover:text-blue-300 text-xs underline-offset-2 hover:underline transition"
                          title="Перенести менеджера в другую команду"
                        >
                          сменить команду
                        </button>
                      )}
                      <span>·</span>
                      <span>{modalReports.length} отчётов</span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedManager(null)}
                className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-white/5 transition"
              >
                <CloseIcon />
              </button>
            </div>

            {/* Zone summary strip — единая метрика РКО (ordered_ip) для всех команд */}
            {(() => {
              const val7  = getIPForPeriod(modalReports, 0, 7)
              const val14 = getIPForPeriod(modalReports, 7, 14)
              const z7    = ZONE[getZoneKey(val7, 'standard')]
              const z14   = ZONE[getZoneKey(val14, 'standard')]
              return (
                <div className="px-6 pt-4 pb-2 flex gap-4">
                  <div className={`flex-1 border rounded-xl px-4 py-3 ${z7.card}`}>
                    <p className="text-gray-500 text-xs mb-1">Последние 7 дней</p>
                    <p className={`text-xl font-bold ${z7.text}`}>{val7} РКО</p>
                    <span className={`text-xs ${z7.badge} inline-block px-2 py-0.5 rounded-md mt-1`}>{z7.label}</span>
                  </div>
                  <div className={`flex-1 border rounded-xl px-4 py-3 ${z14.card}`}>
                    <p className="text-gray-500 text-xs mb-1">Предыдущие 7 дней</p>
                    <p className={`text-xl font-bold ${z14.text}`}>{val14} РКО</p>
                    <span className={`text-xs ${z14.badge} inline-block px-2 py-0.5 rounded-md mt-1`}>{z14.label}</span>
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
                          const res = await authFetch(`/api/managers/${selectedManager.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sheetUrl: sheetUrlInput }),
                          })
                          const result = await res.json()
                          if (res.ok) {
                            setManagers(prev => prev.map(m => m.id === selectedManager.id ? { ...m, sheet_id: result.sheetId } : m))
                            setSelectedManager(prev => ({ ...prev, sheet_id: result.sheetId }))
                            setSheetEditing(false)
                          }
                        } catch (e) {
                          console.error('sheet bind save:', e)
                        } finally {
                          setSheetSaving(false)
                        }
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
                            const res = await authFetch(`/api/managers/${selectedManager.id}`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ sheetUrl: '' }),
                            })
                            if (res.ok) {
                              setManagers(prev => prev.map(m => m.id === selectedManager.id ? { ...m, sheet_id: null } : m))
                              setSelectedManager(prev => ({ ...prev, sheet_id: null }))
                              setSheetEditing(false)
                              setSheetUrlInput('')
                            }
                          } catch (e) {
                            console.error('sheet unbind:', e)
                          } finally {
                            setSheetSaving(false)
                          }
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
                    <th className="text-left py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wider">Написавшие</th>
                    <th className="text-left py-2.5 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказали РКО</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {modalReports.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-12 text-gray-600 text-sm">
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
                        <td className="py-2.5 text-sm text-gray-300">{r.people_wrote ?? '—'}</td>
                        <td className="py-2.5 text-sm font-semibold text-blue-400">{r.ordered_ip ?? '—'}</td>
                        <td className="py-2.5 pr-1 text-right">
                          <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition">
                            <button
                              onClick={() => setEditingReport(r)}
                              className="text-gray-600 hover:text-blue-400 transition"
                              title="Редактировать цифры"
                            >
                              ✏
                            </button>
                            <button
                              onClick={() => handleDeleteReport(r.id)}
                              disabled={deletingReport === r.id}
                              className="text-gray-600 hover:text-red-400 transition disabled:opacity-30"
                              title="Удалить отчёт"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Секция предупреждений (только для role=manager) */}
            {selectedManager.role === 'manager' && (
              <div style={{ borderTop: '1px solid #1f1f2e' }} className="px-6 py-4">
                <h3 className="text-sm font-semibold text-gray-300 mb-2">Предупреждения</h3>
                <WarningsList
                  managerId={selectedManager.id}
                  canDelete={true}
                  onLoaded={(monthCount) => setWarningCounts(prev => ({ ...prev, [selectedManager.id]: monthCount }))}
                />
              </div>
            )}

            {/* Создать команду и сделать этого менеджера тимлидом (только role=manager) */}
            {selectedManager.role === 'manager' && (
              <div style={{ borderTop: '1px solid #1f1f2e' }} className="px-6 py-4">
                {creatingTeam ? (
                  <div>
                    <p className="text-sm font-semibold text-gray-300 mb-1">Новая команда</p>
                    <p className="text-gray-500 text-xs mb-3">
                      {selectedManager.name || selectedManager.email} станет тимлидом. Название — как команда будет подписана в системе.
                    </p>
                    <input
                      type="text" maxLength={60} autoFocus
                      value={newTeamName}
                      onChange={e => { setNewTeamName(e.target.value); setNewTeamError(null) }}
                      placeholder="Пети"
                      className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm mb-1"
                    />
                    {newTeamName.trim() && (
                      <p className="text-gray-600 text-xs mb-2">
                        Отобразится как «Команда {newTeamName.trim()}» · slug: <span className="font-mono">{slugifyTeamName(newTeamName) || '—'}</span>
                      </p>
                    )}
                    {newTeamError && <p className="text-red-400 text-sm mb-2">{newTeamError}</p>}
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleCreateTeamForManager(selectedManager.id)}
                        disabled={savingNewTeam}
                        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold transition"
                      >
                        {savingNewTeam ? 'Создаём...' : 'Создать команду'}
                      </button>
                      <button
                        onClick={() => { setCreatingTeam(false); setNewTeamName(''); setNewTeamError(null) }}
                        disabled={savingNewTeam}
                        className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm transition"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setCreatingTeam(true); setNewTeamName(''); setNewTeamError(null) }}
                    className="text-blue-400 hover:text-blue-300 text-sm font-medium flex items-center gap-1.5 transition"
                  >
                    + Создать команду (сделать тимлидом)
                  </button>
                )}
              </div>
            )}

            {/* Footer: удалить менеджера (только для role=manager) */}
            {selectedManager.role === 'manager' && (
              <div style={{ borderTop: '1px solid #1f1f2e' }} className="px-6 py-4 flex justify-end">
                {deleteConfirm === selectedManager.id ? (
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 text-sm">Удалить менеджера?</span>
                    <button
                      onClick={() => handleDeleteManager(selectedManager.id)}
                      disabled={deleting}
                      className="bg-red-600 hover:bg-red-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold transition"
                    >
                      {deleting ? '...' : 'Да, удалить'}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      disabled={deleting}
                      className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm transition"
                    >
                      Отмена
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(selectedManager.id)}
                    className="text-gray-600 hover:text-red-400 text-sm flex items-center gap-1.5 transition"
                  >
                    <TrashIcon />
                    Удалить менеджера
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Модалка редактирования отчёта менеджера (2 поля: написавшие + РКО) */}
      {editingReport && (
        <EditReportModal
          report={editingReport}
          onClose={() => setEditingReport(null)}
          onSaved={(updated) => {
            // Подменяем отчёт в общем списке
            setReports(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r))
          }}
        />
      )}

    </div>
  )
}
