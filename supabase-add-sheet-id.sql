-- Добавляем колонку sheet_id в profiles для хранения ID Google-таблицы менеджера
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sheet_id TEXT;

-- Засеиваем данные из хардкода MANAGER_SHEETS
-- Команда Анастасии
UPDATE profiles SET sheet_id = '1G-OrQWRKKOq10lMp87U29NHkb9IbwiHzxx2ZGF2Bz64' WHERE name = 'Анастасия Гнидкина' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1l6DNKXIn3bqeB5Dx9UvLZ3FegIeS9qjZlmAt9qU--2w' WHERE name = 'Анна Овчинникова' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1iapi9iWUzjumZ6qSOMyh75K95J2my_BY1dMVA62EYcY' WHERE name = 'Таня Гапонько' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '16QEKF-onbOeSjDjg5HveGrWqRttmTCIrkprm8jIESMk' WHERE name = 'Кристина Фролова' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1LDiTigOGhb9uoG9OZQMHL40Ol8DU1zcXcGz9_-iLLTM' WHERE name = 'Настя Алексеева' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1F5wJ5FBSq0zJSRv8w-pF8Yk_7vSLGFF5-C8SviB10EM' WHERE name = 'Диана Ирисбаева' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1LfYJP2WX6oam3yAfaK5oGhVuU4iBFZqApeZMk6oHjFk' WHERE name = 'Лера Зиборова' AND sheet_id IS NULL;

-- Команда Ясмин
UPDATE profiles SET sheet_id = '1XS924tJPwMt8RsXaGn7aikrsjjbKUh6Afgidw0MAFWQ' WHERE name = 'Ясмин Усманова' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1VnSU9PxRyppq1Hb_DD4idaGMLoK1Wkp0WrOJHDb-EUk' WHERE name = 'Варвара Кубасова' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1KbvfEPRo4k2RjM7rbQw9nX10CccW3SAKlY9kymJfRiI' WHERE name = 'Диана Азимова' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1yuhfknj1C_JoHfB-UlamvQZ7SwtBAKHvTyQLAyA_A5o' WHERE name = 'Анастасия Альферович' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1X24SebentvOjNX1hxva_P-8inOra-h-CmBes9zjvH9c' WHERE name = 'Ari M' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1-oyJpjksZitu1MhUyn7SmGSejlpCqLw7o-nuP6M2QVE' WHERE name = 'Lelya Kotova' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1ZS5XhFq71gB2S301WzT2kD3If6VfmY8XIUEPFoaDZ9k' WHERE name = 'Кристина Герасименко' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1nOgHCb5sfwSeb03DpXiftJ26C1J2azitMTzcPvp8RIU' WHERE name = 'Карина Тихомирова' AND sheet_id IS NULL;

-- Команда Оли
UPDATE profiles SET sheet_id = '1IgVS379I6Zmdz2dyoJF5KwEitmwkov1vHjJRyn-AzxI' WHERE name = 'Olga Alexandrovna' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1SJuNKRNb-7asK1C_5PxdoloSR7TulPCcRXfV2mA5Xmg' WHERE name = 'Վես Պ.' AND sheet_id IS NULL;

-- Команда Карины
UPDATE profiles SET sheet_id = '17Bc_DRAjCO7551ovSfWkXnmNM-HssEORUMQFw3H4X9Q' WHERE name = 'Карина Калинина' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '10mqkuVZLe6i89HzWApGBDH-6qaogp-95id5LVbgsCUo' WHERE name = 'Алинка Бутенко' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '12BKOSzfVQOIUOI7DbfTB11lsQGarjVf7teDMEGIc7bQ' WHERE name = 'Оська Шогенова' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '16G3XewRwc3WIYcMaK1bhp46qxiT5-hPE75vufjVTHE8' WHERE name = 'Ксения Челик' AND sheet_id IS NULL;

-- Команда Никиты
UPDATE profiles SET sheet_id = '15rb-ShZRa5cpd8n3VphRu4-YgQVzUDobu68ED_gZ_HI' WHERE name = 'Ангелина Рвачева' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1kaa8GZnxKH-0X2mIdcC8eX0PINQ58MFqgMgts35tvwc' WHERE name = 'Оксана Стадникова' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1chjgTCIHurOhXL5hg2_GhybOOaQUW1VklAu2nM3bcHQ' WHERE name = 'Карина Фаттахова' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1dAvrWS1KK9TFRrdM38AU5mxX-Ky_xep3EYe9oTY_fio' WHERE name = 'Полина Страхова' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '11pmlXzBpBH8zhiy2yS_tb5v1DgHaOGbVdc3UN_yIqL4' WHERE name = 'Анна Лалкина' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1BlMrO7VP80YBi5qdlSjcTQFUk0prnKWoYwtah1_oGjQ' WHERE name = 'Каролина Волкова' AND sheet_id IS NULL;
UPDATE profiles SET sheet_id = '1yuiBdpVGUtA9warMp5qOCvB_ZQLyJDyhLcD1LNRvLn4' WHERE name = 'Даша Утяшева' AND sheet_id IS NULL;
