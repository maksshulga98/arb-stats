-- Защита исторических данных от каскадного удаления вместе с профилем.
--
-- Что случилось 08.2026: при «увольнении» менеджера код удалял его учётку в
-- Supabase Auth. profiles.id завязан на auth.users каскадом → строка профиля
-- исчезала, а следом (ON DELETE CASCADE) удалялись ВСЕ его отчёты и заявки.
-- Мягкое удаление (role='deleted') при этом обнулялось: профилей с такой ролью
-- в базе не осталось вообще.
--
-- Лечение в двух местах:
--   1) код больше не удаляет учётку, а банит её (см. app/api/managers/[id]);
--   2) здесь: CASCADE → RESTRICT на исторических таблицах. Теперь попытка
--      удалить профиль, у которого есть отчёты или заявки, будет ОТКЛОНЕНА
--      базой, а не выполнена молча. Данные потерять нельзя даже вручную.

-- Отчёты
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_manager_id_fkey;
ALTER TABLE public.reports ADD CONSTRAINT reports_manager_id_fkey
  FOREIGN KEY (manager_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- Заявки «Счёт ИП»
ALTER TABLE public.account_applications DROP CONSTRAINT IF EXISTS account_applications_manager_id_fkey;
ALTER TABLE public.account_applications ADD CONSTRAINT account_applications_manager_id_fkey
  FOREIGN KEY (manager_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- Заявки «Ссылка ИП» (старый оффер)
ALTER TABLE public.ip_applications DROP CONSTRAINT IF EXISTS ip_applications_manager_id_fkey;
ALTER TABLE public.ip_applications ADD CONSTRAINT ip_applications_manager_id_fkey
  FOREIGN KEY (manager_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- Заявки в банк (новый алгоритм)
ALTER TABLE public.bank_link_jobs DROP CONSTRAINT IF EXISTS bank_link_jobs_manager_id_fkey;
ALTER TABLE public.bank_link_jobs ADD CONSTRAINT bank_link_jobs_manager_id_fkey
  FOREIGN KEY (manager_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- Предупреждения (фича скрыта, но данные храним)
ALTER TABLE public.manager_warnings DROP CONSTRAINT IF EXISTS manager_warnings_manager_id_fkey;
ALTER TABLE public.manager_warnings ADD CONSTRAINT manager_warnings_manager_id_fkey
  FOREIGN KEY (manager_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- Выдачи контактов (фича скрыта, но данные храним)
ALTER TABLE public.contact_distributions DROP CONSTRAINT IF EXISTS contact_distributions_manager_id_fkey;
ALTER TABLE public.contact_distributions ADD CONSTRAINT contact_distributions_manager_id_fkey
  FOREIGN KEY (manager_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
