-- =============================================================================
-- بَلِّغْنِي | BALAGHNI — تفعيل Realtime على جدول البلاغات وتتبع رسائل واتساب و Twilio
-- =============================================================================

BEGIN;

-- 1. إضافة أعمدة تتبع رسائل واتساب و Twilio والرمز المختصر للرد السريع ورقم المُبلِّغ في جدول reports
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS whatsapp_message_id text,
  ADD COLUMN IF NOT EXISTS twilio_message_sid text,
  ADD COLUMN IF NOT EXISTS whatsapp_status text default 'sent',
  ADD COLUMN IF NOT EXISTS short_code text,
  ADD COLUMN IF NOT EXISTS reporter_phone text;

CREATE INDEX IF NOT EXISTS idx_reports_whatsapp_message_id
  ON public.reports (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_twilio_message_sid
  ON public.reports (twilio_message_sid)
  WHERE twilio_message_sid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_short_code
  ON public.reports (short_code)
  WHERE short_code IS NOT NULL;

-- 2. السماح بدور anon بقراءة تحديثات حالة البلاغ عبر Supabase Realtime (SELECT)
GRANT SELECT ON TABLE public.reports TO anon, authenticated;

DROP POLICY IF EXISTS "reports_public_realtime_select" ON public.reports;
CREATE POLICY "reports_public_realtime_select"
  ON public.reports
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 3. تفعيل REPLICA IDENTITY FULL وضم جدول reports إلى منشور supabase_realtime
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
