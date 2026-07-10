// Заводит ещё одну тестовую заявку и печатает ТОЛЬКО реф-ссылку
// (как её увидит менеджер на сайте после нажатия "+ Создать заявку").

process.env.RKO_PROXY_URL = 'http://hP4AWm:cJedWrO2lf@46.8.212.117:5500'
process.env.RKO_PARTNER_EMAIL = 'ntatarincev33@gmail.com'
process.env.RKO_PARTNER_PASSWORD = 'Nick.2kkl.019'

const { loginToRkoPartner, createRkoApplication } = await import('../lib/rko-partner.js')

function generateValidINN(prefix10) {
  const d = prefix10.split('').map(Number)
  const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]
  const check1 = w1.reduce((s, w, i) => s + w * d[i], 0) % 11 % 10
  const d11 = [...d, check1]
  const check2 = w2.reduce((s, w, i) => s + w * d11[i], 0) % 11 % 10
  return prefix10 + check1 + check2
}

const auth = await loginToRkoPartner()
const result = await createRkoApplication(auth, {
  fullName: 'Петров Алексей Викторович',
  inn: generateValidINN('5012345678'),
  phone: '+79261112233',
  email: 'a.petrov.test@example.com',
  city: 'Санкт-Петербург',
})

console.log('Order ID:', result.orderId)
console.log()
console.log('РЕФЕРАЛЬНАЯ ССЫЛКА (как увидит менеджер на сайте):')
console.log(result.referralLink)
