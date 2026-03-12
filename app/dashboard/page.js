'use client'
export const dynamic = 'force-dynamic'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [stats, setStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    ad_spend: '',
    revenue: '',
    leads: '',
    conversions: '',
    traffic_source: '',
    notes: ''
  })
  const router = useRouter()

  useEffect(() => {
    checkUser()
  }, [])

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    setUser(user)
    loadStats(user.id)
  }

  const loadStats = async (userId) => {
    const { data } = await supabase
      .from('stats')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
    setStats(data || [])
    setLoading(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const profit = parseFloat(form.revenue) - parseFloat(form.ad_spend)
    const { error } = await supabase.from('stats').insert([{
      user_id: user.id,
      date: form.date,
      ad_spend: parseFloat(form.ad_spend),
      revenue: parseFloat(form.revenue),
      profit: profit,
      leads: parseInt(form.leads),
      conversions: parseInt(form.conversions),
      traffic_source: form.traffic_source,
      notes: form.notes
    }])
    if (!error) {
      setShowForm(false)
      loadStats(user.id)
      setForm({ date: new Date().toISOString().split('T')[0], ad_spend: '', revenue: '', leads: '', conversions: '', traffic_source: '', notes: '' })
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const totalProfit = stats.reduce((sum, s) => sum + (s.profit || 0), 0)
  const totalSpend = stats.reduce((sum, s) => sum + (s.ad_spend || 0), 0)
  const totalRevenue = stats.reduce((sum, s) => sum + (s.revenue || 0), 0)

  if (loading) return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Загрузка...</div>

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold">Моя статистика</h1>
          <div className="flex gap-3">
            <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-semibold transition">
              + Добавить
            </button>
            <button onClick={handleLogout} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition">
              Выйти
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-800 p-5 rounded-xl">
            <p className="text-gray-400 text-sm">Общий расход</p>
            <p className="text-2xl font-bold text-red-400">${totalSpend.toFixed(2)}</p>
          </div>
          <div className="bg-gray-800 p-5 rounded-xl">
            <p className="text-gray-400 text-sm">Общий доход</p>
            <p className="text-2xl font-bold text-green-400">${totalRevenue.toFixed(2)}</p>
          </div>
          <div className="bg-gray-800 p-5 rounded-xl">
            <p className="text-gray-400 text-sm">Общий профит</p>
            <p className={`text-2xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>${totalProfit.toFixed(2)}</p>
          </div>
        </div>

        {showForm && (
          <div className="bg-gray-800 p-6 rounded-xl mb-8">
            <h2 className="text-lg font-semibold mb-4">Добавить статистику</h2>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Дата</label>
                <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg" required />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Источник трафика</label>
                <input type="text" value={form.traffic_source} onChange={e => setForm({...form, traffic_source: e.target.value})} className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg" placeholder="Facebook, Google..." />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Расход на рекламу ($)</label>
                <input type="number" value={form.ad_spend} onChange={e => setForm({...form, ad_spend: e.target.value})} className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg" required />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Доход ($)</label>
                <input type="number" value={form.revenue} onChange={e => setForm({...form, revenue: e.target.value})} className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg" required />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Лиды</label>
                <input type="number" value={form.leads} onChange={e => setForm({...form, leads: e.target.value})} className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg" />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Конверсии</label>
                <input type="number" value={form.conversions} onChange={e => setForm({...form, conversions: e.target.value})} className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg" />
              </div>
              <div className="col-span-2">
                <label className="text-gray-400 text-sm mb-1 block">Заметки</label>
                <input type="text" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg" placeholder="Любые заметки..." />
              </div>
              <div className="col-span-2 flex gap-3">
                <button type="submit" className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg font-semibold transition">Сохранить</button>
                <button type="button" onClick={() => setShowForm(false)} className="bg-gray-700 hover:bg-gray-600 px-6 py-2 rounded-lg transition">Отмена</button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="text-left px-4 py-3 text-gray-400 text-sm">Дата</th>
                <th className="text-left px-4 py-3 text-gray-400 text-sm">Источник</th>
                <th className="text-left px-4 py-3 text-gray-400 text-sm">Расход</th>
                <th className="text-left px-4 py-3 text-gray-400 text-sm">Доход</th>
                <th className="text-left px-4 py-3 text-gray-400 text-sm">Профит</th>
                <th className="text-left px-4 py-3 text-gray-400 text-sm">Лиды</th>
                <th className="text-left px-4 py-3 text-gray-400 text-sm">Конверсии</th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr><td colSpan="7" className="text-center py-8 text-gray-500">Нет данных. Добавьте первую запись!</td></tr>
              ) : (
                stats.map(s => (
                  <tr key={s.id} className="border-t border-gray-700 hover:bg-gray-750">
                    <td className="px-4 py-3 text-sm">{s.date}</td>
                    <td className="px-4 py-3 text-sm">{s.traffic_source || '—'}</td>
                    <td className="px-4 py-3 text-sm text-red-400">${s.ad_spend}</td>
                    <td className="px-4 py-3 text-sm text-green-400">${s.revenue}</td>
                    <td className={`px-4 py-3 text-sm font-semibold ${s.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>${s.profit}</td>
                    <td className="px-4 py-3 text-sm">{s.leads}</td>
                    <td className="px-4 py-3 text-sm">{s.conversions}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}