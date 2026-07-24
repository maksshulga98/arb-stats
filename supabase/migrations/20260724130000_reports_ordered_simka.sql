-- Новый доп-продукт «Симка Билайн» в дневных отчётах.
-- Отдельная метрика "Заказали Симка" — НЕ влияет на конверсию
-- (конверсия = ordered_ip / people_wrote, симку туда не пускаем).
ALTER TABLE reports ADD COLUMN IF NOT EXISTS ordered_simka INT DEFAULT 0;
