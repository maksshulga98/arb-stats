'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  // Префетчим бандлы целевых кабинетов пока пользователь вводит логин/пароль —
  // когда нажмёт «Войти», JS уже скачан и страница откроется мгновенно.
  useEffect(() => {
    router.prefetch('/dashboard')
    router.prefetch('/teamlead')
    router.prefetch('/admin')
  }, [router])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // Серверный прокси /api/auth/login — стучимся только в наш Vercel-домен,
      // он уже на сервере дёргает Supabase. У многих российских юзеров прямой
      // запрос к supabase.co режется провайдером, через наш домен идёт чище.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20000)

      let res
      try {
        res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.session) {
        setError(data?.error || 'Неверный email или пароль')
        setLoading(false)
        return
      }

      // Кладём полученную с сервера сессию в supabase-js, чтобы дальше все
      // остальные запросы (supabase.from(...).select() и т.д.) работали
      // с авторизацией без повторного логина.
      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      })

      // Кешируем роль в sessionStorage, чтобы целевая страница могла сразу определиться
      // с навигацией без повторного запроса профиля
      try {
        sessionStorage.setItem('arb_user_role', data.role || 'manager')
      } catch { /* ignore */ }

      if (data.role === 'admin') {
        router.push('/admin')
      } else if (data.role === 'teamlead') {
        router.push('/teamlead')
      } else {
        router.push('/dashboard')
      }
    } catch (err) {
      console.error('Login failed:', err?.name === 'AbortError' ? 'timeout 20s' : err?.message || err)
      setError('Сервер долго отвечает. Попробуйте ещё раз через несколько секунд.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white border border-slate-200 p-6 sm:p-8 rounded-2xl shadow-sm w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">Arb Stats</h1>
        <p className="text-gray-600 text-center mb-6">Войдите в свой аккаунт</p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-gray-600 text-sm mb-1 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white text-gray-900 px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30"
              placeholder="your@email.com"
              required
            />
          </div>
          <div>
            <label className="text-gray-600 text-sm mb-1 block">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white text-gray-900 px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30"
              placeholder="••••••••"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
          >
            {loading ? 'Входим...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}