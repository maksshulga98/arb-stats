// Пул ссылок оформления (trk.ppdu.ru). Менеджер банк не выбирает — заявка
// автоматически уходит на очередную ссылку из пула по кругу (round-robin),
// чтобы объём заявок распределялся по ссылкам равномерно.
//
// Env `BANK_LINK_URLS` — список ссылок через перевод строки, запятую или пробел.
// Меняется без деплоя: достаточно обновить переменную в Vercel.
// Для совместимости поддерживается старая одиночная BANK_LINK_ALFA_URL.

export function getLinkPool() {
  const raw = process.env.BANK_LINK_URLS || process.env.BANK_LINK_ALFA_URL || ''
  return raw
    .split(/[\s,;]+/)
    .map(s => s.trim())
    .filter(s => /^https?:\/\//i.test(s))
}

// Короткий код ссылки из trk.ppdu.ru/click/XXXX — им помечаем заявку,
// чтобы потом было видно, через какую ссылку она ушла.
export function linkCode(url) {
  const m = String(url || '').match(/\/click\/([A-Za-z0-9]+)/)
  return m ? m[1] : 'link'
}

/**
 * Выбор следующей ссылки по кругу.
 * Индекс считаем от общего числа уже созданных заявок — так нагрузка ложится
 * на ссылки поочерёдно. Гонка при одновременных запросах возможна (два запроса
 * прочитают одинаковый count), но на равномерность в целом это не влияет.
 */
export async function pickNextLink(supabaseAdmin) {
  const pool = getLinkPool()
  if (pool.length === 0) return null
  if (pool.length === 1) return pool[0]

  const { count, error } = await supabaseAdmin
    .from('bank_link_jobs')
    .select('*', { count: 'exact', head: true })
  if (error) {
    console.warn('pickNextLink: не смог посчитать заявки, беру первую ссылку:', error.message)
    return pool[0]
  }
  return pool[(count || 0) % pool.length]
}
