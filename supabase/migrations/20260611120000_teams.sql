-- Таблица команд — теперь команды можно создавать/удалять с сайта,
-- а не только править захардкоженный массив TEAMS в коде.
--
-- slug — стабильный текстовый id (например 'olya', 'oleg', 'maria').
--        Используется в profiles.team — оставляем текстовый для обратной совместимости.
-- name — отображаемое имя ("Оли", "Олега")
-- type — определяет какая метрика основная и пороги в зонах:
--        'standard' (ИП основная) | 'karina' (карты основная) | 'nikita' (people_wrote)

CREATE TABLE IF NOT EXISTS teams (
  slug       TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9_-]{2,30}$'),
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  type       TEXT NOT NULL DEFAULT 'standard' CHECK (type IN ('standard','karina','nikita')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- Все авторизованные пользователи могут читать список (нужно для рендера UI).
CREATE POLICY teams_read ON teams FOR SELECT TO authenticated USING (true);

-- Изменять — только admin. POST/PUT/DELETE через service role, RLS строгая.
CREATE POLICY teams_admin_write ON teams FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Засеиваем текущие активные команды (Анастасия/Ясмин/Карина уже не должны быть)
INSERT INTO teams (slug, name, type) VALUES
  ('olya',   'Оли',    'standard'),
  ('nikita', 'Никиты', 'nikita')
ON CONFLICT (slug) DO NOTHING;
