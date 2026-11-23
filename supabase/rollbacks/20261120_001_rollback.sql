-- =============================================================================
-- Migration 001 (ROLLBACK): التراجع المنظّم عن الترحيل 001
-- بَلِّغْنِي | BALAGHNI
--
-- جرد جميع التغييرات التي أجراها Migration 001:
--   [أ] جدول ودوال Rate Limiter المركزي:
--       - TABLE public.rate_limit_entries
--       - FUNCTION public.rl_check(text, integer, bigint)
--       - FUNCTION public.rl_record(text, integer, bigint)
--       - FUNCTION public.rl_clear(text)
--   [ب] جدول البلاغات public.reports وجدول public.notifications:
--       - تم سحب الصلاحيات: REVOKE ALL ON TABLE public.reports FROM PUBLIC, anon, authenticated
--       - تم حذف السياسة المكشوفة: DROP POLICY reports_public_realtime_select ON public.reports
--       - تم الإبقاء على السياسة الآمنة: reports_service_role_only (FOR ALL TO service_role)
--       - تم إزالة public.reports من منشور supabase_realtime (postgres_changes)
--
-- قاعدة أمان صارمة:
--   هذا الملف يتراجع تلقائياً عن [أ] فقط، ولا يُعيد تلقائياً أي سياسة عامة (anon/public)
--   تكشف بيانات البلاغات أو أرقام المبلغين (reporter_phone).
-- =============================================================================

BEGIN;

-- 1. التراجع عن دوال وجدول Rate Limiter المركزي
REVOKE ALL ON FUNCTION public.rl_clear(text) FROM service_role;
REVOKE ALL ON FUNCTION public.rl_record(text, integer, bigint) FROM service_role;
REVOKE ALL ON FUNCTION public.rl_check(text, integer, bigint) FROM service_role;

DROP FUNCTION IF EXISTS public.rl_clear(text);
DROP FUNCTION IF EXISTS public.rl_record(text, integer, bigint);
DROP FUNCTION IF EXISTS public.rl_check(text, integer, bigint);
DROP TABLE IF EXISTS public.rate_limit_entries;

-- 2. [توثيق مرجعي فقط — معطّل عمداً لمنع إعادة كشف بيانات البلاغات تلقائياً]
-- في حال الطوارئ القصوى فقط وبعد موافقة أمنية صريحة، هذه هي الأوامر التي كانت مطبّقة سابقاً
-- قبل Migration 001 (من ملف supabase/realtime_and_whatsapp_tracking.sql):
--
-- GRANT SELECT ON TABLE public.reports TO anon, authenticated;
-- CREATE POLICY "reports_public_realtime_select"
--   ON public.reports
--   FOR SELECT
--   TO anon, authenticated
--   USING (true);
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.reports;

COMMIT;
