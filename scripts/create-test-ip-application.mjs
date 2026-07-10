// Создаёт настоящую тестовую заявку через тот же lib/rko-partner.js,
// который вызывает прод-роут /api/ip-link. Записывает в Supabase
// ip_applications, чтобы заявка появилась в истории на сайте.
//
// Запуск: node --env-file=.env.local scripts/create-test-ip-application.mjs

// Креды и прокси rko-partner — задаём прямо здесь, пока пользователь не
// прописал на Vercel. .env.local их не содержит.
process.env.RKO_PROXY_URL = process.env.RKO_PROXY_URL || 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
process.env.RKO_PARTNER_EMAIL = process.env.RKO_PARTNER_EMAIL || 'ntatarincev33@gmail.com'
process.env.RKO_PARTNER_PASSWORD = process.env.RKO_PARTNER_PASSWORD || 'Nick.2kkl.019'

import { createClient } from '@supabase/supabase-js'
import { loginToRkoPartner, createRkoApplication, fetchAllRkoOrders } from '../lib/rko-partner.js'

// Тестовые данные (реалистичные, не "Тестов Тест"). ИНН валидный.
const TEST_FIO = 'Иванов Сергей Петрович'
const TEST_INN_PREFIX = '7707083893'  // 10 цифр от случайного физлица-ИП Москвы
const TEST_PHONE = '+79171234567'
const TEST_EMAIL = 'sergey.ivanov.test@example.com'
const TEST_CITY = 'Москва'

function generateValidINN(prefix10) {
  const d = prefix10.split('').map(Number)
  const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const check1 = w1.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  const d11 = [...d, check1]
  const check2 = w2.reduce((s, w, i) => s + w * d11[i], 0) % 11 % 10
  return prefix10 + check1 + check2
}

const TEST_INN = generateValidINN(TEST_INN_PREFIX)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

// 1. Находим админский профиль (чтобы приписать заявку)
console.log('━'.repeat(70))
console.log('1. Ищем профиль админа в Supabase...')
console.log('━'.repeat(70))
const { data: admins, error: adminErr } = await supabase
  .from('profiles')
  .select('id, name, role, team')
  .eq('role', 'admin')
  .limit(1)
if (adminErr) { console.error('FAIL:', adminErr); process.exit(1) }
if (!admins || admins.length === 0) {
  console.error('Нет админов в profiles!')
  process.exit(1)
}
const admin = admins[0]
console.log(`   профиль: id=${admin.id}, name="${admin.name}", team=${admin.team || '-'}`)

// 2. Логин в rko-partner через прокси
console.log('\n' + '━'.repeat(70))
console.log('2. Логин в rko-partner.com через прокси...')
console.log('━'.repeat(70))
const t1 = Date.now()
const auth = await loginToRkoPartner()
console.log(`   ✓ залогинен (${Date.now() - t1}ms, ${auth.cookies.length} cookies)`)

// 3. Создаём заявку
console.log('\n' + '━'.repeat(70))
console.log('3. POST /api/app/orders — создаём заявку...')
console.log('━'.repeat(70))
console.log(`   ФИО:    ${TEST_FIO}`)
console.log(`   ИНН:    ${TEST_INN}`)
console.log(`   тел:    ${TEST_PHONE}`)
console.log(`   email:  ${TEST_EMAIL}`)
console.log(`   город:  ${TEST_CITY}`)

const t2 = Date.now()
const result = await createRkoApplication(auth, {
  fullName: TEST_FIO,
  inn: TEST_INN,
  phone: TEST_PHONE,
  email: TEST_EMAIL,
  city: TEST_CITY,
})
console.log(`\n   ✓ создана за ${Date.now() - t2}ms`)
console.log(`   Order ID:     ${result.orderId}`)
console.log(`   Реф-ссылка:   ${result.referralLink}`)
console.log(`   State:        ${result.raw?.state}`)
console.log(`   Reward:       ${result.raw?.reward?.formatted || '-'}`)
console.log(`   Partner user: ${result.raw?.user_id}`)

// 4. Записываем в Supabase ip_applications
console.log('\n' + '━'.repeat(70))
console.log('4. Сохраняем в Supabase ip_applications...')
console.log('━'.repeat(70))
const { data: inserted, error: insErr } = await supabase
  .from('ip_applications')
  .insert([{
    manager_id: admin.id,
    team: admin.team || 'admin',
    full_name: TEST_FIO,
    inn: TEST_INN,
    phone: TEST_PHONE,
    email: TEST_EMAIL,
    city: TEST_CITY,
    referral_link: result.referralLink,
    rko_order_id: String(result.orderId),
    rko_application_id: '',
    status: 'success',
  }])
  .select()
  .single()
if (insErr) {
  console.error('   ✗ Supabase insert failed:', insErr)
  process.exit(1)
}
console.log(`   ✓ записано, id=${inserted.id}, created_at=${inserted.created_at}`)

// 5. Подтверждаем что заявка в кабинете rko-partner
console.log('\n' + '━'.repeat(70))
console.log('5. fetchAllRkoOrders() — проверяем что заявка появилась в кабинете')
console.log('━'.repeat(70))
const orders = await fetchAllRkoOrders(auth, { perPage: 50, maxPages: 5 })
const found = orders.find(o => o.id === result.orderId)
if (found) {
  console.log(`   ✓ #${found.id}  state=${found.state}  fio=${found.fio}  inn=${found.inn}`)
  console.log(`   ✓ Заявка видна в кабинете — крон ежедневной проверки статусов её увидит`)
} else {
  console.log(`   ⚠ заявка #${result.orderId} НЕ найдена в списке — это странно`)
}

console.log('\n' + '━'.repeat(70))
console.log('ИТОГО')
console.log('━'.repeat(70))
console.log(`Order ID в rko-partner:  ${result.orderId}`)
console.log(`Реф-ссылка:              ${result.referralLink}`)
console.log(`Запись в Supabase:       id=${inserted.id}`)
console.log(`Видимость в UI:          у админа в "Ссылка ИП" на сайте после редеплоя`)
console.log(`Видимость в rko-partner: https://rko-partner.com/app/orders (ищи #${result.orderId})`)
