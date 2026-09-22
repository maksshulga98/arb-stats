import { NextResponse } from 'next/server'

// Кроны запускает планировщик на VPS раннера (раньше — Vercel Cron, который
// на бесплатном тарифе разрешает только раз в сутки и с разбросом ±59 мин).
// Доступ только по общему секрету: заголовок x-vercel-cron подделывается
// любым curl'ом, поэтому ему больше не доверяем. Если секрет не задан —
// закрыто для всех, а не открыто.
export function rejectUnlessCron(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
