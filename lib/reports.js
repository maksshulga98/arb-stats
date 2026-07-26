// Устойчивая вставка отчёта.
//
// Зачем: поле ordered_simka (Симка Билайн) добавили в код раньше, чем колонку
// в БД (миграция 20260724130000). Если колонки ещё нет — обычная вставка падает
// с 42703 (undefined_column) и менеджер НЕ может сохранить отчёт вообще.
// Здесь ловим именно эту ошибку и повторяем вставку без ordered_simka, чтобы
// добавление отчёта работало всегда. Как только колонку накатят — ветка отвалится
// сама и Симка начнёт сохраняться без изменений кода (self-healing).
export async function insertReport(supabase, record) {
  let res = await supabase.from('reports').insert([record]).select().single()
  if (res.error && res.error.code === '42703' && 'ordered_simka' in record) {
    const { ordered_simka, ...rest } = record
    res = await supabase.from('reports').insert([rest]).select().single()
  }
  return res
}
