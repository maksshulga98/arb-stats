// Серверный helper для загрузки списка команд из Supabase.
// Используется в:
//   /api/teams                  — CRUD
//   /api/cron/daily-summary     — собирает сводку по командам
//   /api/managers/[id] PUT      — валидация ALLOWED_TEAMS при переносе менеджера
//
// На клиенте команды грузятся через GET /api/teams (см. компоненты).

import { createClient } from '@supabase/supabase-js'

// Описания типов: используется UI и cron-логикой для выбора метрики/порогов.
export const TEAM_TYPES = ['standard', 'karina', 'nikita']

/**
 * Возвращает список команд из БД в виде [{ slug, name, type }, ...].
 * Сортировка по name. Без RLS — через service role, чтобы работало в cron.
 */
export async function fetchTeamsFromDb(supabaseAdmin) {
  const client = supabaseAdmin || createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
  const { data, error } = await client
    .from('teams')
    .select('slug, name, type')
    .order('name')
  if (error) {
    console.error('fetchTeamsFromDb error:', error.message)
    return []
  }
  return data || []
}

/**
 * Валидация slug: 2-30 символов, [a-z0-9_-]. Должен быть уникальным.
 * Используется на бэке при POST /api/teams.
 */
export function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9_-]{2,30}$/.test(slug)
}

/**
 * Транслит русского имени → slug. Берёт первое слово, латиницу lower-case.
 * "Команда Олега" → "komanda" (нет — берём первое полное слово после "Команда")
 * Лучше — берём ВСЁ имя без слова "Команда" и транслитим.
 *
 * Used on client to auto-suggest slug from name (но юзер может править).
 */
const TRANSLIT_MAP = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',
  к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
  х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
}
export function slugifyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/команды?|команду|команд|тимы?/gi, '')
    .trim()
    .split(/\s+/)[0]
    .replace(/./g, c => TRANSLIT_MAP[c] ?? c)
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 30)
}
