// Тест round-robin: подряд заводим 4 заявки и проверяем что они идут
// в кабинеты по схеме A → B → A → B (или B → A → B → A в зависимости от
// текущего счётчика). Полностью повторяет логику /api/ip-link POST,
// чтобы убедиться что прод-роут будет работать так же.

process.env.RKO_PROXY_URL = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
process.env.RKO_PARTNER_EMAIL = 'ntatarincev33@gmail.com'
process.env.RKO_PARTNER_PASSWORD = 'Nick.2kkl.019'
process.env.RKO_PROXY_URL_2 = 'http://hP4AWm:cJedWrO2lf@194.32.237.145:5500'
process.env.RKO_PARTNER_EMAIL_2 = 'ms_marishka2003@mail.ru'
process.env.RKO_PARTNER_PASSWORD_2 = 'marishka_love1'

import { createClient } from '@supabase/supabase-js'
// ВАЖНО: динамический import — env-вары выше, статичный import выполнился бы
// ДО присваивания и lib/rko-accounts.js загрузилась бы с пустыми кредами.
const { loginToRkoPartner, createRkoApplication } = await import('../lib/rko-partner.js')
const { getActiveAccounts } = await import('../lib/rko-accounts.js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

function generateValidINN(prefix10) {
  const d = prefix10.split('').map(Number)
  const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const c1 = w1.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  const c2 = w2.reduce((s, w, i) => s + w * [...d, c1][i], 0) % 11 % 10
  return prefix10 + c1 + c2
}

async function pickNextAccount() {
  const accounts = getActiveAccounts()
  const { count } = await supabase
    .from('ip_applications')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'success')
    .not('rko_account', 'is', null)
  const idx = (count || 0) % accounts.length
  return { account: accounts[idx], count: count || 0 }
}

// Найдём админский профиль для приписки заявок
const { data: admins } = await supabase
  .from('profiles')
  .select('id, name, role, team')
  .eq('role', 'admin')
  .limit(1)
const admin = admins[0]

const testApps = [
  { fio: 'Сидоров Антон Петрович',     prefix: '7700111111', city: 'Москва',          phone: '+79110001111', email: 'a.sidorov.test@example.com' },
  { fio: 'Морозова Татьяна Игоревна', prefix: '7800222222', city: 'Санкт-Петербург', phone: '+79220002222', email: 't.morozova.test@example.com' },
  { fio: 'Кузнецов Илья Сергеевич',    prefix: '6600333333', city: 'Казань',          phone: '+79330003333', email: 'i.kuznetsov.test@example.com' },
  { fio: 'Дмитриева Ольга Викторовна', prefix: '5400444444', city: 'Новосибирск',     phone: '+79440004444', email: 'o.dmitrieva.test@example.com' },
]

console.log('Активных аккаунтов:', getActiveAccounts().map(a => `${a.id}=${a.label}`).join(', '))
console.log()

const results = []
for (let i = 0; i < testApps.length; i++) {
  const t = testApps[i]
  const { account, count } = await pickNextAccount()
  console.log(`━━━ Заявка #${i + 1}: count(success)=${count} → кабинет ${account.id} (${account.label})`)
  console.log(`     ${t.fio}  ИНН ${generateValidINN(t.prefix)}  ${t.city}`)

  const auth = await loginToRkoPartner(account)
  const r = await createRkoApplication(auth, {
    fullName: t.fio,
    inn: generateValidINN(t.prefix),
    phone: t.phone,
    email: t.email,
    city: t.city,
  })
  console.log(`     ✓ Order #${r.orderId}  partner_user_id=${r.raw?.user_id}  link=${r.referralLink}`)

  await supabase.from('ip_applications').insert([{
    manager_id: admin.id,
    team: admin.team || 'admin',
    full_name: t.fio,
    inn: generateValidINN(t.prefix),
    phone: t.phone,
    email: t.email,
    city: t.city,
    referral_link: r.referralLink,
    rko_order_id: String(r.orderId),
    rko_application_id: '',
    status: 'success',
    rko_account: account.id,
  }])

  results.push({ idx: i + 1, account: account.id, orderId: r.orderId, partnerId: r.raw?.user_id, link: r.referralLink })
  console.log()
}

console.log('━'.repeat(70))
console.log('РЕЗУЛЬТАТ ROUND-ROBIN')
console.log('━'.repeat(70))
console.log('Заявка | Кабинет | Order ID | Partner user_id | Реф-ссылка')
for (const r of results) {
  console.log(`  #${r.idx}    | ${r.account.padEnd(7)} | ${String(r.orderId).padEnd(8)} | ${String(r.partnerId).padEnd(15)} | ${r.link}`)
}

const accountSequence = results.map(r => r.account).join(' → ')
const isAlternating = results.every((r, i) => i === 0 || r.account !== results[i - 1].account)
console.log()
console.log(`Последовательность: ${accountSequence}`)
console.log(`Чередование без повтора подряд: ${isAlternating ? '✓ да' : '✗ НЕТ'}`)
