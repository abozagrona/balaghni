-- =============================================================================
-- Migration 009 (ROLLBACK): Safe Rollback for report-photos Storage ONLY
-- بَلِّغْنِي | BALAGHNI
-- توثيق أثر Rollback:
--   - لا يحذف حاوية report-photos ولا يحذف أي صور أو كائنات مخزنة في storage.objects.
--   - لا يلمس سياسات أو صلاحيات storage.objects ولا يفتح أي وصول عام.
--   - يُبقي الحاوية خاصة (public = false) ويحافظ على حد 5MB (5242880) وأنواع MIME المعتمدة
--     دون تصفيرها إلى NULL، وتبقى جميع الصور والروابط الموقّعة القائمة آمنة وسليمة.
-- =============================================================================

BEGIN;

UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'report-photos';

COMMIT;
