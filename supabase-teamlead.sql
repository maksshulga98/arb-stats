-- Run this in Supabase SQL Editor to enable teamlead role

-- 1. RLS: teamleads can view reports of managers in their team
CREATE POLICY "Teamleads can view team reports" ON reports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles tl
      JOIN profiles mgr ON mgr.team = tl.team AND mgr.id = reports.manager_id
      WHERE tl.id = auth.uid() AND tl.role = 'teamlead'
    )
  );

-- 2. RLS: admins can delete any report
CREATE POLICY "Admins can delete reports" ON reports
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 3. RLS: teamleads can delete reports of managers in their team
CREATE POLICY "Teamleads can delete team reports" ON reports
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles tl
      JOIN profiles mgr ON mgr.team = tl.team AND mgr.id = reports.manager_id
      WHERE tl.id = auth.uid() AND tl.role = 'teamlead'
    )
  );

-- 4. RLS: teamleads can also delete their own reports
CREATE POLICY "Teamleads can delete own reports" ON reports
  FOR DELETE USING (manager_id = auth.uid());

-- 5. RLS: allow teamleads to read profiles of managers in their team
--    (needed so the teamlead page can list managers)
--    If your profiles table has RLS enabled, add this:
-- CREATE POLICY "Teamleads can view team profiles" ON profiles
--   FOR SELECT USING (
--     id = auth.uid()
--     OR EXISTS (
--       SELECT 1 FROM profiles tl
--       WHERE tl.id = auth.uid() AND tl.role = 'teamlead' AND profiles.team = tl.team
--         AND profiles.role = 'manager'
--     )
--   );

-- 6. Example: set teamlead role for a user
-- UPDATE profiles SET role = 'teamlead', team = 'anastasia' WHERE id = '<user-uuid>';

-- Note: SUPABASE_SERVICE_ROLE_KEY must be added to .env.local for the
-- /api/managers endpoints (create/delete manager) to work.
