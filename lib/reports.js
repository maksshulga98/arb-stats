// Устойчивая вставка отчёта.
//
// Зачем: поле ordered_simka (Симка Билайн) добавили в код раньше, чем колонку
// в БД (миграция 20260724130000). Если колонки ещё нет — обычная вставка падает
// с 42703 (undefined_column) и менеджер НЕ может сохранить отчёт вообще.
// Здесь ловим именно эту ошибку и повторяем вставку без ordered_simka, чтобы
// добавление отчёта работало всегда. Как только колонку накатят — ветка отвалится
// сама и Симка начнёт сохраняться без изменений кода (self-healing).
// PostgREST для несуществующей колонки при INSERT отдаёт PGRST204 (schema cache),
// а прямой SQL — 42703. Ловим оба.
export function isMissingColumnError(error) {
  return !!error && (error.code === 'PGRST204' || error.code === '42703')
}

export async function insertReport(supabase, record) {
  let res = await supabase.from('reports').insert([record]).select().single()
  if (isMissingColumnError(res.error) && 'ordered_simka' in record) {
    const { ordered_simka, ...rest } = record
    res = await supabase.from('reports').insert([rest]).select().single()
  }
  return res
}
