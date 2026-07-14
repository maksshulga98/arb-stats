// Конфигурация банковских офферов для авто-оформления через Dolphin-раннер.
// По образцу lib/rko-accounts.js — источники ссылок хранятся в env, чтобы их
// можно было менять без деплоя (партнёрки периодически меняют ссылки).
//
// Каждый банк = { id, label, sourceUrl }.
//   sourceUrl — «некрасивая» ссылка на оформление, которую откроет раннер.
//
// Env:
//   BANK_LINK_ALFA_URL   — ссылка оформления Альфа-Банк
//   (добавление банка = ещё одна запись ниже + свой env)

const BANKS = [
  {
    id: 'alfa',
    label: 'Альфа-Банк',
    sourceUrl: process.env.BANK_LINK_ALFA_URL || '',
  },
]

// Только те банки, у которых задана ссылка оформления
export function getActiveBanks() {
  return BANKS.filter(b => b.sourceUrl)
}

export function getBankById(id) {
  return getActiveBanks().find(b => b.id === id) || null
}
