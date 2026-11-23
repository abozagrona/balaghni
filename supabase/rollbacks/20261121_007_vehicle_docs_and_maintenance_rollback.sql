-- =============================================================================
-- Migration 007 (ROLLBACK): Safe Rollback for
--   public.vehicle_documents & public.maintenance_records ONLY
-- بَلِّغْنِي | BALAGHNI
-- توثيق الحالة بعد Rollback:
--   - يعيد الجدولين إلى وضع مغلق وآمن تماماً، ولا يعيد السياسات العامة القديمة أبداً.
--   - تبقى RLS مفعّلة، وتُسحب جميع الصلاحيات من PUBLIC, anon, authenticated, service_role.
--   - لا يحذف أي بيانات ولا يمس أي جدول آخر.
-- =============================================================================

BEGIN;

-- 1. public.vehicle_documents
ALTER TABLE public.vehicle_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_documents_service_role_select ON public.vehicle_documents;
DROP POLICY IF EXISTS vehicle_documents_service_role_insert ON public.vehicle_documents;
DROP POLICY IF EXISTS vehicle_documents_service_role_update ON public.vehicle_documents;
REVOKE ALL ON TABLE public.vehicle_documents FROM PUBLIC, anon, authenticated, service_role;

-- 2. public.maintenance_records
ALTER TABLE public.maintenance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maintenance_records_service_role_select ON public.maintenance_records;
DROP POLICY IF EXISTS maintenance_records_service_role_insert ON public.maintenance_records;
REVOKE ALL ON TABLE public.maintenance_records FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
