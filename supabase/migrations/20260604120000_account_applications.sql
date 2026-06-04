-- Таблица для заявок на РКО (product_id=533, оффер "Короткая заявка с смс-подтверждением РЕФ")
-- По структуре повторяет ip_applications, но с полями из новой формы:
--   organization_name (наименование организации, "ИП Фамилия Имя Отчество" или "ООО Х")
--   inn               (10 или 12 цифр)
--   legal_address     (юридический адрес одной строкой)
--   city              (город обслуживания)
--   contact_person    (контактное лицо)
--   email
--   phone

CREATE TABLE IF NOT EXISTS account_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  team TEXT NOT NULL,
  organization_name TEXT NOT NULL,
  inn TEXT NOT NULL,
  legal_address TEXT NOT NULL,
  city TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  referral_link TEXT,
  rko_order_id TEXT,
  rko_account TEXT,             -- 'a' или 'b' — какой кабинет (нужно для round-robin)
  status TEXT DEFAULT 'success',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_applications_manager ON account_applications(manager_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_applications_team ON account_applications(team, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_applications_status_rko ON account_applications(status, rko_account)
  WHERE status = 'success';     -- partial index для быстрого round-robin count'а

ALTER TABLE account_applications ENABLE ROW LEVEL SECURITY;

-- Менеджеры видят только свои заявки
CREATE POLICY "Managers can view own account_applications" ON account_applications
  FOR SELECT USING (manager_id = auth.uid());

-- Тимлиды видят заявки менеджеров своей команды
CREATE POLICY "Teamleads can view team account_applications" ON account_applications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'teamlead'
        AND team = account_applications.team
    )
  );

-- Админы видят все
CREATE POLICY "Admins can view all account_applications" ON account_applications
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- INSERT только через service role (API route)
