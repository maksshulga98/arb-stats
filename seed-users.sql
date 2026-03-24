-- =============================================================================
--  ШАБЛОН: создание пользователей
--  Запустить в Supabase → SQL Editor
--
--  Замените данные на свои:
--  - email'ы, имена, роли и команды
--  - пароль по умолчанию: Arb2024! (измените на свой)
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
    crypt('Arb2024!', gen_salt('bf')),  -- ИЗМЕНИТЕ ПАРОЛЬ
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    NOW(), NOW()
  );

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

  INSERT INTO public.profiles (id, email, name, role, team)
  VALUES (v_uid, p_email, p_name, p_role, p_team)
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Создан: % (%)', p_name, p_email;
END;
$$;

-- =============================================================================
--  АДМИН (обязательно создать хотя бы одного)
-- =============================================================================

-- SELECT _seed_create_user('admin@yourcompany.ru', 'Имя Админа', 'admin', NULL);

-- =============================================================================
--  ТИМЛИДЫ (по одному на команду)
-- =============================================================================

-- SELECT _seed_create_user('teamlead1@yourcompany.ru', 'Имя Тимлида 1', 'teamlead', 'team1');
-- SELECT _seed_create_user('teamlead2@yourcompany.ru', 'Имя Тимлида 2', 'teamlead', 'team2');

-- =============================================================================
--  МЕНЕДЖЕРЫ
-- =============================================================================

-- SELECT _seed_create_user('manager1@yourcompany.ru', 'Имя Менеджера 1', 'manager', 'team1');
-- SELECT _seed_create_user('manager2@yourcompany.ru', 'Имя Менеджера 2', 'manager', 'team1');

-- =============================================================================
--  Убираем вспомогательную функцию
-- =============================================================================

DROP FUNCTION _seed_create_user(TEXT, TEXT, TEXT, TEXT);

-- Проверка: посмотреть всех созданных пользователей
-- SELECT name, email, role, team FROM public.profiles ORDER BY role, team, name;
