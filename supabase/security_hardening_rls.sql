-- =============================================================================
-- بَلِّغْنِي | BALAGHNI — سكربت التحصين الأمني لقاعدة البيانات (Row Level Security)
-- المرحلة الثانية: إغلاق صلاحيات الوصول المفتوح (anon / public) وحصرها بـ service_role
-- =============================================================================
-- توثيق الجداول الـ 14 والسياسات القديمة التي يتم استبدالها:
--   1. tags: كانت تمنح anon قراءة وتحديث وإدراج مفتوح (Allow public read/update/insert) -> تُحصر بـ service_role (تفعيل QR وفحص الملاحظات وبيانات المالك تمر عبر /api/tags/* و/api/dashboard).
--   2. stickers: مخزون الملصقات غير المفعلة ورموز الخدش -> تُحصر بـ service_role (عبر /api/stickers/* و/api/orders).
--   3. orders: طلبات العملاء وأرقام هواتفهم وعناوينهم -> تُحصر بـ service_role (عبر /api/orders و/api/admin).
--   4. reports: بلاغات المركبات وreporter_phone -> تُحصر بـ service_role (عبر /api/notify و/api/dashboard).
--   5. vehicle_documents: وثائق الصيانة والرخص لخدمة نبّهني -> تُحصر بـ service_role (عبر /api/dashboard و/api/cron/reminders).
--   6. maintenance_records: سجلات الصيانة وتكاليفها -> تُحصر بـ service_role (عبر /api/dashboard).
--   7. admin_profiles: حسابات المشرفين وpin_hash -> تُحصر بـ service_role (عبر /api/auth/login و/api/admin).
--   8. admin_audit_logs: سجل التدقيق الإداري -> تُحصر بـ service_role.
--   9. vendors: بيانات المناديب والتجار -> تُحصر بـ service_role (عبر /api/vendor و/api/admin).
--  10. vendor_settlements: التسويات المالية للمناديب -> تُحصر بـ service_role.
--  11. corporate_leads: طلبات الشركات والأساطيل -> تُحصر بـ service_role (عبر /api/corporate-leads).
--  12. otp_verifications: رموز التحقق المؤقتة OTP -> تُحصر بـ service_role (عبر /api/auth/otp).
--  13. gift_redemptions: استرداد الهدايا -> تُحصر بـ service_role.
--  14. visual_overrides: إعدادات المظهر الإدارية -> تُحصر بـ service_role (عبر /api/visual-overrides).
--
-- ملاحظة: جميع مسارات Next.js API تعمل خادمياً عبر SUPABASE_SERVICE_ROLE_KEY وتتحقق
-- من جلسات HMAC-SHA256 الموقعة (admin_session, owner_session, vendor_session).
-- =============================================================================

BEGIN;

-- 1. تفعيل RLS وإلغاء جميع السياسات المفتوحة على كافة جداول المنصة
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
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated;', tbl);

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

-- 2. تحصين حاوية صور البلاغات (Storage Bucket: report-photos) وجعلها خاصة (Private)
DO $$
DECLARE
  pol record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    -- جعل الحاوية خاصة (public = false) والوصول عبر روابط موقّعة من الخادم فقط
    UPDATE storage.buckets
    SET
      public = false,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
    WHERE id = 'report-photos';

    -- حذف أي سياسات قراءة أو رفع عامة على report-photos
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

    -- حصر القراءة والرفع والتعديل والحذف بالخادم (service_role) فقط — بدون أي وصول عام
    DROP POLICY IF EXISTS "report_photos_public_read" ON storage.objects;
    DROP POLICY IF EXISTS "report_photos_service_role_write" ON storage.objects;
    DROP POLICY IF EXISTS "report_photos_service_role_only" ON storage.objects;
    CREATE POLICY "report_photos_service_role_only"
      ON storage.objects
      FOR ALL
      TO service_role
      USING (bucket_id = 'report-photos')
      WITH CHECK (bucket_id = 'report-photos');
  END IF;
END $$;

COMMIT;
