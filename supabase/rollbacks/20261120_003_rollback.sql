-- =============================================================================
-- Migration 003 (ROLLBACK): تراجع آمن لا يعيد تفعيل التوكنات الملغاة
-- بَلِّغْنِي | BALAGHNI
-- تحذير أمني مهم:
--   حذف جدول revoked_report_tokens أثناء سريان مدة التوكنات (ساعتان) قد يعيد
--   قبول توكنات سبق إلغاؤها ما لم يتم:
--     1) تدوير SESSION_HMAC_SECRET (لإبطال جميع التوكنات فوراً)، أو
--     2) الإبقاء على وضع fail-closed في is_report_token_revoked (تُرجع true)
--        حتى انتهاء نافذة الساعتين.
-- لذلك يقوم هذا التراجع بأرشفة الجدول (بدلاً من حذفه) وإيقاف الدوال مع سجل تدقيق،
-- مما يضمن بقاء الخادم في حالة fail-closed (رفض 401) حتى استكمال التراجع الآمن.
-- =============================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.is_report_token_revoked(text, text) FROM service_role;
REVOKE ALL ON FUNCTION public.revoke_report_token(text, text, timestamptz) FROM service_role;

DROP FUNCTION IF EXISTS public.is_report_token_revoked(text, text);
DROP FUNCTION IF EXISTS public.is_report_token_revoked(text);
DROP FUNCTION IF EXISTS public.revoke_report_token(text, text, timestamptz);

-- أرشفة جدول الإلغاءات بدلاً من حذفه لمنع فقدان سجل التوكنات الملغاة
ALTER TABLE IF EXISTS public.revoked_report_tokens
  RENAME TO revoked_report_tokens_archived;

COMMIT;
