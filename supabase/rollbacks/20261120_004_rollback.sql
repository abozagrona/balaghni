-- =============================================================================
-- Migration 004 (ROLLBACK) — Phase 3B / Batch 1 Safe Rollback
-- بَلِّغْنِي | BALAGHNI
-- يُرجع فقط صلاحيات وسياسات الدفعة الأولى:
--   - لا يفتح أي بيانات لـ PUBLIC أو anon أو authenticated.
--   - لا يلمس جدول reports أو أي جداول من دفعات أخرى.
-- =============================================================================

BEGIN;

-- 1. stickers
DROP POLICY IF EXISTS stickers_service_role_select ON public.stickers;
DROP POLICY IF EXISTS stickers_service_role_insert ON public.stickers;
DROP POLICY IF EXISTS stickers_service_role_update ON public.stickers;
REVOKE SELECT, INSERT, UPDATE ON TABLE public.stickers FROM service_role;
REVOKE ALL ON TABLE public.stickers FROM PUBLIC, anon, authenticated;

-- 2. orders
DROP POLICY IF EXISTS orders_service_role_select ON public.orders;
DROP POLICY IF EXISTS orders_service_role_insert ON public.orders;
DROP POLICY IF EXISTS orders_service_role_update ON public.orders;
REVOKE SELECT, INSERT, UPDATE ON TABLE public.orders FROM service_role;
REVOKE ALL ON TABLE public.orders FROM PUBLIC, anon, authenticated;

-- 3. vendors
DROP POLICY IF EXISTS vendors_service_role_select ON public.vendors;
DROP POLICY IF EXISTS vendors_service_role_insert ON public.vendors;
REVOKE SELECT, INSERT ON TABLE public.vendors FROM service_role;
REVOKE ALL ON TABLE public.vendors FROM PUBLIC, anon, authenticated;

-- 4. vendor_settlements
DROP POLICY IF EXISTS vendor_settlements_service_role_select ON public.vendor_settlements;
DROP POLICY IF EXISTS vendor_settlements_service_role_insert ON public.vendor_settlements;
REVOKE SELECT, INSERT ON TABLE public.vendor_settlements FROM service_role;
REVOKE ALL ON TABLE public.vendor_settlements FROM PUBLIC, anon, authenticated;

-- 5. corporate_leads
DROP POLICY IF EXISTS corporate_leads_service_role_select ON public.corporate_leads;
DROP POLICY IF EXISTS corporate_leads_service_role_insert ON public.corporate_leads;
REVOKE SELECT, INSERT ON TABLE public.corporate_leads FROM service_role;
REVOKE ALL ON TABLE public.corporate_leads FROM PUBLIC, anon, authenticated;

COMMIT;
