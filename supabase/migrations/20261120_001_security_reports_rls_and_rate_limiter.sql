-- =============================================================================
-- Migration 001 (UP): Security Hardening — Reports Privacy + Distributed Rate Limiter
-- بَلِّغْنِي | BALAGHNI
-- 1. إغلاق ثغرة reports_public_realtime_select وحماية أرقام المبلغين (reporter_phone)
-- 2. إنشاء جدول ودوال Rate Limiter المركزي المشترك بين نسخ Vercel Serverless
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- القسم 1: إغلاق الوصول العام (anon / authenticated) عن جدول البلاغات public.reports
-- ملاحظة: التحديثات اللحظية لصفحة المبلّغ تعمل بالكامل عبر Realtime Broadcast الآمن
-- (report-live:<id>) و/api/notify الذي لا يعيد أي أرقام هواتف أو بيانات حساسة.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  pol record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'reports'
  ) THEN
    ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.reports FORCE ROW LEVEL SECURITY;

    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'reports'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.reports;', pol.policyname);
    END LOOP;

    REVOKE ALL ON TABLE public.reports FROM PUBLIC, anon, authenticated;
    GRANT ALL ON TABLE public.reports TO service_role;

    CREATE POLICY reports_service_role_only
      ON public.reports
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);

    -- إزالة reports من منشور postgres_changes لمنع أي بث خام لصفوف تحتوي reporter_phone
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'reports'
    ) THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.reports;
    END IF;
  END IF;

  -- تأمين جدول notifications بنفس الصرامة إن وُجد
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notifications'
  ) THEN
    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'notifications'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.notifications;', pol.policyname);
    END LOOP;

    REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated;
    GRANT ALL ON TABLE public.notifications TO service_role;

    CREATE POLICY notifications_service_role_only
      ON public.notifications
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- القسم 2: جدول ودوال تحديد المعدل المركزي (Distributed Rate Limiter)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limit_entries (
  rate_key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_entries_expires_at
  ON public.rate_limit_entries (expires_at);

ALTER TABLE public.rate_limit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_entries FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rate_limit_entries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limit_entries TO service_role;

DROP POLICY IF EXISTS rate_limit_entries_service_role_only ON public.rate_limit_entries;
CREATE POLICY rate_limit_entries_service_role_only
  ON public.rate_limit_entries
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- دالة فحص حالة الحد بدون تسجيل محاولة جديدة (مع التحقق الصارم من المدخلات)
CREATE OR REPLACE FUNCTION public.rl_check(
  p_key text,
  p_max_attempts integer,
  p_window_ms bigint
)
RETURNS TABLE(allowed boolean, remaining integer, reset_ms bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_key text := trim(coalesce(p_key, ''));
  v_rec public.rate_limit_entries%ROWTYPE;
  v_reset_ms bigint;
BEGIN
  IF length(v_key) = 0 OR length(v_key) > 256 THEN
    RAISE EXCEPTION 'invalid rate_key' USING ERRCODE = '22023';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 10000 THEN
    RAISE EXCEPTION 'invalid max_attempts' USING ERRCODE = '22023';
  END IF;
  IF p_window_ms IS NULL OR p_window_ms < 100 OR p_window_ms > 86400000 THEN
    RAISE EXCEPTION 'invalid window_ms' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rec
  FROM public.rate_limit_entries
  WHERE rate_key = v_key;

  IF NOT FOUND OR v_rec.expires_at <= v_now THEN
    RETURN QUERY SELECT true, GREATEST(0, p_max_attempts), 0::bigint;
    RETURN;
  END IF;

  IF v_rec.attempts >= p_max_attempts THEN
    v_reset_ms := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_rec.expires_at - v_now)) * 1000)::bigint);
    RETURN QUERY SELECT false, 0, v_reset_ms;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, GREATEST(0, p_max_attempts - v_rec.attempts), 0::bigint;
END;
$$;

-- دالة ذرية (Atomic) لتسجيل محاولة وإرجاع المتبقي (مع التحقق الصارم من المدخلات)
CREATE OR REPLACE FUNCTION public.rl_record(
  p_key text,
  p_max_attempts integer,
  p_window_ms bigint
)
RETURNS TABLE(allowed boolean, remaining integer, reset_ms bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_key text := trim(coalesce(p_key, ''));
  v_expires timestamptz;
  v_attempts integer;
  v_exp timestamptz;
  v_reset_ms bigint;
BEGIN
  IF length(v_key) = 0 OR length(v_key) > 256 THEN
    RAISE EXCEPTION 'invalid rate_key' USING ERRCODE = '22023';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 10000 THEN
    RAISE EXCEPTION 'invalid max_attempts' USING ERRCODE = '22023';
  END IF;
  IF p_window_ms IS NULL OR p_window_ms < 100 OR p_window_ms > 86400000 THEN
    RAISE EXCEPTION 'invalid window_ms' USING ERRCODE = '22023';
  END IF;

  v_expires := v_now + (p_window_ms::double precision / 1000.0) * interval '1 second';

  -- تنظيف خفيف عشوائي (~2%) للسجلات المنتهية حتى لا يتضخم الجدول
  IF random() < 0.02 THEN
    DELETE FROM public.rate_limit_entries WHERE expires_at < v_now - interval '5 minutes';
  END IF;

  INSERT INTO public.rate_limit_entries (rate_key, attempts, window_started_at, expires_at, updated_at)
  VALUES (v_key, 1, v_now, v_expires, v_now)
  ON CONFLICT (rate_key) DO UPDATE
  SET
    attempts = CASE
      WHEN public.rate_limit_entries.expires_at <= v_now THEN 1
      ELSE public.rate_limit_entries.attempts + 1
    END,
    window_started_at = CASE
      WHEN public.rate_limit_entries.expires_at <= v_now THEN v_now
      ELSE public.rate_limit_entries.window_started_at
    END,
    expires_at = CASE
      WHEN public.rate_limit_entries.expires_at <= v_now THEN v_expires
      ELSE public.rate_limit_entries.expires_at
    END,
    updated_at = v_now
  RETURNING public.rate_limit_entries.attempts, public.rate_limit_entries.expires_at
  INTO v_attempts, v_exp;

  v_reset_ms := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_exp - v_now)) * 1000)::bigint);

  IF v_attempts > p_max_attempts THEN
    RETURN QUERY SELECT false, 0, v_reset_ms;
  ELSE
    RETURN QUERY SELECT true, GREATEST(0, p_max_attempts - v_attempts), 0::bigint;
  END IF;
END;
$$;

-- دالة مسح سجل المحاولات عند نجاح التحقق (مع التحقق من المفتاح)
CREATE OR REPLACE FUNCTION public.rl_clear(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := trim(coalesce(p_key, ''));
BEGIN
  IF length(v_key) = 0 OR length(v_key) > 256 THEN
    RAISE EXCEPTION 'invalid rate_key' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.rate_limit_entries WHERE rate_key = v_key;
END;
$$;

REVOKE ALL ON FUNCTION public.rl_check(text, integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rl_record(text, integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rl_clear(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rl_check(text, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.rl_record(text, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.rl_clear(text) TO service_role;

COMMIT;
