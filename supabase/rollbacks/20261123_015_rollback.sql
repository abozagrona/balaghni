-- =============================================================================
-- Migration 015 (ROLLBACK): Revert public.gift_redemptions Grants & Policies
-- بَلِّغْنِي | BALAGHNI
--
-- ملاحظة تشغيلية:
--   - يعيد جدول public.gift_redemptions إلى حالته السابقة المعروفة (RLS مفعّل،
--     وصلاحيات service_role مسحوبة دون حذف الجدول أو أي سجلات ودون CASCADE).
--   - يُحفظ هذا الملف في supabase/rollbacks/ فقط ولا يُشغّل تلقائياً.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS gift_redemptions_service_role_select ON public.gift_redemptions;
DROP POLICY IF EXISTS gift_redemptions_service_role_insert ON public.gift_redemptions;

REVOKE SELECT, INSERT ON TABLE public.gift_redemptions FROM service_role;

ALTER TABLE public.gift_redemptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gift_redemptions FROM PUBLIC, anon, authenticated;

COMMIT;
