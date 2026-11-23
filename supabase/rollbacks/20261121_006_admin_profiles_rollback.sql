-- =============================================================================
-- Migration 006 (ROLLBACK): Safe Rollback for public.admin_profiles ONLY
-- بَلِّغْنِي | BALAGHNI
-- توثيق الحالة بعد Rollback:
--   - يعيد هذا التراجع جدول public.admin_profiles إلى وضع مغلق وآمن تماماً، وليس إلى الحالة العامة القديمة.
--   - تبقى RLS مفعّلة (ENABLE ROW LEVEL SECURITY).
--   - تبقى السياسة العامة القديمة "Allow access to admin_profiles" محذوفة ولا تُعاد أبداً.
--   - يبقى PUBLIC وanon وauthenticated وservice_role دون أي صلاحيات.
--   - لا يحذف أي بيانات من الجدول ولا يمس أي جدول آخر.
-- =============================================================================

BEGIN;

-- 1. إبقاء RLS مفعّلة
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;

-- 2. حذف سياسات service_role الجديدة فقط
DROP POLICY IF EXISTS admin_profiles_service_role_select ON public.admin_profiles;
DROP POLICY IF EXISTS admin_profiles_service_role_insert ON public.admin_profiles;
DROP POLICY IF EXISTS admin_profiles_service_role_update ON public.admin_profiles;

-- 3. سحب جميع الصلاحيات من service_role وPUBLIC وanon وauthenticated
REVOKE ALL ON TABLE public.admin_profiles FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
