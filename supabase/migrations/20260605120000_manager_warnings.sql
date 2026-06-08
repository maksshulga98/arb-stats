-- Предупреждения менеджерам (за несданные отчёты и т.п.).
-- Выдают: admin (любому), teamlead (только своей команды).
-- Счётчик "3 и увольнять" считается по текущему МСК-месяцу.
-- При наступлении 3-го за месяц — Telegram-уведомление owner + Nikita.

CREATE TABLE IF NOT EXISTS manager_warnings (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id   UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  issued_by_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  issued_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mgr_warn_manager_date
  ON manager_warnings(manager_id, issued_at DESC);

ALTER TABLE manager_warnings ENABLE ROW LEVEL SECURITY;

-- Менеджер видит свои
CREATE POLICY mgr_warn_own ON manager_warnings
  FOR SELECT USING (manager_id = auth.uid());

-- Тимлид видит предупреждения менеджеров СВОЕЙ команды
CREATE POLICY mgr_warn_teamlead ON manager_warnings
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles tl, profiles mgr
      WHERE tl.id = auth.uid()
        AND tl.role = 'teamlead'
        AND mgr.id = manager_warnings.manager_id
        AND mgr.team = tl.team
    )
  );

-- Админ — всех
CREATE POLICY mgr_warn_admin ON manager_warnings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
