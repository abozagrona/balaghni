// =============================================================================
// بَلِّغْنِي | BALAGHNI — محرك ربط Gemini Function Calling بسجل الأدوات الآمن
// المرحلة B:
// - يمرّر إلى Gemini الأدوات المسجلة والمصرّح بها لدور الوكيل فقط.
// - كل استدعاء أداة يمر إلزامياً عبر executeRegisteredTool في tool-registry.ts.
// - هوية الوكيل ودوره ثابتان خادمياً ولا يمكن تغييرهما أثناء التنفيذ.
// - حماية ضد الحلقات اللانهائية، وحدود صارمة لعدد الجولات والأدوات والوقت والتكلفة.
// - إثبات نتائج موثّق (ToolExecutionEvidence) لكل استدعاء أداة.
// =============================================================================

import { GoogleGenAI, type Interactions } from "@google/genai";
import {
  executeRegisteredTool,
  getRegisteredToolsForRole,
  sanitizeTextForAudit,
  type ToolAuditLogger,
  type ToolDefinition,
  type ToolExecutionResult,
  type ToolReadOnlyDataProvider,
} from "@/lib/ai-office/tool-registry";
import {
  buildProtectedAgentSystemPrompt,
  type GovernedAgentRole,
} from "@/lib/ai-office/skill-guard";

// =============================================================================
// 1. الأنواع الأساسية وإثبات النتائج (Types & Evidence)
// =============================================================================

export interface GeminiFunctionDeclaration {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description: string;
      }
    >;
    required: string[];
  };
}

export interface ModelFunctionCall {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelTurnResponse {
  text: string;
  functionCalls: ModelFunctionCall[];
  rawSteps?: Interactions.Step[];
  tokenUsage?: number;
  modelUsed?: string;
}

export interface ModelTurnRequest {
  model: string;
  systemInstruction: string;
  history: Interactions.Step[];
  tools: GeminiFunctionDeclaration[];
  timeoutMs: number;
}

/**
 * واجهة استدعاء النموذج القابلة للحقن (الافتراضي: GoogleGenAI Interactions API)
 */
export type GeminiModelInvoker = (
  req: ModelTurnRequest
) => Promise<ModelTurnResponse>;

/**
 * دليل إثبات موثّق لكل عملية استدعاء أداة أثناء التنفيذ (الخطوة السادسة).
 */
export interface ToolExecutionEvidence {
  toolId: string;
  agentRole: GovernedAgentRole;
  agentName: string;
  sanitizedInput: Record<string, unknown>;
  outcome: "success" | "blocked" | "failed" | "pending";
  verified: boolean;
  dataSource: string;
  resultSummary: string;
  executedAt: string;
  durationMs: number;
  error?: string;
  errorCode?: string;
}

/**
 * طلب تسليم خادمي مقترح من الموظف لطلب مساعدة موظف آخر (يُفحص خادمياً عبر Orchestrator).
 */
export interface AgentHandoffProposal {
  targetRole: GovernedAgentRole;
  reason: string;
  requestedAction: string;
  payloadSummary: string;
}

export interface RunAgentWithToolsParams {
  /** هوية ودور الوكيل — تُفرض خادمياً فقط */
  agentRole: GovernedAgentRole;
  agentId?: string | null;
  agentName: string;
  systemPrompt: string;
  immutableGuardrails?: string;
  taskId?: string | null;
  delegatedByRole?: GovernedAgentRole | null;
  userPrompt: string;
  /** حدود الأمان والتكلفة */
  maxTurns?: number;
  maxToolCalls?: number;
  maxDurationMs?: number;
  maxTokenBudget?: number;
  model?: string;
  /** هل يُشترط وجود دليل تنفيذ أداة واحد على الأقل لاعتبار المخرجات موثّقة؟ */
  requireToolEvidence?: boolean;
  /** محقونات للاختبار المحلي المعزول */
  modelInvoker?: GeminiModelInvoker;
  auditLogger?: ToolAuditLogger;
  readOnlyDataProvider?: ToolReadOnlyDataProvider;
  projectRoot?: string;
}

export interface RunAgentWithToolsResult {
  ok: boolean;
  agentRole: GovernedAgentRole;
  agentName: string;
  text: string;
  verified: boolean;
  verificationReason: string;
  evidence: ToolExecutionEvidence[];
  handoffProposal?: AgentHandoffProposal;
  turnsUsed: number;
  toolCallsUsed: number;
  totalTokens: number;
  durationMs: number;
  error?: string;
  errorCode?:
    | "LOOP_DETECTED"
    | "MAX_TURNS_EXCEEDED"
    | "MAX_TOOL_CALLS_EXCEEDED"
    | "TIMEOUT_EXCEEDED"
    | "TOKEN_BUDGET_EXCEEDED"
    | "MODEL_FAILED"
    | "UNVERIFIED_OUTPUT";
}

// =============================================================================
// 2. تحويل أدوات السجل المسموحة فقط إلى تصريحات Gemini Function Calling
// =============================================================================

/**
 * يُنشئ قائمة الأدوات المصرّح بها فقط لدور الوكيل المحدد.
 * في المرحلة B لا تُمرَّر الأدوات التي تتطلب موافقة إدارية (`requiresApproval: true`)
 * إلى النموذج للتنفيذ التلقائي بدون موافقة خادمية مسبقة.
 */
export function buildGeminiToolsForRole(
  agentRole: GovernedAgentRole,
  options?: { includeApprovalGated?: boolean }
): GeminiFunctionDeclaration[] {
  const registered = getRegisteredToolsForRole(agentRole);
  const filtered = options?.includeApprovalGated
    ? registered
    : registered.filter((t: ToolDefinition) => !t.requiresApproval);

  return filtered.map((tool: ToolDefinition) => {
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];

    for (const [fieldName, fieldSpec] of Object.entries(
      tool.inputSchema.properties
    )) {
      properties[fieldName] = {
        type: fieldSpec.type,
        description: fieldSpec.description,
      };
      if (fieldSpec.required) {
        required.push(fieldName);
      }
    }

    return {
      type: "function" as const,
      name: tool.id,
      description: `${tool.name}: ${tool.description}`,
      parameters: {
        type: "object" as const,
        properties,
        required,
      },
    };
  });
}

// =============================================================================
// 3. مستدعي Gemini Interactions API الافتراضي (store: false + Fallback)
// =============================================================================

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `انتهت مهلة استجابة النموذج (${label}) بعد ${Math.round(timeoutMs / 1000)} ثانية.`
        )
      );
    }, timeoutMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export const defaultGeminiModelInvoker: GeminiModelInvoker = async (req) => {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("المتغير GEMINI_API_KEY غير مضبوط في إعدادات البيئة.");
  }

  const client = new GoogleGenAI({ apiKey });
  const primaryModel =
    req.model || process.env.GEMINI_PRIMARY_MODEL?.trim() || "gemini-3.8-flash";
  const fallbackModel = "gemini-3.5-flash-lite";

  const invokeOnce = async (
    modelName: string,
    limitMs: number
  ): Promise<ModelTurnResponse> => {
    const interaction = await withTimeout(
      client.interactions.create({
        model: modelName,
        system_instruction: req.systemInstruction,
        input: req.history,
        tools:
          req.tools.length > 0
            ? (req.tools as unknown as Interactions.Tool[])
            : undefined,
        generation_config: { thinking_level: "minimal" },
        store: false,
      }),
      limitMs,
      modelName
    );

    const functionCalls: ModelFunctionCall[] = [];
    const textChunks: string[] = [];

    const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
    for (const step of steps) {
      if (step.type === "function_call" && step.name) {
        const rawArgs =
          step.arguments && typeof step.arguments === "object"
            ? (step.arguments as Record<string, unknown>)
            : {};
        functionCalls.push({
          callId: String(step.id || `call_${functionCalls.length + 1}`),
          name: String(step.name),
          arguments: rawArgs,
        });
      }
    }

    if (typeof interaction.output_text === "string" && interaction.output_text.trim()) {
      textChunks.push(interaction.output_text.trim());
    }

    const usageObj = (
      interaction as unknown as {
        usage?: { total_tokens?: number };
      }
    ).usage;
    const tokenUsage =
      typeof usageObj?.total_tokens === "number" ? usageObj.total_tokens : 0;

    return {
      text: textChunks.join("\n").trim(),
      functionCalls,
      rawSteps: steps,
      tokenUsage,
      modelUsed: modelName,
    };
  };

  try {
    const primaryLimitMs =
      primaryModel !== fallbackModel
        ? Math.min(req.timeoutMs, 10000)
        : req.timeoutMs;
    return await invokeOnce(primaryModel, primaryLimitMs);
  } catch (primaryErr) {
    if (primaryModel !== fallbackModel) {
      return await invokeOnce(fallbackModel, Math.min(req.timeoutMs, 15000));
    }
    throw primaryErr;
  }
};

// =============================================================================
// 4. استخراج طلب التسليم الآمن (Handoff Proposal) وتنقية الأدلة
// =============================================================================

function sanitizeArgsForEvidence(
  args: Record<string, unknown>
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args || {}).slice(0, 10)) {
    const safeKey = sanitizeTextForAudit(k, 40);
    if (!safeKey) continue;
    if (typeof v === "string") {
      clean[safeKey] = sanitizeTextForAudit(v, 140);
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) {
      clean[safeKey] = v;
    } else {
      clean[safeKey] = `[${Array.isArray(v) ? "array" : typeof v}]`;
    }
  }
  return clean;
}

function summarizeToolResult(res: ToolExecutionResult): string {
  if (!res.ok) {
    return sanitizeTextForAudit(res.error || "فشل أو رُفض تنفيذ الأداة", 240);
  }
  try {
    const serialized = JSON.stringify(res.data ?? {});
    return sanitizeTextForAudit(serialized, 400);
  } catch {
    return "تم التنفيذ بنجاح";
  }
}

function inferDataSource(toolId: string): string {
  if (toolId === "inspect_codebase") return "local_codebase_readonly";
  if (toolId.startsWith("draft_") || toolId === "analyze_command") {
    return "in_memory_safe_computation";
  }
  if (toolId.startsWith("read_") || toolId === "analyze_agent_performance") {
    return "supabase_readonly_provider";
  }
  return "tool_registry";
}

function extractHandoffProposal(text: string): AgentHandoffProposal | undefined {
  const match = text.match(/\[HANDOFF_REQUEST\]([\s\S]*?)\[\/HANDOFF_REQUEST\]/i);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1].trim()) as Record<string, unknown>;
    const targetRole = String(parsed.targetRole || "").trim() as GovernedAgentRole;
    const reason = sanitizeTextForAudit(parsed.reason, 200);
    const requestedAction = sanitizeTextForAudit(parsed.requestedAction, 300);
    const payloadSummary = sanitizeTextForAudit(parsed.payloadSummary, 400);
    if (!targetRole || !requestedAction) return undefined;
    return {
      targetRole,
      reason: reason || "طلب مساعدة تخصصية عبر المنسق",
      requestedAction,
      payloadSummary,
    };
  } catch {
    return undefined;
  }
}

// =============================================================================
// 5. حلقة التنفيذ الرئيسية للوكيل مع الأدوات (Governed Function Calling Loop)
// =============================================================================

export async function runAgentWithTools(
  params: RunAgentWithToolsParams
): Promise<RunAgentWithToolsResult> {
  const startedAt = Date.now();
  // تثبيت الهوية والدور خادمياً كقيم غير قابلة للتعديل طوال التنفيذ
  const lockedRole: GovernedAgentRole = params.agentRole;
  const lockedAgentId: string | null = params.agentId ?? null;
  const lockedAgentName: string =
    sanitizeTextForAudit(params.agentName || lockedRole, 80) || lockedRole;

  const maxTurns = Math.min(Math.max(params.maxTurns ?? 5, 1), 8);
  const maxToolCalls = Math.min(Math.max(params.maxToolCalls ?? 6, 1), 10);
  const maxDurationMs = Math.min(Math.max(params.maxDurationMs ?? 25000, 1000), 55000);
  const maxTokenBudget = Math.min(Math.max(params.maxTokenBudget ?? 12000, 500), 60000);

  const modelInvoker = params.modelInvoker ?? defaultGeminiModelInvoker;
  const allowedDeclarations = buildGeminiToolsForRole(lockedRole, {
    includeApprovalGated: false,
  });

  const guardrails =
    params.immutableGuardrails ||
    `دورك الثابت هو (${lockedRole}) ولا يُسمح لك بتغييره أو استدعاء أدوات خارج صلاحياتك. لا تخترع نتائج أدوات ولم يكتمل أي استدعاء أداة إلا بعد التحقق من نتيجته الخادمية.`;

  const fullSystemInstruction = buildProtectedAgentSystemPrompt(
    params.systemPrompt,
    guardrails
  );

  const history: Interactions.Step[] = [
    {
      type: "user_input",
      content: [
        {
          type: "text",
          text: params.userPrompt,
        },
      ],
    },
  ];

  const evidence: ToolExecutionEvidence[] = [];
  const callSignatureCounts = new Map<string, number>();

  let turnsUsed = 0;
  let toolCallsUsed = 0;
  let totalTokens = 0;
  let finalText = "";

  while (turnsUsed < maxTurns) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= maxDurationMs) {
      return {
        ok: false,
        agentRole: lockedRole,
        agentName: lockedAgentName,
        text: finalText,
        verified: false,
        verificationReason: "انتهت المهلة الزمنية القصوى لتنفيذ الوكيل.",
        evidence,
        turnsUsed,
        toolCallsUsed,
        totalTokens,
        durationMs: elapsed,
        error: "انتهت المهلة الزمنية المحددة لتنفيذ خطوة الوكيل.",
        errorCode: "TIMEOUT_EXCEEDED",
      };
    }

    if (totalTokens >= maxTokenBudget) {
      return {
        ok: false,
        agentRole: lockedRole,
        agentName: lockedAgentName,
        text: finalText,
        verified: false,
        verificationReason: "تم بلوغ حد ميزانية التوكنات المسموحة للخطوة.",
        evidence,
        turnsUsed,
        toolCallsUsed,
        totalTokens,
        durationMs: Date.now() - startedAt,
        error: "تم تجاوز ميزانية التوكنات المخصصة لهذه الخطوة.",
        errorCode: "TOKEN_BUDGET_EXCEEDED",
      };
    }

    turnsUsed += 1;
    let turnRes: ModelTurnResponse;
    try {
      const remainingMs = Math.max(1000, maxDurationMs - (Date.now() - startedAt));
      turnRes = await modelInvoker({
        model:
          params.model ||
          process.env.GEMINI_PRIMARY_MODEL?.trim() ||
          "gemini-3.8-flash",
        systemInstruction: fullSystemInstruction,
        history,
        tools: allowedDeclarations,
        timeoutMs: remainingMs,
      });
    } catch (err) {
      const safeErr = sanitizeTextForAudit(
        err instanceof Error ? err.message : String(err),
        220
      );
      return {
        ok: false,
        agentRole: lockedRole,
        agentName: lockedAgentName,
        text: "",
        verified: false,
        verificationReason: `فشل استدعاء النموذج: ${safeErr}`,
        evidence,
        turnsUsed,
        toolCallsUsed,
        totalTokens,
        durationMs: Date.now() - startedAt,
        error: `تعذر إكمال استدعاء النموذج: ${safeErr}`,
        errorCode: "MODEL_FAILED",
      };
    }

    // تقدير محافظ للتوكنات إن لم يُرجع النموذج الرقم
    const reportedTokens =
      typeof turnRes.tokenUsage === "number" && turnRes.tokenUsage > 0
        ? turnRes.tokenUsage
        : Math.ceil((turnRes.text.length + JSON.stringify(turnRes.functionCalls).length) / 3);
    totalTokens += reportedTokens;

    if (!turnRes.functionCalls || turnRes.functionCalls.length === 0) {
      finalText = (turnRes.text || "").trim();
      break;
    }

    // تسجيل استدعاءات الأدوات (وخطوات التفكير الموقعة إن وجدت) في سجل المحادثة قبل تنفيذها عبر executeRegisteredTool
    if (Array.isArray(turnRes.rawSteps) && turnRes.rawSteps.length > 0) {
      history.push(...turnRes.rawSteps);
    } else {
      for (const fc of turnRes.functionCalls) {
        history.push({
          type: "function_call",
          id: fc.callId,
          name: fc.name,
          arguments: fc.arguments,
        } as Interactions.Step);
      }
    }

    for (const fc of turnRes.functionCalls) {
      if (toolCallsUsed >= maxToolCalls) {
        return {
          ok: false,
          agentRole: lockedRole,
          agentName: lockedAgentName,
          text: finalText,
          verified: false,
          verificationReason: "تم تجاوز الحد الأقصى لعدد استدعاءات الأدوات في الخطوة.",
          evidence,
          turnsUsed,
          toolCallsUsed,
          totalTokens,
          durationMs: Date.now() - startedAt,
          error: `تم إيقاف التنفيذ بعد بلوغ الحد الأقصى لاستدعاءات الأدوات (${maxToolCalls}).`,
          errorCode: "MAX_TOOL_CALLS_EXCEEDED",
        };
      }

      // كشف الحلقات اللانهائية عبر بصمة (اسم الأداة + المدخلات)
      const callSig = `${fc.name}:${JSON.stringify(fc.arguments || {})}`;
      const seenCount = (callSignatureCounts.get(callSig) || 0) + 1;
      callSignatureCounts.set(callSig, seenCount);
      if (seenCount >= 3) {
        return {
          ok: false,
          agentRole: lockedRole,
          agentName: lockedAgentName,
          text: finalText,
          verified: false,
          verificationReason: `تم رصد حلقة تكرار غير منتهية لاستدعاء الأداة (${fc.name}).`,
          evidence,
          turnsUsed,
          toolCallsUsed,
          totalTokens,
          durationMs: Date.now() - startedAt,
          error: `تم إيقاف حلقة Function Calling متكررة للأداة (${fc.name}).`,
          errorCode: "LOOP_DETECTED",
        };
      }

      toolCallsUsed += 1;
      const executedAt = new Date().toISOString();

      // التنفيذ الحصري عبر محرك الأدوات الآمن بهوية الوكيل المثبتة خادمياً فقط
      const toolResult = await executeRegisteredTool(
        {
          agentRole: lockedRole,
          agentId: lockedAgentId,
          agentName: lockedAgentName,
          taskId: params.taskId ?? null,
          delegatedByRole: params.delegatedByRole ?? null,
          // لا يُمرَّر approvalGranted من النموذج أبداً
          approvalGranted: false,
          approvalId: null,
          auditLogger: params.auditLogger,
          readOnlyDataProvider: params.readOnlyDataProvider,
          projectRoot: params.projectRoot,
        },
        fc.name,
        fc.arguments
      );

      const isVerifiedCall =
        toolResult.ok === true && toolResult.outcome === "success";

      evidence.push({
        toolId: fc.name,
        agentRole: lockedRole,
        agentName: lockedAgentName,
        sanitizedInput: sanitizeArgsForEvidence(fc.arguments),
        outcome: toolResult.outcome,
        verified: isVerifiedCall,
        dataSource: inferDataSource(fc.name),
        resultSummary: summarizeToolResult(toolResult),
        executedAt,
        durationMs: toolResult.durationMs,
        error: toolResult.ok ? undefined : sanitizeTextForAudit(toolResult.error, 200),
        errorCode: toolResult.errorCode,
      });

      const resultPayload = isVerifiedCall
        ? { ok: true, verified: true, data: toolResult.data }
        : {
            ok: false,
            verified: false,
            outcome: toolResult.outcome,
            errorCode: toolResult.errorCode,
            error: sanitizeTextForAudit(toolResult.error, 200),
          };

      history.push({
        type: "function_result",
        name: fc.name,
        call_id: fc.callId,
        result: JSON.stringify(resultPayload),
      } as Interactions.Step);
    }
  }

  // إذا انتهت الجولات دون نص نهائي
  if (!finalText && turnsUsed >= maxTurns) {
    return {
      ok: false,
      agentRole: lockedRole,
      agentName: lockedAgentName,
      text: "",
      verified: false,
      verificationReason: `بلغ الوكيل الحد الأقصى للجولات (${maxTurns}) دون إنتاج نتيجة نهائية.`,
      evidence,
      turnsUsed,
      toolCallsUsed,
      totalTokens,
      durationMs: Date.now() - startedAt,
      error: `تم إيقاف التنفيذ بعد بلوغ الحد الأقصى لجولات Function Calling (${maxTurns}).`,
      errorCode: "MAX_TURNS_EXCEEDED",
    };
  }

  // التحقق من الأدلة (الخطوة السادسة): لا تُعتمد النتيجة لمجرد نص إن كانت تتطلب دليل أداة
  const verifiedCallsCount = evidence.filter((e) => e.verified).length;
  const requireEvidence = params.requireToolEvidence ?? false;
  const isVerified =
    Boolean(finalText) && (!requireEvidence || verifiedCallsCount > 0);

  if (!isVerified) {
    return {
      ok: false,
      agentRole: lockedRole,
      agentName: lockedAgentName,
      text: finalText,
      verified: false,
      verificationReason:
        !finalText
          ? "النموذج لم يُعد مخرجات نصية قابلة للتحقق."
          : "الخطوة تتطلب دليل تنفيذ أداة موثّق واحد على الأقل، ولم ينجح أي استدعاء أداة.",
      evidence,
      turnsUsed,
      toolCallsUsed,
      totalTokens,
      durationMs: Date.now() - startedAt,
      error: "تعذر اعتماد نتيجة الوكيل لغياب دليل التنفيذ الموثّق.",
      errorCode: "UNVERIFIED_OUTPUT",
    };
  }

  const handoffProposal = extractHandoffProposal(finalText);

  return {
    ok: true,
    agentRole: lockedRole,
    agentName: lockedAgentName,
    text: finalText,
    verified: true,
    verificationReason:
      verifiedCallsCount > 0
        ? `تم التحقق بنجاح مع ${verifiedCallsCount} دليل تنفيذ أداة موثّق.`
        : "تم التحقق من المخرجات النصية للخطوة.",
    evidence,
    handoffProposal,
    turnsUsed,
    toolCallsUsed,
    totalTokens,
    durationMs: Date.now() - startedAt,
  };
}
