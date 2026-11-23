-- =============================================================================
-- بَلِّغْنِي | BALAGHNI — فحص ما قبل الترحيل (قراءة فقط - READ ONLY)
-- نفّذ هذا السكربت في Supabase SQL Editor قبل تطبيق أي Migration
-- للتأكد من حالة الجداول والسياسات والقيود الحالية، مع أخذ نسخة احتياطية من لوحة Supabase Backups
-- =============================================================================

-- 1. فحص جميع الجداول في public وحالة RLS
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- 2. فحص أي سياسات تسمح بوصول anon أو authenticated أو public (التدقيق الأمني)
SELECT tablename, policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    'anon' = ANY(roles)
    OR 'authenticated' = ANY(roles)
    OR 'public' = ANY(roles)
  )
ORDER BY tablename, policyname;

-- 3. فحص القيود (Constraints) على جداول غرفة العمليات والبلاغات
SELECT conrelid::regclass::text AS table_name, conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid::regclass::text IN ('ai_agents', 'agent_tasks', 'agent_logs', 'agent_skills', 'reports')
ORDER BY table_name, conname;

-- 4. فحص الفهارس (Indexes) الحالية
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('ai_agents', 'agent_tasks', 'agent_logs', 'agent_skills', 'reports')
ORDER BY tablename, indexname;

-- 5. فحص الجداول المفعّلة في منشور Realtime
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
ORDER BY tablename;

-- 6. تعداد الصفوف الحالية قبل الترحيل
SELECT 'ai_agents' AS tbl, count(*) AS row_count FROM public.ai_agents
UNION ALL SELECT 'agent_tasks', count(*) FROM public.agent_tasks
UNION ALL SELECT 'agent_logs', count(*) FROM public.agent_logs
UNION ALL SELECT 'agent_skills', count(*) FROM public.agent_skills
UNION ALL SELECT 'reports', count(*) FROM public.reports;
