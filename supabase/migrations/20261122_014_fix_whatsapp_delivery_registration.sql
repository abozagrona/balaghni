-- =============================================================================
-- Migration 014 (UP): Fix SQLSTATE 42702 in public.register_whatsapp_delivery
-- بَلِّغْنِي | BALAGHNI
--
-- الاعتمادية:
--   - تعتمد على تطبيق Migration 012 (20261121_012_whatsapp_delivery_and_otp_sessions.sql)
--     التي أنشأت جدول public.whatsapp_delivery_tracking بالقيد الأساسي
--     whatsapp_delivery_tracking_pkey على العمود message_sid.
--
-- سبب الإصلاح (SQLSTATE 42702):
--   في Migration 012 عرّفت الدالة public.register_whatsapp_delivery عمود إرجاع
--   باسم message_sid داخل RETURNS TABLE (registered boolean, message_sid text)،
--   مما أنشأ متغير إخراج ضمنياً باسم message_sid داخل PL/pgSQL وتعارض مع عبارة
--   ON CONFLICT (message_sid) DO NOTHING (column reference "message_sid" is ambiguous).
--
-- التعديل الدقيق:
--   استبدال ON CONFLICT (message_sid) DO NOTHING فقط بعبارة
--   ON CONFLICT ON CONSTRAINT whatsapp_delivery_tracking_pkey DO NOTHING
--   مع الحفاظ الحرفي على التوقيع وجدول الإرجاع وجميع الشروط والصلاحيات الأمنية.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.register_whatsapp_delivery(
  p_message_sid            text,
  p_message_kind           text,
  p_report_id              text,
  p_tag_code               text,
  p_otp_session_id         uuid,
  p_recipient_phone_hash   text,
  p_phone_hmac_key_version smallint,
  p_sms_fallback_enabled   boolean,
  p_fallback_after_at      timestamptz
)
RETURNS TABLE (
  registered  boolean,
  message_sid text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sid        text := trim(coalesce(p_message_sid, ''));
  v_phone_hash text := lower(trim(coalesce(p_recipient_phone_hash, '')));
  v_now        timestamptz := now();
BEGIN
  IF length(v_sid) < 8 OR length(v_sid) > 128 THEN
    RETURN QUERY SELECT false, ''::text;
    RETURN;
  END IF;

  IF p_message_kind NOT IN ('otp', 'notification') THEN
    RAISE EXCEPTION 'invalid p_message_kind' USING ERRCODE = '22023';
  END IF;

  IF length(v_phone_hash) <> 64 OR v_phone_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid p_recipient_phone_hash' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.whatsapp_delivery_tracking (
    message_sid,
    message_kind,
    report_id,
    tag_code,
    otp_session_id,
    recipient_phone_hash,
    phone_hmac_key_version,
    sms_fallback_enabled,
    status,
    sms_fallback_state,
    fallback_after_at,
    created_at,
    updated_at
  ) VALUES (
    v_sid,
    p_message_kind,
    nullif(trim(coalesce(p_report_id, '')), ''),
    nullif(upper(trim(coalesce(p_tag_code, ''))), ''),
    p_otp_session_id,
    v_phone_hash,
    p_phone_hmac_key_version,
    coalesce(p_sms_fallback_enabled, false),
    'queued',
    CASE WHEN coalesce(p_sms_fallback_enabled, false) THEN 'queued' ELSE 'skipped' END,
    p_fallback_after_at,
    v_now,
    v_now
  )
  ON CONFLICT ON CONSTRAINT whatsapp_delivery_tracking_pkey DO NOTHING;

  RETURN QUERY SELECT FOUND, v_sid;
END;
$$;

ALTER FUNCTION public.register_whatsapp_delivery(text, text, text, text, uuid, text, smallint, boolean, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.register_whatsapp_delivery(text, text, text, text, uuid, text, smallint, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_whatsapp_delivery(text, text, text, text, uuid, text, smallint, boolean, timestamptz) TO service_role;

COMMIT;
