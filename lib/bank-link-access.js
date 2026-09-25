// Кто работает по новому алгоритму: вместо «Счёт ИП» — «Заявка в банк»
// (заявки уходят на ротируемые ссылки Пампаду через раннер).
//
// Команды переводятся целиком, отдельные люди — по id профиля: так можно
// включить алгоритм одному менеджеру, не трогая остальную команду.

export const BANK_LINK_TEAMS = ['elizavety', 'nikita']

export const BANK_LINK_MEMBERS = [
  '5e9f3d8c-acb9-49da-bfe5-a407085fa92b', // Ксюша Филиппова (команда Анны), 25.09.2026
]

export function usesBankLink(profile) {
  if (!profile) return false
  return BANK_LINK_TEAMS.includes(profile.team) || BANK_LINK_MEMBERS.includes(profile.id)
}
