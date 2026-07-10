# ТЗ: раздел «Задачи» с напоминаниями в Telegram

**Версия:** 1.0
**Дата:** 04.06.2026
**Статус:** approved → ready for implementation

---

## 0. Контекст

Проект `arb-stats` — внутренний сайт для управления командой (Next.js 16 App Router, Supabase, Vercel). У нас уже есть админ-кабинет, бот Telegram, ежедневные сводки в TG, прокси-интеграция с rko-partner и т.д.

Нужно добавить **приватный таск-трекер для двух админов** (Максим Шульга, Никита Татаринцев) с напоминаниями о дедлайнах в существующий Telegram-бот.

Этот документ — полное ТЗ. Реализуй строго по нему, при сомнениях по умолчанию выбирай вариант **«проще и надёжнее»**.

---

## 1. Цель

Собрать все рабочие задачи двух админов в одном месте и не пропускать дедлайны за счёт авто-напоминаний.

---

## 2. Доступ

- Видят только пользователи с `role='admin'` в таблице `profiles`. Сейчас это `maks_shulga_98@mail.ru` и `nikita.tatarintsev@arbteam.ru`.
- Все API-эндпоинты проверяют `role='admin'`, иначе возвращают `403`.
- Никаких хардкодов на конкретные `id` / `email` — если завтра добавится третий админ, он автоматически получает доступ.

---

## 3. Схема БД (Supabase)

Создать через SQL Editor в Supabase Studio (proj `agnrzveeoswkscjwxnde`). Параллельно положить миграцию в `supabase/migrations/YYYYMMDDhhmmss_tasks.sql`.

### Таблица `tasks`

```sql
CREATE TABLE tasks (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description  TEXT,
  assignee_id  UUID REFERENCES profiles(id) ON DELETE RESTRICT NOT NULL,
  creator_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deadline     TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_status_deadline ON tasks(status, deadline);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id, status);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_tasks ON tasks
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
```

### Таблица `task_notifications`

```sql
CREATE TABLE task_notifications (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id    UUID REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
  threshold  TEXT NOT NULL CHECK (threshold IN ('48h','24h','6h','overdue')),
  sent_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (task_id, threshold)
);

CREATE INDEX idx_task_notifications_task ON task_notifications(task_id);

ALTER TABLE task_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_notif ON task_notifications
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
```

### Триггер `updated_at`

```sql
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_touch BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

**Применение:** SQL Editor в Supabase Studio через Chrome MCP (есть в прошлых сессиях, можно дёргать ту же flow).

---

## 4. API endpoints

Все в `app/api/tasks/`. Auth — стандартная для проекта: `Authorization: Bearer <supabase JWT>`, на сервере вычитываем профиль и проверяем `role='admin'`. Паттерн брать из `/api/account-link/route.js`.

### `GET /api/tasks?scope=...`

Query params:
- `scope=all` (default) — все задачи
- `scope=mine` — где `assignee_id = me`
- `scope=overdue` — `status='pending' AND deadline < NOW()`
- `scope=done` — `status='done'`

Сортировка: сначала `pending` по `deadline ASC`, потом `done` по `completed_at DESC`.
Лимит: 500 строк.

Возвращает:
```json
{
  "tasks": [
    {
      "id": "uuid",
      "title": "...",
      "description": "...",
      "assignee_id": "uuid",
      "assignee_name": "...",
      "creator_id": "uuid",
      "creator_name": "...",
      "deadline": "2026-06-10T15:00:00+03:00",
      "status": "pending",
      "completed_at": null,
      "created_at": "..."
    }
  ]
}
```

Имена вытаскиваем одним JOIN/in-clause (не N+1).

### `POST /api/tasks`

Body:
```json
{
  "title": "...",
  "description": "...",  // опционально
  "deadline": "2026-06-10T15:00:00",  // ISO
  "assignee_id": "uuid"
}
```

Валидация:
- `title` 1–200 символов
- `deadline` валидный ISO timestamp, **строго > now**
- `assignee_id` существует в `profiles` и имеет `role='admin'`

Создаёт запись со `status='pending'`, `creator_id = me`.
Возвращает: `{ task: { ... } }`.

### `PUT /api/tasks/[id]`

Body может содержать любое из: `title`, `description`, `deadline`, `assignee_id`, `status`.

Правила:
- При `status='done'` — выставить `completed_at = NOW()`
- При `status='pending'` (возврат) — `completed_at = NULL`
- **При изменении `deadline`** — удалить **все** записи `task_notifications` для этой задачи (`DELETE FROM task_notifications WHERE task_id = ?`). Следующий cron-такт пересчитает.

Возвращает обновлённый объект.

### `DELETE /api/tasks/[id]`

Удаляет задачу. `task_notifications` уходят каскадом.
Возвращает: `{ success: true }`.

### `GET /api/tasks/[id]/notifications`

Возвращает историю уведомлений по задаче:
```json
{
  "notifications": [
    { "threshold": "48h", "sent_at": "..." },
    { "threshold": "24h", "sent_at": "..." }
  ]
}
```

---

## 5. Cron `/api/cron/task-deadlines`

### Расписание
В `vercel.json` добавить:
```json
{ "path": "/api/cron/task-deadlines", "schedule": "0 * * * *" }
```
Каждый час, минута 0.

### Auth
Стандартный паттерн из `/api/cron/check-cd-status`:
```js
const isVercelCron = request.headers.get('x-vercel-cron') !== null
const cronSecret = process.env.CRON_SECRET
if (!isVercelCron && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

### Логика

```
1. Получить все pending задачи (status='pending') с join'ом profiles для assignee_name
2. Получить все task_notifications для этих задач одним запросом → Map<task_id, Set<threshold>>
3. Для каждой задачи:
   - hours_left = (deadline - NOW()) / 3_600_000
   - Определить какие пороги пора отправить (ВСЕ из попавших, не только один):
     • '48h'      если hours_left <= 48 AND hours_left > 24
     • '24h'      если hours_left <= 24 AND hours_left > 6
     • '6h'       если hours_left <= 6  AND hours_left > 0
     • 'overdue'  если hours_left <= 0
   - Для каждого попавшего порога:
     • Если (task_id, threshold) уже есть в task_notifications → skip
     • Иначе: послать сообщение в Telegram через broadcastTelegramMessage(),
       затем INSERT в task_notifications. INSERT делаем ВСЕГДА,
       даже если broadcast вернул ok=false — чтобы не спамить повторными попытками.
4. Логировать в console.log каждое отправленное сообщение для дебага.
5. Возврат: { ok: true, processed: N, sent: [{ task_id, threshold, recipients }] }
```

### Получатели
Оба админа всегда:
- `process.env.TELEGRAM_CHAT_ID_OWNER`
- `process.env.TELEGRAM_CHAT_ID_NIKITA`

Через существующий `broadcastTelegramMessage` из `lib/telegram.js`.

### Шаблоны сообщений (HTML parse_mode)

Имя ответственного — `assignee.name` из БД.
Формат даты дедлайна: `"5 июня, 18:00"` (через тот же `fmtDateHuman` стиль что в `daily-summary`, но с временем).

**Helper для форматирования:**
```js
function fmtDeadline(iso) {
  const d = new Date(iso)
  // Локализация в МСК
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(d)
}
```

**48h:**
```
⏰ <b>Задача с приближающимся дедлайном</b>

«<b>{title}</b>»

Дедлайн через 2 дня — <i>{fmtDeadline(deadline)}</i>
Ответственный: <b>{assignee_name}</b>
```

**24h:**
```
🔔 <b>Напоминание о задаче</b>

«<b>{title}</b>»

Остался 1 день до дедлайна — <i>{fmtDeadline(deadline)}</i>
Ответственный: <b>{assignee_name}</b>
```

**6h:**
```
🚨 <b>Срочно: задача горит</b>

«<b>{title}</b>»

До дедлайна 6 часов — <i>{fmtDeadline(deadline)}</i>
Ответственный: <b>{assignee_name}</b>
```

**overdue:**
```
❌ <b>Задача просрочена</b>

«<b>{title}</b>»

Дедлайн был <i>{fmtDeadline(deadline)}</i> ({hoursLate} ч назад)
Ответственный: <b>{assignee_name}</b>
```

---

## 6. UI

### Подключение
В `app/admin/page.js`:
1. В массив `TABS` добавить `{ id: 'tasks', label: 'Задачи' }` после `'analytics'`.
2. В блок рендера табов добавить:
   ```jsx
   {activeTab === 'tasks' && <TasksSection currentUserId={user.id} admins={admins} />}
   ```
3. Импортировать `TasksSection` из `components/TasksSection.js`.
4. `admins` — массив профилей с `role='admin'`. Получить через тот же запрос, что уже грузится в `loadData()` (расширить добавив `role='admin'` фильтр), или отдельным запросом.

### Файл `components/TasksSection.js`

Аналог `components/AccountLinkSection.js` по структуре. Внутри:
- Стейт: `tasks`, `loading`, `filter`, `showModal`, `editingTask`, `form`, `submitting`, `error`
- Хелперы: `loadTasks`, `handleCreate`, `handleUpdate`, `handleDelete`, `handleToggleStatus`

### Хедер секции

```
Задачи           [ Все 12 ] [ Мои 5 ] [ Никиты 4 ] [ Просрочены 1 ] [ Выполнены 12 ]
                                                                   [ + Новая задача ]
```

Кнопки-фильтры: активный подсвечен синим, неактивные серые. Счётчики считаем на клиенте (без отдельных запросов) — фильтруем загруженный массив `tasks`.

### Список задач (карточки/строки)

Стилистика и таблица — как у `AccountLinkSection.js` (тёмный фон `#13131f`, бордер `#1f1f2e`).

Каждая строка:
1. Цветной кружок (24×24px) — статус
2. Заголовок задачи (`truncate`, max-width)
3. Дедлайн с относительным временем: `5 июня, 18:00` + серым `(через 6ч)`
4. Имя ответственного
5. Чекбокс — переключает `status` через `PUT /api/tasks/[id]`

**Цвет кружка (вычисляется на клиенте):**
- 🔴 — `status='pending' AND (overdue OR hoursLeft <= 6)`
- 🟡 — `hoursLeft <= 24 AND hoursLeft > 6`
- 🟠 — `hoursLeft <= 48 AND hoursLeft > 24`
- ⚪ — `hoursLeft > 48`
- ✅ — `status='done'`

**Клик по строке (не по чекбоксу)** — открывает модалку редактирования. Чекбокс ловит `e.stopPropagation()`.

### Модалка

Тот же стиль что у `AccountLinkSection.js` (overlay, `max-w-md`, dark).

Поля:
1. **Заголовок** — `<input type="text" maxLength="200" required>`
2. **Описание** — `<textarea rows="4">`, опционально
3. **Дедлайн** — `<input type="datetime-local" required>`. При создании default = `now + 2 days @ 12:00 МСК`. **Important:** `datetime-local` отдаёт значение в локальной TZ браузера; на сервер шлём как ISO через `new Date(value).toISOString()`.
4. **Ответственный** — `<select required>` с двумя `<option>` (имена из props `admins`).
5. (только редактирование) **История уведомлений** — секция снизу:
   ```
   ⏰ 48h — отправлено 03.06 в 10:00
   🔔 24h — отправлено 04.06 в 10:00
   ```
   Грузится отдельным GET к `/api/tasks/[id]/notifications` при открытии модалки в режиме редактирования.

Кнопки:
- **Сохранить** (синяя `bg-blue-600`)
- **Отмена** (серая `bg-gray-800`)
- **Удалить** (красная `bg-red-600`, только в редактировании) — inline confirm «Точно удалить? Да / Отмена»

### Формат дат в UI

Хелперы (можно в том же файле компонента):
```js
function fmtDeadline(iso) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Moscow',
  })
}

function fmtRelative(iso) {
  const ms = new Date(iso).getTime() - Date.now()
  const hours = ms / 3_600_000
  if (hours < 0) return `просрочено на ${Math.abs(Math.round(hours))}ч`
  if (hours < 24) return `через ${Math.round(hours)}ч`
  const days = hours / 24
  if (days < 7) return `через ${Math.round(days)}д`
  return `через ${Math.round(days)} дн`
}
```

---

## 7. Edge cases (обязательно реализовать)

| № | Кейс | Поведение |
|---|------|-----------|
| 1 | Дедлайн в прошлом при создании | API возвращает 400, в UI красная плашка «Дедлайн должен быть в будущем» |
| 2 | Удаление задачи | Каскад уносит `task_notifications`. После удаления — закрыть модалку и обновить список |
| 3 | Изменение дедлайна | На бэке в `PUT` — `DELETE FROM task_notifications WHERE task_id = ?` |
| 4 | Изменение ответственного | Никаких сторон-эффектов, имя в шаблоне TG возьмёт следующий cron |
| 5 | Отметка «выполнено» в момент порога | Cron берёт только `pending` → уведомление не пошлётся |
| 6 | Возврат с done в pending | Записи `task_notifications` остались → повторно не пошлёт (UNIQUE constraint). Чтобы пнуть — двинуть дедлайн |
| 7 | Telegram не доставил (заблокирован бот) | INSERT в `task_notifications` всё равно делаем (чтобы не спамить ретраями). Ошибку логируем в console |
| 8 | Cron сработал между двумя порогами | Если оба попадают в окно — отправляются оба в одной итерации |
| 9 | Часовые пояса | `deadline` — `TIMESTAMPTZ`. UI отображает в Europe/Moscow. На сервере для cron использовать `Date.now()` напрямую |
| 10 | Длинный title (200+) | UI обрезает `truncate`, БД ругается CHECK |

---

## 8. Env переменные

Новых не нужно. Используем существующие:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID_OWNER`
- `TELEGRAM_CHAT_ID_NIKITA`
- `CRON_SECRET` (если задан)
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 9. Acceptance criteria

Реализация принята когда:

1. ✅ Из админ-кабинета Максима и Никиты виден таб **«Задачи»**
2. ✅ Из менеджерского/тимлид-кабинета вкладка **не видна**, API возвращает 403
3. ✅ Можно создать задачу с заголовком, описанием, дедлайном и ответственным
4. ✅ Список отображается с цветными статусами, фильтры работают, счётчики верные
5. ✅ Чекбокс отмечает задачу выполненной и она уезжает вниз
6. ✅ Дедлайн в прошлом при создании — отклоняется с понятной ошибкой
7. ✅ Можно отредактировать любое поле; при изменении дедлайна `task_notifications` чистятся
8. ✅ Удаление задачи каскадом сносит её `task_notifications`
9. ✅ Cron `/api/cron/task-deadlines` запускается каждый час, проверяет пороги, шлёт сообщения в TG обоим адресатам
10. ✅ Каждое уведомление за конкретный порог отправляется **только один раз** (защита `UNIQUE (task_id, threshold)`)
11. ✅ Шаблоны сообщений соответствуют разделу 5
12. ✅ В модалке редактирования виден лог отправленных уведомлений
13. ✅ Build проходит без ошибок (`npx next build --turbopack`)
14. ✅ `vercel.json` обновлён

---

## 10. План реализации (последовательность)

1. **Миграция Supabase** — две таблицы + триггер + RLS через SQL Editor (можно через Chrome MCP). Также положить файл `supabase/migrations/YYYYMMDDhhmmss_tasks.sql` для истории.
2. **Backend:**
   - `app/api/tasks/route.js` — GET + POST
   - `app/api/tasks/[id]/route.js` — PUT + DELETE
   - `app/api/tasks/[id]/notifications/route.js` — GET
   - `app/api/cron/task-deadlines/route.js` — cron handler
3. **`vercel.json`** — добавить четвёртый cron.
4. **UI:**
   - `components/TasksSection.js` — компонент с формой, списком, модалкой
   - Подключить в `app/admin/page.js` (новый таб + рендер)
5. **Локальная проверка билда:** `npx next build --turbopack`
6. **Коммит + push.**
7. **Проверка на проде:**
   - Войти в Niktу-админ-кабинет через Chrome MCP
   - Создать тестовую задачу с дедлайном через ~5 часов
   - Дёрнуть `https://arb-stats-eta.vercel.app/api/cron/task-deadlines` руками
   - Убедиться что пришло сообщение «6h» в TG
   - Передвинуть дедлайн на через 3 дня — убедиться что `task_notifications` для этой задачи очистились
   - Отметить выполненной, проверить что задача переехала вниз
   - Удалить — убедиться в каскадном удалении из БД

---

## 11. Что НЕ делать (out of scope)

- Подзадачи, чек-листы, комментарии, вложения
- История изменений полей (audit log)
- Метки/теги/проекты
- Календарный/Kanban вид
- Snooze / повторные напоминания вручную
- Telegram inline-кнопки «отметить выполненной» прямо из чата
- Приоритеты задач
- Повторяющиеся задачи

Всё это — потенциальные фичи для v2 если зайдёт. Сейчас держим минимум.

---

## 12. Стилистика и архитектурные ориентиры

При сомнениях смотри как сделано в существующих файлах:
- **API + auth + Supabase** → `app/api/account-link/route.js`
- **UI компонент с формой, историей, модалкой** → `components/AccountLinkSection.js`
- **Cron + Telegram** → `app/api/cron/daily-summary/route.js` + `lib/telegram.js`
- **Применение SQL миграций через Chrome MCP** → история предыдущих сессий (Supabase Studio SQL Editor, project `agnrzveeoswkscjwxnde`)

Технологии те же что в проекте: Next.js 16 App Router (JS, не TS), Supabase JS client, Tailwind, undici, googleapis. Никаких новых зависимостей.
