// Маппинг имени менеджера (как в profiles.name) → Google Spreadsheet ID
// Spreadsheet ID — это часть URL между /d/ и /edit
// Пример: https://docs.google.com/spreadsheets/d/1VnSU9PxRyppq1Hb_DD4idaGMLoK1Wkp0WrOJHDb-EUk/edit
//                                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// Добавьте сюда всех менеджеров у которых есть таблица с ЦД

export const MANAGER_SHEETS = {
  // Команда 1 (пример)
  // 'Имя Фамилия': 'GOOGLE_SPREADSHEET_ID',
}

// ─── Конфигурация выдачи контактов ───
export const CONTACTS_SPREADSHEET_ID = 'YOUR_CONTACTS_SPREADSHEET_ID'

// Команда → индекс колонки (0 = A, 1 = B)
// Настройте под свою структуру таблицы контактов
export const TEAM_CONTACT_COLUMN = {
  // team_id: 0,  // колонка A
  // team_id: 1,  // колонка B
}

export const CONTACTS_PER_ACCOUNT = 20
export const COOLDOWN_HOURS = 12

// ─── Конфигурация ЦД-таблиц ───

// Русские названия месяцев для вкладок Google Sheets
export const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

// Короткие названия продуктов (маппинг из длинных заголовков таблицы)
// Настройте под свои продукты
export const PRODUCT_NAMES = {
  0: 'Продукт 1',
  1: 'Продукт 2',
  2: 'Продукт 3',
  3: 'Продукт 4',
}

// Индексы столбцов в CSV (0-based)
// A=0 (Всего ЦД), B=1 (Дата), C=2..H=7 (продукты)
export const COL_TOTAL = 0
export const COL_DATE = 1
export const COL_PRODUCTS_START = 2
export const COL_PRODUCTS_END = 5  // inclusive

// ─── Таблица TG-аккаунтов ───
export const TG_ACCOUNTS_SPREADSHEET_ID = 'YOUR_TG_ACCOUNTS_SPREADSHEET_ID'
