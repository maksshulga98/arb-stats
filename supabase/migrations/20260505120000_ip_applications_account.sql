-- Добавляем колонку rko_account в ip_applications, чтобы знать через какой
-- кабинет rko-partner.com была заведена заявка. Round-robin выбирает кабинет
-- по модулю количества успешных заявок, поэтому проще считать долю каждого.
-- Значения: 'a', 'b' (см. lib/rko-accounts.js). NULL для исторических записей
-- (они все шли на старый аккаунт, который сейчас забанен — для статистики не важно).

ALTER TABLE ip_applications ADD COLUMN IF NOT EXISTS rko_account TEXT;

-- Индекс на случай если будем фильтровать историю по аккаунту
CREATE INDEX IF NOT EXISTS idx_ip_applications_rko_account
  ON ip_applications (rko_account)
  WHERE rko_account IS NOT NULL;
