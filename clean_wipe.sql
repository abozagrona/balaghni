-- ============================================================================
-- منصة «بَلِّغْنِي | BALAGHNI» — كود التصفير الشامل لقاعدة بيانات Supabase
-- تشغيل في: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================================

-- 1. تصفير الملصقات بالكامل
DELETE FROM public.tags;

-- 2. تصفير البلاغات والوثائق وسجلات الرقابة
DELETE FROM public.reports;
DELETE FROM public.vehicle_documents;
DELETE FROM public.admin_audit_logs;

-- 3. الإبقاء التام على حساب المدير الرئيسي 0919009899 فقط وبصمته ومسح أي حسابات أخرى
DELETE FROM public.admin_profiles
WHERE username != '0919009899' AND phone != '0919009899';

-- النتيجة: النظام الآن في حالة الصفر النظيف (0 ملصقات، 0 بلاغات، 0 سجلات).
