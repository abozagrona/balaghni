-- =============================================================================
-- Migration 004 (UP) — Phase 3B / Batch 1: Commerce & Vendors Least-Privilege RLS
-- بَلِّغْنِي | BALAGHNI
-- الجداول المشمولة: stickers, orders, vendors, vendor_settlements, corporate_leads
-- المبادئ:
--   1. لا GRANT ALL ولا FORCE RLS جماعياً.
--   2. سحب كل الصلاحيات من PUBLIC, anon, authenticated.
--   3. منح service_role العمليات المثبتة في الكود فقط، مع سياسات منفصلة لكل عملية.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. stickers: الكود يستخدم SELECT, INSERT, UPDATE (upsert) فقط — بدون DELETE
-- -----------------------------------------------------------------------------
ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stickers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stickers TO service_role;

DROP POLICY IF EXISTS stickers_service_role_select ON public.stickers;
DROP POLICY IF EXISTS stickers_service_role_insert ON public.stickers;
DROP POLICY IF EXISTS stickers_service_role_update ON public.stickers;

CREATE POLICY stickers_service_role_select
  ON public.stickers FOR SELECT TO service_role USING (true);
CREATE POLICY stickers_service_role_insert
  ON public.stickers FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY stickers_service_role_update
  ON public.stickers FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 2. orders: الكود يستخدم SELECT, INSERT, UPDATE فقط — بدون DELETE
-- -----------------------------------------------------------------------------
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.orders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.orders TO service_role;

DROP POLICY IF EXISTS orders_service_role_select ON public.orders;
DROP POLICY IF EXISTS orders_service_role_insert ON public.orders;
DROP POLICY IF EXISTS orders_service_role_update ON public.orders;

CREATE POLICY orders_service_role_select
  ON public.orders FOR SELECT TO service_role USING (true);
CREATE POLICY orders_service_role_insert
  ON public.orders FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY orders_service_role_update
  ON public.orders FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 3. vendors: الكود يستخدم SELECT, INSERT فقط — بدون UPDATE/DELETE
-- -----------------------------------------------------------------------------
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vendors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.vendors TO service_role;

DROP POLICY IF EXISTS vendors_service_role_select ON public.vendors;
DROP POLICY IF EXISTS vendors_service_role_insert ON public.vendors;

CREATE POLICY vendors_service_role_select
  ON public.vendors FOR SELECT TO service_role USING (true);
CREATE POLICY vendors_service_role_insert
  ON public.vendors FOR INSERT TO service_role WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 4. vendor_settlements: الكود يستخدم SELECT, INSERT فقط — بدون UPDATE/DELETE
-- -----------------------------------------------------------------------------
ALTER TABLE public.vendor_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.vendor_settlements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.vendor_settlements TO service_role;

DROP POLICY IF EXISTS vendor_settlements_service_role_select ON public.vendor_settlements;
DROP POLICY IF EXISTS vendor_settlements_service_role_insert ON public.vendor_settlements;

CREATE POLICY vendor_settlements_service_role_select
  ON public.vendor_settlements FOR SELECT TO service_role USING (true);
CREATE POLICY vendor_settlements_service_role_insert
  ON public.vendor_settlements FOR INSERT TO service_role WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 5. corporate_leads: الكود يستخدم SELECT, INSERT فقط — بدون UPDATE/DELETE
-- -----------------------------------------------------------------------------
ALTER TABLE public.corporate_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.corporate_leads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.corporate_leads TO service_role;

DROP POLICY IF EXISTS corporate_leads_service_role_select ON public.corporate_leads;
DROP POLICY IF EXISTS corporate_leads_service_role_insert ON public.corporate_leads;

CREATE POLICY corporate_leads_service_role_select
  ON public.corporate_leads FOR SELECT TO service_role USING (true);
CREATE POLICY corporate_leads_service_role_insert
  ON public.corporate_leads FOR INSERT TO service_role WITH CHECK (true);

COMMIT;
