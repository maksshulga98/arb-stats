-- Таблица для хранения заявок ИП и реферальных ссылок
CREATE TABLE IF NOT EXISTS ip_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  team TEXT NOT NULL,
  full_name TEXT NOT NULL,
  inn TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  city TEXT NOT NULL,
  referral_link TEXT,
  rko_order_id TEXT,
  rko_application_id TEXT,
  status TEXT DEFAULT 'success',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ip_applications_manager ON ip_applications(manager_id, created_at DESC);

ALTER TABLE ip_applications ENABLE ROW LEVEL SECURITY;

-- Менеджеры видят только свои заявки
CREATE POLICY "Managers can view own ip_applications" ON ip_applications
  FOR SELECT USING (manager_id = auth.uid());

-- Тимлиды видят заявки менеджеров своей команды
CREATE POLICY "Teamleads can view team ip_applications" ON ip_applications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'teamlead'
        AND team = ip_applications.team
    )
  );

-- Админы видят все заявки
CREATE POLICY "Admins can view all ip_applications" ON ip_applications
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- INSERT только через service role (API route)
