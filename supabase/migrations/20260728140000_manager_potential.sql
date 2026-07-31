-- Анкета «потенциал менеджера» — субъективная оценка руководителя:
-- сколько у человека ресурса (время, мотивация, запрос по деньгам) и что мешает.
--
-- Смысл: пересечение ПОТЕНЦИАЛА (эта анкета, цвет ставит руководитель) и
-- РЕЗУЛЬТАТА (зоны по заказам РКО, считаются автоматически):
--   зелёный потенциал + красный результат → человек готов, надо с ним работать;
--   красный потенциал + любой результат   → кандидат на увольнение.
--
-- Одна строка на менеджера (перезаписывается при каждом сохранении).

CREATE TABLE IF NOT EXISTS manager_potential (
  manager_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

  free_time      TEXT,   -- Много ли у менеджера свободного времени?
  desired_income TEXT,   -- Сколько хочет зарабатывать?
  age            TEXT,   -- Сколько ему лет?
  likes_work     TEXT,   -- Всё ли нравится в работе?
  difficulties   TEXT,   -- Какие сложности есть в работе?
  comments       TEXT,   -- Дополнительные комментарии

  -- Цвет-плашка менеджера в аналитике: green | yellow | red
  color TEXT CHECK (color IN ('green', 'yellow', 'red')),

  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE manager_potential ENABLE ROW LEVEL SECURITY;

-- Читают только руководители: админ — всех, тимлид — свою команду.
-- Сам менеджер свою анкету не видит (это внутренняя оценка).
CREATE POLICY "Admins can view all manager_potential" ON manager_potential
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Teamleads can view team manager_potential" ON manager_potential
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles tl
      JOIN profiles m ON m.id = manager_potential.manager_id
      WHERE tl.id = auth.uid() AND tl.role = 'teamlead' AND tl.team = m.team
    )
  );

-- Запись — только через service role (API-роут проверяет права сам).
