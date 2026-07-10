import { createClient } from '@supabase/supabase-js'
import { MANAGER_SHEETS } from '../lib/sheets-config.js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const { data, error } = await supabase
  .from('profiles')
  .select('name, role, team')
if (error) { console.error(error); process.exit(1) }

const byName = new Map(data.map(p => [p.name, p]))

console.log('=== Менеджеры из MANAGER_SHEETS и их роли ===')
for (const name of Object.keys(MANAGER_SHEETS)) {
  const p = byName.get(name)
  console.log(`  ${p ? p.role.padEnd(10) : 'НЕТ В DB '.padEnd(10)} | ${p?.team || '-'.padEnd(10)} | ${name}`)
}

console.log('\n=== Все роли в profiles ===')
const roleCount = {}
for (const p of data) roleCount[p.role] = (roleCount[p.role] || 0) + 1
console.log(roleCount)
