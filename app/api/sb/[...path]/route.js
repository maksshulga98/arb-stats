// Универсальный прокси Supabase через наш Vercel-домен.
// Российские провайдеры режут трафик к *.supabase.co. Vercel-домен они
// не трогают, поэтому клиентские запросы идём отсюда: браузер → vercel.app
// → наш сервер → Supabase. Этот роут принимает любой путь, любой метод,
// и пробрасывает запрос как есть, со всеми заголовками и телом.

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://agnrzveeoswkscjwxnde.supabase.co'

// Заголовки, которые нельзя пробрасывать наверх (управляющие/hop-by-hop).
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'accept-encoding',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'x-vercel-id',
  'x-vercel-forwarded-for',
  'x-vercel-deployment-url',
  'x-vercel-internal-ingress',
  'forwarded',
])

const STRIP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
])

async function proxy(request, ctx) {
  try {
    const params = await ctx.params
    const segments = params?.path || []
    const search = new URL(request.url).search
    const target = `${SUPABASE_URL}/${segments.join('/')}${search}`

    const fwdHeaders = new Headers()
    request.headers.forEach((value, key) => {
      if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
        fwdHeaders.set(key, value)
      }
    })

    const init = {
      method: request.method,
      headers: fwdHeaders,
      redirect: 'manual',
    }

    if (!['GET', 'HEAD'].includes(request.method)) {
      // Читаем тело как ArrayBuffer — supabase-js шлёт JSON / form-encoded /
      // multipart, всё подходит. Stream-проброс упростил бы код, но
      // arrayBuffer() надёжнее на Vercel runtime.
      init.body = await request.arrayBuffer()
    }

    const upstream = await fetch(target, init)

    const respHeaders = new Headers()
    upstream.headers.forEach((value, key) => {
      if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
        respHeaders.set(key, value)
      }
    })

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    })
  } catch (err) {
    console.error('sb-proxy error:', err?.message || err)
    return new Response(
      JSON.stringify({ error: 'Proxy error', message: err?.message || String(err) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

export async function GET(request, ctx) { return proxy(request, ctx) }
export async function POST(request, ctx) { return proxy(request, ctx) }
export async function PUT(request, ctx) { return proxy(request, ctx) }
export async function PATCH(request, ctx) { return proxy(request, ctx) }
export async function DELETE(request, ctx) { return proxy(request, ctx) }
export async function HEAD(request, ctx) { return proxy(request, ctx) }
export async function OPTIONS(request, ctx) { return proxy(request, ctx) }
