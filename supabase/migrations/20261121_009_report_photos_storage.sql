-- =============================================================================
-- Migration 009 (UP): Private Storage Bucket for report-photos ONLY
-- بَلِّغْنِي | BALAGHNI
-- السياسة المعتمدة:
--   - إنشاء أو تحديث حاوية report-photos كحاوية خاصة (public = false).
--   - حد حجم الملف 5MB (5242880 بايت) وأنواع MIME: image/jpeg, image/png, image/webp فقط.
--   - عدم تعديل أي سياسة أو صلاحية على storage.objects.
--   - فحص قرائي صارم: قراءة جميع سياسات storage.objects وعددها وتعريفاتها، وإيقاف التنفيذ
--     برسالة تطلب مراجعة يدوية إذا لم يكن العدد صفراً (دون الاعتماد على البحث النصي).
-- =============================================================================

BEGIN;

-- 1. فحص قرائي صارم على storage.objects (RLS + عدد وتعريفات جميع السياسات)
DO $$
DECLARE
  v_rls_enabled boolean;
  v_policy_count integer;
  v_policy_summary text;
BEGIN
  SELECT c.relrowsecurity
    INTO v_rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'storage' AND c.relname = 'objects';

  IF v_rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Aborted: RLS is not enabled on storage.objects';
  END IF;

  SELECT
    count(*)::int,
    string_agg(
      format(
        '%I (%s TO %s | USING: %s | WITH CHECK: %s)',
        policyname,
        cmd,
        roles::text,
        coalesce(qual, 'NULL'),
        coalesce(with_check, 'NULL')
      ),
      '; ' ORDER BY policyname
    )
    INTO v_policy_count, v_policy_summary
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects';

  IF v_policy_count <> 0 THEN
    RAISE EXCEPTION 'Manual review required: storage.objects has % existing policy(ies) [%]',
      v_policy_count,
      coalesce(v_policy_summary, '');
  END IF;
END $$;

-- 2. إنشاء أو تحديث حاوية report-photos كحاوية خاصة بحد 5MB وأنواع الصور المعتمدة فقط
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'report-photos',
  'report-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

COMMIT;
