-- =============================================================================
-- بَلِّغْنِي | BALAGHNI — سكربت التحصين الأمني لقاعدة البيانات (Row Level Security)
-- المرحلة الثانية: إغلاق صلاحيات الوصول المفتوح (anon / public) وحصرها بـ service_role
-- =============================================================================
-- تنبيه هام قبل التنفيذ في Supabase SQL Editor:
-- 1. تأكد من إضافة المتغير SUPABASE_SERVICE_ROLE_KEY في إعدادات بيئة الخادم (Vercel / .env.local).
-- 2. تأكد من إضافة المتغير SESSION_HMAC_SECRET (مفتاح عشوائي بطول 32 بايت على الأقل) لتوقيع الجلسات.
-- 3. جميع مسارات الخادم (Next.js API Routes) أصبحت تعمل حصرياً عبر الخادم باستخدام SUPABASE_SERVICE_ROLE_KEY،
--    لذلك فإن إغلاق صلاحيات (anon) لن يؤثر على أي وظيفة في الموقع بل يمنع أي استعلام مباشر من المتصفح.
-- =============================================================================

BEGIN;

-- 1. تفعيل RLS وإلغاء جميع السياسات المفتوحة (USING (true)) على كافة جداول المنصة
DO $$
DECLARE
  tbl text;
  pol record;
  target_tables text[] := ARRAY[
    'tags',
    'stickers',
    'orders',
    'reports',
    'vehicle_documents',
    'maintenance_records',
    'admin_profiles',
    'admin_audit_logs',
    'vendors',
    'vendor_settlements',
    'corporate_leads',
    'otp_verifications',
    'gift_redemptions',
    'visual_overrides'
  ];
BEGIN
  FOREACH tbl IN ARRAY target_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      -- تفعيل Row Level Security وإجبار تطبيقه
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      -- حذف جميع السياسات القديمة المفتوحة للعامة (anon / public)
      FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = tbl
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, tbl);
      END LOOP;

      -- سحب الصلاحيات المباشرة من الأدوار العامة (anon و authenticated)
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated;', tbl);

      -- منح الصلاحيات الكاملة لدور الخادم الموثوق (service_role) فقط
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role;', tbl);

      -- إنشاء سياسة صريحة تسمح لدور service_role فقط بالقراءة والكتابة
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
        tbl || '_service_role_only',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- 2. تحصين حاوية صور البلاغات (Storage Bucket: report-photos)
DO $$
DECLARE
  pol record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    -- ضبط قيود الحاوية: الحد الأقصى 5 ميجابايت، وأنواع الصور المسموحة فقط (JPEG, PNG, WebP)
    UPDATE storage.buckets
    SET
      public = true,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
    WHERE id = 'report-photos';

    -- حذف السياسات المفتوحة القديمة للرفع أو الحذف عبر anon على report-photos
    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND (
          policyname ILIKE '%report-photos%'
          OR policyname ILIKE '%report_photos%'
          OR policyname ILIKE '%Allow public uploads%'
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects;', pol.policyname);
    END LOOP;

    -- السماح بالقراءة العامة لعرض صور البلاغات فقط، وحصر الرفع والتعديل والحذف بالخادم (service_role)
    DROP POLICY IF EXISTS "report_photos_public_read" ON storage.objects;
    CREATE POLICY "report_photos_public_read"
      ON storage.objects
      FOR SELECT
      TO public
      USING (bucket_id = 'report-photos');

    DROP POLICY IF EXISTS "report_photos_service_role_write" ON storage.objects;
    CREATE POLICY "report_photos_service_role_write"
      ON storage.objects
      FOR ALL
      TO service_role
      USING (bucket_id = 'report-photos')
      WITH CHECK (bucket_id = 'report-photos');
  END IF;
END $$;

COMMIT;
