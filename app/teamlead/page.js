'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'
import { getMissingReportAlerts } from '../../lib/notifications'
import IpApplicationTab from '../../components/IpApplicationTab'

// Normalize latin lookalikes to cyrillic for name comparison
const CYR_MAP = { a:'а',b:'в',c:'с',e:'е',h:'н',k:'к',m:'м',o:'о',p:'р',t:'т',x:'х',y:'у' }
const normName = s => (s||'').trim().replace(/\s+/g,' ').toLowerCase().replace(/[a-z]/g, c => CYR_MAP[c] || c)
import { MANAGER_SHEETS } from '../../lib/sheets-config'

// ── Team config ──────────────────────────────────────────────────────────────
const TEAMS = [
  { id: 'anastasia', name: 'Анастасии', type: 'standard' },
  { id: 'yasmin',    name: 'Ясмин',     type: 'standard' },
  { id: 'olya',      name: 'Оли',       type: 'standard' },
  { id: 'karina',    name: 'Карины',    type: 'karina'   },
  { id: 'nikita',    name: 'Никиты',    type: 'nikita'   },
]

// Команды с доступом к выдаче номеров
const CONTACT_TEAMS = ['yasmin', 'karina', 'anastasia', 'olya']

function formatTimeLeft(ms) {
  if (ms <= 0) return null
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 0) return `${hours} ч ${mins} мин`
  return `${mins} мин`
}

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

const ZONE = {
  red:    { card: 'border-red-800 bg-red-950/25',    badge: 'bg-red-900/50 text-red-300 border border-red-800',    text: 'text-red-400',    label: 'Красная зона' },
  yellow: { card: 'border-yellow-700 bg-yellow-950/25', badge: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700', text: 'text-yellow-400', label: 'Жёлтая зона' },
  green:  { card: 'border-green-800 bg-green-950/25',  badge: 'bg-green-900/50 text-green-300 border border-green-800',  text: 'text-green-400',  label: 'Зелёная зона' },
}

// Personal zone (for the teamlead's own indicator strip)
function getPersonalZone(ip, teamType) {
  const key = getZoneKey(ip, teamType)
  const map = {
    red:    { bg: 'bg-red-950/40',    border: 'border-red-700',    text: 'text-red-400',    badge: 'bg-red-900/60 text-red-300 border border-red-700',    label: 'Красная зона' },
    yellow: { bg: 'bg-yellow-950/40', border: 'border-yellow-600', text: 'text-yellow-400', badge: 'bg-yellow-900/60 text-yellow-300 border border-yellow-600', label: 'Жёлтая зона' },
    green:  { bg: 'bg-green-950/40',  border: 'border-green-700',  text: 'text-green-400',  badge: 'bg-green-900/60 text-green-300 border border-green-700',  label: 'Зелёная зона' },
  }
  return map[key]
}

// ── Transliteration for email generation ──────────────────────────────────────
const TRANSLIT = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',
  к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
  х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
}
function transliterate(str) {
  return str.toLowerCase().split('').map(c => TRANSLIT[c] ?? c).join('')
}
function generateEmail(firstName, lastName) {
  const f = transliterate(firstName.trim())
  const l = transliterate(lastName.trim())
  if (!f || !l) return ''
  return `${f}.${l}@arbteam.ru`
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

const ADMIN_EMAILS = ['nikita.tatarintsev@arbteam.ru']

// ── Component ─────────────────────────────────────────────────────────────────
export default function TeamleadPage() {
  const [user, setUser]         = useState(null)
  const [profile, setProfile]   = useState(null)
  const [myReports, setMyReports]     = useState([])
  const [managers, setManagers]       = useState([])
  const [deletedMembers, setDeletedMembers] = useState([])
  const [teamReports, setTeamReports] = useState([])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('analytics')
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo]     = useState(new Date().toISOString().split('T')[0])

  // Personal report form
  const [showReportForm, setShowReportForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reportForm, setReportForm] = useState({
    date: new Date().toISOString().split('T')[0],
    unsubscribed: '', replied: '', ordered_ip: '', ordered_cards: '', people_wrote: '',
  })

  // Team manager detail modal
  const [selectedManager, setSelectedManager] = useState(null)
  const [deletingReport, setDeletingReport]   = useState(null) // report id being deleted

  // Add manager modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm]   = useState({ firstName: '', lastName: '', email: '', password: 'Arb2024!', emailManual: false })
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState('')

  // Delete manager confirm
  const [deleteConfirm, setDeleteConfirm] = useState(null) // manager id
  const [deleting, setDeleting] = useState(false)

  // Sheet binding
  const [sheetEditing, setSheetEditing] = useState(false)
  const [sheetUrlInput, setSheetUrlInput] = useState('')
  const [sheetSaving, setSheetSaving] = useState(false)
  useEffect(() => { setSheetEditing(false); setSheetUrlInput('') }, [selectedManager?.id])

  // Telegram tab state
  const [tgAccounts, setTgAccounts]       = useState([])
  const [tgLoading, setTgLoading]         = useState(false)
  const [tgCodeLoading, setTgCodeLoading] = useState({})
  const [tgCode, setTgCode]               = useState(null)
  const [tgAssigning, setTgAssigning]     = useState({})

  // IP Link tab state
  const [showIpModal, setShowIpModal] = useState(false)
  const [ipForm, setIpForm] = useState({ fullName: '', inn: '', phone: '', email: '', city: '' })
  const [ipSubmitting, setIpSubmitting] = useState(false)
  const [ipError, setIpError] = useState(null)
  const [ipResult, setIpResult] = useState(null)
  const [ipHistory, setIpHistory] = useState([])
  const [ipHistoryLoading, setIpHistoryLoading] = useState(false)
  const [copiedIpLink, setCopiedIpLink] = useState(null)

  // Contacts tab state
  const [accountsCount, setAccountsCount]           = useState(1)
  const [distributedContacts, setDistributedContacts] = useState(null)
  const [distributing, setDistributing]             = useState(false)
  const [distributions, setDistributions]           = useState([])
  const [cooldownUntil, setCooldownUntil]           = useState(null)
  const [cooldownLeft, setCooldownLeft]             = useState(null)
  const [copiedIdx, setCopiedIdx]                   = useState(null)
  const [contactsError, setContactsError]           = useState(null)
  const [contactsLoading, setContactsLoading]       = useState(false)
  const [expandedDistId, setExpandedDistId]         = useState(null)
  const [tgAssignSelect, setTgAssignSelect] = useState({})

  // Bell
  const [showBell, setShowBell] = useState(false)
  const bellRef = useRef(null)

  // Sheets ЦД data
  const [sheetsData, setSheetsData] = useState({})
  const [sheetsLoading, setSheetsLoading] = useState(false)

  const router = useRouter()

  useEffect(() => { init() }, [])

  // Fetch Google Sheets ЦД data when daily tab is active
  useEffect(() => {
    if (activeTab !== 'daily' || managers.length === 0) return
    const allMembers = [profile, ...managers, ...deletedMembers].filter(Boolean)
    const namesWithSheets = allMembers.filter(m => m.sheet_id || MANAGER_SHEETS[m.name]).map(m => m.name)
    if (namesWithSheets.length === 0) { setSheetsData({}); return }
    setSheetsLoading(true)
    fetch(`/api/sheets?names=${encodeURIComponent(namesWithSheets.join(','))}&dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then(r => r.json())
      .then(data => setSheetsData(data))
      .catch(() => setSheetsData({}))
      .finally(() => setSheetsLoading(false))
  }, [activeTab, dateFrom, dateTo, managers, deletedMembers, profile])
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

    await Promise.all([loadMyReports(user.id), loadTeamData(p.team), loadTgAccountsInit()])
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

  const loadMyReports = async (userId) => {
    const { data } = await supabase.from('reports').select('*').eq('manager_id', userId).order('date', { ascending: false })
    setMyReports(data || [])
  }

  const loadTeamData = async (team) => {
    const [{ data: mgrs }, { data: deleted }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'manager').eq('team', team),
      supabase.from('profiles').select('*').eq('role', 'deleted').eq('team', team),
    ])
    const list = mgrs || []
    const deletedList = deleted || []
    setManagers(list)
    setDeletedMembers(deletedList)

    const allIds = [...list, ...deletedList].map(m => m.id)
    if (allIds.length > 0) {
      const { data: reps } = await supabase.from('reports').select('*').in('manager_id', allIds).order('date', { ascending: false })
      setTeamReports(reps || [])
    } else {
      setTeamReports([])
    }
  }

  // ── Contacts: load history ──
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

  useEffect(() => {
    if (activeTab === 'contacts' && user) loadContactHistory()
  }, [activeTab, user, loadContactHistory])

  // ── Contacts: cooldown timer ──
  useEffect(() => {
    if (!cooldownUntil) { setCooldownLeft(null); return }
    const updateTimer = () => {
      const diff = cooldownUntil.getTime() - Date.now()
      if (diff <= 0) { setCooldownUntil(null); setCooldownLeft(null) }
      else setCooldownLeft(diff)
    }
    updateTimer()
    const interval = setInterval(updateTimer, 30000)
    return () => clearInterval(interval)
  }, [cooldownUntil])

  // ── Contacts: request ──
  const handleRequestContacts = async () => {
    setDistributing(true)
    setContactsError(null)
    setDistributedContacts(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ accountsCount }),
      })
      const data = await res.json()
      if (!res.ok) {
        setContactsError(data.error || 'Ошибка')
        if (data.nextAvailableAt) setCooldownUntil(new Date(data.nextAvailableAt))
      } else {
        setDistributedContacts(data.contacts)
        setCooldownUntil(new Date(new Date(data.distributedAt).getTime() + 12 * 60 * 60 * 1000))
        await loadContactHistory()
      }
    } catch (err) {
      setContactsError('Ошибка сети. Попробуйте ещё раз.')
    }
    setDistributing(false)
  }

  // ── Contacts: copy ──
  const handleCopyContacts = async (contacts, idx) => {
    try {
      await navigator.clipboard.writeText(contacts.join('\n'))
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = contacts.join('\n')
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    }
  }

  // ── IP Link: load history ──
  const loadIpHistory = useCallback(async () => {
    if (!user) return
    setIpHistoryLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/ip-link?scope=team', {
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

  // ── Personal report submit ──────────────────────────────────────────────────
  const handleSubmitReport = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    const teamType = TEAMS.find(t => t.id === profile?.team)?.type || 'standard'
    const record = { manager_id: user.id, date: reportForm.date }
    if (teamType === 'karina') {
      record.ordered_cards = parseInt(reportForm.ordered_cards) || 0
      record.unsubscribed = parseInt(reportForm.unsubscribed) || 0
      record.replied      = parseInt(reportForm.replied) || 0
    } else if (teamType === 'nikita') {
      record.ordered_ip = parseInt(reportForm.ordered_ip) || 0
      record.people_wrote = parseInt(reportForm.people_wrote) || 0
    } else {
      record.ordered_ip = parseInt(reportForm.ordered_ip) || 0
      record.unsubscribed = parseInt(reportForm.unsubscribed) || 0
      record.replied      = parseInt(reportForm.replied) || 0
    }
    const { error } = await supabase.from('reports').insert([record])
    if (!error) {
      setShowReportForm(false)
      setReportForm({ date: new Date().toISOString().split('T')[0], unsubscribed: '', replied: '', ordered_ip: '', ordered_cards: '', people_wrote: '' })
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
      setAddForm({ firstName: '', lastName: '', email: '', password: 'Arb2024!', emailManual: false })
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
  const isKarina  = teamInfo?.type === 'karina'
  const myWeekValue = isKarina
    ? myReports.filter(r => { const d = new Date(r.date); const now = new Date(); now.setHours(23,59,59,999); const start = new Date(now); start.setDate(start.getDate()-7); start.setHours(0,0,0,0); return d >= start && d <= now }).reduce((s, r) => s + (r.ordered_cards || 0), 0)
    : getIPLast7Days(myReports)
  const myZone    = getPersonalZone(myWeekValue, teamInfo?.type)

  const mgr7Reps  = (id) => teamReports.filter(r => r.manager_id === id)
  const redManagers = isKarina ? [] : managers.filter(m => isRedFor14Days(mgr7Reps(m.id), m.created_at))

  // Missing report notifications
  const { missing: missingAlerts, streaks: streakAlerts } = getMissingReportAlerts(managers, teamReports)
  const totalNotifications = redManagers.length + missingAlerts.length + streakAlerts.length

  const modalReports  = selectedManager ? teamReports.filter(r => r.manager_id === selectedManager.id) : []
  const modalIsNikita = TEAMS.find(t => t.id === selectedManager?.team)?.type === 'nikita'
  const modalIsKarina = TEAMS.find(t => t.id === selectedManager?.team)?.type === 'karina'

  const hasContactsAccess = CONTACT_TEAMS.includes(profile?.team)

  const TABS = [
    { id: 'analytics', label: 'Аналитика команды' },
    { id: 'daily',     label: 'Дневной отчёт' },
    { id: 'salary',    label: 'Расчёт ЗП' },
    { id: 'telegram',  label: 'Аккаунты Телеграмм' },
    ...(hasContactsAccess ? [{ id: 'contacts', label: 'Выдача номеров' }] : []),
    { id: 'ip-link', label: 'Ссылка ИП' },
    { id: 'ip-application', label: 'Заявка ИП' },
  ]

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Header ── */}
      <header style={{ backgroundColor: '#111118', borderBottom: '1px solid #1f1f2e' }} className="px-4 sm:px-6 py-3 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0">
          <div className="flex items-center justify-between sm:justify-start gap-3 sm:gap-8">
            <span className="text-base font-bold tracking-tight">Arb Stats</span>
            <div className="flex items-center gap-2 sm:hidden">
              <div className="relative" ref={bellRef}>
                <button
                  onClick={() => setShowBell(v => !v)}
                  className="relative p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition"
                >
                  <BellIcon />
                  {totalNotifications > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                      {totalNotifications}
                    </span>
                  )}
                </button>

                {showBell && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowBell(false)} />
                    <div style={{ backgroundColor: '#13131f', border: '1px solid #2a2a3e' }}
                      className="absolute right-0 top-12 rounded-2xl p-4 w-64 z-50 shadow-2xl"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-gray-200">Уведомления</h3>
                        <button onClick={() => setShowBell(false)} className="text-gray-500 hover:text-white transition"><CloseIcon /></button>
                      </div>
                      {totalNotifications === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-4">Нет уведомлений</p>
                      ) : (
                        <div className="space-y-2 max-h-80 overflow-y-auto">
                          {streakAlerts.map(m => (
                            <div key={`streak-${m.id}`}
                              className="bg-orange-950/40 border border-orange-700 rounded-xl p-3 cursor-pointer hover:bg-orange-950/60 transition"
                              onClick={() => { setSelectedManager(managers.find(x => x.id === m.id)); setShowBell(false) }}
                            >
                              <p className="text-orange-300 text-sm font-semibold">{m.name}</p>
                              <p className="text-gray-500 text-xs mt-0.5">Не сдавал отчёт {m.days} дн. подряд</p>
                            </div>
                          ))}
                          {missingAlerts.filter(m => !streakAlerts.find(s => s.id === m.id)).map(m => (
                            <div key={`missing-${m.id}`}
                              className="bg-yellow-950/40 border border-yellow-700 rounded-xl p-3 cursor-pointer hover:bg-yellow-950/60 transition"
                              onClick={() => { setSelectedManager(managers.find(x => x.id === m.id)); setShowBell(false) }}
                            >
                              <p className="text-yellow-300 text-sm font-semibold">{m.name}</p>
                              <p className="text-gray-500 text-xs mt-0.5">Не сдал отчёт за {m.dateFormatted}</p>
                            </div>
                          ))}
                          {redManagers.map(m => (
                            <div key={`red-${m.id}`}
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
              {user && ADMIN_EMAILS.includes(user.email) && (
                <button onClick={() => router.push('/admin')} className="text-gray-400 hover:text-white text-xs transition">Админ</button>
              )}
              <button onClick={handleLogout} className="text-gray-500 hover:text-white text-sm transition">Выйти</button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto pb-1 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
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
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                    {redManagers.length}
                  </span>
                )}
              </button>

              {showBell && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowBell(false)} />
                  <div style={{ backgroundColor: '#13131f', border: '1px solid #2a2a3e' }}
                    className="absolute right-0 top-12 rounded-2xl p-4 w-64 sm:w-72 z-50 shadow-2xl"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-200">Уведомления</h3>
                      <button onClick={() => setShowBell(false)} className="text-gray-500 hover:text-white transition"><CloseIcon /></button>
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
                            <p className="text-gray-500 text-xs mt-0.5">Не сдавал отчёт {m.days} дн. подряд</p>
                          </div>
                        ))}
                        {missingAlerts.filter(m => !streakAlerts.find(s => s.id === m.id)).map(m => (
                          <div
                            key={`missing-${m.id}`}
                            className="bg-yellow-950/40 border border-yellow-700 rounded-xl p-3 cursor-pointer hover:bg-yellow-950/60 transition"
                            onClick={() => { setSelectedManager(managers.find(x => x.id === m.id)); setShowBell(false) }}
                          >
                            <p className="text-yellow-300 text-sm font-semibold">{m.name}</p>
                            <p className="text-gray-500 text-xs mt-0.5">Не сдал отчёт за {m.dateFormatted}</p>
                          </div>
                        ))}
                        {redManagers.map(m => (
                          <div
                            key={`red-${m.id}`}
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

            {user && ADMIN_EMAILS.includes(user.email) && (
              <button
                onClick={() => router.push('/admin')}
                className="text-gray-400 hover:text-white text-sm transition px-3 py-1.5 rounded-lg hover:bg-white/5"
              >
                Админ
              </button>
            )}
            <span className="w-px h-5 bg-gray-800" />
            <span className="text-gray-500 text-sm">{profile?.name}</span>
            <button onClick={handleLogout} className="text-gray-500 hover:text-white text-sm transition">Выйти</button>
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

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
                  <p className={`text-2xl font-bold ${myZone.text}`}>{myWeekValue} <span className="text-sm font-normal">{isKarina ? 'карт' : 'ИП'}</span></p>
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-gray-400 text-xs mb-1.5 block">Дата</label>
                        <input type="date" value={reportForm.date} onChange={e => setReportForm({ ...reportForm, date: e.target.value })}
                          className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" required />
                      </div>
                      {!isNikita && !isKarina && (
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
                      {isKarina && (
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
                          <div>
                            <label className="text-gray-400 text-xs mb-1.5 block">Заказано карт</label>
                            <input type="number" min="0" value={reportForm.ordered_cards} onChange={e => setReportForm({ ...reportForm, ordered_cards: e.target.value })}
                              placeholder="0" required className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
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
                      {!isKarina && (
                      <div>
                        <label className="text-gray-400 text-xs mb-1.5 block">Заказали ИП</label>
                        <input type="number" min="0" value={reportForm.ordered_ip} onChange={e => setReportForm({ ...reportForm, ordered_ip: e.target.value })}
                          placeholder="0" required className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm" />
                      </div>
                      )}
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
              <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl overflow-hidden overflow-x-auto">
                <table className="w-full min-w-[480px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                      <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Дата</th>
                      {!isNikita && (
                        <>
                          <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Отписанные</th>
                          <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Ответившие</th>
                        </>
                      )}
                      {isNikita && <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Написало людей</th>}
                      {isKarina ? (
                        <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказано карт</th>
                      ) : (
                        <th className="text-left px-3 sm:px-5 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Заказали ИП</th>
                      )}
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {myReports.length === 0 ? (
                      <tr><td colSpan={isNikita ? 4 : 5} className="text-center py-12 text-gray-600 text-sm">Нет данных — добавьте первый отчёт</td></tr>
                    ) : myReports.map(r => (
                      <tr key={r.id} style={{ borderTop: '1px solid #1a1a28' }} className="hover:bg-white/[0.02] group">
                        <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{new Date(r.date).toLocaleDateString('ru-RU')}</td>
                        {!isNikita && (
                          <>
                            <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{r.unsubscribed ?? '—'}</td>
                            <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{r.replied ?? '—'}</td>
                          </>
                        )}
                        {isNikita && <td className="px-3 sm:px-5 py-3 text-sm text-gray-300">{r.people_wrote ?? '—'}</td>}
                        {isKarina ? (
                          <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-purple-400">{r.ordered_cards ?? '—'}</td>
                        ) : (
                          <td className="px-3 sm:px-5 py-3 text-sm font-semibold text-blue-400">{r.ordered_ip ?? '—'}</td>
                        )}
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
                    const value7  = isKarina
                      ? mRep.filter(r => { const d = new Date(r.date); const now = new Date(); now.setHours(23,59,59,999); const start = new Date(now); start.setDate(start.getDate()-7); start.setHours(0,0,0,0); return d >= start && d <= now }).reduce((s, r) => s + (r.ordered_cards || 0), 0)
                      : getIPLast7Days(mRep)
                    const zKey    = getZoneKey(value7, teamInfo?.type)
                    const z       = ZONE[zKey]
                    const alert14 = !isKarina && isRedFor14Days(mRep, manager.created_at)
                    const isDeletePending = deleteConfirm === manager.id

                    return (
                      <div
                        key={manager.id}
                        className={`border rounded-2xl p-4 transition-all ${z.card} ${!isDeletePending ? 'cursor-pointer hover:scale-[1.02]' : ''}`}
                        onClick={() => !isDeletePending && setSelectedManager(manager)}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${(manager.sheet_id || MANAGER_SHEETS[manager.name]) ? 'bg-green-500' : 'bg-gray-600'}`}
                              title={(manager.sheet_id || MANAGER_SHEETS[manager.name]) ? 'Таблица привязана' : 'Таблица не привязана'} />
                            <span className="font-medium text-white text-sm leading-tight truncate">{manager.name}</span>
                          </div>
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
                              <span className={`text-2xl font-bold ${z.text}`}>{value7}</span>
                              <span className="text-gray-500 text-xs ml-1">{isKarina ? 'карт' : 'ИП'} / 7 дн</span>
                            </div>
                            <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-medium ${z.badge}`}>{z.label}</span>
                            {(() => {
                              const mName = normName(manager.name)
                              const accs = tgAccounts.filter(a => normName(a.assignedTo) === mName)
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
          const dayReports = allReports.filter(r => r.date >= dateFrom && r.date <= dateTo)

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

          // Include deleted members' reports in totals
          const deletedTotals = deletedMembers.reduce((acc, member) => {
            const memberReports = dayReports.filter(r => r.manager_id === member.id)
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
            <div className="space-y-6">
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
              <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-200">Сводка за период</h2>
                  <span className="text-gray-600 text-xs">
                    {rows.filter(r => r.report).length} из {rows.length} сдали отчёт
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  <div>
                    <p className="text-gray-500 text-xs mb-1">Отписанные</p>
                    <p className="text-xl font-bold text-gray-200">{totals.unsubscribed}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs mb-1">Ответившие</p>
                    <p className="text-xl font-bold text-gray-200">{totals.replied}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs mb-1">Написало людей</p>
                    <p className="text-xl font-bold text-gray-200">{totals.people_wrote}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs mb-1">{isKarina ? 'Заказано карт' : 'Заказали ИП'}</p>
                    <p className={`text-xl font-bold ${isKarina ? 'text-purple-400' : 'text-blue-400'}`}>{isKarina ? totals.ordered_cards : totals.ordered_ip}</p>
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
                </div>
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
                      </tr>
                    </thead>
                    <tbody>
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
                            {rows.reduce((s, { member }) => s + (sheetsData[member.name]?.ip || 0), 0) + deletedMembers.reduce((s, m) => s + (sheetsData[m.name]?.ip || 0), 0)}
                          </td>
                          <td className="px-3 sm:px-5 py-3 text-sm font-bold text-purple-400">
                            {rows.reduce((s, { member }) => s + (sheetsData[member.name]?.debit || 0), 0) + deletedMembers.reduce((s, m) => s + (sheetsData[m.name]?.debit || 0), 0)}
                          </td>
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

        {activeTab === 'telegram' && (() => {
          const loadTgAccounts = async () => {
            setTgLoading(true)
            try {
              const { data: { session } } = await supabase.auth.getSession()
              const res = await fetch('/api/telegram-accounts', {
                headers: { Authorization: `Bearer ${session.access_token}` },
              })
              const data = await res.json()
              // Filter: team accounts + unassigned (free) accounts
              const teamNames = new Set(managers.map(m => normName(m.name)).concat(profile?.name ? [normName(profile.name)] : []))
              const myAccounts = (data.accounts || []).filter(a => !a.assignedTo || teamNames.has(normName(a.assignedTo)))
              setTgAccounts(myAccounts)
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

          const teamPeople = [profile, ...managers].filter(Boolean).sort((a, b) => (a.name || '').localeCompare(b.name || ''))

          if (tgAccounts.length === 0 && !tgLoading) {
            loadTgAccounts()
          }

          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-200">Аккаунты команды</h2>
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

              {tgLoading && tgAccounts.length === 0 ? (
                <div className="text-center py-16 text-gray-600">Загрузка...</div>
              ) : tgAccounts.length === 0 ? (
                <div className="text-center py-16 text-gray-600">Нет аккаунтов</div>
              ) : (
                <div style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }} className="rounded-2xl overflow-hidden overflow-x-auto">
                  <table className="w-full min-w-[650px]">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1f1f2e' }}>
                        <th className="text-left px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Телефон</th>
                        <th className="text-left px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">ТГ</th>
                        <th className="text-left px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Кому выдан</th>
                        <th className="text-left px-3 sm:px-4 py-3 text-gray-500 text-xs font-medium uppercase tracking-wider">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tgAccounts.map(acc => (
                        <tr key={acc.rowIndex} style={{ borderTop: '1px solid #1a1a28' }} className="hover:bg-white/[0.02] transition">
                          <td className="px-3 sm:px-4 py-3 text-sm text-gray-300 font-mono">{acc.phone}</td>
                          <td className="px-3 sm:px-4 py-3 text-sm text-blue-400">{acc.tgLink}</td>
                          <td className="px-3 sm:px-4 py-3 text-sm">
                            {tgAssignSelect[acc.rowIndex] !== undefined ? (
                              <div className="flex items-center gap-1">
                                <select
                                  value={tgAssignSelect[acc.rowIndex]}
                                  onChange={e => setTgAssignSelect(prev => ({ ...prev, [acc.rowIndex]: e.target.value }))}
                                  className="bg-black/30 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                                >
                                  <option value="">— Свободен —</option>
                                  {teamPeople.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                                </select>
                                <button onClick={() => assignAccount(acc.rowIndex, tgAssignSelect[acc.rowIndex])}
                                  disabled={tgAssigning[acc.rowIndex]}
                                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-2 py-1 rounded text-xs transition">
                                  {tgAssigning[acc.rowIndex] ? '...' : 'OK'}
                                </button>
                                <button onClick={() => setTgAssignSelect(prev => { const n = { ...prev }; delete n[acc.rowIndex]; return n })}
                                  className="text-gray-600 hover:text-gray-400 text-xs transition">Отмена</button>
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
                              {acc.assignedTo && (
                                <button onClick={() => fetchCode(acc)} disabled={tgCodeLoading[acc.rowIndex]}
                                  className="bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 disabled:opacity-50 px-2.5 py-1 rounded-lg text-xs font-medium transition">
                                  {tgCodeLoading[acc.rowIndex] ? '...' : 'Код'}
                                </button>
                              )}
                              <button onClick={() => setTgAssignSelect(prev => ({ ...prev, [acc.rowIndex]: acc.assignedTo || '' }))}
                                className="bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded-lg text-xs transition">
                                {acc.assignedTo ? 'Изменить' : 'Назначить'}
                              </button>
                              {acc.assignedTo && (
                                <button onClick={() => assignAccount(acc.rowIndex, '')}
                                  disabled={tgAssigning[acc.rowIndex]}
                                  className="text-red-400/70 hover:text-red-400 text-xs transition">Освободить</button>
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
                Всего: {tgAccounts.length} · Выдано: {tgAccounts.filter(a => a.assignedTo).length} · Свободно: {tgAccounts.filter(a => !a.assignedTo).length}
              </div>
            </div>
          )
        })()}

        {/* ─── Contacts tab ─── */}
        {activeTab === 'contacts' && hasContactsAccess && (
          <>
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
                        <span className="text-sm font-semibold text-gray-300">Аккаунт {idx + 1}</span>
                        <button
                          onClick={() => handleCopyContacts(group, idx)}
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

            <div>
              <h3 className="text-base font-semibold text-gray-200 mb-3">История выдач</h3>
              <div
                style={{ backgroundColor: '#13131f', border: '1px solid #1f1f2e' }}
                className="rounded-2xl overflow-hidden"
              >
                {contactsLoading ? (
                  <div className="text-center py-12 text-gray-600 text-sm">Загрузка...</div>
                ) : distributions.length === 0 ? (
                  <div className="text-center py-12 text-gray-600 text-sm">Вы ещё не получали контакты</div>
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
                                              onClick={(e) => { e.stopPropagation(); handleCopyContacts(group, `hist-${dist.id}-${gIdx}`) }}
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

        {/* ─── Заявка ИП tab ─── */}
        {activeTab === 'ip-application' && (
          <IpApplicationTab profile={profile} scope="team" />
        )}

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
                <div className="text-center py-12 text-gray-600 text-sm">Нет заявок — создайте первую</div>
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

      {/* ── Manager Detail Modal ── */}
      {selectedManager && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedManager(null)}>
          <div style={{ backgroundColor: '#13131f', border: '1px solid #2a2a3e' }}
            className="rounded-2xl w-full max-w-2xl max-h-[90vh] sm:max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div style={{ borderBottom: '1px solid #1f1f2e' }} className="px-6 py-5 flex justify-between items-start">
              <div>
                <h2 className="text-lg font-bold">{selectedManager.name}</h2>
                <p className="text-gray-500 text-sm mt-0.5">{modalReports.length} отчётов</p>
              </div>
              <button onClick={() => setSelectedManager(null)} className="text-gray-500 hover:text-white p-1 rounded-lg hover:bg-white/5 transition"><CloseIcon /></button>
            </div>

            {/* Credentials */}
            <div className="px-6 pt-4 pb-2">
              <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-gray-500 text-xs">Логин</p>
                    <p className="text-gray-300 text-sm truncate">{selectedManager.email}</p>
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(selectedManager.email); }}
                    className="text-gray-600 hover:text-white text-xs px-2.5 py-1 rounded-lg hover:bg-white/5 transition flex-shrink-0 ml-2"
                  >
                    Копировать
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-xs">Пароль</p>
                    <p className="text-gray-300 text-sm">Arb2024!</p>
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText('Arb2024!'); }}
                    className="text-gray-600 hover:text-white text-xs px-2.5 py-1 rounded-lg hover:bg-white/5 transition flex-shrink-0 ml-2"
                  >
                    Копировать
                  </button>
                </div>
              </div>
            </div>

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

            {/* Zone summary */}
            {(() => {
              const field = modalIsKarina ? 'ordered_cards' : 'ordered_ip'
              const unitLabel = modalIsKarina ? 'карт' : 'ИП'
              const modalTeamType = TEAMS.find(t => t.id === selectedManager?.team)?.type
              const val7  = modalIsKarina
                ? modalReports.filter(r => { const d = new Date(r.date); const now = new Date(); now.setHours(23,59,59,999); const start = new Date(now); start.setDate(start.getDate()-7); start.setHours(0,0,0,0); return d >= start && d <= now }).reduce((s, r) => s + (r[field] || 0), 0)
                : getIPForPeriod(modalReports, 0, 7)
              const val14 = modalIsKarina
                ? modalReports.filter(r => { const d = new Date(r.date); const now = new Date(); now.setHours(23,59,59,999); const end = new Date(now); end.setDate(end.getDate()-7); const start = new Date(now); start.setDate(start.getDate()-14); start.setHours(0,0,0,0); return d >= start && d <= end }).reduce((s, r) => s + (r[field] || 0), 0)
                : getIPForPeriod(modalReports, 7, 14)
              return (
                <div className="px-6 pt-4 pb-2 flex gap-3">
                  {[{ val: val7, label: 'Последние 7 дней' }, { val: val14, label: 'Предыдущие 7 дней' }].map(({ val, label }) => {
                    const z = ZONE[getZoneKey(val, modalTeamType)]
                    return (
                      <div key={label} className={`flex-1 border rounded-xl px-4 py-3 ${z.card}`}>
                        <p className="text-gray-500 text-xs mb-1">{label}</p>
                        <p className={`text-xl font-bold ${z.text}`}>{val} {unitLabel}</p>
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
                      {modalIsKarina ? (
                        <td className="py-2.5 text-sm font-semibold text-purple-400">{r.ordered_cards ?? '—'}</td>
                      ) : (
                        <td className="py-2.5 text-sm font-semibold text-blue-400">{r.ordered_ip ?? '—'}</td>
                      )}
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

            {/* Delete manager button */}
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
                    className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm transition"
                  >
                    Отмена
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirm(selectedManager.id)}
                  className="text-gray-600 hover:text-red-400 text-sm flex items-center gap-1.5 transition"
                >
                  <TrashIcon /> Удалить менеджера
                </button>
              )}
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
                    onChange={e => {
                      const firstName = e.target.value
                      const upd = { ...addForm, firstName }
                      if (!addForm.emailManual) upd.email = generateEmail(firstName, addForm.lastName)
                      setAddForm(upd)
                    }}
                    placeholder="Иван"
                    className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1.5 block">Фамилия</label>
                  <input
                    type="text" value={addForm.lastName} required
                    onChange={e => {
                      const lastName = e.target.value
                      const upd = { ...addForm, lastName }
                      if (!addForm.emailManual) upd.email = generateEmail(addForm.firstName, lastName)
                      setAddForm(upd)
                    }}
                    placeholder="Петров"
                    className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-gray-400 text-xs mb-1.5 block">
                  Email
                  {!addForm.emailManual && addForm.email && (
                    <span className="text-gray-600 ml-2">· сгенерирован автоматически</span>
                  )}
                </label>
                <input
                  type="email" value={addForm.email} required
                  onChange={e => setAddForm({ ...addForm, email: e.target.value, emailManual: true })}
                  placeholder="ivan.petrov@arbteam.ru"
                  className={`w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg border focus:outline-none focus:border-blue-500 text-sm ${
                    !addForm.emailManual && addForm.email ? 'border-blue-800/50' : 'border-gray-700'
                  }`}
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
