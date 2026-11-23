-- =============================================================================
-- Migration 008 (UP): Append-Only Enforcement & Least-Privilege RLS for
--   public.admin_audit_logs ONLY
-- بَلِّغْنِي | BALAGHNI
-- السياسة المعتمدة:
--   - تفعيل RLS دون تفعيل FORCE RLS.
--   - حذف السياسة العامة القديمة "Allow access to admin_audit_logs".
--   - سحب جميع الصلاحيات من PUBLIC, anon, authenticated, service_role أولاً.
--   - منح service_role صلاحية SELECT وINSERT فقط (بدون UPDATE/DELETE/Dxtm).
--   - إنشاء سياستين منفصلتين لـ SELECT وINSERT لـ service_role فقط.
--   - إنشاء دالة وTrigger (BEFORE UPDATE OR DELETE) لمنع تعديل أو حذف سجلات التدقيق.
-- =============================================================================

BEGIN;

-- 1. تفعيل RLS دون تفعيل FORCE RLS
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- 2. حذف السياسة العامة القديمة
DROP POLICY IF EXISTS "Allow access to admin_audit_logs" ON public.admin_audit_logs;

-- 3. سحب جميع الصلاحيات (بما فيها UPDATE وDELETE وDxtm) من الجميع أولاً
REVOKE ALL ON TABLE public.admin_audit_logs FROM PUBLIC, anon, authenticated, service_role;

-- 4. منح service_role صلاحية القراءة والإدراج فقط (Append-Only)
GRANT SELECT, INSERT ON TABLE public.admin_audit_logs TO service_role;

-- 5. سياسات منفصلة لـ SELECT وINSERT مخصصة لـ service_role فقط (Idempotent)
DROP POLICY IF EXISTS admin_audit_logs_service_role_select ON public.admin_audit_logs;
DROP POLICY IF EXISTS admin_audit_logs_service_role_insert ON public.admin_audit_logs;

CREATE POLICY admin_audit_logs_service_role_select
  ON public.admin_audit_logs
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY admin_audit_logs_service_role_insert
  ON public.admin_audit_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 6. دالة الحماية Append-Only (تمنع أي UPDATE أو DELETE على صفوف السجل)
CREATE OR REPLACE FUNCTION public.prevent_admin_audit_logs_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs is append-only: % is prohibited', TG_OP
    USING ERRCODE = '42501';
END;
$$;

ALTER FUNCTION public.prevent_admin_audit_logs_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_admin_audit_logs_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

-- 7. Trigger قبل أي UPDATE أو DELETE
DROP TRIGGER IF EXISTS trg_admin_audit_logs_append_only ON public.admin_audit_logs;
CREATE TRIGGER trg_admin_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON public.admin_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_admin_audit_logs_mutation();

COMMIT;
