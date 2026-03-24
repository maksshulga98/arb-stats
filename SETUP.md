# Arb Stats — Инструкция по развёртыванию

Система аналитики для управления командами менеджеров. Включает дневные отчёты, отслеживание ЦД (целевых действий) через Google Sheets, управление TG-аккаунтами, выдачу контактов и формирование ссылок на заявки ИП.

---

## Что умеет система

- **Дашборд менеджера** (`/dashboard`) — менеджер заполняет дневной отчёт, видит свою статистику за неделю и зону (красная/жёлтая/зелёная), получает контакты для обзвона
- **Страница тимлида** (`/teamlead`) — тимлид видит отчёты своей команды, может удалять отчёты, смотреть ЦД из Google Sheets, управлять TG-аккаунтами своих менеджеров, выдавать контакты
- **Админ-панель** (`/admin`) — админ видит все команды, общую сводку за день, управляет менеджерами (добавляет/удаляет), привязывает Google Sheets, управляет TG-аккаунтами, видит расчёт ЗП
- **Три типа команд:**
  - `standard` — поля: отписанные, ответившие, заказали ИП
  - `karina` — поля: отписанные, ответившие, заказано дебетовых карт
  - `nikita` — поля: написало людей, заказали ИП
- **Зоны эффективности** (цветовая индикация за 7 дней):
  - `standard`: <10 красная, 10-15 жёлтая, 15+ зелёная
  - `karina`: <15 красная, 15-30 жёлтая, 30+ зелёная
  - `nikita`: <10 красная, 10-15 жёлтая, 15+ зелёная

---

## Пошаговая инструкция для Claude

> Скопируй эту инструкцию целиком в Claude Code и попроси его всё настроить. Он пройдёт по шагам и заполнит все данные.

### Шаг 1: Supabase

1. Зайди на https://supabase.com и создай новый проект
2. Зайди в **Settings → API** и скопируй:
   - `Project URL` → это будет `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → это будет `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → это будет `SUPABASE_SERVICE_ROLE_KEY`
3. Зайди в **SQL Editor** и выполни SQL-скрипты в таком порядке:

```
supabase-setup.sql          — создаёт таблицу reports и RLS-политики
supabase-teamlead.sql       — добавляет политики для тимлидов
supabase-contacts.sql       — создаёт таблицу contact_distributions
supabase-add-sheet-id.sql   — добавляет колонку sheet_id в profiles
supabase-add-payment-info.sql — добавляет колонку payment_info в profiles
```

4. Затем выполни `seed-users.sql` — предварительно заполнив его своими данными (админы, тимлиды, менеджеры)

### Шаг 2: Google Cloud (для Google Sheets API)

1. Зайди в https://console.cloud.google.com
2. Создай новый проект
3. Включи **Google Sheets API** (APIs & Services → Enable APIs)
4. Создай **Service Account** (IAM & Admin → Service Accounts)
5. Создай ключ для service account (формат JSON)
6. Из JSON-файла возьми:
   - `client_email` → это будет `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → это будет `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
7. **Дай доступ** service account email к каждой Google-таблице (кнопка "Поделиться" в Google Sheets → добавь email сервис-аккаунта с правами "Редактор")

### Шаг 3: Google Sheets — подготовка таблиц

Нужно создать **3 типа таблиц**:

#### 3.1 Таблицы ЦД менеджеров
Для каждого менеджера создаётся своя Google-таблица с вкладками по месяцам (Январь, Февраль, ...). Формат каждой вкладки:
- Колонка A: Всего ЦД (число)
- Колонка B: Дата (формат ДД.ММ.ГГГГ)
- Колонки C-F: Продукты (например, Альфа ИП, ВТБ, Газпромбанк, Тинькофф)
- Также считаются дебетовые карты (IP/debit breakdown определяется в API)

#### 3.2 Таблица контактов
Одна общая таблица для выдачи контактов менеджерам. Контакты расположены в колонках (A, B и т.д.), каждая строка — один контакт. Контакты закрашиваются зелёным после выдачи.

#### 3.3 Таблица TG-аккаунтов
Таблица со списком Telegram-аккаунтов. Формат:
- Колонка A: Номер телефона
- Колонка B: Username (например @username)
- Колонка C: Email
- Колонка D: Статус (free/busy)
- Колонка E: Имя менеджера (кому привязан)

### Шаг 4: Файл .env.local

Создай файл `.env.local` в корне проекта:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nXXXXX\n-----END PRIVATE KEY-----\n"
```

### Шаг 5: Настройка команд в коде

Открой и заполни данные в следующих файлах:

#### 5.1 `lib/sheets-config.js`
```javascript
export const MANAGER_SHEETS = {
  'Имя Менеджера': 'GOOGLE_SPREADSHEET_ID',
  // ... для каждого менеджера с ЦД-таблицей
}

export const CONTACTS_SPREADSHEET_ID = 'ID_таблицы_контактов'

export const TEAM_CONTACT_COLUMN = {
  team1: 0,  // колонка A
  team2: 1,  // колонка B
}

export const TG_ACCOUNTS_SPREADSHEET_ID = 'ID_таблицы_тг_аккаунтов'

export const PRODUCT_NAMES = {
  0: 'Название продукта 1',
  1: 'Название продукта 2',
  // ...
}
```

#### 5.2 `app/admin/page.js` и `app/teamlead/page.js`
Массив TEAMS (в начале файла):
```javascript
const TEAMS = [
  { id: 'team1', name: 'Имя тимлида 1', type: 'standard' },
  { id: 'team2', name: 'Имя тимлида 2', type: 'standard' },
  // type: 'standard' | 'karina' | 'nikita'
]
```

#### 5.3 `app/dashboard/page.js`
```javascript
const TEAMS = {
  team1: { name: 'Имя тимлида 1', type: 'standard' },
  team2: { name: 'Имя тимлида 2', type: 'standard' },
}

const CONTACT_TEAMS = ['team1', 'team2']  // команды с доступом к выдаче контактов
```

#### 5.4 `app/teamlead/page.js`
```javascript
const CONTACT_TEAMS = ['team1', 'team2']
```

### Шаг 6: seed-users.sql

Заполни файл `seed-users.sql` своими пользователями. Пример:

```sql
-- Админ
SELECT _seed_create_user('admin@company.ru', 'Иван Иванов', 'admin', NULL);

-- Тимлид команды team1
SELECT _seed_create_user('teamlead1@company.ru', 'Мария Петрова', 'teamlead', 'team1');

-- Менеджеры команды team1
SELECT _seed_create_user('manager1@company.ru', 'Анна Сидорова', 'manager', 'team1');
SELECT _seed_create_user('manager2@company.ru', 'Пётр Козлов', 'manager', 'team1');
```

Роли: `admin`, `teamlead`, `manager`
Team ID должен совпадать с тем, что в `TEAMS` массиве.

### Шаг 7: Деплой на Vercel

1. Зайди на https://vercel.com
2. Импортируй свой GitHub-репозиторий
3. В настройках проекта → **Environment Variables** добавь все 5 переменных из `.env.local`
4. Деплой произойдёт автоматически при пуше в `main`

### Шаг 8: Установка и запуск локально

```bash
npm install
npm run dev
```

Приложение запустится на http://localhost:3000

---

## Структура проекта

```
app/
  admin/page.js         — Админ-панель (все команды, сводка, управление)
  dashboard/page.js     — Дашборд менеджера (личный отчёт, статистика)
  teamlead/page.js      — Страница тимлида (команда, отчёты, ЦД)
  api/
    contacts/            — API выдачи контактов из Google Sheets
    ip-link/             — API формирования ссылок на заявки ИП
    managers/            — API создания/удаления менеджеров
    sheets/              — API чтения ЦД из Google Sheets
    telegram-accounts/   — API управления TG-аккаунтами

lib/
  google-sheets-api.js   — Клиент Google Sheets API
  sheets-config.js       — Конфигурация: ID таблиц, команды, продукты
  supabase.js           — Клиент Supabase
  notifications.js       — Алерты пропущенных отчётов

supabase-setup.sql       — Начальная схема БД
supabase-teamlead.sql    — RLS-политики для тимлидов
supabase-contacts.sql    — Таблица выдачи контактов
supabase-add-sheet-id.sql — Колонка sheet_id
supabase-add-payment-info.sql — Колонка payment_info
seed-users.sql           — Шаблон создания пользователей
```

---

## Технологии

- **Next.js 16** (App Router)
- **Supabase** (PostgreSQL + Auth + RLS)
- **Google Sheets API v4**
- **Tailwind CSS**
- **Vercel** (хостинг)
