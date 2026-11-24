// =============================================================================
// بَلِّغْنِي | BALAGHNI — محرك المهام متعدد الوكلاء والتعاون الخادمي (Task Orchestrator)
// المرحلة B:
// - إدارة المهمة الرئيسية والمهام الفرعية والاعتماديات والأولويات والمحاولات والمهل.
// - توزيع المهام من رامي، تمرير السياق المحدود والآمن فقط، والتسليم الخادمي بين الموظفين.
// - كشف التعارضات، طلب التوضيح المحدود، والتصعيد عند الفشل.
// - حفظ آمن وقابل للاستئناف (Idempotent & Crash-Safe) باستخدام agent_tasks و ai_task_steps.
// - إثبات النتائج (Evidence-Verified Completion) قبل إغلاق المهمة.
// =============================================================================

import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/client";
import {
  defaultAiAuditLogger,
  sanitizeTextForAudit,
  type ToolAuditLogger,
  type ToolReadOnlyDataProvider,
} from "@/lib/ai-office/tool-registry";
import {
  SERVER_AGENT_TOOL_ALLOWLIST,
  type GovernedAgentRole,
} from "@/lib/ai-office/skill-guard";
import {
  runAgentWithTools,
  type GeminiModelInvoker,
  type ToolExecutionEvidence,
} from "@/lib/ai-office/gemini-tool-runner";
import type { MemoryServiceAdapter } from "@/lib/ai-office/memory-service";

// =============================================================================
// 1. الأنواع الأساسية (Orchestrator Types)
// =============================================================================

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export type OrchestratedTaskStatus =
  | "pending"
  | "analyzing"
  | "in_progress"
  | "completed"
  | "failed"
  | "paused"
  | "cancelled";

export type OrchestratedStepStatus =
  | "pending"
  | "in_progress"
  | "awaiting_approval"
  | "testing"
  | "completed"
  | "failed"
  | "paused"
  | "cancelled";

export interface PlannedSubtask {
  stepKey: string;
  title: string;
  instruction: string;
  assignedRole: GovernedAgentRole;
  priority?: TaskPriority;
  executionMode?: "sequential" | "parallel";
  dependsOn?: string[];
  maxAttempts?: number;
  timeoutMs?: number;
  requireToolEvidence?: boolean;
  /** حقول السياق المسموح تمريرها من الخطوات السابقة */
  allowedContextKeys?: string[];
}

export interface OrchestratedStepRecord {
  id: string;
  taskId: string;
  stepKey: string;
  stepOrder: number;
  title: string;
  instruction: string;
  assignedRole: GovernedAgentRole;
  assignedAgentName: string;
  priority: TaskPriority;
  executionMode: "sequential" | "parallel";
  dependsOn: string[];
  maxAttempts: number;
  attempts: number;
  timeoutMs: number;
  requireToolEvidence: boolean;
  status: OrchestratedStepStatus;
  scopedContext: string;
  output: string | null;
  evidence: ToolExecutionEvidence[];
  verified: boolean;
  verificationReason: string | null;
  errorMessage: string | null;
  tokenUsage: number;
  handoffFromStepKey?: string | null;
  handoffFromRole?: GovernedAgentRole | null;
  handoffDepth: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface EscalationRecord {
  stepKey: string;
  agentRole: GovernedAgentRole;
  agentName: string;
  reason: string;
  severity: "warning" | "critical";
  escalatedTo: "orchestrator" | "admin";
  createdAt: string;
}

export interface TaskConflictRecord {
  stepKeyA: string;
  stepKeyB: string;
  description: string;
  resolution: string;
  resolved: boolean;
}

export interface OrchestratedTaskRecord {
  id: string;
  idempotencyKey: string;
  title: string;
  command: string;
  priority: TaskPriority;
  status: OrchestratedTaskStatus;
  createdByAdminId: string | null;
  steps: OrchestratedStepRecord[];
  escalations: EscalationRecord[];
  conflicts: TaskConflictRecord[];
  finalReport: string | null;
  verificationStatus: "verified" | "partial" | "failed" | "pending";
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface TaskPersistenceAdapter {
  findTaskByIdempotencyKey: (
    key: string
  ) => Promise<OrchestratedTaskRecord | null>;
  upsertTask: (task: OrchestratedTaskRecord) => Promise<OrchestratedTaskRecord>;
  upsertStep: (step: OrchestratedStepRecord) => Promise<OrchestratedStepRecord>;
  appendLog: (entry: {
    taskId: string;
    agentRole: GovernedAgentRole;
    message: string;
    logType: "info" | "security_alert" | "code_patch" | "design_proposal";
  }) => Promise<void>;
}

export interface OrchestrateCommandParams {
  command: string;
  title?: string;
  priority?: TaskPriority;
  /** مفتاح منع التكرار واستعادة التنفيذ بعد الانقطاع */
  idempotencyKey?: string;
  createdByAdminId?: string | null;
  /** خطة فرعية مخصصة (اختيارية؛ إن غابت يقوم رامي بتحليل وتقسيم الأمر تلقائياً) */
  customPlan?: PlannedSubtask[];
  /** حدود الأمان والتكلفة على مستوى المهمة */
  maxSteps?: number;
  maxHandoffDepth?: number;
  maxTaskDurationMs?: number;
  /** ميزانية زمنية للمرحلة الواحدة (للتوقف الآمن وحفظ نقطة الاستئناف قبل مهلة HTTP) */
  stageTimeBudgetMs?: number;
  /** محقونات للاختبار المحلي المعزول أو الذاكرة السياقية */
  modelInvoker?: GeminiModelInvoker;
  auditLogger?: ToolAuditLogger;
  readOnlyDataProvider?: ToolReadOnlyDataProvider;
  persistence?: TaskPersistenceAdapter;
  memoryAdapter?: MemoryServiceAdapter;
  projectRoot?: string;
  /** خطاف اختباري لمحاكاة انقطاع التنفيذ بعد خطوة محددة */
  simulateInterruptAfterStepKey?: string;
}

export interface OrchestrateCommandResult {
  ok: boolean;
  resumedFromCheckpoint: boolean;
  interrupted: boolean;
  needsResume?: boolean;
  task: OrchestratedTaskRecord;
  executedStepKeys: string[];
  skippedStepKeys: string[];
  error?: string;
}

// =============================================================================
// 2. خريطة أسماء واختصاصات الموظفين (Agent Profiles)
// =============================================================================

const AGENT_PROFILE_MAP: Record<
  GovernedAgentRole,
  { name: string; title: string; systemPrompt: string }
> = {
  orchestrator: {
    name: "رامي",
    title: "المدير العام المنسق",
    systemPrompt:
      "أنت رامي، المدير العام المنسق لغرفة عمليات بَلِّغْنِي. تقسّم الأوامر إلى مهام فرعية دقيقة، وتتابع التنفيذ، وتتحقق من الأدلة قبل إغلاق المهمة.",
  },
  principal_architect: {
    name: "كريم",
    title: "المعماري الرئيسي ومهندس الأمان",
    systemPrompt:
      "أنت كريم، المعماري الرئيسي في بَلِّغْنِي (مشروع Next.js App Router). يجب أن تستخدم أداة inspect_codebase بمسارات تبدأ حصراً بـ src/ أو supabase/migrations/ مثل src/lib/ai-office/skill-guard.ts أو src/lib/ai-office/tool-registry.ts أو src/proxy.ts أو src/app/api/agents/command/route.ts. لا تطلب أبداً App.tsx أو ملفات .env أو مسارات خارج القائمة المسموح بها، وقدّم أدلة دقيقة من الكود الفعلي فقط.",
  },
  skills_architect: {
    name: "طارق",
    title: "مهندس المهارات والأداء",
    systemPrompt:
      "أنت طارق، مهندس المهارات والأداء في بَلِّغْنِي. يجب عليك استخدام أداة analyze_agent_performance أولاً لقراءة أداء الوكلاء الفعلي وتقديم توصية موثّقة، ولا تعدّل صلاحياتك أو قواعد الأمان.",
  },
  operations: {
    name: "عمر",
    title: "مدير العمليات والتشغيل",
    systemPrompt:
      "أنت عمر، مدير العمليات في بَلِّغْنِي. يجب أن تستخدم أدوات القراءة المصرح بها (read_orders, read_tags, read_subscriptions, read_maintenance_reminders) أولاً وتنقل الأرقام الفعلية فقط؛ وعند غياب بيانات أو فشل جدول، صرّح بذلك بوضوح دون اختلاق أي أرقام.",
  },
  support: {
    name: "سارة",
    title: "أخصائية خدمة العملاء",
    systemPrompt:
      "أنتِ سارة، أخصائية خدمة العملاء وتجربة المواطن في بَلِّغْنِي. يجب عليكِ دائماً استدعاء أداة read_support_context أولاً لقراءة سياق البلاغات والدعم الفعلي، وعند الحاجة لمسودة رد استدعِي draft_customer_reply (مسودة فقط بدون إرسال حقيقي). يُحظر اختلاق شكاوى أو أرقام؛ وإذا كانت النتيجة count=0 فاذكري بوضوح ما ينقصكِ من بيانات.",
  },
  marketing: {
    name: "ليلى",
    title: "مديرة التسويق والمحتوى",
    systemPrompt:
      "أنتِ ليلى، مديرة التسويق والاتصال التوعوي في بَلِّغْنِي. يجب عليكِ استدعاء أداة draft_marketing_copy لإعداد مسودة المحتوى أو الرسالة التوعوية فقط، مع التأكيد على أنها مسودة بانتظار المراجعة الإدارية بدون نشر أو إرسال جماعي.",
  },
  finance: {
    name: "يوسف",
    title: "المدير المالي",
    systemPrompt:
      "أنت يوسف، المدير المالي في بَلِّغْنِي. تحلل الطلبات والاشتراكات من الأدوات المالية المصرح بها فقط.",
  },
  qa_testing: {
    name: "أحمد",
    title: "مدير الجودة والاختبارات",
    systemPrompt:
      "أنت أحمد، مدير الجودة في بَلِّغْنِي. تفحص جودة المسارات وتوثق النتائج بأدلة.",
  },
  data_analytics: {
    name: "مريم",
    title: "محللة البيانات والإحصائيات",
    systemPrompt:
      "أنتِ مريم، محللة البيانات في بَلِّغْنِي. تحللين الإحصاءات المجمعة بدون كشف بيانات شخصية.",
  },
  integrations: {
    name: "خالد",
    title: "مسؤول التكاملات والأنظمة الخارجية",
    systemPrompt:
      "أنت خالد، مسؤول التكاملات في بَلِّغْنِي. تتابع حالة التكاملات بدون كشف مفاتيح سرية.",
  },
  privacy_compliance: {
    name: "هدى",
    title: "مسؤولة الخصوصية والامتثال",
    systemPrompt:
      "أنتِ هدى، مسؤولة الخصوصية والامتثال في بَلِّغْنِي. تراجعين سجل التدقيق وتقدمين توصيات امتثال تشغيلية.",
  },
};

export function getAgentProfile(role: GovernedAgentRole) {
  return AGENT_PROFILE_MAP[role];
}

// =============================================================================
// 3. فلترة السياق ومنع تسريب بيانات المواطنين أو الموظفين (Data Minimization)
// =============================================================================

const PII_REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // أرقام الهواتف الليبية والدولية
  { pattern: /\+?218[\s\-]?9\d[\s\-]?\d{3}[\s\-]?\d{4}/g, replacement: "[PHONE_REDACTED]" },
  { pattern: /\b09[1-5]\d{7}\b/g, replacement: "[PHONE_REDACTED]" },
  // البريد الإلكتروني
  { pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, replacement: "[EMAIL_REDACTED]" },
  // أرقام الهوية / البطاقات / التوكنات
  { pattern: /\b(national_id|passport|pin_code|otp_code|owner_phone)\s*[:=]\s*["']?[^\s"',;}{]+/gi, replacement: "$1=[PII_REDACTED]" },
];

/**
 * تنقية وتحديد السياق الممرّر من موظف إلى آخر حسب مبدأ الحد الأدنى للبيانات (Need-to-Know).
 * يزيل أرقام الهواتف والبريد الإلكتروني والأسرار، ويمنع تمرير تفاصيل مالية أو كود داخلي لغير المختص.
 */
export function buildScopedHandoffContext(params: {
  fromRole: GovernedAgentRole;
  toRole: GovernedAgentRole;
  rawSummary: string;
  evidenceSummaries?: string[];
  maxLength?: number;
}): string {
  let clean = sanitizeTextForAudit(params.rawSummary, params.maxLength ?? 800);
  for (const rule of PII_REDACTION_PATTERNS) {
    clean = clean.replace(rule.pattern, rule.replacement);
  }

  // منع تسريب تفاصيل مالية خام أو كود مصدري إلى أدوار غير مخوّلة مثل support و marketing
  if (params.toRole === "support" || params.toRole === "marketing") {
    clean = clean.replace(
      /\b(total_amount|settlement_amount|iban|bank_account|sql_query|rls_policy)\s*[:=]\s*[^\s,;]+/gi,
      "[RESTRICTED_FOR_ROLE]"
    );
  }

  const parts: string[] = [
    `[سياق مُصفّى ومحدود من ${AGENT_PROFILE_MAP[params.fromRole].name} (${params.fromRole}) إلى ${AGENT_PROFILE_MAP[params.toRole].name} (${params.toRole})]:`,
    clean,
  ];

  if (params.evidenceSummaries && params.evidenceSummaries.length > 0) {
    const safeEvidence = params.evidenceSummaries
      .slice(0, 3)
      .map((item) => {
        let s = sanitizeTextForAudit(item, 220);
        for (const rule of PII_REDACTION_PATTERNS) {
          s = s.replace(rule.pattern, rule.replacement);
        }
        return `- ${s}`;
      })
      .join("\n");
    parts.push(`ملخص أدلة التحقق المسموح مشاركتها:\n${safeEvidence}`);
  }

  return parts.join("\n");
}

// =============================================================================
// 4. محول الحفظ (Supabase Persistence + In-Memory Store للاختبارات)
// =============================================================================

export const defaultSupabaseTaskPersistence: TaskPersistenceAdapter = {
  async findTaskByIdempotencyKey(key) {
    const { data: taskRow, error } = await supabaseAdmin
      .from("agent_tasks")
      .select("*")
      .eq("idempotency_key", key)
      .maybeSingle();

    if (error || !taskRow) return null;

    const { data: stepRows } = await supabaseAdmin
      .from("ai_task_steps")
      .select("*")
      .eq("task_id", taskRow.id)
      .order("step_order", { ascending: true });

    const planMeta = (taskRow.execution_plan || {}) as Record<string, unknown>;
    const steps: OrchestratedStepRecord[] = (stepRows || []).map(
      (r: Record<string, unknown>) => {
        const meta = (
          Array.isArray(r.tools_used)
            ? { evidence: r.tools_used }
            : (r.tools_used as Record<string, unknown>) || {}
        ) as Record<string, unknown>;
        const role = String(r.agent_role || "operations") as GovernedAgentRole;
        return {
          id: String(r.id),
          taskId: String(r.task_id),
          stepKey: String(meta.stepKey || `step_${r.step_order}`),
          stepOrder: Number(r.step_order || 1),
          title: String(r.title || ""),
          instruction: String(r.instruction || ""),
          assignedRole: role,
          assignedAgentName: AGENT_PROFILE_MAP[role]?.name || role,
          priority: (meta.priority as TaskPriority) || "normal",
          executionMode:
            r.execution_mode === "parallel" ? "parallel" : "sequential",
          dependsOn: Array.isArray(meta.dependsOn)
            ? (meta.dependsOn as string[])
            : [],
          maxAttempts: Number(meta.maxAttempts || 2),
          attempts: Number(meta.attempts || 0),
          timeoutMs: Number(meta.timeoutMs || 20000),
          requireToolEvidence: Boolean(meta.requireToolEvidence ?? true),
          status: String(r.status || "pending") as OrchestratedStepStatus,
          scopedContext: String(meta.scopedContext || ""),
          output: r.output ? String(r.output) : null,
          evidence: Array.isArray(meta.evidence)
            ? (meta.evidence as ToolExecutionEvidence[])
            : [],
          verified: Boolean(meta.verified),
          verificationReason: meta.verificationReason
            ? String(meta.verificationReason)
            : null,
          errorMessage: r.error_message ? String(r.error_message) : null,
          tokenUsage: Number(r.token_usage || 0),
          handoffFromStepKey: meta.handoffFromStepKey
            ? String(meta.handoffFromStepKey)
            : null,
          handoffFromRole: meta.handoffFromRole
            ? (String(meta.handoffFromRole) as GovernedAgentRole)
            : null,
          handoffDepth: Number(meta.handoffDepth || 0),
          startedAt: r.started_at ? String(r.started_at) : null,
          completedAt: r.completed_at ? String(r.completed_at) : null,
        };
      }
    );

    return {
      id: String(taskRow.id),
      idempotencyKey: key,
      title: String(taskRow.title || ""),
      command: String(taskRow.description || ""),
      priority: (taskRow.priority as TaskPriority) || "normal",
      status: String(taskRow.status || "pending") as OrchestratedTaskStatus,
      createdByAdminId: taskRow.created_by_admin_id
        ? String(taskRow.created_by_admin_id)
        : null,
      steps,
      escalations: Array.isArray(planMeta.escalations)
        ? (planMeta.escalations as EscalationRecord[])
        : [],
      conflicts: Array.isArray(planMeta.conflicts)
        ? (planMeta.conflicts as TaskConflictRecord[])
        : [],
      finalReport: taskRow.result ? String(taskRow.result) : null,
      verificationStatus:
        (planMeta.verificationStatus as OrchestratedTaskRecord["verificationStatus"]) ||
        "pending",
      startedAt: taskRow.started_at ? String(taskRow.started_at) : null,
      completedAt: taskRow.completed_at ? String(taskRow.completed_at) : null,
      updatedAt: String(taskRow.updated_at || new Date().toISOString()),
    };
  },

  async upsertTask(task) {
    const payload = {
      id: task.id,
      title: sanitizeTextForAudit(task.title, 180),
      description: sanitizeTextForAudit(task.command, 2000),
      status: task.status,
      priority: task.priority,
      idempotency_key: task.idempotencyKey,
      created_by_admin_id: task.createdByAdminId,
      result: task.finalReport,
      execution_plan: {
        verificationStatus: task.verificationStatus,
        escalations: task.escalations,
        conflicts: task.conflicts,
        stepKeys: task.steps.map((s) => s.stepKey),
      },
      started_at: task.startedAt,
      completed_at: task.completedAt,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from("agent_tasks")
      .upsert(payload, { onConflict: "id" });

    if (error) {
      throw new Error(`task_persist_failed: ${sanitizeTextForAudit(error.message, 160)}`);
    }
    return task;
  },

  async upsertStep(step) {
    const payload = {
      id: step.id,
      task_id: step.taskId,
      agent_role: step.assignedRole,
      step_order: step.stepOrder,
      execution_mode: step.executionMode,
      title: sanitizeTextForAudit(step.title, 180),
      instruction: sanitizeTextForAudit(step.instruction, 1500),
      status: step.status,
      output: step.output,
      error_message: step.errorMessage,
      tools_used: {
        stepKey: step.stepKey,
        priority: step.priority,
        dependsOn: step.dependsOn,
        maxAttempts: step.maxAttempts,
        attempts: step.attempts,
        timeoutMs: step.timeoutMs,
        requireToolEvidence: step.requireToolEvidence,
        verified: step.verified,
        verificationReason: step.verificationReason,
        handoffFromStepKey: step.handoffFromStepKey ?? null,
        handoffFromRole: step.handoffFromRole ?? null,
        handoffDepth: step.handoffDepth,
        evidence: step.evidence,
      },
      token_usage: step.tokenUsage,
      started_at: step.startedAt,
      completed_at: step.completedAt,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from("ai_task_steps")
      .upsert(payload, { onConflict: "id" });

    if (error) {
      throw new Error(`step_persist_failed: ${sanitizeTextForAudit(error.message, 160)}`);
    }
    return step;
  },

  async appendLog(entry) {
    await supabaseAdmin.from("agent_logs").insert({
      task_id: entry.taskId,
      message: sanitizeTextForAudit(entry.message, 1500),
      log_type: entry.logType,
    });
  },
};

/**
 * مخزن ذاكرة محلي للاختبارات المعزولة يحاكي agent_tasks + ai_task_steps + agent_logs بدقة.
 */
export function createInMemoryTaskStore() {
  const tasksByKey = new Map<string, OrchestratedTaskRecord>();
  const logs: Array<{
    taskId: string;
    agentRole: GovernedAgentRole;
    message: string;
    logType: string;
  }> = [];

  const adapter: TaskPersistenceAdapter = {
    async findTaskByIdempotencyKey(key) {
      const found = tasksByKey.get(key);
      return found ? structuredClone(found) : null;
    },
    async upsertTask(task) {
      const copy = structuredClone(task);
      tasksByKey.set(task.idempotencyKey, copy);
      return structuredClone(copy);
    },
    async upsertStep(step) {
      for (const t of tasksByKey.values()) {
        if (t.id === step.taskId) {
          const idx = t.steps.findIndex((s) => s.stepKey === step.stepKey);
          if (idx >= 0) t.steps[idx] = structuredClone(step);
          else t.steps.push(structuredClone(step));
          break;
        }
      }
      return structuredClone(step);
    },
    async appendLog(entry) {
      logs.push(structuredClone(entry));
    },
  };

  return { tasksByKey, logs, adapter };
}

// =============================================================================
// 5. تقسيم الأمر بواسطة رامي (Task Decomposition) وكشف التعارضات
// =============================================================================

export function buildDefaultPlanForCommand(command: string): PlannedSubtask[] {
  const text = command.toLowerCase();
  const subtasks: PlannedSubtask[] = [];

  if (/طلب|ملصق|اشتراك|صيانة|عمليات|تشغيل/.test(text)) {
    subtasks.push({
      stepKey: "ops_analysis",
      title: "تحليل البيانات التشغيلية للطلبات والملصقات",
      instruction: `ركّز حصراً على اختصاص العمليات (الطلبات، الملصقات، الاشتراكات، وسجلات الصيانة) ولا تكتب في الكود أو التسويق أو مسودات الدعم. استدعِ أدوات القراءة المصرح بها أولاً وانقل الأرقام الفعلية فقط من السياق التالي: ${command}`,
      assignedRole: "operations",
      priority: "high",
      executionMode: "parallel",
      dependsOn: [],
      requireToolEvidence: true,
    });
  }

  if (/عميل|مواطن|دعم|رد|شكوى|بلاغ|مسودة/.test(text)) {
    subtasks.push({
      stepKey: "support_response",
      title: "مراجعة سياق الدعم وتجربة المواطن وإعداد مسودة رد",
      instruction: `ركّز حصراً على اختصاص تجربة المواطن والبلاغات ومسودة الرد فقط (بدون إرسال)، ولا تكتب في فحص الكود أو الحملات التسويقية. استدعِ read_support_context أولاً ثم draft_customer_reply عند الحاجة، وصرّح بنقص البيانات إن كانت فارغة: ${command}`,
      assignedRole: "support",
      priority: "normal",
      executionMode: "sequential",
      dependsOn: subtasks.length > 0 ? [subtasks[0].stepKey] : [],
      requireToolEvidence: true,
    });
  }

  if (/تسويق|حملة|محتوى|منشور|توعو|توعية/.test(text)) {
    subtasks.push({
      stepKey: "marketing_draft",
      title: "إعداد مسودة محتوى توعوي وتسويقي (بدون نشر)",
      instruction: `ركّز حصراً على اختصاص المحتوى التوعوي والتسويقي فقط (بدون نشر أو إرسال)، ولا تكتب في فحص الكود أو تفاصيل العمليات. استدعِ أداة draft_marketing_copy لإعداد مسودة متوافقة مع الأمر: ${command}`,
      assignedRole: "marketing",
      priority: "normal",
      executionMode: "parallel",
      dependsOn: subtasks.length > 0 ? [subtasks[0].stepKey] : [],
      requireToolEvidence: true,
    });
  }

  if (/أمان|كود|ثغر|فحص|معماري|تقني/.test(text)) {
    subtasks.push({
      stepKey: "arch_review",
      title: "مراجعة معمارية وأمنية للكود",
      instruction: `ركّز حصراً على اختصاص الفحص المعماري والأمني للكود داخل src/ أو supabase/migrations/ فقط، ولا تكتب مسودات دعم أو حملات تسويقية. استدعِ أداة inspect_codebase على ملف فعلي مسموح (مثل src/lib/ai-office/skill-guard.ts أو src/lib/ai-office/tool-registry.ts أو src/proxy.ts؛ لا تطلب App.tsx أو .env): ${command}`,
      assignedRole: "principal_architect",
      priority: "high",
      executionMode: "parallel",
      dependsOn: [],
      requireToolEvidence: true,
    });
  }

  if (/مهار|أداء الوكلاء|معرفة|إجراء|كفاءة/.test(text)) {
    subtasks.push({
      stepKey: "skills_review",
      title: "مراجعة أداء الوكلاء والمعرفة والإجراءات",
      instruction: `ركّز حصراً على اختصاص تقييم أداء الوكلاء والمهارات والإجراءات، ولا تكتب مسودات دعم أو حملات تسويقية أو فحص كود. استدعِ أداة analyze_agent_performance أولاً وقدّم توصية موثّقة: ${command}`,
      assignedRole: "skills_architect",
      priority: "normal",
      executionMode: "parallel",
      dependsOn: [],
      requireToolEvidence: true,
    });
  }

  if (/امتثال|خصوصية|تدقيق/.test(text)) {
    subtasks.push({
      stepKey: "compliance_audit",
      title: "مراجعة الامتثال وسجل التدقيق",
      instruction: `استدعِ أداة read_audit_logs لمراجعة سجل التدقيق الأمني وتقديم توصيات امتثال تشغيلية للأمر: ${command}`,
      assignedRole: "privacy_compliance",
      priority: "normal",
      executionMode: "parallel",
      dependsOn: [],
      requireToolEvidence: true,
    });
  }

  // خطة افتراضية آمنة إذا لم يطابق الأمر كلمات مفتاحية محددة
  if (subtasks.length === 0) {
    subtasks.push({
      stepKey: "ops_default_check",
      title: "فحص تشغيلي مبدئي",
      instruction: `نفّذ فحصاً تشغيلياً أولياً باستخدام أدوات القراءة المصرح بها (read_tags أو read_orders) للأمر: ${command}`,
      assignedRole: "operations",
      priority: "normal",
      executionMode: "sequential",
      dependsOn: [],
      requireToolEvidence: true,
    });
  }

  return subtasks;
}

/**
 * كشف التعارضات البسيطة والمباشرة بين مخرجات خطوتين (مثلاً: تضارب حالة "مستقر/سليم" مع "حرج/مرتفع الفشل").
 */
function detectStepConflicts(
  steps: OrchestratedStepRecord[]
): TaskConflictRecord[] {
  const conflicts: TaskConflictRecord[] = [];
  const completed = steps.filter((s) => s.status === "completed" && s.output);

  for (let i = 0; i < completed.length; i += 1) {
    for (let j = i + 1; j < completed.length; j += 1) {
      const a = completed[i];
      const b = completed[j];
      const textA = (a.output || "").toLowerCase();
      const textB = (b.output || "").toLowerCase();

      const aPositive = /سليم|مستقر|لا توجد مشاكل|0 أخطاء/.test(textA);
      const bNegative = /حرج|عطل|فشل متكرر|تعارض|خطأ جسيم/.test(textB);
      const bPositive = /سليم|مستقر|لا توجد مشاكل|0 أخطاء/.test(textB);
      const aNegative = /حرج|عطل|فشل متكرر|تعارض|خطأ جسيم/.test(textA);

      if ((aPositive && bNegative) || (bPositive && aNegative)) {
        conflicts.push({
          stepKeyA: a.stepKey,
          stepKeyB: b.stepKey,
          description: `تعارض محتمل بين تقييم ${a.assignedAgentName} (${a.stepKey}) وتقييم ${b.assignedAgentName} (${b.stepKey}).`,
          resolution:
            "تم توثيق التقييمين معاً في التقرير النهائي لرامي مع ترجيح الأدلة المسجلة في ToolExecutionEvidence ومراجعة المدير.",
          resolved: true,
        });
      }
    }
  }
  return conflicts;
}

// =============================================================================
// 6. المحرك الرئيسي لتنسيق وتنفيذ المهام المتعددة (Main Orchestrator Engine)
// =============================================================================

export async function orchestrateMultiAgentTask(
  params: OrchestrateCommandParams
): Promise<OrchestrateCommandResult> {
  const startedAtMs = Date.now();
  const cleanCommand = sanitizeTextForAudit(params.command, 1500);
  if (!cleanCommand) {
    throw new Error("نص الأمر مطلوب لبدء تنسيق المهمة.");
  }

  const persistence = params.persistence ?? defaultSupabaseTaskPersistence;
  const auditLogger = params.auditLogger ?? defaultAiAuditLogger;
  const maxSteps = Math.min(Math.max(params.maxSteps ?? 8, 1), 12);
  const maxHandoffDepth = Math.min(Math.max(params.maxHandoffDepth ?? 2, 0), 3);
  const maxTaskDurationMs = Math.min(
    Math.max(params.maxTaskDurationMs ?? 90000, 3000),
    180000
  );
  const stageTimeBudgetMs =
    typeof params.stageTimeBudgetMs === "number" && params.stageTimeBudgetMs > 0
      ? Math.min(Math.max(params.stageTimeBudgetMs, 1000), maxTaskDurationMs)
      : maxTaskDurationMs;

  const idempotencyKey =
    params.idempotencyKey?.trim() ||
    `task_${crypto
      .createHash("sha256")
      .update(`${cleanCommand}:${Date.now()}`)
      .digest("hex")
      .slice(0, 24)}`;

  // 1. التحقق من وجود مهمة سابقة بنفس idempotencyKey لاستئنافها دون تكرار
  let task = await persistence.findTaskByIdempotencyKey(idempotencyKey);
  let resumedFromCheckpoint = false;

  if (task) {
    resumedFromCheckpoint = true;
    if (task.status === "completed" && task.verificationStatus === "verified") {
      return {
        ok: true,
        resumedFromCheckpoint: true,
        interrupted: false,
        needsResume: false,
        task,
        executedStepKeys: [],
        skippedStepKeys: task.steps.map((s) => s.stepKey),
      };
    }
    if (task.status === "paused") {
      task.status = "in_progress";
      task.updatedAt = new Date().toISOString();
      await persistence.upsertTask(task);
    }
  } else {
    const plan = (
      params.customPlan && params.customPlan.length > 0
        ? params.customPlan
        : buildDefaultPlanForCommand(cleanCommand)
    ).slice(0, maxSteps);

    // التحقق من صحة أدوار الموظفين في الخطة ومنع الدورات في الاعتماديات
    const seenKeys = new Set<string>();
    const taskId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const steps: OrchestratedStepRecord[] = plan.map((item, idx) => {
      if (!(item.assignedRole in SERVER_AGENT_TOOL_ALLOWLIST)) {
        throw new Error(`دور موظف غير معروف في الخطة: ${item.assignedRole}`);
      }
      if (seenKeys.has(item.stepKey)) {
        throw new Error(`تكرار مفتاح الخطوة في الخطة: ${item.stepKey}`);
      }
      seenKeys.add(item.stepKey);

      return {
        id: crypto.randomUUID(),
        taskId,
        stepKey: item.stepKey,
        stepOrder: idx + 1,
        title: sanitizeTextForAudit(item.title, 180),
        instruction: sanitizeTextForAudit(item.instruction, 1200),
        assignedRole: item.assignedRole,
        assignedAgentName: AGENT_PROFILE_MAP[item.assignedRole].name,
        priority: item.priority ?? params.priority ?? "normal",
        executionMode: item.executionMode ?? "sequential",
        dependsOn: item.dependsOn ?? [],
        maxAttempts: Math.min(Math.max(item.maxAttempts ?? 2, 1), 3),
        attempts: 0,
        timeoutMs: Math.min(Math.max(item.timeoutMs ?? 30000, 1000), 45000),
        requireToolEvidence: item.requireToolEvidence ?? true,
        status: "pending",
        scopedContext: "",
        output: null,
        evidence: [],
        verified: false,
        verificationReason: null,
        errorMessage: null,
        tokenUsage: 0,
        handoffFromStepKey: null,
        handoffFromRole: null,
        handoffDepth: 0,
        startedAt: null,
        completedAt: null,
      };
    });

    task = {
      id: taskId,
      idempotencyKey,
      title: sanitizeTextForAudit(params.title || cleanCommand.slice(0, 90), 180),
      command: cleanCommand,
      priority: params.priority ?? "normal",
      status: "in_progress",
      createdByAdminId: params.createdByAdminId ?? null,
      steps,
      escalations: [],
      conflicts: [],
      finalReport: null,
      verificationStatus: "pending",
      startedAt: nowIso,
      completedAt: null,
      updatedAt: nowIso,
    };

    await persistence.upsertTask(task);
    for (const st of task.steps) {
      await persistence.upsertStep(st);
    }

    await auditLogger({
      actor_type: "agent",
      actor_id: null,
      actor_name: "رامي",
      action: "orchestrator:plan_created",
      resource_type: "ai_tool",
      resource_id: task.id,
      risk_level: "low",
      approval_id: null,
      outcome: "success",
      metadata: {
        task_id: task.id,
        idempotency_key: idempotencyKey,
        steps_count: task.steps.length,
        roles: task.steps.map((s) => s.assignedRole),
      },
    });
  }

  const executedStepKeys: string[] = [];
  const skippedStepKeys: string[] = [];
  let interrupted = false;

  const executeSingleStep = async (step: OrchestratedStepRecord) => {
    const depRecords = step.dependsOn.map((depKey) =>
      task!.steps.find((s) => s.stepKey === depKey)
    );

    const scopedContextParts: string[] = [];
    for (const dep of depRecords) {
      if (!dep) continue;
      scopedContextParts.push(
        buildScopedHandoffContext({
          fromRole: dep.assignedRole,
          toRole: step.assignedRole,
          rawSummary: dep.output || "",
          evidenceSummaries: dep.evidence
            .filter((e) => e.verified)
            .map((e) => `${e.toolId}: ${e.resultSummary}`),
        })
      );
    }
    if (step.scopedContext) {
      scopedContextParts.unshift(step.scopedContext);
    }

    if (params.memoryAdapter) {
      try {
        const memRes = await params.memoryAdapter.retrieveRelevantMemories({
          agentRole: step.assignedRole,
          queryText: step.instruction,
          limit: 3,
        });
        if (memRes.formattedContext) {
          scopedContextParts.push(memRes.formattedContext);
        }
      } catch {
        // عدم كسر تنفيذ الخطوة عند تعذر قراءة الذاكرة الاختيارية
      }
    }

    const finalScopedContext = scopedContextParts.join("\n\n");

    const profile = AGENT_PROFILE_MAP[step.assignedRole];
    step.status = "in_progress";
    step.startedAt = step.startedAt || new Date().toISOString();
    await persistence.upsertStep(step);

    let stepSucceeded = false;
    let lastError = "";
    let handoffProposal:
      | {
          targetRole: GovernedAgentRole;
          reason: string;
          requestedAction: string;
          payloadSummary: string;
        }
      | undefined;

    while (step.attempts < step.maxAttempts && !stepSucceeded) {
      step.attempts += 1;
      const promptForAgent = [
        `المهمة الفرعية (${step.title}):`,
        step.instruction,
        finalScopedContext ? `\nالسياق المسموح من الخطوات السابقة:\n${finalScopedContext}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const runRes = await runAgentWithTools({
        agentRole: step.assignedRole,
        agentName: profile.name,
        systemPrompt: profile.systemPrompt,
        taskId: task!.id,
        delegatedByRole: step.handoffFromRole ?? "orchestrator",
        userPrompt: promptForAgent,
        maxDurationMs: step.timeoutMs,
        requireToolEvidence: step.requireToolEvidence,
        modelInvoker: params.modelInvoker,
        auditLogger,
        readOnlyDataProvider: params.readOnlyDataProvider,
        projectRoot: params.projectRoot,
      });

      step.evidence.push(...runRes.evidence);
      step.tokenUsage += runRes.totalTokens;

      if (runRes.ok && runRes.verified) {
        stepSucceeded = true;
        step.status = "completed";
        step.output = runRes.text;
        step.verified = true;
        step.verificationReason = runRes.verificationReason;
        step.errorMessage = null;
        step.completedAt = new Date().toISOString();
        handoffProposal = runRes.handoffProposal;
      } else {
        lastError = runRes.error || runRes.verificationReason || "فشل تنفيذ الخطوة";
        if (
          runRes.errorCode === "LOOP_DETECTED" ||
          runRes.errorCode === "MAX_TOOL_CALLS_EXCEEDED" ||
          runRes.errorCode === "TOKEN_BUDGET_EXCEEDED"
        ) {
          break;
        }
      }
    }

    if (!stepSucceeded) {
      step.status = "failed";
      step.verified = false;
      step.errorMessage = sanitizeTextForAudit(lastError, 240);
      step.completedAt = new Date().toISOString();

      const escalation: EscalationRecord = {
        stepKey: step.stepKey,
        agentRole: step.assignedRole,
        agentName: step.assignedAgentName,
        reason: step.errorMessage,
        severity: step.priority === "urgent" || step.priority === "high" ? "critical" : "warning",
        escalatedTo: "orchestrator",
        createdAt: new Date().toISOString(),
      };
      task!.escalations.push(escalation);

      await auditLogger({
        actor_type: "agent",
        actor_id: null,
        actor_name: step.assignedAgentName,
        action: "orchestrator:step_escalated",
        resource_type: "ai_tool",
        resource_id: step.stepKey,
        risk_level: "medium",
        approval_id: null,
        outcome: "failed",
        metadata: {
          task_id: task!.id,
          agent_role: step.assignedRole,
          attempts: step.attempts,
          reason: step.errorMessage,
        },
      });
    } else if (params.memoryAdapter && step.verified && step.evidence.length > 0) {
      try {
        await params.memoryAdapter.saveVerifiedLesson({
          scope: "personal",
          agentRole: step.assignedRole,
          summary: `${step.title}: ${sanitizeTextForAudit(step.output || "", 260)}`,
          sourceTaskId: task!.id,
          verified: true,
          evidenceCount: step.evidence.filter((e) => e.verified).length,
        });
      } catch {
        // عدم كسر التنفيذ عند تعذر حفظ الذاكرة الاختياري
      }
    }

    await persistence.upsertStep(step);
    executedStepKeys.push(step.stepKey);

    if (stepSucceeded && handoffProposal) {
      const targetRole = handoffProposal.targetRole;
      const canHandoff =
        targetRole in SERVER_AGENT_TOOL_ALLOWLIST &&
        targetRole !== step.assignedRole &&
        step.handoffDepth < maxHandoffDepth &&
        task!.steps.length < maxSteps &&
        !task!.steps.some(
          (s) =>
            s.handoffFromStepKey === step.stepKey &&
            s.assignedRole === targetRole
        );

      if (canHandoff) {
        const handoffStepKey = `handoff_${step.stepKey}_to_${targetRole}`;
        const scopedHandoffCtx = buildScopedHandoffContext({
          fromRole: step.assignedRole,
          toRole: targetRole,
          rawSummary: `${handoffProposal.payloadSummary || step.output || ""}`,
          evidenceSummaries: step.evidence
            .filter((e) => e.verified)
            .map((e) => `${e.toolId}: ${e.resultSummary}`),
        });

        const handoffStep: OrchestratedStepRecord = {
          id: crypto.randomUUID(),
          taskId: task!.id,
          stepKey: handoffStepKey,
          stepOrder: task!.steps.length + 1,
          title: `تسليم خادمي من ${step.assignedAgentName} إلى ${AGENT_PROFILE_MAP[targetRole].name}`,
          instruction: handoffProposal.requestedAction,
          assignedRole: targetRole,
          assignedAgentName: AGENT_PROFILE_MAP[targetRole].name,
          priority: step.priority,
          executionMode: "sequential",
          dependsOn: [step.stepKey],
          maxAttempts: 2,
          attempts: 0,
          timeoutMs: 30000,
          requireToolEvidence: true,
          status: "pending",
          scopedContext: scopedHandoffCtx,
          output: null,
          evidence: [],
          verified: false,
          verificationReason: null,
          errorMessage: null,
          tokenUsage: 0,
          handoffFromStepKey: step.stepKey,
          handoffFromRole: step.assignedRole,
          handoffDepth: step.handoffDepth + 1,
          startedAt: null,
          completedAt: null,
        };

        task!.steps.push(handoffStep);
        await persistence.upsertStep(handoffStep);

        await auditLogger({
          actor_type: "agent",
          actor_id: null,
          actor_name: step.assignedAgentName,
          action: "orchestrator:controlled_handoff",
          resource_type: "ai_tool",
          resource_id: handoffStepKey,
          risk_level: "low",
          approval_id: null,
          outcome: "success",
          metadata: {
            task_id: task!.id,
            from_role: step.assignedRole,
            to_role: targetRole,
            handoff_depth: handoffStep.handoffDepth,
            reason: handoffProposal.reason,
          },
        });
      }
    }
  };

  // 2. حلقة تنفيذ الخطوات على موجات مع احترام الاعتماديات والتوازي الآمن للمستقلات والاستئناف القابل للتوقف
  let progressMade = true;
  while (progressMade) {
    progressMade = false;

    const pendingSteps = task.steps.filter((s) => s.status === "pending");
    if (pendingSteps.length === 0) break;

    if (Date.now() - startedAtMs >= stageTimeBudgetMs) {
      interrupted = true;
      task.status = "paused";
      task.updatedAt = new Date().toISOString();
      await persistence.upsertTask(task);
      return {
        ok: false,
        resumedFromCheckpoint,
        interrupted: true,
        needsResume: true,
        task,
        executedStepKeys,
        skippedStepKeys,
        error: `توقف التنفيذ مؤقتاً بعد استهلاك الميزانية الزمنية للمرحلة (${Math.round(stageTimeBudgetMs / 1000)} ثانية)؛ تم حفظ التقدم ويمكن استئناف الخطوات المتبقية (${pendingSteps.length}) بنفس idempotencyKey.`,
      };
    }

    const readySteps: OrchestratedStepRecord[] = [];
    for (const step of task.steps) {
      if (step.status === "completed" && step.verified) {
        if (!skippedStepKeys.includes(step.stepKey) && !executedStepKeys.includes(step.stepKey)) {
          skippedStepKeys.push(step.stepKey);
        }
        continue;
      }
      if (step.status !== "pending") continue;

      const depRecords = step.dependsOn.map((depKey) =>
        task!.steps.find((s) => s.stepKey === depKey)
      );
      const hasFailedDep = depRecords.some(
        (d) => !d || d.status === "failed" || d.status === "cancelled"
      );
      if (hasFailedDep) {
        step.status = "cancelled";
        step.errorMessage =
          "تم إلغاء الخطوة تلقائياً بسبب فشل أو تعذر خطوة تعتمد عليها.";
        step.completedAt = new Date().toISOString();
        await persistence.upsertStep(step);
        progressMade = true;
        continue;
      }

      const allDepsCompleted = depRecords.every(
        (d) => d && d.status === "completed" && d.verified
      );
      if (allDepsCompleted) {
        readySteps.push(step);
      }
    }

    if (readySteps.length === 0) {
      continue;
    }

    const parallelBatch = !params.simulateInterruptAfterStepKey
      ? readySteps.filter((s) => s.executionMode === "parallel").slice(0, 3)
      : [];

    if (parallelBatch.length > 1) {
      await Promise.all(parallelBatch.map((st) => executeSingleStep(st)));
      progressMade = true;
    } else {
      const nextStep = readySteps[0];
      await executeSingleStep(nextStep);
      progressMade = true;

      if (
        params.simulateInterruptAfterStepKey &&
        nextStep.stepKey === params.simulateInterruptAfterStepKey
      ) {
        interrupted = true;
        task.status = "paused";
        task.updatedAt = new Date().toISOString();
        await persistence.upsertTask(task);
        return {
          ok: false,
          resumedFromCheckpoint,
          interrupted: true,
          needsResume: true,
          task,
          executedStepKeys,
          skippedStepKeys,
          error: `انقطع التنفيذ بعد الخطوة (${nextStep.stepKey}) وتم حفظ نقطة الاستئناف بأمان.`,
        };
      }
    }
  }

  // 3. كشف التعارضات والتحقق النهائي وتجميع التقرير الموحد لرامي
  task.conflicts = detectStepConflicts(task.steps);

  const totalSteps = task.steps.length;
  const verifiedSteps = task.steps.filter(
    (s) => s.status === "completed" && s.verified
  );
  const failedOrCancelledSteps = task.steps.filter(
    (s) => s.status === "failed" || s.status === "cancelled"
  );

  if (verifiedSteps.length === totalSteps && totalSteps > 0) {
    task.status = "completed";
    task.verificationStatus = "verified";
  } else if (verifiedSteps.length > 0) {
    task.status = "failed";
    task.verificationStatus = "partial";
  } else {
    task.status = "failed";
    task.verificationStatus = "failed";
  }

  const reportSections: string[] = [
    `# التقرير الموحد من رامي (المدير العام المنسق)`,
    `- **المهمة:** ${task.title}`,
    `- **حالة التحقق النهائية:** ${task.verificationStatus} (${verifiedSteps.length}/${totalSteps} خطوات موثّقة)`,
  ];

  for (const st of task.steps) {
    const verifiedTools = st.evidence
      .filter((e) => e.verified)
      .map((e) => e.toolId);
    reportSections.push(
      `\n### ${st.stepOrder}. ${st.title} — ${st.assignedAgentName} (${st.assignedRole}) [${st.status}]`,
      st.output
        ? `- **النتيجة:** ${sanitizeTextForAudit(st.output, 500)}`
        : `- **الخطأ:** ${st.errorMessage || "لا توجد مخرجات"}`,
      `- **الأدلة الموثّقة:** ${
        verifiedTools.length > 0 ? verifiedTools.join(", ") : "لا يوجد دليل أداة موثّق"
      }`
    );
  }

  if (task.conflicts.length > 0) {
    reportSections.push(
      `\n### التعارضات المرصودة ومعالجتها`,
      ...task.conflicts.map((c) => `- ${c.description} ← ${c.resolution}`)
    );
  }

  if (task.escalations.length > 0) {
    reportSections.push(
      `\n### التصعيدات المسجلة`,
      ...task.escalations.map(
        (e) =>
          `- [${e.severity}] ${e.agentName} (${e.stepKey}): ${e.reason} → مُصعَّد إلى ${e.escalatedTo}`
      )
    );
  }

  task.finalReport = reportSections.join("\n");
  task.completedAt = new Date().toISOString();
  task.updatedAt = task.completedAt;

  await persistence.upsertTask(task);
  await persistence.appendLog({
    taskId: task.id,
    agentRole: "orchestrator",
    logType: task.status === "completed" ? "info" : "security_alert",
    message: task.finalReport,
  });

  await auditLogger({
    actor_type: "agent",
    actor_id: null,
    actor_name: "رامي",
    action: "orchestrator:task_closed",
    resource_type: "ai_tool",
    resource_id: task.id,
    risk_level: task.status === "completed" ? "low" : "medium",
    approval_id: null,
    outcome: task.status === "completed" ? "success" : "failed",
    metadata: {
      task_id: task.id,
      verification_status: task.verificationStatus,
      verified_steps: verifiedSteps.length,
      failed_steps: failedOrCancelledSteps.length,
      escalations_count: task.escalations.length,
      conflicts_count: task.conflicts.length,
    },
  });

  return {
    ok: task.status === "completed" && task.verificationStatus === "verified",
    resumedFromCheckpoint,
    interrupted: false,
    task,
    executedStepKeys,
    skippedStepKeys,
    error:
      task.status === "completed"
        ? undefined
        : `لم تكتمل جميع الخطوات بتحقق كامل (${verifiedSteps.length}/${totalSteps}).`,
  };
}
