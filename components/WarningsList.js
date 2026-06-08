'use client'
import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../lib/supabase'

// Секция в модалке менеджера: история предупреждений + monthCount.
// Кнопка снятия рядом с каждым — только если props.canDelete (для admin).
// При первой загрузке вызывает onLoaded(monthCount) — родительский счётчик
// можно обновить без отдельного запроса.
export default function WarningsList({ managerId, canDelete, onLoaded }) {
  const [warnings, setWarnings] = useState([])
  const [monthCount, setMonthCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/manager-warnings?manager_id=${managerId}`)
      const data = await res.json()
      if (res.ok) {
        setWarnings(data.warnings || [])
        setMonthCount(data.monthCount || 0)
        onLoaded?.(data.monthCount || 0)
      }
    } catch (err) {
      console.error('load warnings:', err)
    } finally {
      setLoading(false)
    }
  }, [managerId, onLoaded])

  useEffect(() => { load() }, [load])

  async function remove(id) {
    setDeletingId(id)
    try {
      const res = await authFetch(`/api/manager-warnings/${id}`, { method: 'DELETE' })
      if (res.ok) await load()
    } catch (err) {
      console.error('delete warning:', err)
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <p className="text-gray-600 text-xs">Загрузка предупреждений...</p>

  return (
    <div>
      <p className="text-gray-400 text-xs mb-2">
        Предупреждений за текущий месяц:{' '}
        <span className={monthCount >= 3 ? 'text-red-400 font-semibold' : monthCount > 0 ? 'text-yellow-300' : 'text-gray-500'}>
          {monthCount}/3
        </span>
        {monthCount >= 3 && <span className="text-red-400 ml-2">⚠ нужно увольнять</span>}
      </p>

      {warnings.length === 0 ? (
        <p className="text-gray-600 text-xs">Предупреждений пока нет.</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {warnings.map(w => (
            <li key={w.id} className="flex items-center gap-2 text-gray-400">
              <span>•</span>
              <span>
                {new Date(w.issued_at).toLocaleString('ru-RU', {
                  day: '2-digit', month: '2-digit', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                  timeZone: 'Europe/Moscow',
                })}
              </span>
              <span className="text-gray-600">— выдал {w.issued_by_name}</span>
              {canDelete && (
                <button
                  onClick={() => remove(w.id)}
                  disabled={deletingId === w.id}
                  className="ml-auto text-gray-600 hover:text-red-400 text-[10px] underline disabled:opacity-50"
                >
                  {deletingId === w.id ? '...' : 'снять'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
