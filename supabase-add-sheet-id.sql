-- Добавляем колонку sheet_id в profiles для хранения ID Google-таблицы менеджера
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sheet_id TEXT;

-- Пример: привязка Google Sheet к менеджеру
-- UPDATE profiles SET sheet_id = 'YOUR_GOOGLE_SPREADSHEET_ID' WHERE name = 'Имя Менеджера' AND sheet_id IS NULL;
