-- =============================================================================
--  ARB TEAM — seed users
--  Запустить в Supabase → SQL Editor
--
--  Логины и пароли:
-- =============================================================================
--
--  ТИМЛИДЫ
--  anastasia.gnidkina@arbteam.ru   Arb2024!  (команда anastasia)
--  yasmin.usmanova@arbteam.ru      Arb2024!  (команда yasmin)
--  olga.alexandrovna@arbteam.ru    Arb2024!  (команда olya)
--  karina.kalinina@arbteam.ru      Arb2024!  (команда karina)
--  nikita.tatarintsev@arbteam.ru   Arb2024!  (команда nikita)
--
--  МЕНЕДЖЕРЫ — команда anastasia
--  anna.ovchinnikova@arbteam.ru    Arb2024!
--  diana.irisbaeva@arbteam.ru      Arb2024!
--  yuno.gasai@arbteam.ru           Arb2024!
--  tanya.gaponko@arbteam.ru        Arb2024!
--  lera.ziborova@arbteam.ru        Arb2024!
--  kristina.frolova@arbteam.ru     Arb2024!
--  nastya.alekseeva@arbteam.ru     Arb2024!
--
--  МЕНЕДЖЕРЫ — команда yasmin
--  varvara.kubasova@arbteam.ru     Arb2024!
--  diana.azimova@arbteam.ru        Arb2024!
--  anastasia.alferovich@arbteam.ru Arb2024!
--  ari.m@arbteam.ru                Arb2024!
--  lelya.kotova@arbteam.ru         Arb2024!
--  kristina.gerasimenko@arbteam.ru Arb2024!
--  karina.tikhomirova@arbteam.ru   Arb2024!
--
--  МЕНЕДЖЕРЫ — команда olya
--  ves.p@arbteam.ru                Arb2024!
--
--  МЕНЕДЖЕРЫ — команда karina
--  alinka.butenko@arbteam.ru       Arb2024!
--  oska.shogenova@arbteam.ru       Arb2024!
--  kseniya.chelik@arbteam.ru       Arb2024!
--
--  МЕНЕДЖЕРЫ — команда nikita
--  angelina.rvacheva@arbteam.ru    Arb2024!
--  karina.fattakhova@arbteam.ru    Arb2024!
--  oksana.stadnikova@arbteam.ru    Arb2024!
--  anna.lalkina@arbteam.ru         Arb2024!
--  polina.strakhova@arbteam.ru     Arb2024!
--  dasha.utyasheva@arbteam.ru      Arb2024!
--  karolina.volkova@arbteam.ru     Arb2024!
--
-- =============================================================================

-- Вспомогательная функция — создаёт auth-пользователя + профиль.
-- Пропускает если email уже существует.
CREATE OR REPLACE FUNCTION _seed_create_user(
  p_email  TEXT,
  p_name   TEXT,
  p_role   TEXT,
  p_team   TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_uid UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RAISE NOTICE 'Пользователь % уже существует, пропускаем', p_email;
    RETURN;
  END IF;

  v_uid := gen_random_uuid();

  -- 1. Создаём auth-пользователя
  INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    v_uid,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    p_email,
    crypt('Arb2024!', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    NOW(), NOW()
  );

  -- 2. Создаём identity (нужно для входа по email/паролю)
  INSERT INTO auth.identities (
    id, provider_id, user_id,
    identity_data,
    provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    v_uid, p_email, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', p_email),
    'email',
    NOW(), NOW(), NOW()
  );

  -- 3. Создаём профиль в публичной таблице
  INSERT INTO public.profiles (id, email, name, role, team)
  VALUES (v_uid, p_email, p_name, p_role, p_team)
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Создан: % (%)', p_name, p_email;
END;
$$;

-- =============================================================================
--  ТИМЛИДЫ
-- =============================================================================

SELECT _seed_create_user('anastasia.gnidkina@arbteam.ru',   'Анастасия Гнидкина',   'teamlead', 'anastasia');
SELECT _seed_create_user('yasmin.usmanova@arbteam.ru',      'Ясмин Усманова',       'teamlead', 'yasmin');
SELECT _seed_create_user('olga.alexandrovna@arbteam.ru',    'Olga Alexandrovna',    'teamlead', 'olya');
SELECT _seed_create_user('karina.kalinina@arbteam.ru',      'Карина Калинина',      'teamlead', 'karina');
SELECT _seed_create_user('nikita.tatarintsev@arbteam.ru',   'Никита Татаринцев',    'teamlead', 'nikita');

-- =============================================================================
--  МЕНЕДЖЕРЫ — команда Анастасии
-- =============================================================================

SELECT _seed_create_user('anna.ovchinnikova@arbteam.ru',  'Анна Овчинникова',    'manager', 'anastasia');
SELECT _seed_create_user('diana.irisbaeva@arbteam.ru',    'Диана Ирисбаева',     'manager', 'anastasia');
SELECT _seed_create_user('yuno.gasai@arbteam.ru',         'Yuno Gasai',          'manager', 'anastasia');
SELECT _seed_create_user('tanya.gaponko@arbteam.ru',      'Таня Гапонько',       'manager', 'anastasia');
SELECT _seed_create_user('lera.ziborova@arbteam.ru',      'Лера Зиборова',       'manager', 'anastasia');
SELECT _seed_create_user('kristina.frolova@arbteam.ru',   'Кристина Фролова',    'manager', 'anastasia');
SELECT _seed_create_user('nastya.alekseeva@arbteam.ru',   'Настя Алексеева',     'manager', 'anastasia');

-- =============================================================================
--  МЕНЕДЖЕРЫ — команда Ясмин
-- =============================================================================

SELECT _seed_create_user('varvara.kubasova@arbteam.ru',     'Варвара Кубасова',       'manager', 'yasmin');
SELECT _seed_create_user('diana.azimova@arbteam.ru',        'Диана Азимова',          'manager', 'yasmin');
SELECT _seed_create_user('anastasia.alferovich@arbteam.ru', 'Анастасия Альферович',   'manager', 'yasmin');
SELECT _seed_create_user('ari.m@arbteam.ru',                'Ari M',                  'manager', 'yasmin');
SELECT _seed_create_user('lelya.kotova@arbteam.ru',         'Lelya Kotova',           'manager', 'yasmin');
SELECT _seed_create_user('kristina.gerasimenko@arbteam.ru', 'Кристина Герасименко',   'manager', 'yasmin');
SELECT _seed_create_user('karina.tikhomirova@arbteam.ru',   'Карина Тихомирова',      'manager', 'yasmin');

-- =============================================================================
--  МЕНЕДЖЕРЫ — команда Оли
-- =============================================================================

SELECT _seed_create_user('ves.p@arbteam.ru', 'Վес Պ.', 'manager', 'olya');

-- =============================================================================
--  МЕНЕДЖЕРЫ — команда Карины
-- =============================================================================

SELECT _seed_create_user('alinka.butenko@arbteam.ru',  'Алинка Бутенко',  'manager', 'karina');
SELECT _seed_create_user('oska.shogenova@arbteam.ru',  'Оська Шогенова',  'manager', 'karina');
SELECT _seed_create_user('kseniya.chelik@arbteam.ru',  'Ксения Челик',    'manager', 'karina');

-- =============================================================================
--  МЕНЕДЖЕРЫ — команда Никиты
-- =============================================================================

SELECT _seed_create_user('angelina.rvacheva@arbteam.ru',  'Ангелина Рвачева',   'manager', 'nikita');
SELECT _seed_create_user('karina.fattakhova@arbteam.ru',  'Карина Фаттахова',   'manager', 'nikita');
SELECT _seed_create_user('oksana.stadnikova@arbteam.ru',  'Оксана Стадникова',  'manager', 'nikita');
SELECT _seed_create_user('anna.lalkina@arbteam.ru',       'Анна Лалкина',       'manager', 'nikita');
SELECT _seed_create_user('polina.strakhova@arbteam.ru',   'Полина Страхова',    'manager', 'nikita');
SELECT _seed_create_user('dasha.utyasheva@arbteam.ru',    'Даша Утяшева',       'manager', 'nikita');
SELECT _seed_create_user('karolina.volkova@arbteam.ru',   'Каролина Волкова',   'manager', 'nikita');

-- =============================================================================
--  Убираем вспомогательную функцию
-- =============================================================================

DROP FUNCTION _seed_create_user(TEXT, TEXT, TEXT, TEXT);

-- Проверка: посмотреть всех созданных пользователей
-- SELECT name, email, role, team FROM public.profiles ORDER BY role, team, name;
