-- =============================================================================
-- Migration 012 (UP): Distributed OTP Sessions & Atomic WhatsApp-to-SMS Fallback
-- بَلِّغْنِي | BALAGHNI
--
-- الهدف الأمني والمعماري:
--   1. إنشاء جدول public.otp_sessions الموزّع للعمل عبر جميع نسخ Vercel Serverless
--      مع 3 إصدارات مفاتيح HKDF-SHA256 مستقلة (phone_hmac, otp_hmac, enc) وصلاحية
--      قصوى 5 دقائق وحد أقصى 5 محاولات وقفل مزدوج مرتّب لمنع جلستين مفتوحتين.
--   2. إنشاء جدول public.whatsapp_delivery_tracking بدون أي رقم هاتف خام، مع آلة
--      حالات Worker كاملة (queued -> claimed -> sending -> sent/failed/skipped/abandoned_unknown)
--      وClaim Token فريد وLease (120 ثانية) وحماية رتيبة لتحديثات Webhook.
--   3. أقل صلاحية ممكنة: OWNER TO postgres + ENABLE/FORCE RLS + REVOKE ALL من
--      PUBLIC/anon/authenticated/service_role على الجدولين، وحصر التنفيذ عبر
--      دوال SECURITY DEFINER لـ service_role فقط.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. جدول جلسات OTP الموزعة (public.otp_sessions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.otp_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash             text NOT NULL CHECK (
    length(trim(phone_hash)) = 64
    AND trim(phone_hash) ~ '^[0-9a-f]{64}$'
  ),
  phone_hmac_key_version smallint NOT NULL CHECK (phone_hmac_key_version >= 1),
  otp_hmac_key_version   smallint NOT NULL CHECK (otp_hmac_key_version >= 1),
  enc_key_version        smallint NOT NULL CHECK (enc_key_version >= 1),
  session_salt           text NOT NULL CHECK (
    length(trim(session_salt)) BETWEEN 16 AND 128
  ),
  otp_hash               text NULL CHECK (
    otp_hash IS NULL
    OR (length(trim(otp_hash)) = 64 AND trim(otp_hash) ~ '^[0-9a-f]{64}$')
  ),
  otp_payload_enc        text NULL CHECK (
    otp_payload_enc IS NULL
    OR length(trim(otp_payload_enc)) BETWEEN 32 AND 2048
  ),
  channel                text NOT NULL DEFAULT 'WHATSAPP'
    CHECK (channel IN ('WHATSAPP', 'SMS')),
  twilio_message_sid     text NULL CHECK (
    twilio_message_sid IS NULL
    OR length(trim(twilio_message_sid)) BETWEEN 8 AND 128
  ),
  resala_pin_id          text NULL CHECK (
    resala_pin_id IS NULL
    OR length(trim(resala_pin_id)) BETWEEN 1 AND 128
  ),
  attempts               integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  max_attempts           integer NOT NULL DEFAULT 5 CHECK (max_attempts = 5),
  status                 text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'verified', 'expired', 'locked', 'superseded', 'failed')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  verified_at            timestamptz NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_otp_sessions_ttl_max_5m
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes'),
  CONSTRAINT chk_otp_sessions_terminal_wiped
    CHECK (
      status IN ('pending', 'active')
      OR (otp_hash IS NULL AND otp_payload_enc IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_otp_sessions_one_open_per_phone
  ON public.otp_sessions (phone_hash)
  WHERE status IN ('pending', 'active');

CREATE UNIQUE INDEX IF NOT EXISTS idx_otp_sessions_unique_twilio_sid
  ON public.otp_sessions (twilio_message_sid)
  WHERE twilio_message_sid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_otp_sessions_expires_at
  ON public.otp_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_otp_sessions_key_versions_open
  ON public.otp_sessions (phone_hmac_key_version, otp_hmac_key_version, enc_key_version)
  WHERE status IN ('pending', 'active');

ALTER TABLE public.otp_sessions OWNER TO postgres;
ALTER TABLE public.otp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_sessions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.otp_sessions FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS otp_sessions_owner_only ON public.otp_sessions;
CREATE POLICY otp_sessions_owner_only
  ON public.otp_sessions
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 2. جدول تتبع تسليم واتساب والتحويل الذري إلى SMS (public.whatsapp_delivery_tracking)
--    ملاحظة: لا يُخزّن أي رقم هاتف خام — فقط recipient_phone_hash وإصدار مفتاحه
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_delivery_tracking (
  message_sid            text PRIMARY KEY CHECK (length(trim(message_sid)) BETWEEN 8 AND 128),
  message_kind           text NOT NULL CHECK (message_kind IN ('otp', 'notification')),
  report_id              text NULL,
  tag_code               text NULL,
  otp_session_id         uuid NULL,
  recipient_phone_hash   text NOT NULL CHECK (
    length(trim(recipient_phone_hash)) = 64
    AND trim(recipient_phone_hash) ~ '^[0-9a-f]{64}$'
  ),
  phone_hmac_key_version smallint NOT NULL CHECK (phone_hmac_key_version >= 1),
  sms_fallback_enabled   boolean NOT NULL DEFAULT true,
  status                 text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'undelivered')),
  sms_fallback_state     text NOT NULL DEFAULT 'queued'
    CHECK (sms_fallback_state IN ('queued', 'claimed', 'sending', 'sent', 'failed', 'skipped', 'abandoned_unknown')),
  sms_fallback_reason    text NULL,
  claim_token            uuid NULL,
  claim_expires_at       timestamptz NULL,
  sms_provider_id        text NULL,
  sms_error              text NULL,
  fallback_after_at      timestamptz NOT NULL,
  delivered_at           timestamptz NULL,
  late_delivered         boolean NOT NULL DEFAULT false,
  late_cancelled         boolean NOT NULL DEFAULT false,
  sms_claimed_at         timestamptz NULL,
  sms_sending_at         timestamptz NULL,
  sms_sent_at            timestamptz NULL,
  expires_at             timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_wa_tracking_claim_fields
    CHECK (
      (sms_fallback_state IN ('claimed', 'sending') AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL)
      OR (sms_fallback_state NOT IN ('claimed', 'sending'))
    )
);

CREATE INDEX IF NOT EXISTS idx_wa_delivery_due_fallback
  ON public.whatsapp_delivery_tracking (fallback_after_at)
  WHERE sms_fallback_enabled = true
    AND sms_fallback_state = 'queued'
    AND status IN ('queued', 'sent', 'failed', 'undelivered');

CREATE INDEX IF NOT EXISTS idx_wa_delivery_stale_claims
  ON public.whatsapp_delivery_tracking (claim_expires_at)
  WHERE sms_fallback_state IN ('claimed', 'sending');

CREATE INDEX IF NOT EXISTS idx_wa_delivery_otp_session
  ON public.whatsapp_delivery_tracking (otp_session_id)
  WHERE otp_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_delivery_expires_at
  ON public.whatsapp_delivery_tracking (expires_at);

ALTER TABLE public.whatsapp_delivery_tracking OWNER TO postgres;
ALTER TABLE public.whatsapp_delivery_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_delivery_tracking FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.whatsapp_delivery_tracking FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS whatsapp_delivery_tracking_owner_only ON public.whatsapp_delivery_tracking;
CREATE POLICY whatsapp_delivery_tracking_owner_only
  ON public.whatsapp_delivery_tracking
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 3. دوال جلسات OTP الذرية
-- -----------------------------------------------------------------------------

-- 3.1 إنشاء جلسة OTP بحالة pending قبل إرسال Twilio (مع قفل مزدوج مرتّب للتدوير)
CREATE OR REPLACE FUNCTION public.create_otp_session_pending(
  p_phone_hash_current     text,
  p_phone_hash_previous    text,
  p_phone_hmac_key_version smallint,
  p_otp_hmac_key_version   smallint,
  p_enc_key_version        smallint,
  p_otp_payload_enc        text,
  p_session_salt           text,
  p_otp_hash               text,
  p_expires_at             timestamptz
)
RETURNS TABLE (
  session_id     uuid,
  superseded_sid text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cur                  text := lower(trim(coalesce(p_phone_hash_current, '')));
  v_prev                 text := nullif(lower(trim(coalesce(p_phone_hash_previous, ''))), '');
  v_now                  timestamptz := now();
  v_max_expires_at       timestamptz := v_now + interval '5 minutes';
  v_effective_expires_at timestamptz;
  v_superseded_sid       text := null;
  v_new_id               uuid;
BEGIN
  IF length(v_cur) <> 64 OR v_cur !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid p_phone_hash_current' USING ERRCODE = '22023';
  END IF;

  IF v_prev IS NOT NULL AND (length(v_prev) <> 64 OR v_prev !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'invalid p_phone_hash_previous' USING ERRCODE = '22023';
  END IF;

  -- مرجعية الوقت هي ساعة PostgreSQL (v_now):
  -- نرفض التلاعب الصريح (أكثر من 5 دقائق و30 ثانية أو في الماضي > 30 ثانية)،
  -- ونقص أي انحراف ساعة طفيف من Vercel إلى سقف 5 دقائق بالضبط.
  IF p_expires_at IS NOT NULL THEN
    IF p_expires_at <= v_now - interval '30 seconds'
       OR p_expires_at > v_now + interval '5 minutes 30 seconds' THEN
      RAISE EXCEPTION 'p_expires_at out of allowed 5-minute window' USING ERRCODE = '22023';
    END IF;
    v_effective_expires_at := LEAST(p_expires_at, v_max_expires_at);
    IF v_effective_expires_at <= v_now THEN
      v_effective_expires_at := v_max_expires_at;
    END IF;
  ELSE
    v_effective_expires_at := v_max_expires_at;
  END IF;

  -- قفل استشاري مرتّب أبجدياً على بصمة الهاتف الحالية والسابقة لمنع Deadlock ومنع جلستين مفتوحتين أثناء التدوير
  IF v_prev IS NOT NULL AND v_prev <> v_cur THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(LEAST(v_cur, v_prev), 0));
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(GREATEST(v_cur, v_prev), 0));
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_cur, 0));
  END IF;

  -- التقاط آخر twilio_message_sid مفتوح قبل الإلغاء
  SELECT s.twilio_message_sid
    INTO v_superseded_sid
  FROM public.otp_sessions s
  WHERE s.status IN ('pending', 'active')
    AND (s.phone_hash = v_cur OR (v_prev IS NOT NULL AND s.phone_hash = v_prev))
  ORDER BY s.created_at DESC
  LIMIT 1;

  -- إلغاء جميع الجلسات المفتوحة السابقة وتطهير بياناتها الحساسة
  UPDATE public.otp_sessions s
  SET
    status          = 'superseded',
    otp_hash        = NULL,
    otp_payload_enc = NULL,
    updated_at      = v_now
  WHERE s.status IN ('pending', 'active')
    AND (s.phone_hash = v_cur OR (v_prev IS NOT NULL AND s.phone_hash = v_prev));

  -- تخطي fallback لرسائل واتساب السابقة المرتبطة بالجلسات الملغاة إذا لم تبدأ الإرسال
  UPDATE public.whatsapp_delivery_tracking t
  SET
    sms_fallback_state  = 'skipped',
    sms_fallback_reason = 'otp_session_superseded',
    claim_token         = NULL,
    claim_expires_at    = NULL,
    updated_at          = v_now
  WHERE t.message_kind = 'otp'
    AND (t.recipient_phone_hash = v_cur OR (v_prev IS NOT NULL AND t.recipient_phone_hash = v_prev))
    AND t.sms_fallback_state IN ('queued', 'claimed');

  INSERT INTO public.otp_sessions (
    phone_hash,
    phone_hmac_key_version,
    otp_hmac_key_version,
    enc_key_version,
    session_salt,
    otp_hash,
    otp_payload_enc,
    channel,
    status,
    created_at,
    expires_at,
    updated_at
  ) VALUES (
    v_cur,
    p_phone_hmac_key_version,
    p_otp_hmac_key_version,
    p_enc_key_version,
    trim(p_session_salt),
    lower(trim(p_otp_hash)),
    trim(p_otp_payload_enc),
    'WHATSAPP',
    'pending',
    v_now,
    v_effective_expires_at,
    v_now
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, v_superseded_sid;
END;
$$;

-- 3.2 تفعيل جلسة OTP وربط Twilio MessageSid وتسجيل التتبع في معاملة ذرية واحدة
CREATE OR REPLACE FUNCTION public.activate_otp_whatsapp_session(
  p_session_id             uuid,
  p_twilio_message_sid     text,
  p_recipient_phone_hash   text,
  p_phone_hmac_key_version smallint,
  p_fallback_after_at      timestamptz
)
RETURNS TABLE (
  activated           boolean,
  tracking_registered boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sid        text := trim(coalesce(p_twilio_message_sid, ''));
  v_phone_hash text := lower(trim(coalesce(p_recipient_phone_hash, '')));
  v_now        timestamptz := now();
  v_activated  boolean := false;
  v_registered boolean := false;
BEGIN
  IF length(v_sid) < 8 OR length(v_sid) > 128 THEN
    RAISE EXCEPTION 'invalid p_twilio_message_sid' USING ERRCODE = '22023';
  END IF;

  -- منع ربط SID مستخدم مسبقاً بأي جلسة أخرى
  IF EXISTS (
    SELECT 1
    FROM public.otp_sessions s
    WHERE s.twilio_message_sid = v_sid
      AND s.id <> p_session_id
  ) THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  UPDATE public.otp_sessions s
  SET
    status             = 'active',
    channel            = 'WHATSAPP',
    twilio_message_sid = v_sid,
    updated_at         = v_now
  WHERE s.id = p_session_id
    AND s.status = 'pending'
    AND s.expires_at > v_now;

  v_activated := FOUND;

  IF NOT v_activated THEN
    RETURN QUERY SELECT false, false;
    RETURN;
  END IF;

  INSERT INTO public.whatsapp_delivery_tracking (
    message_sid,
    message_kind,
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
    'otp',
    p_session_id,
    v_phone_hash,
    p_phone_hmac_key_version,
    true,
    'queued',
    'queued',
    p_fallback_after_at,
    v_now,
    v_now
  )
  ON CONFLICT (message_sid) DO NOTHING;

  v_registered := FOUND;

  RETURN QUERY SELECT v_activated, v_registered;
END;
$$;

-- 3.3 تفعيل جلسة OTP على قناة SMS (يبقي otp_hash نفسه ويمسح otp_payload_enc بعد إرسال SMS)
CREATE OR REPLACE FUNCTION public.activate_otp_sms_session(
  p_session_id    uuid,
  p_resala_pin_id text DEFAULT NULL
)
RETURNS TABLE (activated boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE public.otp_sessions s
  SET
    status          = 'active',
    channel         = 'SMS',
    resala_pin_id   = COALESCE(nullif(trim(coalesce(p_resala_pin_id, '')), ''), s.resala_pin_id),
    otp_payload_enc = NULL,
    updated_at      = v_now
  WHERE s.id = p_session_id
    AND s.status IN ('pending', 'active')
    AND s.expires_at > v_now;

  RETURN QUERY SELECT FOUND;
END;
$$;

-- 3.4 إلغاء جلسة OTP معلّقة عند فشل كل القنوات وتطهير بياناتها الحساسة
CREATE OR REPLACE FUNCTION public.cancel_pending_otp_session(
  p_session_id uuid
)
RETURNS TABLE (cancelled boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE public.otp_sessions s
  SET
    status          = 'failed',
    otp_hash        = NULL,
    otp_payload_enc = NULL,
    updated_at      = v_now
  WHERE s.id = p_session_id
    AND s.status = 'pending';

  RETURN QUERY SELECT FOUND;
END;
$$;

-- 3.5 جلب الجلسة المفتوحة للتحقق في Node.js (crypto.timingSafeEqual) مع جميع إصدارات المفاتيح
CREATE OR REPLACE FUNCTION public.get_open_otp_session_for_verify(
  p_phone_hash_current  text,
  p_phone_hash_previous text,
  p_now                 timestamptz DEFAULT now()
)
RETURNS TABLE (
  session_id             uuid,
  phone_hmac_key_version smallint,
  otp_hmac_key_version   smallint,
  enc_key_version        smallint,
  session_salt           text,
  otp_hash               text,
  otp_payload_enc        text,
  channel                text,
  twilio_message_sid     text,
  attempts               integer,
  expires_at             timestamptz,
  status                 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cur  text := lower(trim(coalesce(p_phone_hash_current, '')));
  v_prev text := nullif(lower(trim(coalesce(p_phone_hash_previous, ''))), '');
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.phone_hmac_key_version,
    s.otp_hmac_key_version,
    s.enc_key_version,
    s.session_salt,
    s.otp_hash,
    s.otp_payload_enc,
    s.channel,
    s.twilio_message_sid,
    s.attempts,
    s.expires_at,
    s.status
  FROM public.otp_sessions s
  WHERE s.status IN ('pending', 'active')
    AND (s.phone_hash = v_cur OR (v_prev IS NOT NULL AND s.phone_hash = v_prev))
  ORDER BY s.created_at DESC
  LIMIT 1;
END;
$$;

-- 3.5b جلب جلسة OTP للـ Worker عبر otp_session_id لفك تشفير { phone, otp } وإرسال نفس الرمز عبر Resala
CREATE OR REPLACE FUNCTION public.get_otp_session_for_worker_fallback(
  p_otp_session_id uuid,
  p_now            timestamptz DEFAULT now()
)
RETURNS TABLE (
  session_id      uuid,
  phone_hash      text,
  enc_key_version smallint,
  session_salt    text,
  otp_payload_enc text,
  status          text,
  expires_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.phone_hash,
    s.enc_key_version,
    s.session_salt,
    s.otp_payload_enc,
    s.status,
    s.expires_at
  FROM public.otp_sessions s
  WHERE s.id = p_otp_session_id
  LIMIT 1;
END;
$$;

-- 3.6 تثبيت محاولة التحقق ذرياً عبر Atomic CAS (بعد crypto.timingSafeEqual في Node.js)
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

-- -----------------------------------------------------------------------------
-- 4. دوال تتبع تسليم واتساب وآلة حالات الـ Worker
-- -----------------------------------------------------------------------------

-- 4.1 تسجيل رسالة واتساب صادرة (منع التسجيل المكرر عبر ON CONFLICT DO NOTHING)
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
  ON CONFLICT (message_sid) DO NOTHING;

  RETURN QUERY SELECT FOUND, v_sid;
END;
$$;

-- 4.2 تحديث حالة التسليم من Webhook بشكل رتيب وIdempotent مع كشف late_delivered
CREATE OR REPLACE FUNCTION public.update_whatsapp_delivery_status(
  p_message_sid text,
  p_status      text,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  updated            boolean,
  duplicate          boolean,
  late_delivered     boolean,
  status             text,
  sms_fallback_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sid       text := trim(coalesce(p_message_sid, ''));
  v_row       public.whatsapp_delivery_tracking%ROWTYPE;
  v_cur_rank  integer;
  v_next_rank integer;
  v_is_late   boolean := false;
BEGIN
  IF p_status NOT IN ('queued', 'sent', 'delivered', 'read', 'failed', 'undelivered') THEN
    RETURN;
  END IF;

  SELECT * INTO v_row
  FROM public.whatsapp_delivery_tracking t
  WHERE t.message_sid = v_sid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_row.status = p_status THEN
    RETURN QUERY SELECT false, true, v_row.late_delivered, v_row.status, v_row.sms_fallback_state;
    RETURN;
  END IF;

  v_cur_rank  := CASE v_row.status WHEN 'queued' THEN 0 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 1 END;
  v_next_rank := CASE p_status     WHEN 'queued' THEN 0 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 1 END;

  -- منع التراجع من delivered/read إلى حالة أدنى
  IF v_cur_rank >= 2 AND v_next_rank < v_cur_rank THEN
    RETURN QUERY SELECT false, true, v_row.late_delivered, v_row.status, v_row.sms_fallback_state;
    RETURN;
  END IF;

  IF p_status IN ('delivered', 'read')
     AND v_row.sms_fallback_state IN ('claimed', 'sending', 'sent', 'abandoned_unknown') THEN
    v_is_late := true;
  END IF;

  UPDATE public.whatsapp_delivery_tracking t
  SET
    status             = p_status,
    delivered_at       = CASE WHEN p_status IN ('delivered', 'read') THEN COALESCE(t.delivered_at, p_occurred_at) ELSE t.delivered_at END,
    late_delivered     = t.late_delivered OR v_is_late,
    sms_fallback_state = CASE
                           WHEN p_status IN ('delivered', 'read') AND t.sms_fallback_state = 'queued' THEN 'skipped'
                           ELSE t.sms_fallback_state
                         END,
    sms_fallback_reason = CASE
                            WHEN p_status IN ('delivered', 'read') AND t.sms_fallback_state = 'queued' THEN 'whatsapp_delivered'
                            ELSE t.sms_fallback_reason
                          END,
    updated_at         = now()
  WHERE t.message_sid = v_row.message_sid
  RETURNING t.* INTO v_row;

  -- مسح الحمولة المشفرة لـ OTP عند تأكيد تسليم واتساب إذا لم يعد مطلوباً للتحويل
  IF p_status IN ('delivered', 'read') AND v_row.otp_session_id IS NOT NULL THEN
    UPDATE public.otp_sessions s
    SET otp_payload_enc = NULL, updated_at = now()
    WHERE s.id = v_row.otp_session_id
      AND s.otp_payload_enc IS NOT NULL;
  END IF;

  RETURN QUERY SELECT true, false, v_row.late_delivered, v_row.status, v_row.sms_fallback_state;
END;
$$;

-- 4.3 حجز ذري لرسالة واحدة (للـ Webhook عند الفشل أو لطلب SMS اليدوي)
CREATE OR REPLACE FUNCTION public.claim_sms_fallback_delivery(
  p_message_sid   text,
  p_now           timestamptz DEFAULT now(),
  p_reason        text DEFAULT 'timeout_60s',
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  claimed            boolean,
  reason             text,
  claim_token        uuid,
  status             text,
  sms_fallback_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sid   text := trim(coalesce(p_message_sid, ''));
  v_lease integer := LEAST(GREATEST(coalesce(p_lease_seconds, 120), 30), 300);
  v_token uuid := gen_random_uuid();
  v_row   public.whatsapp_delivery_tracking%ROWTYPE;
BEGIN
  UPDATE public.whatsapp_delivery_tracking t
  SET
    sms_fallback_state  = 'claimed',
    sms_fallback_reason = p_reason,
    claim_token         = v_token,
    sms_claimed_at      = p_now,
    claim_expires_at    = p_now + make_interval(secs => v_lease),
    updated_at          = p_now
  WHERE t.message_sid = v_sid
    AND t.sms_fallback_enabled = true
    AND t.sms_fallback_state = 'queued'
    AND t.status IN ('queued', 'sent', 'failed', 'undelivered')
    AND (
      t.status IN ('failed', 'undelivered')
      OR p_reason = 'user_requested_sms'
      OR t.fallback_after_at <= p_now
    )
    AND (
      t.message_kind <> 'otp'
      OR EXISTS (
        SELECT 1 FROM public.otp_sessions s
        WHERE s.id = t.otp_session_id
          AND s.status IN ('pending', 'active')
          AND s.expires_at > p_now
          AND s.otp_payload_enc IS NOT NULL
      )
    )
  RETURNING t.* INTO v_row;

  IF FOUND THEN
    RETURN QUERY SELECT true, 'claimed'::text, v_row.claim_token, v_row.status, v_row.sms_fallback_state;
    RETURN;
  END IF;

  SELECT * INTO v_row
  FROM public.whatsapp_delivery_tracking t
  WHERE t.message_sid = v_sid;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::text, NULL::uuid, NULL::text, NULL::text;
  ELSIF NOT v_row.sms_fallback_enabled THEN
    RETURN QUERY SELECT false, 'sms_fallback_disabled'::text, NULL::uuid, v_row.status, v_row.sms_fallback_state;
  ELSIF v_row.status IN ('delivered', 'read') THEN
    RETURN QUERY SELECT false, 'already_delivered'::text, NULL::uuid, v_row.status, v_row.sms_fallback_state;
  ELSIF v_row.sms_fallback_state <> 'queued' THEN
    RETURN QUERY SELECT false, 'already_claimed_or_finalized'::text, NULL::uuid, v_row.status, v_row.sms_fallback_state;
  ELSIF v_row.message_kind = 'otp' THEN
    RETURN QUERY SELECT false, 'otp_session_not_eligible'::text, NULL::uuid, v_row.status, v_row.sms_fallback_state;
  ELSE
    RETURN QUERY SELECT false, 'timeout_not_reached'::text, NULL::uuid, v_row.status, v_row.sms_fallback_state;
  END IF;
END;
$$;

-- 4.4 حجز دفعة رسائل مستحقة للـ Worker باستخدام FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_due_whatsapp_fallbacks(
  p_now           timestamptz DEFAULT now(),
  p_limit         integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  message_sid            text,
  message_kind           text,
  report_id              text,
  tag_code               text,
  otp_session_id         uuid,
  phone_hmac_key_version smallint,
  claim_token            uuid,
  claim_expires_at       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(coalesce(p_limit, 20), 1), 50);
  v_lease integer := LEAST(GREATEST(coalesce(p_lease_seconds, 120), 30), 300);
BEGIN
  -- تخطي رسائل OTP التي انتهت جلستها أو أُلغيت قبل الحجز
  UPDATE public.whatsapp_delivery_tracking t
  SET
    sms_fallback_state  = 'skipped',
    sms_fallback_reason = 'otp_session_inactive_or_expired',
    updated_at          = p_now
  WHERE t.message_kind = 'otp'
    AND t.sms_fallback_state = 'queued'
    AND (t.fallback_after_at <= p_now OR t.status IN ('failed', 'undelivered'))
    AND NOT EXISTS (
      SELECT 1 FROM public.otp_sessions s
      WHERE s.id = t.otp_session_id
        AND s.status IN ('pending', 'active')
        AND s.expires_at > p_now
        AND s.otp_payload_enc IS NOT NULL
    );

  RETURN QUERY
  WITH due AS (
    SELECT t.message_sid
    FROM public.whatsapp_delivery_tracking t
    WHERE t.sms_fallback_enabled = true
      AND t.sms_fallback_state = 'queued'
      AND t.status IN ('queued', 'sent', 'failed', 'undelivered')
      AND (t.status IN ('failed', 'undelivered') OR t.fallback_after_at <= p_now)
      AND (
        t.message_kind <> 'otp'
        OR EXISTS (
          SELECT 1 FROM public.otp_sessions s
          WHERE s.id = t.otp_session_id
            AND s.status IN ('pending', 'active')
            AND s.expires_at > p_now
            AND s.otp_payload_enc IS NOT NULL
        )
      )
    ORDER BY t.fallback_after_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.whatsapp_delivery_tracking t
  SET
    sms_fallback_state  = 'claimed',
    sms_fallback_reason = CASE WHEN t.status IN ('failed', 'undelivered') THEN 'twilio_failed' ELSE 'timeout_60s' END,
    claim_token         = gen_random_uuid(),
    sms_claimed_at      = p_now,
    claim_expires_at    = p_now + make_interval(secs => v_lease),
    updated_at          = p_now
  FROM due
  WHERE t.message_sid = due.message_sid
  RETURNING
    t.message_sid,
    t.message_kind,
    t.report_id,
    t.tag_code,
    t.otp_session_id,
    t.phone_hmac_key_version,
    t.claim_token,
    t.claim_expires_at;
END;
$$;

-- 4.5 الانتقال الذري الإلزامي من claimed إلى sending مباشرة قبل نداء Resala
CREATE OR REPLACE FUNCTION public.transition_sms_claim_to_sending(
  p_message_sid text,
  p_claim_token uuid,
  p_now         timestamptz DEFAULT now()
)
RETURNS TABLE (
  can_send boolean,
  reason   text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sid text := trim(coalesce(p_message_sid, ''));
  v_row public.whatsapp_delivery_tracking%ROWTYPE;
  v_otp public.otp_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.whatsapp_delivery_tracking t
  WHERE t.message_sid = v_sid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'not_found'::text;
    RETURN;
  END IF;

  IF v_row.sms_fallback_state <> 'claimed' OR v_row.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN QUERY SELECT false, 'invalid_claim_token_or_state'::text;
    RETURN;
  END IF;

  IF v_row.claim_expires_at IS NULL OR v_row.claim_expires_at <= p_now THEN
    RETURN QUERY SELECT false, 'claim_lease_expired'::text;
    RETURN;
  END IF;

  -- وصول delivered/read بعد الحجز وقبل الإرسال -> تخطي آمن دون نداء Resala
  IF v_row.status IN ('delivered', 'read') THEN
    UPDATE public.whatsapp_delivery_tracking t
    SET
      sms_fallback_state  = 'skipped',
      sms_fallback_reason = 'delivered_before_send',
      claim_token         = NULL,
      claim_expires_at    = NULL,
      updated_at          = p_now
    WHERE t.message_sid = v_sid;

    RETURN QUERY SELECT false, 'delivered_before_send'::text;
    RETURN;
  END IF;

  IF v_row.message_kind = 'otp' THEN
    SELECT * INTO v_otp
    FROM public.otp_sessions s
    WHERE s.id = v_row.otp_session_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_otp.status NOT IN ('pending', 'active')
       OR v_otp.expires_at <= p_now
       OR v_otp.otp_payload_enc IS NULL THEN
      UPDATE public.whatsapp_delivery_tracking t
      SET
        sms_fallback_state  = 'skipped',
        sms_fallback_reason = 'otp_session_cancelled_or_expired',
        claim_token         = NULL,
        claim_expires_at    = NULL,
        updated_at          = p_now
      WHERE t.message_sid = v_sid;

      RETURN QUERY SELECT false, 'otp_session_cancelled_or_expired'::text;
      RETURN;
    END IF;
  END IF;

  UPDATE public.whatsapp_delivery_tracking t
  SET
    sms_fallback_state = 'sending',
    sms_sending_at     = p_now,
    updated_at         = p_now
  WHERE t.message_sid = v_sid;

  RETURN QUERY SELECT true, 'sending'::text;
END;
$$;

-- 4.6 إتمام الحجز الذري بعد نداء Resala (يمنع العامل القديم عبر claim_token + lease)
CREATE OR REPLACE FUNCTION public.complete_sms_fallback_delivery(
  p_message_sid     text,
  p_claim_token     uuid,
  p_final_state     text,
  p_sms_provider_id text DEFAULT NULL,
  p_error           text DEFAULT NULL,
  p_now             timestamptz DEFAULT now()
)
RETURNS TABLE (
  completed          boolean,
  sms_fallback_state text,
  late_cancelled     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_sid            text := trim(coalesce(p_message_sid, ''));
  v_row            public.whatsapp_delivery_tracking%ROWTYPE;
  v_late_cancelled boolean := false;
BEGIN
  IF p_final_state NOT IN ('sent', 'failed', 'skipped', 'abandoned_unknown') THEN
    RAISE EXCEPTION 'invalid p_final_state: %', p_final_state USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.whatsapp_delivery_tracking t
  WHERE t.message_sid = v_sid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, false;
    RETURN;
  END IF;

  -- رفض العامل القديم إذا تغيرت الحالة أو claim_token أو انتهت مدة Lease
  IF v_row.sms_fallback_state NOT IN ('claimed', 'sending')
     OR v_row.claim_token IS DISTINCT FROM p_claim_token
     OR v_row.claim_expires_at IS NULL
     OR v_row.claim_expires_at <= p_now THEN
    RETURN QUERY SELECT false, v_row.sms_fallback_state, v_row.late_cancelled;
    RETURN;
  END IF;

  -- تسجيل الإلغاء المتأخر إذا أُلغيت أو وُثّقت جلسة OTP أثناء طلب HTTP الجاري
  IF v_row.message_kind = 'otp' AND v_row.otp_session_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.otp_sessions s
      WHERE s.id = v_row.otp_session_id
        AND s.status NOT IN ('pending', 'active')
    ) THEN
      v_late_cancelled := true;
    END IF;
  END IF;

  UPDATE public.whatsapp_delivery_tracking t
  SET
    sms_fallback_state = p_final_state,
    sms_provider_id    = COALESCE(nullif(trim(coalesce(p_sms_provider_id, '')), ''), t.sms_provider_id),
    sms_error          = CASE
                           WHEN p_final_state = 'sent' THEN NULL
                           ELSE left(coalesce(p_error, p_final_state), 300)
                         END,
    sms_sent_at        = CASE WHEN p_final_state = 'sent' THEN p_now ELSE t.sms_sent_at END,
    late_cancelled     = t.late_cancelled OR v_late_cancelled,
    claim_token        = NULL,
    claim_expires_at   = NULL,
    updated_at         = p_now
  WHERE t.message_sid = v_sid;

  -- مسح الحمولة المشفرة لـ OTP عند إتمام الإرسال أو النتيجة المجهولة (تبقى في حالة failed فقط لإتاحة إعادة محاولة يدوية بنفس الرمز)
  IF v_row.message_kind = 'otp'
     AND v_row.otp_session_id IS NOT NULL
     AND p_final_state IN ('sent', 'abandoned_unknown') THEN
    UPDATE public.otp_sessions s
    SET
      channel         = CASE WHEN p_final_state = 'sent' THEN 'SMS' ELSE s.channel END,
      resala_pin_id   = COALESCE(nullif(trim(coalesce(p_sms_provider_id, '')), ''), s.resala_pin_id),
      otp_payload_enc = NULL,
      updated_at      = p_now
    WHERE s.id = v_row.otp_session_id
      AND s.status IN ('pending', 'active');
  END IF;

  RETURN QUERY SELECT true, p_final_state, v_late_cancelled;
END;
$$;

-- 4.7 استعادة الحجوزات المنتهية (Lease Expiry -> abandoned_unknown) وتنظيف السجلات المنتهية
CREATE OR REPLACE FUNCTION public.reconcile_stale_whatsapp_claims(
  p_now             timestamptz DEFAULT now(),
  p_cleanup_expired boolean DEFAULT false
)
RETURNS TABLE (
  abandoned_count       integer,
  purged_tracking_count integer,
  purged_otp_count      integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_abandoned integer := 0;
  v_purged_tr integer := 0;
  v_purged_ot integer := 0;
BEGIN
  UPDATE public.whatsapp_delivery_tracking t
  SET
    sms_fallback_state = 'abandoned_unknown',
    sms_error          = COALESCE(t.sms_error, 'claim_lease_expired_unknown_outcome'),
    claim_token        = NULL,
    claim_expires_at   = NULL,
    updated_at         = p_now
  WHERE t.sms_fallback_state IN ('claimed', 'sending')
    AND t.claim_expires_at IS NOT NULL
    AND t.claim_expires_at <= p_now;

  GET DIAGNOSTICS v_abandoned = ROW_COUNT;

  -- إبطال جلسات OTP المنتهية الصلاحية ومسح بياناتها الحساسة
  UPDATE public.otp_sessions s
  SET
    status          = 'expired',
    otp_hash        = NULL,
    otp_payload_enc = NULL,
    updated_at      = p_now
  WHERE s.status IN ('pending', 'active')
    AND s.expires_at <= p_now;

  IF p_cleanup_expired THEN
    DELETE FROM public.whatsapp_delivery_tracking t
    WHERE t.expires_at <= p_now
      AND t.sms_fallback_state NOT IN ('claimed', 'sending');
    GET DIAGNOSTICS v_purged_tr = ROW_COUNT;

    DELETE FROM public.otp_sessions s
    WHERE s.status NOT IN ('pending', 'active')
      AND s.expires_at <= p_now - interval '15 minutes';
    GET DIAGNOSTICS v_purged_ot = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_abandoned, v_purged_tr, v_purged_ot;
END;
$$;

-- 4.8 فحص جاهزية إزالة إصدار مفتاح سابق قبل تدوير v2 -> v3
-- يفحص جميع إصدارات المفاتيح الثلاثة المستقلة على الجلسات المفتوحة (pending/active):
--   1) phone_hmac_key_version  2) otp_hmac_key_version  3) enc_key_version
-- كما يفحص phone_hmac_key_version على جميع رسائل التتبع النشطة (queued/claimed/sending).
-- لا يجوز إزالة SESSION_HMAC_SECRET_PREVIOUS إلا عندما تعيد هذه الدالة safe_to_retire = true.
CREATE OR REPLACE FUNCTION public.check_key_version_active_usage(
  p_key_version smallint
)
RETURNS TABLE (
  open_otp_sessions_count   integer,
  active_deliveries_count   integer,
  safe_to_retire            boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_otp_cnt integer := 0;
  v_del_cnt integer := 0;
BEGIN
  SELECT count(*)::integer INTO v_otp_cnt
  FROM public.otp_sessions s
  WHERE s.status IN ('pending', 'active')
    AND (
      s.phone_hmac_key_version = p_key_version
      OR s.otp_hmac_key_version = p_key_version
      OR s.enc_key_version = p_key_version
    );

  SELECT count(*)::integer INTO v_del_cnt
  FROM public.whatsapp_delivery_tracking t
  WHERE t.sms_fallback_state IN ('queued', 'claimed', 'sending')
    AND t.status IN ('queued', 'sent', 'failed', 'undelivered')
    AND t.phone_hmac_key_version = p_key_version;

  RETURN QUERY SELECT v_otp_cnt, v_del_cnt, (v_otp_cnt = 0 AND v_del_cnt = 0);
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. تقييد الملكية وصلاحيات التنفيذ (EXECUTE لـ service_role فقط)
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.create_otp_session_pending(text, text, smallint, smallint, smallint, text, text, text, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.activate_otp_whatsapp_session(uuid, text, text, smallint, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.activate_otp_sms_session(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.cancel_pending_otp_session(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_open_otp_session_for_verify(text, text, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.get_otp_session_for_worker_fallback(uuid, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.commit_otp_verification_attempt(uuid, integer, boolean, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.register_whatsapp_delivery(text, text, text, text, uuid, text, smallint, boolean, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.update_whatsapp_delivery_status(text, text, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.claim_sms_fallback_delivery(text, timestamptz, text, integer) OWNER TO postgres;
ALTER FUNCTION public.claim_due_whatsapp_fallbacks(timestamptz, integer, integer) OWNER TO postgres;
ALTER FUNCTION public.transition_sms_claim_to_sending(text, uuid, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.complete_sms_fallback_delivery(text, uuid, text, text, text, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.reconcile_stale_whatsapp_claims(timestamptz, boolean) OWNER TO postgres;
ALTER FUNCTION public.check_key_version_active_usage(smallint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_otp_session_pending(text, text, smallint, smallint, smallint, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_otp_whatsapp_session(uuid, text, text, smallint, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_otp_sms_session(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_pending_otp_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_open_otp_session_for_verify(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_otp_session_for_worker_fallback(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_otp_verification_attempt(uuid, integer, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_whatsapp_delivery(text, text, text, text, uuid, text, smallint, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_whatsapp_delivery_status(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_sms_fallback_delivery(text, timestamptz, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_whatsapp_fallbacks(timestamptz, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_sms_claim_to_sending(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_sms_fallback_delivery(text, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_stale_whatsapp_claims(timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_key_version_active_usage(smallint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_otp_session_pending(text, text, smallint, smallint, smallint, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_otp_whatsapp_session(uuid, text, text, smallint, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_otp_sms_session(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_pending_otp_session(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_open_otp_session_for_verify(text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_otp_session_for_worker_fallback(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_otp_verification_attempt(uuid, integer, boolean, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_whatsapp_delivery(text, text, text, text, uuid, text, smallint, boolean, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_whatsapp_delivery_status(text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_sms_fallback_delivery(text, timestamptz, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_whatsapp_fallbacks(timestamptz, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_sms_claim_to_sending(text, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_sms_fallback_delivery(text, uuid, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_whatsapp_claims(timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_key_version_active_usage(smallint) TO service_role;

COMMIT;
