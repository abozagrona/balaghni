-- =============================================================================
-- Migration 012 (ROLLBACK): Non-Destructive Rollback (NO CASCADE)
-- بَلِّغْنِي | BALAGHNI
--
-- إجراءات التشغيل الإلزامية قبل تنفيذ هذا الملف:
--   1. إيقاف مُشغِّل الـ Worker المستقل (Cron / QStash / pg_cron) لمنع أي حجوزات جديدة.
--   2. الانتظار حتى تصبح جميع العمليات الجارية 0 أو مرور مدة Lease (120 ثانية).
--   3. تنفيذ هذا السكربت داخل معاملة واحدة؛ يحوّل الحجوزات المعلّقة إلى abandoned_unknown،
--      يسقط جميع الدوال الـ 14 بدون CASCADE، يطهر بيانات OTP الحساسة، ويؤرشف الجدولين
--      مع الحفاظ الكامل على RLS + FORCE RLS وسحب الصلاحيات دون حذف بيانات التدقيق.
-- =============================================================================

BEGIN;

-- 1. تصريف أي عمليات claimed / sending معلّقة إلى abandoned_unknown قبل إسقاط الدوال
DO $$
BEGIN
  IF to_regclass('public.whatsapp_delivery_tracking') IS NOT NULL THEN
    UPDATE public.whatsapp_delivery_tracking
    SET
      sms_fallback_state = 'abandoned_unknown',
      sms_error          = COALESCE(sms_error, 'rollback_012_in_flight_unknown'),
      claim_token        = NULL,
      claim_expires_at   = NULL,
      updated_at         = now()
    WHERE sms_fallback_state IN ('claimed', 'sending');
  END IF;
END
$$;

-- 2. إسقاط جميع الدوال الـ 14 بتوقيعاتها الكاملة دون استخدام CASCADE
DROP FUNCTION IF EXISTS public.check_key_version_active_usage(smallint);
DROP FUNCTION IF EXISTS public.reconcile_stale_whatsapp_claims(timestamptz, boolean);
DROP FUNCTION IF EXISTS public.complete_sms_fallback_delivery(text, uuid, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.transition_sms_claim_to_sending(text, uuid, timestamptz);
DROP FUNCTION IF EXISTS public.claim_due_whatsapp_fallbacks(timestamptz, integer, integer);
DROP FUNCTION IF EXISTS public.claim_sms_fallback_delivery(text, timestamptz, text, integer);
DROP FUNCTION IF EXISTS public.update_whatsapp_delivery_status(text, text, timestamptz);
DROP FUNCTION IF EXISTS public.register_whatsapp_delivery(text, text, text, text, uuid, text, smallint, boolean, timestamptz);
DROP FUNCTION IF EXISTS public.commit_otp_verification_attempt(uuid, integer, boolean, timestamptz);
DROP FUNCTION IF EXISTS public.get_otp_session_for_worker_fallback(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.get_open_otp_session_for_verify(text, text, timestamptz);
DROP FUNCTION IF EXISTS public.cancel_pending_otp_session(uuid);
DROP FUNCTION IF EXISTS public.activate_otp_sms_session(uuid, text);
DROP FUNCTION IF EXISTS public.activate_otp_whatsapp_session(uuid, text, text, smallint, timestamptz);
DROP FUNCTION IF EXISTS public.create_otp_session_pending(text, text, smallint, smallint, smallint, text, text, text, timestamptz);

-- 3. إبطال جميع جلسات OTP المفتوحة وتطهير جميع البيانات الحساسة قبل الأرشفة
DO $$
BEGIN
  IF to_regclass('public.otp_sessions') IS NOT NULL THEN
    UPDATE public.otp_sessions
    SET
      status          = CASE WHEN status IN ('pending', 'active') THEN 'expired' ELSE status END,
      otp_hash        = NULL,
      otp_payload_enc = NULL,
      updated_at      = now()
    WHERE status IN ('pending', 'active')
       OR otp_hash IS NOT NULL
       OR otp_payload_enc IS NOT NULL;
  END IF;
END
$$;

-- 4. إعادة تسمية الجدولين للأرشفة دون حذف بيانات التدقيق (NO DROP TABLE, NO CASCADE)
DO $$
BEGIN
  IF to_regclass('public.whatsapp_delivery_tracking') IS NOT NULL
     AND to_regclass('public.whatsapp_delivery_tracking_archive_012') IS NULL THEN
    ALTER TABLE public.whatsapp_delivery_tracking
      RENAME TO whatsapp_delivery_tracking_archive_012;
  END IF;

  IF to_regclass('public.otp_sessions') IS NOT NULL
     AND to_regclass('public.otp_sessions_archive_012') IS NULL THEN
    ALTER TABLE public.otp_sessions
      RENAME TO otp_sessions_archive_012;
  END IF;
END
$$;

-- 5. تأكيد استمرار الحماية الصارمة (RLS + FORCE RLS + REVOKE ALL) على جداول الأرشيف
DO $$
BEGIN
  IF to_regclass('public.whatsapp_delivery_tracking_archive_012') IS NOT NULL THEN
    ALTER TABLE public.whatsapp_delivery_tracking_archive_012 ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.whatsapp_delivery_tracking_archive_012 FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.whatsapp_delivery_tracking_archive_012 FROM PUBLIC, anon, authenticated, service_role;
  END IF;

  IF to_regclass('public.otp_sessions_archive_012') IS NOT NULL THEN
    ALTER TABLE public.otp_sessions_archive_012 ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.otp_sessions_archive_012 FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.otp_sessions_archive_012 FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END
$$;

COMMIT;
