-- Индексы для ускорения частых запросов
-- Применить через `npm run db:migrate` или прямо в Supabase SQL Editor

-- Каждое открытие dashboard / teamlead делает:
--   SELECT * FROM reports WHERE manager_id = $1 ORDER BY date DESC LIMIT 180
-- Без индекса по (manager_id, date) Postgres делает sequential scan.
CREATE INDEX IF NOT EXISTS idx_reports_manager_date ON reports (manager_id, date DESC);

-- Для админки и тимлидской daily-вкладки: WHERE date >= ? ORDER BY date DESC
CREATE INDEX IF NOT EXISTS idx_reports_date ON reports (date DESC);

-- Для запросов профилей по команде (teamlead loadTeamData)
CREATE INDEX IF NOT EXISTS idx_profiles_team_role ON profiles (team, role);

-- Для запросов раздач контактов (cooldown check)
CREATE INDEX IF NOT EXISTS idx_contact_distributions_manager_at
  ON contact_distributions (manager_id, distributed_at DESC);

-- Для истории заявок ИП (только если таблица существует)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ip_applications') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ip_applications_team_created ON ip_applications (team, created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ip_applications_manager_created ON ip_applications (manager_id, created_at DESC)';
  END IF;
END $$;

-- Для ip_requests (новая фича, не везде применённая)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ip_requests') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ip_requests_manager_created ON ip_requests (manager_id, created_at DESC)';
  END IF;
END $$;
