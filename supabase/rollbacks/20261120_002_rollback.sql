-- =============================================================================
-- Migration 002 (ROLLBACK): التراجع الآمن عن توسعة BALAGHNI AI COMMAND CENTER
-- يحذف فقط الجداول الجديدة التي أُنشئت في Migration 002 دون المساس بالجداول الأساسية
-- (ai_agents, agent_tasks, agent_logs, agent_skills تبقى سليمة بالكامل)
-- =============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_ai_audit_logs_immutable ON public.ai_audit_logs;
DROP FUNCTION IF EXISTS public.prevent_ai_audit_logs_mutation();

DROP TABLE IF EXISTS public.ai_agent_metrics;
DROP TABLE IF EXISTS public.ai_reports;
DROP TABLE IF EXISTS public.ai_audit_logs;
DROP TABLE IF EXISTS public.ai_system_events;
DROP TABLE IF EXISTS public.ai_tool_connections;
DROP TABLE IF EXISTS public.ai_agent_memory;
DROP TABLE IF EXISTS public.ai_task_approvals;
DROP TABLE IF EXISTS public.ai_task_steps;

COMMIT;
