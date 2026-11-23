-- =============================================================================
-- Migration 011 (ROLLBACK): Remove Distributed Nonce Consumption Table & RPC
-- بَلِّغْنِي | BALAGHNI — VULN-04 Rollback
--
-- تنبيه مهم:
--   يحذف هذا الملف الدالة public.consume_security_nonce والجدول
--   public.consumed_security_nonces فقط، دون المساس بأي جدول أو دالة أخرى.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.consume_security_nonce(text, text, text, timestamptz);
DROP TABLE IF EXISTS public.consumed_security_nonces;

DO $$
BEGIN
  IF to_regprocedure('public.consume_security_nonce(text, text, text, timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback post-check failed: consume_security_nonce still exists';
  END IF;

  IF to_regclass('public.consumed_security_nonces') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback post-check failed: consumed_security_nonces still exists';
  END IF;
END $$;

COMMIT;
