'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

export default function AdminPage() {
  const [stats, setStats] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedManager, setSelectedManager] = useState('all')
  const router = useRouter()

  useEffect(() => {
    checkAdmin()
  }, [])

  const checkAdmin = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') { router.push('/dashboard'); return }
    loadData()
  }

  const loadData = async () => {
    const { data: statsData } = await supabase.from('stats').select('*, profiles(name, email)').order('date', { ascending: false })
    const { data: profilesData } = await supabase.from('profiles').select('*').eq('role', 'manager')
    setStats(statsData || [])
    setProfiles(profilesData || [])
    setLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const filtered = selectedManager === 'all' ? stats : stats.filter(s => s.user_id === selectedManager)
  const totalProfit = filtered.reduce((sum, s) => sum + (s.profit || 0), 0)
  const totalSpend = filtered.reduce((sum, s) => sum + (s.ad_spend || 0), 0)
  const totalRevenue = filtered.reduce((sum, s) => sum + (s.revenue || 0), 0)
  const totalLeads = filtered.reduce((sum, s) => sum + (s.leads || 0), 0)
  const totalConversions = filtered.reduce((sum, s) => sum + (s.conversions || 0), 0)

  if (loading) return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Загрузка...</div>

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold">Админ панель</h1>
            <p className="text-gray-400 text-sm mt-1">Статистика всей команды</p>
          </div>
          <button onClick={handleLogout} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition">Выйти</button>
        </div>

        <div className="flex gap-3 mb-6 flex-wrap">
          <button onClick={() => setSelectedManager('all')} className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${selectedManager === 'all' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
            Все менеджеры
          </button>
          {profiles.map(p => (
            <button key={p.id} onClick={() => setSelectedManager(p.id)} className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${selectedManager === p.id ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              {p.name || p.email}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-5 gap-4 mb-8">
          <div className="bg-gray-800 p-5 rounded-xl">
            <p className="text-gray-400 text-sm">Расход</p>
            <p className="text-xl font-bold text-red-400">${totalSpend.toFixed(2)}</p>
          </div>
          <div className="bg-gray-800 p-5 rounded-xl">
            <p className="text-gray-400 text-sm">Доход</p>
            <p className="text-xl font-bold text-green-400">${totalRevenue.toFixed(2)}</p>
          </div>
          <div className="bg-gray-800 p-5 rounded-xl">
            <p className="text-gray-400 text-sm">Профит</p>
            <p className={`text-xl font-bold ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>${totalProfit.toFixed(2)}</p>
          </div>
          <div className="bg-gray-800 p-5 rounded-xl">
            <p className="text-gray-400 text-sm">Лиды</p>
            <p className="text-xl font-bold text-blue-400">{totalLeads}</p>
          </div>
          <div className="bg-gray-800 p-5 rounded-xl">
            <p className="text-gray-400 text-sm">Конверсии</p>
            <p className="text-xl font-bold text-purple-400">{totalConversions}</p>
          </div>
        </div>

        <div className="bg-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-700">
              <tr>
                <th className="text-left px-4 py-3 text-gray-400 text-sm">Менеджер</th>
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
              {filtered.length === 0 ? (
                <tr><td colSpan="8" className="text-center py-8 text-gray-500">Нет данных</td></tr>
              ) : (
                filtered.map(s => (
                  <tr key={s.id} className="border-t border-gray-700">
                    <td className="px-4 py-3 text-sm font-semibold">{s.profiles?.name || s.profiles?.email || '—'}</td>
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