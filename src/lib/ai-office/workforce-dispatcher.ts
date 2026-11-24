// =============================================================================
// بَلِّغْنِي | BALAGHNI — بوابة ربط محرك الوكلاء متعدد المراحل بغرفة العمليات
// PHASE 2B:
// - Feature Flag خادمي فقط: AI_OFFICE_MULTI_AGENT_ENABLED (معطّل افتراضياً).
// - عند التعطيل: يستمر المسار القديم (executeFounderCommand) دون أي تغيير.
// - عند التفعيل: يمر الأمر عبر task-orchestrator -> gemini-tool-runner -> tool-registry.
// - لا سقوط صامت للمسار القديم عند فشل المحرك الجديد (Fail-Closed).
// - منع التكرار المتزامن داخل العملية لنفس idempotencyKey.
// =============================================================================

import crypto from "node:crypto";
import {
  executeFounderCommand,
  getAiOfficeSnapshot,
} from "@/lib/ai-office/agents-service";
import {
  orchestrateMultiAgentTask,
  type OrchestratedTaskRecord,
  type PlannedSubtask,
  type TaskPersistenceAdapter,
  type TaskPriority,
} from "@/lib/ai-office/task-orchestrator";
import {
  defaultAiAuditLogger,
  sanitizeTextForAudit,
  type ToolAuditLogger,
  type ToolReadOnlyDataProvider,
} from "@/lib/ai-office/tool-registry";
import type { GeminiModelInvoker } from "@/lib/ai-office/gemini-tool-runner";
import { assertTestSupabaseTarget } from "@/lib/supabase/test-env-guard";

export type CommandEnginePath = "legacy_single_agent" | "multi_agent_v2";

export type OfficeTargetRole =
  | "orchestrator"
  | "principal_architect"
  | "skills_architect";

export interface DispatchOfficeCommandParams {
  command: string;
  targetRole: OfficeTargetRole;
  adminId?: string | null;
  adminName?: string;
  priority?: TaskPriority;
  idempotencyKey?: string;
  /** ميزانية زمنية للمرحلة الواحدة قبل الحفظ والتوقف الآمن القابل للاستئناف (الافتراضي 42 ثانية) */
  stageTimeBudgetMs?: number;
  /** محقونات اختيارية للاختبارات المحلية المعزولة فقط (لا تُقبل من HTTP body) */
  _testOverrides?: {
    legacyExecutor?: typeof executeFounderCommand;
    modelInvoker?: GeminiModelInvoker;
    auditLogger?: ToolAuditLogger;
    readOnlyDataProvider?: ToolReadOnlyDataProvider;
    persistence?: TaskPersistenceAdapter;
    customPlan?: PlannedSubtask[];
    skipSnapshotRefresh?: boolean;
    projectRoot?: string;
  };
}

export interface DispatchOfficeCommandResult {
  ok: boolean;
  enginePath: CommandEnginePath;
  multiAgentEnabled: boolean;
  deduplicatedInFlight?: boolean;
  needsResume?: boolean;
  resumedFromCheckpoint?: boolean;
  idempotencyKey?: string;
  summary: string;
  orchestratedTask?: OrchestratedTaskRecord;
  task?: unknown;
  delegatedTo?: unknown;
  agents?: unknown[];
  logs?: unknown[];
  skills?: unknown[];
  error?: string;
}

/**
 * قراءة Feature Flag من بيئة الخادم فقط (معطّل افتراضياً).
 * لا يُسمح للعميل بتغييره عبر HTTP body أو headers.
 */
export function isMultiAgentEngineEnabled(): boolean {
  return String(process.env.AI_OFFICE_MULTI_AGENT_ENABLED || "")
    .trim()
    .toLowerCase() === "true";
}

// قفل منع التكرار المتزامن داخل نفس مثيل الخادم لنفس idempotencyKey
const inFlightByIdempotencyKey = new Map<
  string,
  Promise<DispatchOfficeCommandResult>
>();

function buildTargetedPlanIfNeeded(
  targetRole: OfficeTargetRole,
  command: string
): PlannedSubtask[] | undefined {
  if (targetRole === "principal_architect") {
    return [
      {
        stepKey: "direct_karim_review",
        title: "فحص أمني ومعماري مباشر بواسطة كريم",
        instruction: command,
        assignedRole: "principal_architect",
        priority: "high",
        executionMode: "sequential",
        dependsOn: [],
        requireToolEvidence: true,
      },
    ];
  }
  if (targetRole === "skills_architect") {
    return [
      {
        stepKey: "direct_tariq_analysis",
        title: "تحليل الأداء والمعرفة بواسطة طارق",
        instruction: command,
        assignedRole: "skills_architect",
        priority: "normal",
        executionMode: "sequential",
        dependsOn: [],
        requireToolEvidence: true,
      },
    ];
  }
  return undefined;
}

export async function dispatchOfficeCommand(
  params: DispatchOfficeCommandParams
): Promise<DispatchOfficeCommandResult> {
  assertTestSupabaseTarget(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    {
      context: "workforce_dispatcher",
    }
  );
  const multiAgentEnabled = isMultiAgentEngineEnabled();
  const auditLogger = params._testOverrides?.auditLogger ?? defaultAiAuditLogger;
  const cleanCommand = sanitizeTextForAudit(params.command, 1500);

  if (!cleanCommand) {
    return {
      ok: false,
      enginePath: multiAgentEnabled ? "multi_agent_v2" : "legacy_single_agent",
      multiAgentEnabled,
      summary: "",
      error: "يرجى إدخال نص الأمر المطلوب تنفيذه.",
    };
  }

  // 1. المسار القديم (الافتراضي عند تعطيل Feature Flag)
  if (!multiAgentEnabled) {
    await auditLogger({
      actor_type: "system",
      actor_id: params.adminId ?? null,
      actor_name: params.adminName || "admin",
      action: "dispatcher:route_selected",
      resource_type: "ai_tool",
      resource_id: "legacy_single_agent",
      risk_level: "low",
      approval_id: null,
      outcome: "success",
      metadata: {
        engine_path: "legacy_single_agent",
        target_role: params.targetRole,
      },
    });

    const legacyFn =
      params._testOverrides?.legacyExecutor ?? executeFounderCommand;
    const legacyRes = await legacyFn({
      command: cleanCommand,
      targetRole: params.targetRole,
      adminName: params.adminName,
    });

    return {
      ...legacyRes,
      enginePath: "legacy_single_agent",
      multiAgentEnabled: false,
    };
  }

  // 2. المسار الجديد (PHASE 2B: Multi-Agent Orchestrator + Gemini Tool Runner)
  const effectiveKey =
    params.idempotencyKey?.trim() ||
    `cmd_${crypto
      .createHash("sha256")
      .update(`${params.adminId || "admin"}:${params.targetRole}:${cleanCommand}`)
      .digest("hex")
      .slice(0, 24)}`;

  const existingInFlight = inFlightByIdempotencyKey.get(effectiveKey);
  if (existingInFlight) {
    const shared = await existingInFlight;
    return {
      ...shared,
      deduplicatedInFlight: true,
    };
  }

  const runPromise = (async (): Promise<DispatchOfficeCommandResult> => {
    await auditLogger({
      actor_type: "system",
      actor_id: params.adminId ?? null,
      actor_name: params.adminName || "admin",
      action: "dispatcher:route_selected",
      resource_type: "ai_tool",
      resource_id: "multi_agent_v2",
      risk_level: "low",
      approval_id: null,
      outcome: "success",
      metadata: {
        engine_path: "multi_agent_v2",
        target_role: params.targetRole,
        idempotency_key: effectiveKey,
      },
    });

    try {
      const customPlan =
        params._testOverrides?.customPlan ??
        buildTargetedPlanIfNeeded(params.targetRole, cleanCommand);

      const orchestrated = await orchestrateMultiAgentTask({
        command: cleanCommand,
        priority: params.priority ?? "normal",
        idempotencyKey: effectiveKey,
        createdByAdminId: params.adminId ?? null,
        stageTimeBudgetMs: params.stageTimeBudgetMs ?? 42000,
        customPlan,
        modelInvoker: params._testOverrides?.modelInvoker,
        auditLogger,
        readOnlyDataProvider: params._testOverrides?.readOnlyDataProvider,
        persistence: params._testOverrides?.persistence,
        projectRoot: params._testOverrides?.projectRoot,
      });

      let snap:
        | {
            agents: unknown[];
            logs: unknown[];
            skills: unknown[];
          }
        | undefined;

      if (!params._testOverrides?.skipSnapshotRefresh) {
        try {
          const liveSnap = await getAiOfficeSnapshot();
          snap = {
            agents: liveSnap.agents,
            logs: liveSnap.logs,
            skills: liveSnap.skills,
          };
        } catch {
          // عدم كسر النتيجة إذا تعذر تحديث اللقطة
        }
      }

      return {
        ok: orchestrated.ok,
        enginePath: "multi_agent_v2",
        multiAgentEnabled: true,
        needsResume: Boolean(orchestrated.needsResume || orchestrated.interrupted),
        resumedFromCheckpoint: Boolean(orchestrated.resumedFromCheckpoint),
        idempotencyKey: orchestrated.task.idempotencyKey,
        summary: orchestrated.task.finalReport || "",
        orchestratedTask: orchestrated.task,
        agents: snap?.agents,
        logs: snap?.logs,
        skills: snap?.skills,
        error: orchestrated.ok
          ? undefined
          : orchestrated.error ||
            "لم تكتمل جميع خطوات المهمة بأدلة تحقق كاملة.",
      };
    } catch (err) {
      // Fail-Closed: لا نسقط أبداً للمسار القديم عند فشل المحرك الجديد
      const safeErr = sanitizeTextForAudit(
        err instanceof Error ? err.message : String(err),
        240
      );
      await auditLogger({
        actor_type: "system",
        actor_id: params.adminId ?? null,
        actor_name: params.adminName || "admin",
        action: "dispatcher:multi_agent_failed",
        resource_type: "ai_tool",
        resource_id: "multi_agent_v2",
        risk_level: "medium",
        approval_id: null,
        outcome: "failed",
        metadata: {
          engine_path: "multi_agent_v2",
          idempotency_key: effectiveKey,
          reason: safeErr,
        },
      });
      return {
        ok: false,
        enginePath: "multi_agent_v2",
        multiAgentEnabled: true,
        summary: "",
        error: `تعذر إكمال التنفيذ في محرك الوكلاء متعدد المراحل (لم يتم التحويل للمسار القديم حفاظاً على الأمان): ${safeErr}`,
      };
    }
  })();

  inFlightByIdempotencyKey.set(effectiveKey, runPromise);
  try {
    return await runPromise;
  } finally {
    inFlightByIdempotencyKey.delete(effectiveKey);
  }
}
