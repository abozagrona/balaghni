-- =============================================================================
-- Migration 002 (UP): BALAGHNI AI COMMAND CENTER — Additive-Only Schema Expansion
-- بَلِّغْنِي | BALAGHNI
-- القاعدة: Additive Only — لا حذف لجداول أو بيانات، توافق خلفي كامل مع الغرفة الحالية
-- الفريق: 11 موظفاً (10 وكلاء متخصصين + طارق skills_architect مع حظر تعديل الصلاحيات/الأمان)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. توسعة جدول ai_agents بأعمدة الحوكمة والنماذج والميزانية والصلاحيات المستقلة
-- -----------------------------------------------------------------------------
ALTER TABLE public.ai_agents
  ADD COLUMN IF NOT EXISTS model_provider text NOT NULL DEFAULT 'gemini',
  ADD COLUMN IF NOT EXISTS model_name text NOT NULL DEFAULT 'gemini-3.8-flash',
  ADD COLUMN IF NOT EXISTS daily_token_budget integer NOT NULL DEFAULT 250000 CHECK (daily_token_budget >= 1000),
  ADD COLUMN IF NOT EXISTS allowed_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS immutable_security_guardrails text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS risk_tier text NOT NULL DEFAULT 'low' CHECK (risk_tier IN ('low', 'medium', 'high')),
  ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS avatar_color text NOT NULL DEFAULT '#ED001B';

-- -----------------------------------------------------------------------------
-- 2. توسعة جدول agent_tasks بدورة الحياة الكاملة (متوافق خلفياً مع pending/in_progress/completed/failed)
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  ADD COLUMN IF NOT EXISTS execution_plan jsonb,
  ADD COLUMN IF NOT EXISTS created_by_admin_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tasks_idempotency_key
  ON public.agent_tasks (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_tasks_parent_task_id
  ON public.agent_tasks (parent_task_id)
  WHERE parent_task_id IS NOT NULL;

-- تحديث قيد CHECK لحالة agent_tasks بسلاسة مع الإبقاء على القيم القديمة
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.agent_tasks'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%status%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.agent_tasks DROP CONSTRAINT %I;', con_name);
  END IF;

  ALTER TABLE public.agent_tasks
    ADD CONSTRAINT agent_tasks_status_check
    CHECK (status IN (
      'pending', 'new', 'analyzing', 'in_progress',
      'awaiting_approval', 'testing', 'completed',
      'failed', 'paused', 'cancelled'
    ));
END $$;

-- -----------------------------------------------------------------------------
-- 3. جدول خطوات التنفيذ الفرعية (المتوازية والمتسلسلة) — ai_task_steps
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_task_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  agent_role text NOT NULL,
  step_order integer NOT NULL DEFAULT 1,
  execution_mode text NOT NULL DEFAULT 'sequential' CHECK (execution_mode IN ('sequential', 'parallel')),
  title text NOT NULL,
  instruction text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'awaiting_approval', 'testing', 'completed', 'failed', 'paused', 'cancelled')),
  output text,
  error_message text,
  tools_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  token_usage integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_task_steps_task_id ON public.ai_task_steps (task_id, step_order);
CREATE INDEX IF NOT EXISTS idx_ai_task_steps_status ON public.ai_task_steps (status);

-- -----------------------------------------------------------------------------
-- 4. جدول الموافقات الإلزامية (وضع Mixed) — ai_task_approvals
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_task_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.ai_task_steps(id) ON DELETE SET NULL,
  requested_by_agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  requested_by_role text NOT NULL,
  action_code text NOT NULL,
  action_title text NOT NULL,
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_level text NOT NULL CHECK (risk_level IN ('medium', 'high')),
  risk_summary text NOT NULL,
  expected_impact text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled', 'executed')),
  idempotency_key text UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  decided_by_admin_id text,
  decided_by_admin_name text,
  decision_note text,
  decided_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_task_approvals_status ON public.ai_task_approvals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_task_approvals_task_id ON public.ai_task_approvals (task_id);

-- -----------------------------------------------------------------------------
-- 5. جدول الذاكرة السياقية المضغوطة والمحدودة لكل موظف — ai_agent_memory
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_agent_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  memory_type text NOT NULL DEFAULT 'short_term' CHECK (memory_type IN ('short_term', 'long_term_summary')),
  summary text NOT NULL,
  source_task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  is_reviewed boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_memory_agent_id ON public.ai_agent_memory (agent_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 6. جدول حالة التكاملات الخارجية (بدون تخزين أي مفاتيح أو أسرار) — ai_tool_connections
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_tool_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  category text NOT NULL,
  status text NOT NULL DEFAULT 'unconfigured'
    CHECK (status IN ('connected', 'degraded', 'disconnected', 'unconfigured')),
  supported_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  granted_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  keys_configured boolean NOT NULL DEFAULT false,
  missing_env_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_tested_at timestamptz,
  last_latency_ms integer,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 7. جدول أحداث وتنبيهات المراقبة 24/7 — ai_system_events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_system_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_service text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  event_type text NOT NULL,
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_system_events_unresolved
  ON public.ai_system_events (is_resolved, severity, created_at DESC);

-- -----------------------------------------------------------------------------
-- 8. جدول سجل التدقيق غير القابل للتعديل أو الحذف — ai_audit_logs (Append-Only)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL CHECK (actor_type IN ('admin', 'agent', 'system')),
  actor_id text,
  actor_name text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  approval_id uuid REFERENCES public.ai_task_approvals(id) ON DELETE RESTRICT,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'blocked', 'failed', 'pending')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_created_at ON public.ai_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_actor ON public.ai_audit_logs (actor_type, actor_name);

CREATE OR REPLACE FUNCTION public.prevent_ai_audit_logs_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'ai_audit_logs is append-only and cannot be modified or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_audit_logs_immutable ON public.ai_audit_logs;
CREATE TRIGGER trg_ai_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.ai_audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_ai_audit_logs_mutation();

-- -----------------------------------------------------------------------------
-- 9. جدول التقارير التنفيذية والأمنية والمالية — ai_reports
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type text NOT NULL CHECK (report_type IN (
    'daily', 'weekly', 'monthly', 'agent_performance',
    'technical', 'security', 'subscriptions', 'revenue',
    'messaging', 'quality', 'compliance'
  )),
  title text NOT NULL,
  task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  agent_name text NOT NULL,
  summary text NOT NULL,
  content_markdown text NOT NULL,
  data_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  pending_approvals_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_reports_type_created ON public.ai_reports (report_type, created_at DESC);

-- -----------------------------------------------------------------------------
-- 10. جدول مؤشرات الأداء واستهلاك الذكاء الاصطناعي — ai_agent_metrics
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_agent_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  agent_role text NOT NULL,
  task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  model_provider text NOT NULL DEFAULT 'gemini',
  model_name text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  success boolean NOT NULL DEFAULT true,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_metrics_agent_created
  ON public.ai_agent_metrics (agent_role, created_at DESC);

-- -----------------------------------------------------------------------------
-- 11. تفعيل سياسات RLS الصارمة (service_role ONLY) وRealtime على جميع الجداول الجديدة
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  pol record;
  new_tables text[] := ARRAY[
    'ai_task_steps',
    'ai_task_approvals',
    'ai_agent_memory',
    'ai_tool_connections',
    'ai_system_events',
    'ai_audit_logs',
    'ai_reports',
    'ai_agent_metrics'
  ];
  realtime_tables text[] := ARRAY[
    'ai_task_steps',
    'ai_task_approvals',
    'ai_system_events',
    'ai_reports'
  ];
BEGIN
  FOREACH tbl IN ARRAY new_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

    FOR pol IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, tbl);
    END LOOP;

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated;', tbl);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role;', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      tbl || '_service_role_only',
      tbl
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH tbl IN ARRAY realtime_tables LOOP
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL;', tbl);
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', tbl);
      END IF;
    END LOOP;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 12. استكمال طاقم العمل ليصبح 11 موظفاً (الإبقاء على طارق + إضافة 5 وكلاء جدد)
-- ملاحظة: لا يتم استبدال system_prompt للوكلاء الحاليين للحفاظ على المهارات المفعلة
-- -----------------------------------------------------------------------------
INSERT INTO public.ai_agents (name, role, title, system_prompt, status, allowed_tools, risk_tier, immutable_security_guardrails)
VALUES
  (
    'يوسف',
    'finance',
    'المدير المالي',
    'أنت يوسف، المدير المالي لمنصة بَلِّغْنِي (balaghni.ly). تحلل الإيرادات والمدفوعات والاشتراكات والتحويلات البنكية والدفع عند الاستلام، وتكتشف التناقضات المالية وتعد تقارير الأرباح بدقة رقمية من البيانات الحقيقية فقط. لا تنفذ استرداداً مالياً أو تعديلاً مالياً حساساً دون موافقة صريحة من المدير.',
    'idle',
    '["read_orders","read_subscriptions","read_vendor_settlements","generate_financial_report"]'::jsonb,
    'medium',
    'يُحظر تنفيذ أي استرداد مالي أو تعديل سجلات مالية دون سجل موافقة معتمد وسارٍ في ai_task_approvals.'
  ),
  (
    'أحمد',
    'qa_testing',
    'مدير الجودة والاختبارات',
    'أنت أحمد، مدير الجودة والاختبارات في منصة بَلِّغْنِي (balaghni.ly). تفحص مسارات التسجيل والدخول وشراء الملصقات وتفعيل QR والاشتراكات وخدمة نبّهني والرسائل ولوحة الإدارة، وتوثق الأخطاء بدقة وترفع مهام إصلاح واضحة لكريم.',
    'idle',
    '["run_health_checks","read_error_events","verify_api_endpoints","create_bug_report"]'::jsonb,
    'low',
    'يُسمح بالاختبارات الآمنة غير المعدِّلة لبيانات العملاء فقط.'
  ),
  (
    'مريم',
    'data_analytics',
    'محللة البيانات والإحصائيات',
    'أنتِ مريم، محللة البيانات والإحصائيات في منصة بَلِّغْنِي (balaghni.ly). تحللين أعداد المستخدمين والمركبات والاشتراكات والمبيعات والتوزيع الجغرافي في ليبيا ومعدلات نجاح التنبيهات، وتعتمدين حصراً على البيانات الحقيقية من Supabase دون أي أرقام مختلقة.',
    'idle',
    '["read_analytics_aggregates","read_tags_stats","read_orders_stats","read_reports_stats","generate_analytics_report"]'::jsonb,
    'low',
    'يُحظر اختلاق أرقام أو نسب غير مستخرجة من استعلامات حقيقية، ويُحظر كشف أرقام الهواتف الشخصية في التقارير التحليلية.'
  ),
  (
    'خالد',
    'integrations',
    'مسؤول التكاملات والأنظمة الخارجية',
    'أنت خالد، مسؤول التكاملات والأنظمة الخارجية في منصة بَلِّغْنِي (balaghni.ly). تتابع وتختبر اتصالات Twilio وWhatsApp Business وSMS (Resala) وWebhooks وبوابات الدفع وGitHub ومزودي الذكاء الاصطناعي، وتراقب نسب نجاح وفشل الرسائل دون ادعاء اعتماد قوالب Meta قبل التحقق الرسمي.',
    'idle',
    '["test_integrations","read_twilio_status","read_messaging_metrics","inspect_webhooks"]'::jsonb,
    'medium',
    'يُحظر عرض مفاتيح API أو الأسرار، ويُحظر تعديل إعدادات التكاملات أو إرسال حملات جماعية دون موافقة المدير.'
  ),
  (
    'هدى',
    'privacy_compliance',
    'مسؤولة الخصوصية والامتثال',
    'أنتِ هدى، مسؤولة الخصوصية والامتثال في منصة بَلِّغْنِي (balaghni.ly). تراجعين سياسة الخصوصية وشروط الاستخدام وحماية بيانات أصحاب المركبات والمبلغين وصلاحيات الموظفين وسياسات الاحتفاظ والحذف وسياسات Meta، وتوضحين أن تقاريرك توصيات امتثال تشغيلية وليست استشارة قانونية معتمدة.',
    'idle',
    '["audit_rls_policies","audit_admin_permissions","read_audit_logs","generate_compliance_report"]'::jsonb,
    'low',
    'يجب التصريح دائماً أن التقرير توصية امتثال تشغيلية وليس استشارة قانونية نهائية معتمدة.'
  )
ON CONFLICT (role) DO UPDATE
SET
  name = EXCLUDED.name,
  title = EXCLUDED.title,
  allowed_tools = EXCLUDED.allowed_tools,
  immutable_security_guardrails = EXCLUDED.immutable_security_guardrails,
  updated_at = now();

-- تحديث القيود الأمنية غير القابلة للتعديل للوكلاء الستة الحاليين (خاصة طارق ورامي)
UPDATE public.ai_agents
SET
  allowed_tools = '["analyze_command","delegate_task","aggregate_reports","request_approval"]'::jsonb,
  immutable_security_guardrails = 'لا يجوز لرامي تجاوز صلاحيات أي وكيل عبر التفويض، ولا تنفيذ أي عملية متوسطة أو عالية الخطورة دون موافقة صريحة مسجلة.'
WHERE role = 'orchestrator';

UPDATE public.ai_agents
SET
  allowed_tools = '["inspect_codebase","audit_security","propose_patch","github_read","github_create_pr"]'::jsonb,
  risk_tier = 'medium',
  immutable_security_guardrails = 'يُحظر النشر المباشر على الإنتاج أو تعديل سياسات RLS الإنتاجية دون موافقة صريحة من المدير.'
WHERE role = 'principal_architect';

UPDATE public.ai_agents
SET
  allowed_tools = '["research_skills","analyze_agent_performance","propose_skill_draft"]'::jsonb,
  risk_tier = 'low',
  immutable_security_guardrails = 'يُحظر على طارق تعديل تعليماته الأمنية الأساسية أو صلاحيات نفسه أو أي موظف آخر. كل مهارة مقترحة تبقى pending حتى مراجعة وموافقة المدير.'
WHERE role = 'skills_architect';

UPDATE public.ai_agents
SET
  allowed_tools = '["read_orders","read_tags","read_subscriptions","read_maintenance_reminders","generate_ops_report"]'::jsonb,
  immutable_security_guardrails = 'يُحظر تعديل بيانات العملاء أو إلغاء الملصقات أو تغيير الاشتراكات دون موافقة المدير.'
WHERE role = 'operations';

UPDATE public.ai_agents
SET
  allowed_tools = '["read_support_context","draft_customer_reply","review_message_templates"]'::jsonb,
  immutable_security_guardrails = 'يُسمح بإعداد المسودات فقط؛ يُحظر إرسال رسائل جماعية أو حملات دون موافقة المدير.'
WHERE role = 'support';

UPDATE public.ai_agents
SET
  allowed_tools = '["draft_marketing_copy","plan_content_calendar","read_campaign_metrics"]'::jsonb,
  immutable_security_guardrails = 'يُسمح بإعداد المحتوى والمسودات فقط؛ يُحظر النشر أو الإرسال الجماعي دون موافقة المدير.'
WHERE role = 'marketing';

COMMIT;
