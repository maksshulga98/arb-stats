-- Таблица для хранения истории выдачи контактов менеджерам
CREATE TABLE IF NOT EXISTS contact_distributions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  team TEXT NOT NULL,
  vacancy_column TEXT NOT NULL,        -- 'A' или 'B'
  accounts_count INTEGER NOT NULL CHECK (accounts_count BETWEEN 1 AND 3),
  contacts JSONB NOT NULL,             -- [[...20], [...20], ...] массив массивов
  row_indices JSONB NOT NULL,          -- номера строк в таблице (для предотвращения дублей)
  distributed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс для быстрого поиска по менеджеру и дате
CREATE INDEX idx_contact_distributions_manager ON contact_distributions(manager_id, distributed_at DESC);

-- Индекс для сбора всех выданных строк (предотвращение дублей)
CREATE INDEX idx_contact_distributions_column ON contact_distributions(vacancy_column);

ALTER TABLE contact_distributions ENABLE ROW LEVEL SECURITY;

-- Менеджеры видят только свои выдачи
CREATE POLICY "Managers can view own distributions" ON contact_distributions
  FOR SELECT USING (manager_id = auth.uid());

-- Тимлиды видят выдачи менеджеров своей команды
CREATE POLICY "Teamleads can view team distributions" ON contact_distributions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'teamlead'
        AND team = contact_distributions.team
    )
  );

-- Админы видят все выдачи
CREATE POLICY "Admins can view all distributions" ON contact_distributions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- INSERT только через service role (API route), нет пользовательских INSERT-полисей
