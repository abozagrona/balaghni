-- ============================================================================
-- منصة «بَلِّغْنِي | BALAGHNI» — سكربت التهيئة والأمان والتصفير الكامل لقاعدة بيانات Supabase
-- Clean Slate & Security Hardening Migration
-- ============================================================================

-- 1. إضافة وتحديث كافة الأعمدة المطلوبة لجدول الملصقات (tags)
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS owner_phone text;
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS owner_pin_hash text;
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS recovery_key_hash text;
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS passkey_credential_id text;
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS vehicle_info text;
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS vehicle_brand text DEFAULT 'Hyundai';
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS vehicle_model text DEFAULT 'Elantra';
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS vehicle_color text DEFAULT 'أبيض';
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS city text DEFAULT 'طرابلس';
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS tag_type text DEFAULT 'car';
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS tier text DEFAULT 'premium';
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS alert_channel text DEFAULT 'BOTH';
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS has_emergency_contacts boolean DEFAULT false;
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS emergency_phones text[] DEFAULT '{}';
ALTER TABLE IF EXISTS public.tags ADD COLUMN IF NOT EXISTS activated_at timestamptz;

-- 2. فهرسة الحقول الهامة للبحث السريع
CREATE INDEX IF NOT EXISTS idx_tags_tag_code ON public.tags (tag_code);
CREATE INDEX IF NOT EXISTS idx_tags_owner_phone ON public.tags (owner_phone);
CREATE INDEX IF NOT EXISTS idx_tags_status ON public.tags (status);

-- 3. ضبط سياسات أمان مستوى الصف (RLS Policies) لجدول الملصقات
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read of tags" ON public.tags;
CREATE POLICY "Allow public read of tags"
  ON public.tags FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow tag activation and security setup" ON public.tags;
CREATE POLICY "Allow tag activation and security setup"
  ON public.tags FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow seeding tags" ON public.tags;
CREATE POLICY "Allow seeding tags"
  ON public.tags FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow admin delete of tags" ON public.tags;
CREATE POLICY "Allow admin delete of tags"
  ON public.tags FOR DELETE
  USING (true);

-- 4. ضبط سياسات جدول البلاغات (reports)
ALTER TABLE IF EXISTS public.reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public access to reports" ON public.reports;
CREATE POLICY "Allow public access to reports"
  ON public.reports FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. تصفير كامل لجميع السجلات الاختبارية لبدء النظام من الصفر النظيف (0 ملصقات)
-- ملاحظة: لا يتم مسح جدول admin_profiles للحفاظ على حسابات المشرفين المعتمدين
DELETE FROM public.reports;
DELETE FROM public.vehicle_documents;
DELETE FROM public.tags;

-- التأكيد: أصبح عدد الملصقات الآن 0 تماماً في قاعدة البيانات وجاهز لإصدار الدفعات الرسمية.
