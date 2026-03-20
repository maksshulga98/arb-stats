-- Run this in Supabase SQL Editor

-- 1. Add team column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS team TEXT DEFAULT NULL;
-- Possible values: 'anastasia', 'yasmin', 'olya', 'karina', 'nikita'

-- 2. Create reports table
CREATE TABLE IF NOT EXISTS reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  unsubscribed INTEGER DEFAULT 0,   -- отписанные (anastasia, yasmin, olya, karina)
  replied INTEGER DEFAULT 0,        -- ответившие (anastasia, yasmin, olya, karina)
  ordered_ip INTEGER DEFAULT 0,     -- заказали ИП (all teams except karina)
  ordered_cards INTEGER DEFAULT 0,  -- заказано карт (karina only)
  people_wrote INTEGER DEFAULT 0,   -- написало людей (nikita only)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Enable RLS
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- 4. Admins can view all reports
CREATE POLICY "Admins can view all reports" ON reports
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 5. Managers can view their own reports
CREATE POLICY "Managers can view own reports" ON reports
  FOR SELECT USING (manager_id = auth.uid());

-- 6. Managers can insert their own reports
CREATE POLICY "Managers can insert own reports" ON reports
  FOR INSERT WITH CHECK (manager_id = auth.uid());

-- 7. Example: set team for a manager (replace with real user ids)
-- UPDATE profiles SET team = 'anastasia' WHERE id = '<manager-uuid>';
