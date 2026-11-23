-- =============================================================================
-- Migration 013 (UP): Fix SEC-C1 — Prevent Concurrent / Replay 'verified' Outcome
-- بَلِّغْنِي | BALAGHNI
--
-- الاعتمادية:
--   - تعتمد على تطبيق Migration 012 (20261121_012_whatsapp_delivery_and_otp_sessions.sql)
--     التي أنشأت جدول public.otp_sessions وجدول public.whatsapp_delivery_tracking
--     ودالة public.commit_otp_verification_attempt.
--
-- سبب التعديل (SEC-C1):
--   في Migration 012 كانت الدالة تعيد v_row.status::text عندما يكون الصف في حالة
--   نهائية، مما كان يؤدي إلى إعادة 'verified' مرة أخرى عند وصول طلب متزامن أو معاد
--   لجلسة أصبحت verified بالفعل.
--
-- الإصلاح:
--   - إعادة 'already_verified' صراحةً عندما تكون v_row.status = 'verified'.
--   - حصر إعادة 'verified' بمسار الانتقال الذري الوحيد من pending/active إلى verified
--     تحت قفل FOR UPDATE، بحيث لا تظهر نتيجة 'verified' إلا مرة واحدة فقط لكل جلسة.
--   - الإبقاء على حالات locked / expired / superseded / failed كحالات رفض صريحة.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.commit_otp_verification_attempt(
  p_session_id        uuid,
  p_expected_attempts integer,
  p_matched           boolean,
  p_now               timestamptz DEFAULT now()
)
RETURNS TABLE (
  outcome            text,
  attempts_remaining integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row      public.otp_sessions%ROWTYPE;
  v_next_att integer;
BEGIN
  SELECT * INTO v_row
  FROM public.otp_sessions s
  WHERE s.id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, 0;
    RETURN;
  END IF;

  -- SEC-C1: منع إعادة 'verified' لأي طلب متزامن أو معاد بعد تحقق الجلسة
  IF v_row.status = 'verified' THEN
    RETURN QUERY SELECT 'already_verified'::text, 0;
    RETURN;
  END IF;

  -- الحالات النهائية الأخرى (expired, locked, superseded, failed) تُعاد كما هي كرفض صريح
  IF v_row.status NOT IN ('pending', 'active') THEN
    RETURN QUERY SELECT v_row.status::text, 0;
    RETURN;
  END IF;

  IF p_now > v_row.expires_at THEN
    UPDATE public.otp_sessions s
    SET
      status          = 'expired',
      otp_hash        = NULL,
      otp_payload_enc = NULL,
      updated_at      = p_now
    WHERE s.id = p_session_id;

    UPDATE public.whatsapp_delivery_tracking t
    SET
      sms_fallback_state  = 'skipped',
      sms_fallback_reason = 'otp_session_expired',
      claim_token         = NULL,
      claim_expires_at    = NULL,
      updated_at          = p_now
    WHERE t.otp_session_id = p_session_id
      AND t.sms_fallback_state IN ('queued', 'claimed');

    RETURN QUERY SELECT 'expired'::text, 0;
    RETURN;
  END IF;

  -- تحقق CAS لمنع سباق المحاولات المتزامنة
  IF v_row.attempts <> p_expected_attempts THEN
    RETURN QUERY SELECT 'conflict_retry'::text, GREATEST(0, v_row.max_attempts - v_row.attempts);
    RETURN;
  END IF;

  IF v_row.attempts >= v_row.max_attempts THEN
    UPDATE public.otp_sessions s
    SET
      status          = 'locked',
      otp_hash        = NULL,
      otp_payload_enc = NULL,
      updated_at      = p_now
    WHERE s.id = p_session_id;

    RETURN QUERY SELECT 'locked'::text, 0;
    RETURN;
  END IF;

  v_next_att := v_row.attempts + 1;

  -- المسار الوحيد الذي يعيد 'verified' (مرة واحدة فقط لكل جلسة)
  IF p_matched THEN
    UPDATE public.otp_sessions s
    SET
      status          = 'verified',
      attempts        = v_next_att,
      verified_at     = p_now,
      otp_hash        = NULL,
      otp_payload_enc = NULL,
      updated_at      = p_now
    WHERE s.id = p_session_id;

    -- إلغاء أي SMS fallback لم يبدأ إرساله بعد
    UPDATE public.whatsapp_delivery_tracking t
    SET
      sms_fallback_state  = 'skipped',
      sms_fallback_reason = 'otp_session_verified',
      claim_token         = NULL,
      claim_expires_at    = NULL,
      updated_at          = p_now
    WHERE t.otp_session_id = p_session_id
      AND t.sms_fallback_state IN ('queued', 'claimed');

    RETURN QUERY SELECT 'verified'::text, 0;
    RETURN;
  END IF;

  IF v_next_att >= v_row.max_attempts THEN
    UPDATE public.otp_sessions s
    SET
      status          = 'locked',
      attempts        = v_next_att,
      otp_hash        = NULL,
      otp_payload_enc = NULL,
      updated_at      = p_now
    WHERE s.id = p_session_id;

    UPDATE public.whatsapp_delivery_tracking t
    SET
      sms_fallback_state  = 'skipped',
      sms_fallback_reason = 'otp_session_locked',
      claim_token         = NULL,
      claim_expires_at    = NULL,
      updated_at          = p_now
    WHERE t.otp_session_id = p_session_id
      AND t.sms_fallback_state IN ('queued', 'claimed');

    RETURN QUERY SELECT 'locked'::text, 0;
    RETURN;
  END IF;

  UPDATE public.otp_sessions s
  SET
    attempts   = v_next_att,
    updated_at = p_now
  WHERE s.id = p_session_id;

  RETURN QUERY SELECT 'invalid'::text, GREATEST(0, v_row.max_attempts - v_next_att);
END;
$$;

ALTER FUNCTION public.commit_otp_verification_attempt(uuid, integer, boolean, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commit_otp_verification_attempt(uuid, integer, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_otp_verification_attempt(uuid, integer, boolean, timestamptz) TO service_role;

COMMIT;
