-- =============================================================================
-- Migration 008 (ROLLBACK): Safe Rollback for public.admin_audit_logs ONLY
-- بَلِّغْنِي | BALAGHNI
-- توثيق الحالة بعد Rollback:
--   - يحذف Trigger ودالة الحماية الجديدة فقط.
--   - يحذف سياسات service_role الجديدة ويسحب جميع الصلاحيات من PUBLIC, anon, authenticated, service_role.
--   - يُبقي RLS مفعّلة ولا يعيد السياسة العامة القديمة أبداً.
--   - لا يحذف أي بيانات ولا يمس أي جدول آخر.
-- =============================================================================

BEGIN;

-- 1. حذف الـ Trigger ودالة الحماية
DROP TRIGGER IF EXISTS trg_admin_audit_logs_append_only ON public.admin_audit_logs;
DROP FUNCTION IF EXISTS public.prevent_admin_audit_logs_mutation();

-- 2. إبقاء RLS مفعّلة
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- 3. حذف السياسات الجديدة فقط
DROP POLICY IF EXISTS admin_audit_logs_service_role_select ON public.admin_audit_logs;
DROP POLICY IF EXISTS admin_audit_logs_service_role_insert ON public.admin_audit_logs;

-- 4. سحب جميع الصلاحيات من الأدوار المحددة (وضع مغلق وآمن دون إعادة السياسة العامة)
REVOKE ALL ON TABLE public.admin_audit_logs FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
