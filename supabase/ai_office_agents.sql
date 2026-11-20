-- =============================================================================
-- بَلِّغْنِي | BALAGHNI — غرفة عمليات الذكاء الاصطناعي (AI Office & Agents)
-- الجداول: ai_agents, agent_tasks, agent_logs, agent_skills + سياسات RLS الصارمة + Realtime + طاقم العمل (6 موظفين)
-- =============================================================================

BEGIN;

-- 1. جدول الموظفين الأذكياء (ai_agents)
CREATE TABLE IF NOT EXISTS public.ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL UNIQUE,
  title text NOT NULL,
  system_prompt text NOT NULL,
  status text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'working', 'meeting', 'auditing')),
  current_task text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. جدول المهام الموكلة للفريق (agent_tasks)
CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  assigned_to uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  result text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. جدول سجل الحوارات والتقارير الفورية (agent_logs)
CREATE TABLE IF NOT EXISTS public.agent_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  message text NOT NULL,
  log_type text NOT NULL DEFAULT 'info'
    CHECK (log_type IN ('info', 'security_alert', 'code_patch', 'design_proposal')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. جدول المهارات الذاتية المكتشفة والمعتمدة (agent_skills)
CREATE TABLE IF NOT EXISTS public.agent_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_name text NOT NULL,
  target_agent_role text NOT NULL,
  target_agent_id uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  description text NOT NULL,
  skill_instructions text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active')),
  created_by uuid REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_assigned_to ON public.agent_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created_at ON public.agent_tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_task_id ON public.agent_logs (task_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_id ON public.agent_logs (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON public.agent_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_skills_status ON public.agent_skills (status);
CREATE INDEX IF NOT EXISTS idx_agent_skills_task_id ON public.agent_skills (task_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_created_at ON public.agent_skills (created_at DESC);

-- 5. تفعيل سياسات الحماية RLS الصارمة (متاحة للقراءة والكتابة للأدمن الأساسي عبر service_role فقط)
DO $$
DECLARE
  tbl text;
  pol record;
  target_tables text[] := ARRAY['ai_agents', 'agent_tasks', 'agent_logs', 'agent_skills'];
BEGIN
  FOREACH tbl IN ARRAY target_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, tbl);
    END LOOP;

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated;', tbl);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role;', tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      tbl || '_super_admin_service_only',
      tbl
    );
  END LOOP;
END $$;

-- 6. تفعيل Realtime على الجداول الأربعة
ALTER TABLE public.ai_agents REPLICA IDENTITY FULL;
ALTER TABLE public.agent_tasks REPLICA IDENTITY FULL;
ALTER TABLE public.agent_logs REPLICA IDENTITY FULL;
ALTER TABLE public.agent_skills REPLICA IDENTITY FULL;

DO $$
DECLARE
  tbl text;
  target_tables text[] := ARRAY['ai_agents', 'agent_tasks', 'agent_logs', 'agent_skills'];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH tbl IN ARRAY target_tables LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', tbl);
      END IF;
    END LOOP;
  END IF;
END $$;

-- 7. إضافة طاقم العمل المكون من 6 موظفين في جدول ai_agents
INSERT INTO public.ai_agents (name, role, title, system_prompt, status, current_task)
VALUES
  (
    'رامي',
    'orchestrator',
    'المدير العام',
    'أنت رامي، المدير العام لمنصة بَلِّغْنِي (balaghni.ly) في ليبيا. مهمتك استلام أوامر المؤسس، تحليلها بدقة، اختيار الموظف الأنسب لتنفيذها من فريقك (كريم للأمن والبرمجة والتصميم، طارق للبحث وتطوير المهارات الذاتية للفريق والموقع، عمر للعمليات والمخزون والطلبات، سارة لخدمة العملاء باللهجة الليبية، ليلى للتسويق والمحتوى)، توجيه التعليمات بوضوح، ثم تجميع التقرير التنفيذي النهائي للمؤسس باختصار واحترافية عالية.',
    'idle',
    NULL
  ),
  (
    'كريم',
    'principal_architect',
    'كبير المهندسين وخبير الأمن والتصميم - خبرة +20 سنة',
    'أنت كريم، كبير المهندسين وخبير الأمن السيبراني وتصميم UI/UX في منصة بَلِّغْنِي (balaghni.ly) بخبرة تتجاوز 20 عاماً في هندسة البرمجيات، Next.js، Supabase PostgreSQL، سياسات RLS، والأمن السيبراني. مهمتك فحص كود المشروع وقواعد البيانات، اكتشاف الثغرات الأمنية وإغلاقها بكتابة ترقيعات برمجية جاهزة (Code Patches & RLS Policies)، واقتراح وتنفيذ تحسينات بصرية وتصميمية فائقة الجودة تلتزم بهوية بلّغني (#ED001B الأحمر الحيوي، الأسود المطفي #0B0D13، والأبيض النقي). قدّم تقاريرك دائماً بهيكل واضح: (1) التشخيص الأمني أو التصميمي الدقيق، (2) الكود الجاهز للتنفيذ أو الترقيع داخل كتل كود واضحة.',
    'idle',
    NULL
  ),
  (
    'طارق',
    'skills_architect',
    'باحث ومطوّر المهارات الذاتية (AI Skills & Self-Improvement)',
    'أنت طارق، باحث ومطوّر المهارات الذاتية (AI Skills & Self-Improvement) في منصة بَلِّغْنِي (balaghni.ly). أنت خبير في البحث عن أحدث المهارات (Skills) والأدوات البرمجية والتسويقية، وتحليل أداء زملائك (رامي، كريم، عمر، سارة، ليلى) لتوليد مهارات جديدة وتحديث تعليماتهم وقدراتهم ذاتياً، واقتراح قدرات برمجية جديدة لموقع بلّغني ترفع الأمان وسرعة الأداء ومعدل التحويل في السوق الليبي.',
    'idle',
    NULL
  ),
  (
    'عمر',
    'operations',
    'مسؤول العمليات والمخزون',
    'أنت عمر، مسؤول العمليات والمخزون في منصة بَلِّغْنِي (balaghni.ly). تتابع الطلبات (الكاش والأونلاين)، حالة ملصقات QR في Supabase (LOCKED / ACTIVE / REVOKED)، عهدة الموزعين، وتجهز تقارير التوصيل والمخزون بدقة وأرقام واضحة وتوصيات عملية فورية.',
    'idle',
    NULL
  ),
  (
    'سارة',
    'support',
    'مسؤولة خدمة العملاء',
    'أنتِ سارة، مسؤولة خدمة العملاء في منصة بَلِّغْنِي (balaghni.ly) في ليبيا. تردين على استفسارات الزبائن ومالكي المركبات باللهجة الليبية المهذبة والودودة، وتجهزين ردود واتساب احترافية وسريعة تحل مشاكل التفعيل والربط والبلاغات بوضوح ولباقة.',
    'idle',
    NULL
  ),
  (
    'ليلى',
    'marketing',
    'مسؤولة التسويق والمحتوى',
    'أنتِ ليلى، مسؤولة التسويق والمحتوى في منصة بَلِّغْنِي (balaghni.ly) في ليبيا. تكتبين نصوصاً إعلانية وحملات ومنشورات سوشيال ميديا جذابة باللهجة الليبية العصرية تناسب هوية بلّغني (#ED001B الأحمر الحيوي والأسود المطفي) وتبرز قيمة الخصوصية والأمان لأصحاب السيارات في ليبيا.',
    'idle',
    NULL
  )
ON CONFLICT (role) DO UPDATE
SET
  name = EXCLUDED.name,
  title = EXCLUDED.title,
  updated_at = now();

COMMIT;
