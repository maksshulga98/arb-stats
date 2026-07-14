-- Очередь заданий на автоматическое оформление банковского продукта через
-- антидетект-браузер Dolphin Anty + мобильный прокси.
--
-- Почему очередь, а не прямой вызов (как в account_applications):
--   Сама автоматизация (открыть форму, заполнить, нажать, вытащить ссылку)
--   выполняется РЕАЛЬНЫМ браузером через Dolphin Local API (localhost:3001),
--   который живёт на машине с запущенным Dolphin. Vercel (serverless) туда
--   достучаться не может. Поэтому Vercel только КЛАДЁТ задачу сюда, а отдельный
--   процесс-раннер (на Mac / позже на VPS) её ЗАБИРАЕТ, выполняет и пишет
--   результат обратно. Фронт опрашивает статус задачи по id.
--
-- Жизненный цикл status: queued → processing → success | error.

CREATE TABLE IF NOT EXISTS bank_link_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  team TEXT NOT NULL,

  -- какой банк/оффер и какую «некрасивую» ссылку открывать
  bank TEXT NOT NULL,              -- напр. 'alfa'
  source_url TEXT NOT NULL,        -- ссылка на оформление, которую открывает раннер

  -- данные клиента, которые раннер вставит в форму
  organization_name TEXT NOT NULL,
  inn TEXT NOT NULL,
  legal_address TEXT NOT NULL,
  city TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,

  -- результат
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | processing | success | error
  result_link TEXT,                        -- «красивая» ссылка (href кнопки результата)
  error_message TEXT,

  -- диспетчеризация раннером (атомарный захват через RPC claim_bank_link_job)
  attempts INT NOT NULL DEFAULT 0,
  locked_by TEXT,                          -- id инстанса раннера, взявшего задачу
  locked_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Быстрый выбор следующей задачи раннером
CREATE INDEX IF NOT EXISTS idx_bank_link_jobs_queued ON bank_link_jobs(created_at)
  WHERE status = 'queued';
-- История/поллинг по менеджеру и команде
CREATE INDEX IF NOT EXISTS idx_bank_link_jobs_manager ON bank_link_jobs(manager_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bank_link_jobs_team ON bank_link_jobs(team, created_at DESC);

ALTER TABLE bank_link_jobs ENABLE ROW LEVEL SECURITY;

-- Менеджеры видят только свои задачи
CREATE POLICY "Managers can view own bank_link_jobs" ON bank_link_jobs
  FOR SELECT USING (manager_id = auth.uid());

-- Тимлиды — задачи своей команды
CREATE POLICY "Teamleads can view team bank_link_jobs" ON bank_link_jobs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'teamlead' AND team = bank_link_jobs.team
    )
  );

-- Админы — все
CREATE POLICY "Admins can view all bank_link_jobs" ON bank_link_jobs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- INSERT/UPDATE — только через service role (API-роут и раннер). RLS не даёт
-- обычным клиентам писать; поллинг статуса идёт по SELECT-политикам выше.

-- ── Атомарный захват задачи раннером ──
-- Несколько раннеров (Mac + позже VPS) не должны взять одну задачу дважды.
-- FOR UPDATE SKIP LOCKED гарантирует, что каждый claim берёт свою строку.
CREATE OR REPLACE FUNCTION claim_bank_link_job(p_runner TEXT)
RETURNS SETOF bank_link_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE bank_link_jobs
     SET status = 'processing',
         locked_by = p_runner,
         locked_at = NOW(),
         attempts = attempts + 1,
         updated_at = NOW()
   WHERE id = (
     SELECT id FROM bank_link_jobs
      WHERE status = 'queued'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING *;
END;
$$;
