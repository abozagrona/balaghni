-- =============================================================================
-- Migration 003 (UP): Distributed Report Token Revocation (Multi-Instance Safe)
-- بَلِّغْنِي | BALAGHNI
-- 1. التحقق من تطابق p_jti و p_report_id معاً في is_report_token_revoked
-- 2. التحقق من أن p_expires_at تاريخ مستقبلي عند تسجيل الإلغاء
-- 3. معالجة التزامن والتعارض ذرياً (ON CONFLICT DO UPDATE WHERE report_id = EXCLUDED.report_id)
--    - نفس jti + نفس report_id + expires_at مختلف => تمديد آمن GREATEST(existing, new) دون تقصير
--    - نفس jti + report_id مختلف (حتى مع التزامن) => ينجح الأول فقط ويفشل الثاني بـ ERRCODE 23505
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.is_report_token_revoked(text);

-- 1. جدول الرموز الملغاة (revoked_report_tokens)
CREATE TABLE IF NOT EXISTS public.revoked_report_tokens (
  jti text PRIMARY KEY CHECK (length(trim(jti)) BETWEEN 8 AND 128),
  report_id text NOT NULL CHECK (length(trim(report_id)) BETWEEN 1 AND 128),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revoked_report_tokens_expires_at
  ON public.revoked_report_tokens (expires_at);

CREATE INDEX IF NOT EXISTS idx_revoked_report_tokens_report_id
  ON public.revoked_report_tokens (report_id);

ALTER TABLE public.revoked_report_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revoked_report_tokens FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.revoked_report_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.revoked_report_tokens TO service_role;

DROP POLICY IF EXISTS revoked_report_tokens_service_role_only ON public.revoked_report_tokens;
CREATE POLICY revoked_report_tokens_service_role_only
  ON public.revoked_report_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. دالة تسجيل إلغاء التوكن ذرياً تحت التزامن
CREATE OR REPLACE FUNCTION public.revoke_report_token(
  p_jti text,
  p_report_id text,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jti text := trim(coalesce(p_jti, ''));
  v_report_id text := trim(coalesce(p_report_id, ''));
  v_now timestamptz := now();
  v_returned_report_id text;
BEGIN
  IF length(v_jti) < 8 OR length(v_jti) > 128 THEN
    RAISE EXCEPTION 'invalid jti' USING ERRCODE = '22023';
  END IF;
  IF length(v_report_id) = 0 OR length(v_report_id) > 128 THEN
    RAISE EXCEPTION 'invalid report_id' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= v_now THEN
    RAISE EXCEPTION 'expires_at must be in the future' USING ERRCODE = '22023';
  END IF;

  IF random() < 0.05 THEN
    DELETE FROM public.revoked_report_tokens WHERE expires_at < v_now - interval '1 hour';
  END IF;

  -- قفل ذري على مستوى صف المفتاح الأساسي (jti):
  -- إذا تطابق report_id يتم تمديد expires_at إلى الأبعد (GREATEST) ولا يُقصّر أبداً.
  -- إذا اختلف report_id لا يتحقق شرط WHERE فلا يعود أي صف -> نرفع 23505 فوراً.
  INSERT INTO public.revoked_report_tokens (jti, report_id, expires_at, revoked_at)
  VALUES (v_jti, v_report_id, p_expires_at, v_now)
  ON CONFLICT (jti) DO UPDATE
    SET expires_at = GREATEST(public.revoked_report_tokens.expires_at, EXCLUDED.expires_at)
    WHERE public.revoked_report_tokens.report_id = EXCLUDED.report_id
  RETURNING report_id INTO v_returned_report_id;

  IF v_returned_report_id IS DISTINCT FROM v_report_id THEN
    RAISE EXCEPTION 'jti conflict with different report_id' USING ERRCODE = '23505';
  END IF;

  RETURN true;
END;
$$;

-- 3. دالة التحقق من إلغاء التوكن عبر جميع نسخ الخادم (مطابقة jti و report_id معاً)
CREATE OR REPLACE FUNCTION public.is_report_token_revoked(
  p_jti text,
  p_report_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jti text := trim(coalesce(p_jti, ''));
  v_report_id text := trim(coalesce(p_report_id, ''));
BEGIN
  IF length(v_jti) < 8 OR length(v_jti) > 128 THEN
    RAISE EXCEPTION 'invalid jti' USING ERRCODE = '22023';
  END IF;
  IF length(v_report_id) = 0 OR length(v_report_id) > 128 THEN
    RAISE EXCEPTION 'invalid report_id' USING ERRCODE = '22023';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.revoked_report_tokens
    WHERE jti = v_jti
      AND report_id = v_report_id
      AND expires_at > now()
  );
END;
$$;

ALTER FUNCTION public.revoke_report_token(text, text, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.is_report_token_revoked(text, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.revoke_report_token(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_report_token_revoked(text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.revoke_report_token(text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_report_token_revoked(text, text) TO service_role;

COMMIT;
