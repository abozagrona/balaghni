-- =============================================================================
-- Migration 010 (UP): Revoke Excess PUBLIC EXECUTE Privileges on Trigger Functions
--   1. public.prevent_ai_audit_logs_mutation()
--   2. public.rls_auto_enable()
-- بَلِّغْنِي | BALAGHNI — VULN-09
--
-- الضوابط المعتمدة:
--   - سحب EXECUTE من PUBLIC فقط لكلتا الدالتين (دون منح service_role/anon/authenticated).
--   - عدم تغيير مالك الدالتين (postgres) أو SECURITY INVOKER/DEFINER أو search_path أو الجسم.
--   - عدم تعطيل أو حذف أو تعديل أي Trigger عادي أو Event Trigger.
--   - التنفيذ داخل معاملة واحدة (BEGIN ... COMMIT) مع فحوص قبلية وبعدية صارمة.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. الفحوص القبلية: التحقق من الدالتين والمالك وSECURITY وproconfig والـ Triggers
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_fn_ai_oid oid;
  v_fn_rls_oid oid;
  v_owner_ai text;
  v_owner_rls text;
  v_secdef_ai boolean;
  v_secdef_rls boolean;
  v_config_ai text[];
  v_config_rls text[];
  v_trg_enabled "char";
  v_evt_enabled "char";
BEGIN
  v_fn_ai_oid := to_regprocedure('public.prevent_ai_audit_logs_mutation()');
  IF v_fn_ai_oid IS NULL THEN
    RAISE EXCEPTION 'Pre-check failed: public.prevent_ai_audit_logs_mutation() does not exist';
  END IF;

  v_fn_rls_oid := to_regprocedure('public.rls_auto_enable()');
  IF v_fn_rls_oid IS NULL THEN
    RAISE EXCEPTION 'Pre-check failed: public.rls_auto_enable() does not exist';
  END IF;

  SELECT pg_get_userbyid(proowner), prosecdef, proconfig
    INTO v_owner_ai, v_secdef_ai, v_config_ai
  FROM pg_proc WHERE oid = v_fn_ai_oid;

  SELECT pg_get_userbyid(proowner), prosecdef, proconfig
    INTO v_owner_rls, v_secdef_rls, v_config_rls
  FROM pg_proc WHERE oid = v_fn_rls_oid;

  IF v_owner_ai IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Pre-check failed: unexpected owner for prevent_ai_audit_logs_mutation(): %', v_owner_ai;
  END IF;

  IF v_owner_rls IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Pre-check failed: unexpected owner for rls_auto_enable(): %', v_owner_rls;
  END IF;

  IF v_secdef_ai IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Pre-check failed: prevent_ai_audit_logs_mutation() must be SECURITY INVOKER (prosecdef=%)', v_secdef_ai;
  END IF;

  IF v_secdef_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Pre-check failed: rls_auto_enable() must be SECURITY DEFINER (prosecdef=%)', v_secdef_rls;
  END IF;

  IF NOT COALESCE('search_path=public' = ANY(v_config_ai), false) THEN
    RAISE EXCEPTION 'Pre-check failed: prevent_ai_audit_logs_mutation() missing search_path=public (proconfig=%)', v_config_ai;
  END IF;

  IF NOT COALESCE('search_path=pg_catalog' = ANY(v_config_rls), false) THEN
    RAISE EXCEPTION 'Pre-check failed: rls_auto_enable() missing search_path=pg_catalog (proconfig=%)', v_config_rls;
  END IF;

  SELECT t.tgenabled INTO v_trg_enabled
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE NOT t.tgisinternal
    AND ns.nspname = 'public'
    AND c.relname = 'ai_audit_logs'
    AND t.tgname = 'trg_ai_audit_logs_immutable'
    AND t.tgfoid = v_fn_ai_oid;

  IF v_trg_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'Pre-check failed: trigger trg_ai_audit_logs_immutable missing or not enabled (state=%)', v_trg_enabled;
  END IF;

  SELECT e.evtenabled INTO v_evt_enabled
  FROM pg_event_trigger e
  WHERE e.evtname = 'ensure_rls'
    AND e.evtfoid = v_fn_rls_oid;

  IF v_evt_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'Pre-check failed: event trigger ensure_rls missing or not enabled (state=%)', v_evt_enabled;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. سحب صلاحية EXECUTE من PUBLIC فقط (الإبقاء على صلاحيات المالك postgres)
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.prevent_ai_audit_logs_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 3. الفحوص البعدية: التحقق من ACL والأدوار الفعلية والمالك وproconfig والـ Triggers
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_fn_ai_oid oid := to_regprocedure('public.prevent_ai_audit_logs_mutation()');
  v_fn_rls_oid oid := to_regprocedure('public.rls_auto_enable()');
  v_owner_ai text;
  v_owner_rls text;
  v_secdef_ai boolean;
  v_secdef_rls boolean;
  v_config_ai text[];
  v_config_rls text[];
  v_extra_exec_ai integer;
  v_extra_exec_rls integer;
  v_trg_enabled "char";
  v_evt_enabled "char";
  v_role text;
BEGIN
  -- 3.1 فحص ACL مباشرة عبر aclexplode للتأكد من عدم وجود EXECUTE لـ PUBLIC أو لأي جهة غير المالك
  SELECT COUNT(*)
    INTO v_extra_exec_ai
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
  WHERE p.oid = v_fn_ai_oid
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> p.proowner;

  IF v_extra_exec_ai > 0 THEN
    RAISE EXCEPTION 'Post-check failed: non-owner EXECUTE privilege remains in ACL for prevent_ai_audit_logs_mutation() (count=%)', v_extra_exec_ai;
  END IF;

  SELECT COUNT(*)
    INTO v_extra_exec_rls
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
  WHERE p.oid = v_fn_rls_oid
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> p.proowner;

  IF v_extra_exec_rls > 0 THEN
    RAISE EXCEPTION 'Post-check failed: non-owner EXECUTE privilege remains in ACL for rls_auto_enable() (count=%)', v_extra_exec_rls;
  END IF;

  -- 3.2 فحص صلاحيات الأدوار الفعلية (anon و authenticated و service_role) دون تمرير 'public'
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(v_role, v_fn_ai_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Post-check failed: role % still has EXECUTE on prevent_ai_audit_logs_mutation()', v_role;
    END IF;
    IF has_function_privilege(v_role, v_fn_rls_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Post-check failed: role % still has EXECUTE on rls_auto_enable()', v_role;
    END IF;
  END LOOP;

  -- 3.3 التحقق البعدي من المالك وSECURITY وproconfig (search_path)
  SELECT pg_get_userbyid(proowner), prosecdef, proconfig
    INTO v_owner_ai, v_secdef_ai, v_config_ai
  FROM pg_proc WHERE oid = v_fn_ai_oid;

  SELECT pg_get_userbyid(proowner), prosecdef, proconfig
    INTO v_owner_rls, v_secdef_rls, v_config_rls
  FROM pg_proc WHERE oid = v_fn_rls_oid;

  IF v_owner_ai IS DISTINCT FROM 'postgres' OR v_secdef_ai IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Post-check failed: owner or security mode changed on prevent_ai_audit_logs_mutation()';
  END IF;

  IF v_owner_rls IS DISTINCT FROM 'postgres' OR v_secdef_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Post-check failed: owner or security mode changed on rls_auto_enable()';
  END IF;

  IF NOT COALESCE('search_path=public' = ANY(v_config_ai), false) THEN
    RAISE EXCEPTION 'Post-check failed: prevent_ai_audit_logs_mutation() lost search_path=public (proconfig=%)', v_config_ai;
  END IF;

  IF NOT COALESCE('search_path=pg_catalog' = ANY(v_config_rls), false) THEN
    RAISE EXCEPTION 'Post-check failed: rls_auto_enable() lost search_path=pg_catalog (proconfig=%)', v_config_rls;
  END IF;

  -- 3.4 التحقق البعدي من استمرار تفعيل Trigger وEvent Trigger
  SELECT t.tgenabled INTO v_trg_enabled
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE NOT t.tgisinternal
    AND ns.nspname = 'public'
    AND c.relname = 'ai_audit_logs'
    AND t.tgname = 'trg_ai_audit_logs_immutable'
    AND t.tgfoid = v_fn_ai_oid;

  IF v_trg_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'Post-check failed: trigger trg_ai_audit_logs_immutable no longer enabled (state=%)', v_trg_enabled;
  END IF;

  SELECT e.evtenabled INTO v_evt_enabled
  FROM pg_event_trigger e
  WHERE e.evtname = 'ensure_rls'
    AND e.evtfoid = v_fn_rls_oid;

  IF v_evt_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'Post-check failed: event trigger ensure_rls no longer enabled (state=%)', v_evt_enabled;
  END IF;
END $$;

COMMIT;
