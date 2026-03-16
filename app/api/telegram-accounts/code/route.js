import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

async function authenticate(request) {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const token = request.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return null
  const { data: { user } } = await anon.auth.getUser(token)
  if (!user) return null
  const { data: profile } = await admin.from('profiles').select('role, team').eq('id', user.id).single()
  return profile
}

// POST — fetch TG login code from Rambler email via IMAP
export async function POST(request) {
  try {
    const caller = await authenticate(request)
    if (!caller || !['admin', 'teamlead'].includes(caller.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { email, password } = await request.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'email and password required' }, { status: 400 })
    }

    const client = new ImapFlow({
      host: 'imap.rambler.ru',
      port: 993,
      secure: true,
      auth: { user: email, pass: password },
      logger: false,
    })

    await client.connect()

    let code = null
    let receivedAt = null

    try {
      const lock = await client.getMailboxLock('INBOX')
      try {
        // Search for Telegram messages, sorted by newest first
        const messages = await client.search({
          or: [
            { from: 'telegram' },
            { from: 'Telegram' },
            { subject: 'Telegram' },
          ],
        }, { sort: ['-date'] })

        if (messages && messages.length > 0) {
          // Get the most recent Telegram message
          const uid = Array.isArray(messages) ? messages[messages.length - 1] : messages
          const msgData = await client.fetchOne(uid, { source: true })

          if (msgData?.source) {
            const parsed = await simpleParser(msgData.source)
            const text = parsed.text || parsed.html || ''
            receivedAt = parsed.date?.toISOString() || null

            // Extract 5-digit code from message body
            const codeMatch = text.match(/\b(\d{5})\b/)
            if (codeMatch) {
              code = codeMatch[1]
            }
          }
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout()
    }

    if (!code) {
      return NextResponse.json({ error: 'Код не найден. Нет писем от Telegram или код не распознан.' }, { status: 404 })
    }

    return NextResponse.json({ code, receivedAt })
  } catch (err) {
    const msg = err.message || ''
    if (msg.includes('Authentication') || msg.includes('AUTHENTICATIONFAILED') || msg.includes('Invalid credentials')) {
      return NextResponse.json({ error: 'Ошибка авторизации почты. Проверьте email и пароль.' }, { status: 401 })
    }
    return NextResponse.json({ error: `Ошибка IMAP: ${msg}` }, { status: 500 })
  }
}
