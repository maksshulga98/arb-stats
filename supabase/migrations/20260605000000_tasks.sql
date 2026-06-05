-- Раздел "Задачи" — приватный таск-трекер для двух админов
-- (Максим Шульга, Никита Татаринцев) с напоминаниями в Telegram.
-- См. docs/specs/tasks-section.md

-- ─── tasks: основные карточки задач ───
CREATE TABLE IF NOT EXISTS tasks (
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

CREATE INDEX IF NOT EXISTS idx_tasks_status_deadline ON tasks(status, deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id, status);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_tasks ON tasks
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ─── task_notifications: какие пороги уведомлений уже отправлены ───
-- UNIQUE(task_id, threshold) гарантирует что одно уведомление за порог
-- отправляется ровно один раз. Cron при INSERT'е может смело INSERT'ить
-- — duplicate key уйдёт в ошибку и сработает как skip.
CREATE TABLE IF NOT EXISTS task_notifications (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id    UUID REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
  threshold  TEXT NOT NULL CHECK (threshold IN ('48h','24h','6h','overdue')),
  sent_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (task_id, threshold)
);

CREATE INDEX IF NOT EXISTS idx_task_notifications_task ON task_notifications(task_id);

ALTER TABLE task_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_notif ON task_notifications
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ─── Триггер updated_at ───
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_touch ON tasks;
CREATE TRIGGER tasks_touch BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
