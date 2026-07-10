// Применяет миграцию 20260505120000_ip_applications_account.sql.
// Можно было бы через `supabase db push`, но это требует CLI-линка к проекту;
// проще прямой SQL через service role.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const sqlStatements = [
  `ALTER TABLE ip_applications ADD COLUMN IF NOT EXISTS rko_account TEXT;`,
  `CREATE INDEX IF NOT EXISTS idx_ip_applications_rko_account
     ON ip_applications (rko_account)
     WHERE rko_account IS NOT NULL;`,
]

// Через RPC к exec_sql или прямой запрос к pg-функции
// Supabase JS клиент не даёт DDL напрямую — используем REST endpoint /rpc
// или просто проверим через select что колонка появилась после миграции
// (применить надо вручную через Supabase Studio или supabase db push).

// Для проверки текущего состояния — пробуем select с этой колонкой:
const { data, error } = await supabase
  .from('ip_applications')
  .select('id, rko_account')
  .limit(1)

if (error) {
  console.log('Колонка rko_account ЕЩЁ НЕ создана.')
  console.log('Ошибка:', error.message)
  console.log('\nЗапусти эти SQL вручную в Supabase Studio (SQL Editor):\n')
  for (const s of sqlStatements) console.log(s + '\n')
} else {
  console.log('✓ Колонка rko_account уже существует в ip_applications.')
  if (data && data.length) console.log('  Sample row:', data[0])
}
