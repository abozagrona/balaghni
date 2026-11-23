-- =============================================================================
-- Migration 005 (UP): Least-Privilege RLS & Grants for public.tags ONLY
-- بَلِّغْنِي | BALAGHNI
-- السياسة المعتمدة:
--   - service_role: SELECT, INSERT, UPDATE فقط (منع DELETE تماماً).
--   - PUBLIC, anon, authenticated: سحب جميع الصلاحيات (0 صلاحيات).
--   - حذف السياسات العامة القديمة الثلاث.
--   - إبقاء RLS مفعّلة، وعدم تفعيل FORCE RLS، وعدم منح GRANT ALL أو Sequences.
--   - لا يمس أي جدول آخر ولا يغيّر بنية الجدول أو بياناته.
-- =============================================================================

BEGIN;

-- 1. ضمان تفعيل RLS دون تفعيل FORCE RLS
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

-- 2. حذف السياسات العامة القديمة الثلاث
DROP POLICY IF EXISTS "Allow public read of tags" ON public.tags;
DROP POLICY IF EXISTS "Allow seeding tags" ON public.tags;
DROP POLICY IF EXISTS "Allow tag activation and security setup" ON public.tags;

-- 3. سحب جميع الصلاحيات (بما فيها DELETE وTRUNCATE وREFERENCES وTRIGGER وMAINTAIN) من الجميع
REVOKE ALL ON TABLE public.tags FROM PUBLIC, anon, authenticated, service_role;

-- 4. منح أقل صلاحيات مطلوبة لدور الخادم فقط (SELECT, INSERT, UPDATE)
GRANT SELECT, INSERT, UPDATE ON TABLE public.tags TO service_role;

-- 5. سياسات منفصلة لكل عملية لـ service_role فقط (قابلة لإعادة التشغيل دون تكرار)
DROP POLICY IF EXISTS tags_service_role_select ON public.tags;
DROP POLICY IF EXISTS tags_service_role_insert ON public.tags;
DROP POLICY IF EXISTS tags_service_role_update ON public.tags;

CREATE POLICY tags_service_role_select
  ON public.tags
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY tags_service_role_insert
  ON public.tags
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY tags_service_role_update
  ON public.tags
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
