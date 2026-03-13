// Маппинг имени менеджера (как в profiles.name) → Google Spreadsheet ID
// Spreadsheet ID — это часть URL между /d/ и /edit
// Пример: https://docs.google.com/spreadsheets/d/1VnSU9PxRyppq1Hb_DD4idaGMLoK1Wkp0WrOJHDb-EUk/edit
//                                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// Добавьте сюда всех менеджеров у которых есть таблица с ЦД

export const MANAGER_SHEETS = {
  // Команда Анастасии
  'Анастасия Гнидкина':   '1G-OrQWRKKOq10lMp87U29NHkb9IbwiHzxx2ZGF2Bz64',
  'Анна Овчинникова':     '1l6DNKXIn3bqeB5Dx9UvLZ3FegIeS9qjZlmAt9qU--2w',
  'Таня Гапонько':        '1iapi9iWUzjumZ6qSOMyh75K95J2my_BY1dMVA62EYcY',
  'Кристина Фролова':     '16QEKF-onbOeSjDjg5HveGrWqRttmTCIrkprm8jIESMk',
  'Настя Алексеева':      '1LDiTigOGhb9uoG9OZQMHL40Ol8DU1zcXcGz9_-iLLTM',
  'Диана Ирисбаева':      '1F5wJ5FBSq0zJSRv8w-pF8Yk_7vSLGFF5-C8SviB10EM',
  'Лера Зиборова':        '1LfYJP2WX6oam3yAfaK5oGhVuU4iBFZqApeZMk6oHjFk',
  // Команда Ясмин
  'Ясмин Усманова':       '1XS924tJPwMt8RsXaGn7aikrsjjbKUh6Afgidw0MAFWQ',
  'Варвара Кубасова':     '1VnSU9PxRyppq1Hb_DD4idaGMLoK1Wkp0WrOJHDb-EUk',
  'Диана Азимова':        '1KbvfEPRo4k2RjM7rbQw9nX10CccW3SAKlY9kymJfRiI',
  'Анастасия Альферович': '1yuhfknj1C_JoHfB-UlamvQZ7SwtBAKHvTyQLAyA_A5o',
  'Ari M':                '1X24SebentvOjNX1hxva_P-8inOra-h-CmBes9zjvH9c',
  'Lelya Kotova':         '1-oyJpjksZitu1MhUyn7SmGSejlpCqLw7o-nuP6M2QVE',
  'Кристина Герасименко': '1ZS5XhFq71gB2S301WzT2kD3If6VfmY8XIUEPFoaDZ9k',
  'Карина Тихомирова':    '1nOgHCb5sfwSeb03DpXiftJ26C1J2azitMTzcPvp8RIU',
  // Команда Оли
  'Olga Alexandrovna':    '1IgVS379I6Zmdz2dyoJF5KwEitmwkov1vHjJRyn-AzxI',
  'Վես Պ.':              '1SJuNKRNb-7asK1C_5PxdoloSR7TulPCcRXfV2mA5Xmg',
  // Команда Карины
  'Карина Калинина':      '17Bc_DRAjCO7551ovSfWkXnmNM-HssEORUMQFw3H4X9Q',
  'Алинка Бутенко':       '10mqkuVZLe6i89HzWApGBDH-6qaogp-95id5LVbgsCUo',
  'Оська Шогенова':       '12BKOSzfVQOIUOI7DbfTB11lsQGarjVf7teDMEGIc7bQ',
  'Ксения Челик':         '16G3XewRwc3WIYcMaK1bhp46qxiT5-hPE75vufjVTHE8',
  // Команда Никиты
  'Ангелина Рвачева':     '15rb-ShZRa5cpd8n3VphRu4-YgQVzUDobu68ED_gZ_HI',
  'Оксана Стадникова':    '1kaa8GZnxKH-0X2mIdcC8eX0PINQ58MFqgMgts35tvwc',
  'Карина Фаттахова':     '1chjgTCIHurOhXL5hg2_GhybOOaQUW1VklAu2nM3bcHQ',
  'Полина Страхова':      '1dAvrWS1KK9TFRrdM38AU5mxX-Ky_xep3EYe9oTY_fio',
  'Анна Лалкина':         '11pmlXzBpBH8zhiy2yS_tb5v1DgHaOGbVdc3UN_yIqL4',
  'Каролина Волкова':     '1BlMrO7VP80YBi5qdlSjcTQFUk0prnKWoYwtah1_oGjQ',
  'Даша Утяшева':         '1yuiBdpVGUtA9warMp5qOCvB_ZQLyJDyhLcD1LNRvLn4',
}

// Русские названия месяцев для вкладок Google Sheets
export const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

// Короткие названия продуктов (маппинг из длинных заголовков таблицы)
export const PRODUCT_NAMES = {
  0: 'Альфа ИП',
  1: 'ВТБ',
  2: 'Газпромбанк',
  3: 'Тинькофф',
}

// Индексы столбцов в CSV (0-based)
// A=0 (Всего ЦД), B=1 (Дата), C=2..H=7 (продукты)
export const COL_TOTAL = 0
export const COL_DATE = 1
export const COL_PRODUCTS_START = 2
export const COL_PRODUCTS_END = 5  // inclusive (Альфа ИП, ВТБ, Газпромбанк, Тинькофф)
