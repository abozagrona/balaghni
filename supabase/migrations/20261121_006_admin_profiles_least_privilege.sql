-- =============================================================================
-- Migration 006 (UP): Least-Privilege RLS & Grants for public.admin_profiles ONLY
-- بَلِّغْنِي | BALAGHNI
-- السياسة المعتمدة (الخيار A):
--   - service_role: SELECT, INSERT, UPDATE فقط (منع DELETE وTRUNCATE وREFERENCES وTRIGGER وMAINTAIN).
--   - PUBLIC, anon, authenticated: سحب جميع الصلاحيات (0 صلاحيات).
--   - حذف السياسة العامة القديمة "Allow access to admin_profiles".
--   - إبقاء RLS مفعّلة، وعدم تفعيل FORCE RLS، وعدم منح GRANT ALL.
--   - لا يمس أي جدول آخر ولا يغيّر بنية الجدول أو بياناته.
-- =============================================================================

BEGIN;

-- 1. ضمان تفعيل RLS دون تفعيل FORCE RLS
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;

-- 2. حذف السياسة العامة القديمة
DROP POLICY IF EXISTS "Allow access to admin_profiles" ON public.admin_profiles;

-- 3. سحب جميع الصلاحيات (بما فيها DELETE وDxtm) من جميع الأدوار أولاً
REVOKE ALL ON TABLE public.admin_profiles FROM PUBLIC, anon, authenticated, service_role;

-- 4. منح أقل صلاحيات مطلوبة لدور الخادم فقط (SELECT, INSERT, UPDATE)
GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_profiles TO service_role;

-- 5. سياسات منفصلة لكل عملية لـ service_role فقط (قابلة لإعادة التشغيل دون تكرار)
DROP POLICY IF EXISTS admin_profiles_service_role_select ON public.admin_profiles;
DROP POLICY IF EXISTS admin_profiles_service_role_insert ON public.admin_profiles;
DROP POLICY IF EXISTS admin_profiles_service_role_update ON public.admin_profiles;

CREATE POLICY admin_profiles_service_role_select
  ON public.admin_profiles
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY admin_profiles_service_role_insert
  ON public.admin_profiles
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY admin_profiles_service_role_update
  ON public.admin_profiles
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
