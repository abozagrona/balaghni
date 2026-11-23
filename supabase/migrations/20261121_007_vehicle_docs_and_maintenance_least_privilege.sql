-- =============================================================================
-- Migration 007 (UP): Least-Privilege RLS & Grants for
--   1. public.vehicle_documents (SELECT, INSERT, UPDATE لـ service_role فقط)
--   2. public.maintenance_records (SELECT, INSERT لـ service_role فقط)
-- بَلِّغْنِي | BALAGHNI
-- المبادئ:
--   - حذف السياسات العامة القديمة.
--   - سحب جميع الصلاحيات (بما فيها DELETE وDxtm) من PUBLIC, anon, authenticated, service_role أولاً.
--   - منح الصلاحيات المحددة فقط لـ service_role مع سياسة مستقلة لكل عملية.
--   - إبقاء RLS مفعّلة وعدم تفعيل FORCE RLS، وعدم تغيير البنية أو البيانات أو أي جدول آخر.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. public.vehicle_documents: SELECT, INSERT, UPDATE لـ service_role فقط
-- -----------------------------------------------------------------------------
ALTER TABLE public.vehicle_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access to vehicle_documents" ON public.vehicle_documents;

REVOKE ALL ON TABLE public.vehicle_documents FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.vehicle_documents TO service_role;

DROP POLICY IF EXISTS vehicle_documents_service_role_select ON public.vehicle_documents;
DROP POLICY IF EXISTS vehicle_documents_service_role_insert ON public.vehicle_documents;
DROP POLICY IF EXISTS vehicle_documents_service_role_update ON public.vehicle_documents;

CREATE POLICY vehicle_documents_service_role_select
  ON public.vehicle_documents
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY vehicle_documents_service_role_insert
  ON public.vehicle_documents
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY vehicle_documents_service_role_update
  ON public.vehicle_documents
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 2. public.maintenance_records: SELECT, INSERT لـ service_role فقط
-- -----------------------------------------------------------------------------
ALTER TABLE public.maintenance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public access to maintenance_records" ON public.maintenance_records;

REVOKE ALL ON TABLE public.maintenance_records FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.maintenance_records TO service_role;

DROP POLICY IF EXISTS maintenance_records_service_role_select ON public.maintenance_records;
DROP POLICY IF EXISTS maintenance_records_service_role_insert ON public.maintenance_records;

CREATE POLICY maintenance_records_service_role_select
  ON public.maintenance_records
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY maintenance_records_service_role_insert
  ON public.maintenance_records
  FOR INSERT
  TO service_role
  WITH CHECK (true);

COMMIT;
