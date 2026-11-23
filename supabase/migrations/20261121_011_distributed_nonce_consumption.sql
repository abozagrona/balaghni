-- =============================================================================
-- Migration 011 (UP): Distributed Atomic Nonce Consumption (VULN-04)
-- بَلِّغْنِي | BALAGHNI
--
-- الهدف الأمني:
--   - استبدال Map المحلية (consumedNonces) باستهلاك ذري موزّع عبر PostgreSQL
--     للرموز أحادية الاستخدام: otp_proof و webauthn_challenge.
--   - منع إعادة الاستخدام عبر نسخ Serverless متعددة وتحت الطلبات المتزامنة
--     عبر INSERT ... ON CONFLICT (jti) DO NOTHING RETURNING jti.
--   - عدم تخزين أرقام الهواتف الخام (تخزين subject_hash بصيغة SHA-256 فقط).
--   - أقل صلاحية ممكنة: EXECUTE لـ service_role فقط، ولا صلاحيات مباشرة على الجدول
--     لـ PUBLIC أو anon أو authenticated أو service_role.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. جدول الرموز المستهلكة (public.consumed_security_nonces)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumed_security_nonces (
  jti text PRIMARY KEY CHECK (length(trim(jti)) BETWEEN 8 AND 128),
  purpose text NOT NULL CHECK (purpose IN ('otp_proof', 'webauthn_challenge')),
  subject_hash text NOT NULL CHECK (
    length(trim(subject_hash)) = 64
    AND trim(subject_hash) ~ '^[0-9a-f]{64}$'
  ),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consumed_security_nonces_expires_at
  ON public.consumed_security_nonces (expires_at);

ALTER TABLE public.consumed_security_nonces OWNER TO postgres;

-- تفعيل RLS مع FORCE ROW LEVEL SECURITY وحصر الوصول بالمالك postgres (عبر الدالة SECURITY DEFINER)
ALTER TABLE public.consumed_security_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumed_security_nonces FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.consumed_security_nonces FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS consumed_security_nonces_owner_only ON public.consumed_security_nonces;
CREATE POLICY consumed_security_nonces_owner_only
  ON public.consumed_security_nonces
  FOR ALL
  TO postgres
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 2. دالة الاستهلاك الذري للرموز (public.consume_security_nonce)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_security_nonce(
  p_jti text,
  p_purpose text,
  p_subject_hash text,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_jti text := trim(coalesce(p_jti, ''));
  v_purpose text := trim(coalesce(p_purpose, ''));
  v_subject_hash text := lower(trim(coalesce(p_subject_hash, '')));
  v_now timestamptz := now();
  v_max_ttl interval;
  v_inserted_jti text;
BEGIN
  IF length(v_jti) < 8 OR length(v_jti) > 128 THEN
    RAISE EXCEPTION 'invalid jti' USING ERRCODE = '22023';
  END IF;

  IF v_purpose NOT IN ('otp_proof', 'webauthn_challenge') THEN
    RAISE EXCEPTION 'invalid purpose' USING ERRCODE = '22023';
  END IF;

  IF length(v_subject_hash) <> 64 OR v_subject_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid subject_hash' USING ERRCODE = '22023';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= v_now THEN
    RAISE EXCEPTION 'nonce expired or invalid expires_at' USING ERRCODE = '22023';
  END IF;

  -- الحد الأعلى المسموح به لصلاحية الرمز مع هامش انحراف ساعة مبرر (دقيقتان):
  -- otp_proof: 10 دقائق + دقيقتان = 12 دقيقة
  -- webauthn_challenge: 5 دقائق + دقيقتان = 7 دقائق
  v_max_ttl := CASE
    WHEN v_purpose = 'otp_proof' THEN interval '12 minutes'
    ELSE interval '7 minutes'
  END;

  IF p_expires_at > v_now + v_max_ttl THEN
    RAISE EXCEPTION 'expires_at exceeds maximum allowed ttl' USING ERRCODE = '22023';
  END IF;

  -- تنظيف احتمالي للسجلات المنتهية منذ أكثر من ساعة للحفاظ على صغر حجم الجدول
  IF random() < 0.05 THEN
    DELETE FROM public.consumed_security_nonces
    WHERE expires_at < v_now - interval '1 hour';
  END IF;

  -- استهلاك ذري بجملة واحدة محمية بقفل المفتاح الأساسي (jti):
  -- ينجح أول طلب فقط ويعيد jti -> true، وترجع جميع المحاولات اللاحقة أو المتزامنة NULL -> false
  INSERT INTO public.consumed_security_nonces (
    jti,
    purpose,
    subject_hash,
    expires_at,
    consumed_at
  )
  VALUES (
    v_jti,
    v_purpose,
    v_subject_hash,
    p_expires_at,
    v_now
  )
  ON CONFLICT (jti) DO NOTHING
  RETURNING jti INTO v_inserted_jti;

  RETURN v_inserted_jti IS NOT NULL;
END;
$$;

ALTER FUNCTION public.consume_security_nonce(text, text, text, timestamptz) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.consume_security_nonce(text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.consume_security_nonce(text, text, text, timestamptz)
  TO service_role;

-- -----------------------------------------------------------------------------
-- 3. فحوصات ما بعد الإنشاء: المالك، SECURITY DEFINER، search_path، RLS، وACL
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_fn_oid oid := to_regprocedure('public.consume_security_nonce(text, text, text, timestamptz)');
  v_tbl_oid oid := to_regclass('public.consumed_security_nonces');
  v_owner text;
  v_secdef boolean;
  v_config text[];
  v_rls_enabled boolean;
  v_rls_forced boolean;
  v_unexpected_exec integer;
  v_role text;
BEGIN
  IF v_fn_oid IS NULL OR v_tbl_oid IS NULL THEN
    RAISE EXCEPTION 'Post-check failed: table or function was not created';
  END IF;

  SELECT pg_get_userbyid(proowner), prosecdef, proconfig
    INTO v_owner, v_secdef, v_config
  FROM pg_proc WHERE oid = v_fn_oid;

  IF v_owner IS DISTINCT FROM 'postgres' OR v_secdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Post-check failed: unexpected owner (%) or prosecdef (%) on consume_security_nonce', v_owner, v_secdef;
  END IF;

  IF NOT COALESCE('search_path=pg_catalog, public' = ANY(v_config), false) THEN
    RAISE EXCEPTION 'Post-check failed: unexpected proconfig on consume_security_nonce: %', v_config;
  END IF;

  SELECT relrowsecurity, relforcerowsecurity
    INTO v_rls_enabled, v_rls_forced
  FROM pg_class WHERE oid = v_tbl_oid;

  IF v_rls_enabled IS DISTINCT FROM true OR v_rls_forced IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Post-check failed: RLS or FORCE RLS not enabled on consumed_security_nonces';
  END IF;

  -- التحقق عبر aclexplode على جدول consumed_security_nonces من عدم وجود أي صلاحية لغير المالك postgres
  SELECT COUNT(*)
    INTO v_unexpected_exec
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
  WHERE c.oid = v_tbl_oid
    AND acl.grantee <> c.relowner;

  IF v_unexpected_exec > 0 THEN
    RAISE EXCEPTION 'Post-check failed: non-owner privilege remains in relacl for consumed_security_nonces (count=%)', v_unexpected_exec;
  END IF;

  -- التحقق الصريح من عدم امتلاك anon و authenticated و service_role أي صلاحيات SELECT/INSERT/UPDATE/DELETE مباشرة على الجدول
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_role, v_tbl_oid, 'SELECT')
       OR has_table_privilege(v_role, v_tbl_oid, 'INSERT')
       OR has_table_privilege(v_role, v_tbl_oid, 'UPDATE')
       OR has_table_privilege(v_role, v_tbl_oid, 'DELETE')
       OR has_table_privilege(v_role, v_tbl_oid, 'TRUNCATE')
       OR has_table_privilege(v_role, v_tbl_oid, 'REFERENCES')
       OR has_table_privilege(v_role, v_tbl_oid, 'TRIGGER') THEN
      RAISE EXCEPTION 'Post-check failed: role % has direct table privilege on consumed_security_nonces', v_role;
    END IF;
  END LOOP;

  -- التحقق عبر aclexplode من عدم منح EXECUTE على الدالة إلا للمالك postgres ولـ service_role فقط
  SELECT COUNT(*)
    INTO v_unexpected_exec
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
  WHERE p.oid = v_fn_oid
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> p.proowner
    AND (acl.grantee = 0 OR pg_get_userbyid(acl.grantee) <> 'service_role');

  IF v_unexpected_exec > 0 THEN
    RAISE EXCEPTION 'Post-check failed: unexpected EXECUTE grantee in ACL for consume_security_nonce (count=%)', v_unexpected_exec;
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, v_fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Post-check failed: role % should not have EXECUTE on consume_security_nonce', v_role;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('service_role', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Post-check failed: service_role missing EXECUTE on consume_security_nonce';
  END IF;
END $$;

COMMIT;
