import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const results = {}
    // Ask a few different services what our outbound IP looks like
    const services = [
      { name: 'ipify', url: 'https://api.ipify.org?format=json' },
      { name: 'ipapi', url: 'https://ipapi.co/json/' },
      { name: 'ifconfig', url: 'https://ifconfig.me/all.json' },
    ]
    for (const s of services) {
      try {
        const r = await fetch(s.url, { cache: 'no-store' })
        const j = await r.json()
        results[s.name] = j
      } catch (e) {
        results[s.name] = { error: e.message }
      }
    }
    return NextResponse.json(results)
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
