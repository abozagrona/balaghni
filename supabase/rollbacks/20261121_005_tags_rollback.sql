-- =============================================================================
-- Migration 005 (ROLLBACK): Safe Rollback for public.tags ONLY
-- بَلِّغْنِي | BALAGHNI
-- توثيق الحالة بعد Rollback:
--   - يعيد هذا التراجع جدول public.tags إلى وضع مغلق وآمن تماماً، وليس إلى الحالة العامة القديمة.
--   - تبقى RLS مفعّلة (ENABLE ROW LEVEL SECURITY).
--   - تبقى السياسات العامة القديمة الثلاث محذوفة ولا تُعاد أبداً.
--   - يبقى PUBLIC وanon وauthenticated دون أي صلاحيات.
--   - تُسحب صلاحيات SELECT, INSERT, UPDATE من service_role وتُحذف سياساته الجديدة.
-- =============================================================================

BEGIN;

-- 1. إبقاء RLS مفعّلة
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

-- 2. حذف سياسات service_role الجديدة فقط
DROP POLICY IF EXISTS tags_service_role_select ON public.tags;
DROP POLICY IF EXISTS tags_service_role_insert ON public.tags;
DROP POLICY IF EXISTS tags_service_role_update ON public.tags;

-- 3. سحب كافة صلاحيات service_role بالكامل (بما فيها Dxtm وarw)
REVOKE ALL ON TABLE public.tags FROM service_role;

-- 4. الإبقاء على سحب جميع الصلاحيات من PUBLIC وanon وauthenticated
REVOKE ALL ON TABLE public.tags FROM PUBLIC, anon, authenticated;

COMMIT;
