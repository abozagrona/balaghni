-- =============================================================================
-- Migration 015 (UP): Least-Privilege RLS & Grants for public.gift_redemptions
-- بَلِّغْنِي | BALAGHNI
--
-- الغرض (إغلاق QA-ADM-04):
--   تطبيق سياسة أقل الصلاحيات المعتمدة (مطابقاً لنمط Migration 004 وRLS_REVIEW_MATRIX.md)
--   على جدول public.gift_redemptions فقط دون تعديل أي جدول آخر أو بيانات قائمة:
--   1. تفعيل RLS وسحب جميع الصلاحيات من PUBLIC وanon وauthenticated.
--   2. منح service_role صلاحيتي SELECT وINSERT فقط (دون UPDATE أو DELETE أو TRUNCATE أو REFERENCES أو TRIGGER).
--   3. إنشاء سياستي RLS صريحتين منفصلتين لـ service_role (SELECT وINSERT).
-- =============================================================================

BEGIN;

ALTER TABLE public.gift_redemptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gift_redemptions FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT ON TABLE public.gift_redemptions TO service_role;

DROP POLICY IF EXISTS gift_redemptions_service_role_select ON public.gift_redemptions;
DROP POLICY IF EXISTS gift_redemptions_service_role_insert ON public.gift_redemptions;

CREATE POLICY gift_redemptions_service_role_select
  ON public.gift_redemptions FOR SELECT TO service_role USING (true);

CREATE POLICY gift_redemptions_service_role_insert
  ON public.gift_redemptions FOR INSERT TO service_role WITH CHECK (true);

COMMIT;
