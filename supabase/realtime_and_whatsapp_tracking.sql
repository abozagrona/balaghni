-- =============================================================================
-- بَلِّغْنِي | BALAGHNI — تفعيل Realtime على جدول البلاغات وتتبع رسائل واتساب
-- =============================================================================

BEGIN;

-- 1. إضافة أعمدة تتبع رسائل واتساب والرمز المختصر للرد السريع في جدول reports
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS whatsapp_message_id text,
  ADD COLUMN IF NOT EXISTS short_code text;

CREATE INDEX IF NOT EXISTS idx_reports_whatsapp_message_id
  ON public.reports (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_short_code
  ON public.reports (short_code)
  WHERE short_code IS NOT NULL;

-- 2. تفعيل REPLICA IDENTITY FULL وضم جدول reports إلى منشور supabase_realtime
ALTER TABLE public.reports REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'reports'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.reports;
    END IF;
  END IF;
END $$;

COMMIT;
