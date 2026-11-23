-- =============================================================================
-- Migration 010 (ROLLBACK): Restore PUBLIC EXECUTE on Trigger Functions
--   1. public.prevent_ai_audit_logs_mutation()
--   2. public.rls_auto_enable()
-- بَلِّغْنِي | BALAGHNI — VULN-09 Rollback
--
-- تنبيه مهم:
--   يعيد هذا الملف صلاحية EXECUTE إلى PUBLIC للدالتين لتطابق الحالة التي رُصدت
--   أثناء الفحص الحي لقاعدة الاختبار (BALAGHNI-SECURITY-TEST / yemhfpfdinmixhbfszvq)
--   قبل تطبيق Migration 010 فقط، وليس بالضرورة أي حالة تاريخية أخرى.
--   لا يغيّر هذا الملف مالك الدالتين (postgres) أو تعريفهما أو أي Trigger.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.prevent_ai_audit_logs_mutation()') IS NULL THEN
    RAISE EXCEPTION 'Rollback pre-check failed: public.prevent_ai_audit_logs_mutation() does not exist';
  END IF;

  IF to_regprocedure('public.rls_auto_enable()') IS NULL THEN
    RAISE EXCEPTION 'Rollback pre-check failed: public.rls_auto_enable() does not exist';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.prevent_ai_audit_logs_mutation() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO PUBLIC;

DO $$
DECLARE
  v_fn_ai_oid oid := to_regprocedure('public.prevent_ai_audit_logs_mutation()');
  v_fn_rls_oid oid := to_regprocedure('public.rls_auto_enable()');
BEGIN
  IF NOT has_function_privilege('public', v_fn_ai_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback post-check failed: PUBLIC EXECUTE not restored on prevent_ai_audit_logs_mutation()';
  END IF;

  IF NOT has_function_privilege('public', v_fn_rls_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback post-check failed: PUBLIC EXECUTE not restored on rls_auto_enable()';
  END IF;
END $$;

COMMIT;
