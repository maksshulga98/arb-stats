// Конфиг кабинетов rko-partner.com — каждый со своим логином и прокси.
// Заявки распределяются между ними round-robin по модулю количества
// успешных заявок (см. pickNextAccount в app/api/ip-link/route.js).
//
// Чтобы добавить третий кабинет — просто добавь сюда ещё одну запись и
// пропиши env-вары _3 на Vercel. Ничего больше переделывать не нужно.

export const RKO_ACCOUNTS = [
  {
    id: 'a',
    label: 'Кабинет A (Татаринцев)',
    email: process.env.RKO_PARTNER_EMAIL,
    password: process.env.RKO_PARTNER_PASSWORD,
    proxyUrl: process.env.RKO_PROXY_URL,
  },
  {
    id: 'b',
    label: 'Кабинет B (Маришка)',
    email: process.env.RKO_PARTNER_EMAIL_2,
    password: process.env.RKO_PARTNER_PASSWORD_2,
    proxyUrl: process.env.RKO_PROXY_URL_2,
  },
]

// Аккаунты, у которых заполнены все три обязательных поля. Если на Vercel
// _2 переменные не прописаны — фильтруем второй кабинет, чтобы не падать.
export function getActiveAccounts() {
  return RKO_ACCOUNTS.filter(a => a.email && a.password && a.proxyUrl)
}

// Найти аккаунт по id (используется кроном при пересборке статусов)
export function getAccountById(id) {
  return RKO_ACCOUNTS.find(a => a.id === id) || null
}
