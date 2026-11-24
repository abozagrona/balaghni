// =============================================================================
// بَلِّغْنِي | BALAGHNI — محرك الأدوات الآمن للوكلاء الذكيين (AI Office Tool Registry)
// المرحلة A: سجل مركزي للأدوات + فحص الصلاحيات الخادمي + منع تصعيد الصلاحيات +
// تدقيق إلزامي في public.ai_audit_logs + عزل كامل عن SQL العشوائي والأسرار والرسائل الحقيقية.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase/client";
import {
  assertAgentToolAllowed,
  SERVER_AGENT_TOOL_ALLOWLIST,
  validateSkillProposal,
  type GovernedAgentRole,
} from "@/lib/ai-office/skill-guard";

// =============================================================================
// 1. الأنواع الأساسية (Core Types)
// =============================================================================

/** مستوى الخطورة المتوافق مع قيد CHECK في public.ai_audit_logs */
export type ToolRiskLevel = "low" | "medium" | "high";

/** نتيجة التدقيق المتوافقة مع قيد CHECK في public.ai_audit_logs */
export type ToolAuditOutcome = "success" | "blocked" | "failed" | "pending";

export interface ToolFieldSchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  required?: boolean;
  description: string;
}

export interface ToolSchemaDescriptor {
  type: "object";
  properties: Record<string, ToolFieldSchema>;
}

/**
 * سياق التنفيذ الخادمي الموثوق (يُمرَّر من الخادم فقط ولا يُؤخذ أبداً من مدخلات الأداة).
 */
export interface ToolExecutionContext {
  agentRole: GovernedAgentRole | string;
  agentId?: string | null;
  agentName?: string | null;
  taskId?: string | null;
  delegatedByRole?: string | null;
  /** يُضبط حصراً بعد التحقق الخادمي من سجل موافقة معتمد في ai_task_approvals */
  approvalGranted?: boolean;
  /** UUID سجل الموافقة في public.ai_task_approvals (اختياري) */
  approvalId?: string | null;
  /**
   * مُتحقّق خادمي ذري من سجل الموافقة في ai_task_approvals.
   * بدون هذا المتحقق لا يُسمح بتنفيذ أي أداة requiresApproval حتى لو مُرر approvalGranted وUUID.
   */
  approvalVerifier?: (params: {
    approvalId: string;
    taskId: string | null;
    agentRole: GovernedAgentRole;
    toolId: string;
    input: Record<string, unknown>;
  }) => Promise<{ verified: boolean; reason?: string }>;
  /** مُسجّل تدقيق اختياري قابل للحقن في الاختبارات المحلية */
  auditLogger?: ToolAuditLogger;
  /** مزود بيانات للقراءة فقط قابل للحقن في الاختبارات المحلية */
  readOnlyDataProvider?: ToolReadOnlyDataProvider;
  /** جذر المشروع لأداة inspect_codebase (اختياري للاختبارات) */
  projectRoot?: string;
}

export interface ToolHandlerContext {
  agentRole: GovernedAgentRole;
  agentId: string | null;
  agentName: string;
  taskId: string | null;
  readOnlyDataProvider: ToolReadOnlyDataProvider;
  projectRoot: string;
}

export interface ToolDefinition<
  TInput extends Record<string, unknown> = Record<string, unknown>,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly allowedRoles: readonly GovernedAgentRole[];
  readonly riskLevel: ToolRiskLevel;
  readonly requiresApproval: boolean;
  readonly readOnly: boolean;
  readonly inputSchema: ToolSchemaDescriptor;
  readonly outputSchema: ToolSchemaDescriptor;
  readonly validateInput: (
    raw: Record<string, unknown>
  ) => { valid: true; value: TInput } | { valid: false; reason: string };
  readonly handler: (
    input: TInput,
    ctx: ToolHandlerContext
  ) => Promise<TOutput>;
}

export interface ToolAuditLogEntry {
  actor_type: "agent" | "system" | "admin";
  actor_id: string | null;
  actor_name: string;
  action: string;
  resource_type: "ai_tool";
  resource_id: string;
  risk_level: ToolRiskLevel;
  approval_id: string | null;
  outcome: ToolAuditOutcome;
  metadata: Record<string, unknown>;
}

export type ToolAuditLogger = (
  entry: ToolAuditLogEntry
) => Promise<{ logged: boolean; error?: string }>;

export interface ToolExecutionResult<
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  ok: boolean;
  toolId: string;
  outcome: ToolAuditOutcome;
  data?: TOutput;
  error?: string;
  errorCode?:
    | "UNREGISTERED_TOOL"
    | "UNAUTHORIZED_ROLE"
    | "APPROVAL_REQUIRED"
    | "INVALID_INPUT"
    | "PRIVILEGE_ESCALATION_BLOCKED"
    | "EXECUTION_FAILED";
  auditLogged: boolean;
  durationMs: number;
}

export interface ToolReadOnlyDataProvider {
  readOrdersSummary: (limit: number) => Promise<Record<string, unknown>>;
  readTagsSummary: (limit: number) => Promise<Record<string, unknown>>;
  readSubscriptionsSummary: (limit: number) => Promise<Record<string, unknown>>;
  readMaintenanceRemindersSummary: (
    limit: number
  ) => Promise<Record<string, unknown>>;
  readSupportContextSummary: (limit: number) => Promise<Record<string, unknown>>;
  readAuditLogsSummary: (limit: number) => Promise<Record<string, unknown>>;
  readAgentPerformanceSummary: () => Promise<Record<string, unknown>>;
}

// =============================================================================
// 2. ثوابت الحماية ومنع التصعيد وتسريب الأسرار (Security Constants)
// =============================================================================

/**
 * حقول محظورة في مدخلات الأداة لمنع محاولات تصعيد الصلاحيات أو تجاوز الموافقات أو حقن SQL/أسرار.
 */
const FORBIDDEN_INPUT_KEYS = new Set<string>([
  "agentRole",
  "agent_role",
  "role",
  "delegatedByRole",
  "delegated_by_role",
  "approvalGranted",
  "approval_granted",
  "approvalId",
  "approval_id",
  "bypassApproval",
  "bypass_approval",
  "forceAllow",
  "force_allow",
  "overrideRole",
  "override_role",
  "sql",
  "rawSql",
  "raw_sql",
  "querySql",
  "processEnv",
  "env",
  "serviceRoleKey",
  "__proto__",
  "constructor",
  "prototype",
]);

/** أنماط SQL عشوائية أو محاولات قراءة متغيرات البيئة المحظورة في أي مدخل نصي */
const DANGEROUS_INPUT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\b(select\s+.*\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from|drop\s+table|truncate\s+table|alter\s+table|grant\s+all|revoke\s+all|create\s+policy)\b/i,
    reason: "مرفوض أمنياً: يُحظر تمرير أوامر SQL عشوائية عبر أدوات الوكلاء.",
  },
  {
    pattern:
      /\b(process\.env|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|ADMIN_MASTER_SECRET|SESSION_HMAC_SECRET|GEMINI_API_KEY|TWILIO_AUTH_TOKEN|RESALA_API_KEY|META_WHATSAPP_ACCESS_TOKEN|POSTGRES_URL)\b/i,
    reason: "مرفوض أمنياً: يُحظر طلب أو تمرير أسرار البيئة ومفاتيح الخدمة.",
  },
];

/** أنماط لتنقية رسائل الأخطاء ومخرجات التدقيق من أي أسرار محتملة */
const SECRET_REDACTION_PATTERNS: RegExp[] = [
  /sb_secret_[A-Za-z0-9_\-]+/g,
  /eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g,
  /postgres(?:ql)?:\/\/[^\s"'`]+/gi,
  /(Bearer\s+)[A-Za-z0-9._\-]{16,}/gi,
  /((?:api[_-]?key|secret|token|password|passwd|auth[_-]?token)\s*[:=]\s*["']?)[^\s"',;}{]+/gi,
];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** المجلدات المسموح بقراءتها فقط في أداة inspect_codebase */
const ALLOWED_INSPECT_PREFIXES = ["src/", "supabase/migrations/"] as const;

/** أنماط أسماء الملفات المحظور قراءتها دائماً */
const BLOCKED_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /\.(pem|key|p12|pfx|crt|cer|jks|sqlite|db)$/i,
  /(secret|credential|private[_-]?key|id_rsa)/i,
];

export function sanitizeTextForAudit(value: unknown, maxLen = 300): string {
  let text = String(value ?? "");
  for (const pattern of SECRET_REDACTION_PATTERNS) {
    text = text.replace(pattern, "[REDACTED]");
  }
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLen);
}

function sanitizeInputKeysForMetadata(
  raw: unknown
): Record<string, string | number | boolean | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const summary: Record<string, string | number | boolean | null> = {};
  const entries = Object.entries(raw as Record<string, unknown>).slice(0, 12);
  for (const [k, v] of entries) {
    const safeKey = sanitizeTextForAudit(k, 40);
    if (!safeKey) continue;
    if (FORBIDDEN_INPUT_KEYS.has(k)) {
      summary[safeKey] = "[BLOCKED_KEY]";
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) {
      summary[safeKey] = v;
    } else if (typeof v === "string") {
      summary[safeKey] = sanitizeTextForAudit(v, 80);
    } else {
      summary[safeKey] = `[${Array.isArray(v) ? "array" : typeof v}]`;
    }
  }
  return summary;
}

function detectInputTampering(
  raw: unknown
): { blocked: true; reason: string } | { blocked: false; record: Record<string, unknown> } {
  if (raw === undefined || raw === null) {
    return { blocked: false, record: {} };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      blocked: true,
      reason: "مدخلات الأداة يجب أن تكون كائناً (JSON Object) صالحاً.",
    };
  }

  const visited = new Set<unknown>();
  const stack: unknown[] = [raw];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        if (typeof item === "string") {
          for (const rule of DANGEROUS_INPUT_PATTERNS) {
            if (rule.pattern.test(item)) {
              return { blocked: true, reason: rule.reason };
            }
          }
        } else if (item && typeof item === "object") {
          stack.push(item);
        }
      }
      continue;
    }

    for (const key of Object.keys(current as Record<string, unknown>)) {
      if (FORBIDDEN_INPUT_KEYS.has(key)) {
        return {
          blocked: true,
          reason: `مرفوض أمنياً: الحقل المحظور (${key}) غير مسموح به في مدخلات الأداة لمنع تصعيد الصلاحيات أو حقن SQL.`,
        };
      }
      const val = (current as Record<string, unknown>)[key];
      if (typeof val === "string") {
        for (const rule of DANGEROUS_INPUT_PATTERNS) {
          if (rule.pattern.test(val)) {
            return { blocked: true, reason: rule.reason };
          }
        }
      } else if (val && typeof val === "object") {
        stack.push(val);
      }
    }
  }

  return { blocked: false, record: raw as Record<string, unknown> };
}

function parseBoundedLimit(
  raw: unknown,
  defaultLimit = 20,
  maxLimit = 50
): { valid: true; value: number } | { valid: false; reason: string } {
  if (raw === undefined || raw === null) {
    return { valid: true, value: defaultLimit };
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > maxLimit) {
    return {
      valid: false,
      reason: `قيمة limit يجب أن تكون عدداً صحيحاً بين 1 و ${maxLimit}.`,
    };
  }
  return { valid: true, value: n };
}

// =============================================================================
// 3. مسجل التدقيق الافتراضي في public.ai_audit_logs (Append-Only)
// =============================================================================

export const defaultAiAuditLogger: ToolAuditLogger = async (entry) => {
  try {
    const payload = {
      actor_type: entry.actor_type,
      actor_id: entry.actor_id,
      actor_name: sanitizeTextForAudit(entry.actor_name, 120) || "unknown_agent",
      action: sanitizeTextForAudit(entry.action, 120),
      resource_type: entry.resource_type,
      resource_id: sanitizeTextForAudit(entry.resource_id, 120),
      risk_level: entry.risk_level,
      approval_id:
        entry.approval_id && UUID_REGEX.test(entry.approval_id)
          ? entry.approval_id
          : null,
      outcome: entry.outcome,
      metadata: entry.metadata ?? {},
    };

    const { error } = await supabaseAdmin
      .from("ai_audit_logs")
      .insert(payload);

    if (error) {
      return {
        logged: false,
        error: sanitizeTextForAudit(error.message, 180),
      };
    }
    return { logged: true };
  } catch (err) {
    return {
      logged: false,
      error: sanitizeTextForAudit(
        err instanceof Error ? err.message : String(err),
        180
      ),
    };
  }
};

// =============================================================================
// 4. مزود البيانات للقراءة فقط عبر supabaseAdmin (بدون PII أو SQL عشوائي)
// =============================================================================

export const defaultReadOnlyDataProvider: ToolReadOnlyDataProvider = {
  async readOrdersSummary(limit) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id, order_code, status, payment_status, payment_method, city, tier, quantity, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`orders_read_failed: ${error.message}`);
    const rows = data || [];
    const byStatus: Record<string, number> = {};
    const byPaymentStatus: Record<string, number> = {};
    for (const r of rows) {
      const st = String((r as { status?: string }).status || "unknown");
      byStatus[st] = (byStatus[st] || 0) + 1;
      const ps = String(
        (r as { payment_status?: string }).payment_status || "unknown"
      );
      byPaymentStatus[ps] = (byPaymentStatus[ps] || 0) + 1;
    }
    return {
      count: rows.length,
      hasData: rows.length > 0,
      byStatus,
      byPaymentStatus,
      recent: rows,
    };
  },

  async readTagsSummary(limit) {
    const { data, error } = await supabaseAdmin
      .from("tags")
      .select("id, tag_code, status, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`tags_read_failed: ${error.message}`);
    const rows = data || [];
    const byStatus: Record<string, number> = {};
    for (const r of rows) {
      const st = String((r as { status?: string }).status || "unknown");
      byStatus[st] = (byStatus[st] || 0) + 1;
    }
    return { count: rows.length, hasData: rows.length > 0, byStatus, recent: rows };
  },

  async readSubscriptionsSummary(limit) {
    const { data, error } = await supabaseAdmin
      .from("tags")
      .select("id, status, subscription_expires_at")
      .order("subscription_expires_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`subscriptions_read_failed: ${error.message}`);
    const rows = data || [];
    const now = Date.now();
    let activeCount = 0;
    let expiredCount = 0;
    for (const r of rows) {
      const exp = (r as { subscription_expires_at?: string | null })
        .subscription_expires_at;
      if (exp && new Date(exp).getTime() > now) activeCount += 1;
      else expiredCount += 1;
    }
    return {
      sampled: rows.length,
      hasData: rows.length > 0,
      activeCount,
      expiredCount,
    };
  },

  async readMaintenanceRemindersSummary(limit) {
    // الجدول الفعلي المعتمد في مخطط Supabase هو public.maintenance_records (بدون بيانات شخصية أو ملاحظات حرة)
    const { data, error } = await supabaseAdmin
      .from("maintenance_records")
      .select("id, tag_code, service_type, service_date, mileage_km, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      throw new Error(`maintenance_read_failed: ${error.message}`);
    }
    const rows = data || [];
    const byServiceType: Record<string, number> = {};
    for (const r of rows) {
      const st = String(
        (r as { service_type?: string }).service_type || "unknown"
      );
      byServiceType[st] = (byServiceType[st] || 0) + 1;
    }
    return {
      sourceTable: "maintenance_records",
      count: rows.length,
      hasData: rows.length > 0,
      byServiceType,
      recent: rows,
    };
  },

  async readSupportContextSummary(limit) {
    // قراءة الأعمدة الفعلية غير الشخصية فقط من public.reports (بدون reporter_phone أو message أو location أو photo_url)
    const { data, error } = await supabaseAdmin
      .from("reports")
      .select(
        "id, tag_code, reason_title, reason_badge, icon_type, whatsapp_status, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`support_context_read_failed: ${error.message}`);
    const rows = data || [];
    const byDeliveryStatus: Record<string, number> = {};
    const byReason: Record<string, number> = {};
    for (const r of rows) {
      const ds = String(
        (r as { whatsapp_status?: string | null }).whatsapp_status || "unknown"
      );
      byDeliveryStatus[ds] = (byDeliveryStatus[ds] || 0) + 1;
      const reason = String(
        (r as { reason_title?: string | null }).reason_title || "غير محدد"
      );
      byReason[reason] = (byReason[reason] || 0) + 1;
    }
    return {
      sourceTable: "reports",
      count: rows.length,
      hasData: rows.length > 0,
      byDeliveryStatus,
      byReason,
      recentReports: rows,
    };
  },

  async readAuditLogsSummary(limit) {
    const { data, error } = await supabaseAdmin
      .from("ai_audit_logs")
      .select(
        "id, actor_type, actor_name, action, resource_type, resource_id, risk_level, outcome, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`audit_logs_read_failed: ${error.message}`);
    const rows = data || [];
    return { count: rows.length, logs: rows };
  },

  async readAgentPerformanceSummary() {
    const { data: agents, error: agentsErr } = await supabaseAdmin
      .from("ai_agents")
      .select("id, name, role, status");
    if (agentsErr) throw new Error(`agents_read_failed: ${agentsErr.message}`);

    const { data: tasks, error: tasksErr } = await supabaseAdmin
      .from("agent_tasks")
      .select("id, assigned_to, status, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (tasksErr) throw new Error(`tasks_read_failed: ${tasksErr.message}`);

    const taskByStatus: Record<string, number> = {};
    for (const t of tasks || []) {
      const st = String((t as { status?: string }).status || "unknown");
      taskByStatus[st] = (taskByStatus[st] || 0) + 1;
    }
    return {
      agentsCount: (agents || []).length,
      recentTasksCount: (tasks || []).length,
      taskByStatus,
    };
  },
};

// =============================================================================
// 5. تعريف الأدوات المسجلة في المرحلة A (Read-Only / Safe Draft / Approval-Gated)
// =============================================================================

const REGISTERED_TOOL_LIST_ITEMS: ToolDefinition[] = [
  // 1. read_orders (operations, finance)
  {
    id: "read_orders",
    name: "قراءة ملخص الطلبات",
    description:
      "قراءة ملخص الطلبات الحديثة وحالاتها بدون بيانات شخصية حساسة (للقراءة فقط).",
    allowedRoles: Object.freeze(["operations", "finance"]),
    riskLevel: "low",
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          required: false,
          description: "عدد السجلات المطلوبة (1 إلى 50، الافتراضي 20).",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "عدد الطلبات المسترجعة." },
        byStatus: { type: "object", description: "توزيع الطلبات حسب الحالة." },
        recent: { type: "array", description: "ملخص الطلبات الأحدث." },
      },
    },
    validateInput(raw) {
      const lim = parseBoundedLimit(raw.limit, 20, 50);
      if (!lim.valid) return lim;
      return { valid: true, value: { limit: lim.value } };
    },
    async handler(input, ctx) {
      return ctx.readOnlyDataProvider.readOrdersSummary(Number(input.limit));
    },
  },

  // 2. read_tags (operations)
  {
    id: "read_tags",
    name: "قراءة ملخص الملصقات",
    description:
      "قراءة ملخص ملصقات QR وحالاتها بدون كشف أرقام الهواتف (للقراءة فقط).",
    allowedRoles: Object.freeze(["operations"]),
    riskLevel: "low",
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          required: false,
          description: "عدد السجلات المطلوبة (1 إلى 50، الافتراضي 20).",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "عدد الملصقات المسترجعة." },
        byStatus: { type: "object", description: "توزيع الملصقات حسب الحالة." },
        recent: { type: "array", description: "ملخص الملصقات الأحدث." },
      },
    },
    validateInput(raw) {
      const lim = parseBoundedLimit(raw.limit, 20, 50);
      if (!lim.valid) return lim;
      return { valid: true, value: { limit: lim.value } };
    },
    async handler(input, ctx) {
      return ctx.readOnlyDataProvider.readTagsSummary(Number(input.limit));
    },
  },

  // 3. read_subscriptions (operations, finance)
  {
    id: "read_subscriptions",
    name: "قراءة ملخص الاشتراكات",
    description:
      "قراءة إحصاءات الاشتراكات النشطة والمنتهية بدون تعديل أو كشف بيانات شخصية.",
    allowedRoles: Object.freeze(["operations", "finance"]),
    riskLevel: "low",
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          required: false,
          description: "حجم العينة (1 إلى 50، الافتراضي 30).",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        sampled: { type: "number", description: "عدد السجلات المفحوصة." },
        activeCount: { type: "number", description: "عدد الاشتراكات النشطة." },
        expiredCount: { type: "number", description: "عدد الاشتراكات المنتهية." },
      },
    },
    validateInput(raw) {
      const lim = parseBoundedLimit(raw.limit, 30, 50);
      if (!lim.valid) return lim;
      return { valid: true, value: { limit: lim.value } };
    },
    async handler(input, ctx) {
      return ctx.readOnlyDataProvider.readSubscriptionsSummary(
        Number(input.limit)
      );
    },
  },

  // 4. read_maintenance_reminders (operations)
  {
    id: "read_maintenance_reminders",
    name: "قراءة تذكيرات الصيانة",
    description: "قراءة ملخص تذكيرات خدمة نبّهني وحالاتها (للقراءة فقط).",
    allowedRoles: Object.freeze(["operations"]),
    riskLevel: "low",
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          required: false,
          description: "عدد السجلات المطلوبة (1 إلى 50، الافتراضي 20).",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "عدد التذكيرات المسترجعة." },
        recent: { type: "array", description: "ملخص التذكيرات الأحدث." },
      },
    },
    validateInput(raw) {
      const lim = parseBoundedLimit(raw.limit, 20, 50);
      if (!lim.valid) return lim;
      return { valid: true, value: { limit: lim.value } };
    },
    async handler(input, ctx) {
      return ctx.readOnlyDataProvider.readMaintenanceRemindersSummary(
        Number(input.limit)
      );
    },
  },

  // 5. read_support_context (support)
  {
    id: "read_support_context",
    name: "قراءة سياق الدعم والبلاغات",
    description:
      "قراءة ملخص البلاغات الحديثة لفهم سياق الدعم الفني بدون كشف أرقام هواتف.",
    allowedRoles: Object.freeze(["support"]),
    riskLevel: "low",
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          required: false,
          description: "عدد السجلات المطلوبة (1 إلى 50، الافتراضي 15).",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "عدد البلاغات المسترجعة." },
        recentReports: { type: "array", description: "ملخص البلاغات الأحدث." },
      },
    },
    validateInput(raw) {
      const lim = parseBoundedLimit(raw.limit, 15, 50);
      if (!lim.valid) return lim;
      return { valid: true, value: { limit: lim.value } };
    },
    async handler(input, ctx) {
      return ctx.readOnlyDataProvider.readSupportContextSummary(
        Number(input.limit)
      );
    },
  },

  // 6. draft_customer_reply (support) — مسودة فقط، لا يرسل أي رسالة
  {
    id: "draft_customer_reply",
    name: "إعداد مسودة رد للعميل",
    description:
      "توليد مسودة رد منسقة للعميل للمراجعة الإدارية فقط (لا يرسل أي رسالة WhatsApp أو SMS).",
    allowedRoles: Object.freeze(["support"]),
    riskLevel: "low",
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          required: true,
          description: "موضوع الاستفسار أو الشكوى.",
        },
        draftBody: {
          type: "string",
          required: true,
          description: "نص المسودة المقترحة.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        draftOnly: { type: "boolean", description: "تأكيد أنها مسودة فقط." },
        sent: { type: "boolean", description: "دائماً false في المرحلة A." },
        topic: { type: "string", description: "موضوع الرد." },
        draftBody: { type: "string", description: "نص المسودة المنقحة." },
      },
    },
    validateInput(raw) {
      const topic = sanitizeTextForAudit(raw.topic, 120);
      const draftBody = sanitizeTextForAudit(raw.draftBody, 1200);
      if (!topic || !draftBody) {
        return {
          valid: false,
          reason: "الحقلان topic و draftBody مطلوبان لإعداد مسودة الرد.",
        };
      }
      return { valid: true, value: { topic, draftBody } };
    },
    async handler(input) {
      return {
        draftOnly: true,
        sent: false,
        deliveryChannel: "none",
        topic: String(input.topic),
        draftBody: String(input.draftBody),
      };
    },
  },

  // 7. draft_marketing_copy (marketing) — مسودة فقط، لا ينشر ولا يرسل حملات
  {
    id: "draft_marketing_copy",
    name: "إعداد مسودة محتوى تسويقي",
    description:
      "توليد مسودة محتوى تسويقي للمراجعة الإدارية فقط (لا ينشر ولا يرسل حملات جماعية).",
    allowedRoles: Object.freeze(["marketing"]),
    riskLevel: "low",
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        campaignTitle: {
          type: "string",
          required: true,
          description: "عنوان الحملة أو المنشور.",
        },
        copyText: {
          type: "string",
          required: true,
          description: "نص المحتوى التسويقي المقترح.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        draftOnly: { type: "boolean", description: "تأكيد أنها مسودة فقط." },
        published: { type: "boolean", description: "دائماً false في المرحلة A." },
        campaignTitle: { type: "string", description: "عنوان الحملة." },
        copyText: { type: "string", description: "نص المحتوى المنقح." },
      },
    },
    validateInput(raw) {
      const campaignTitle = sanitizeTextForAudit(raw.campaignTitle, 140);
      const copyText = sanitizeTextForAudit(raw.copyText, 1500);
      if (!campaignTitle || !copyText) {
        return {
          valid: false,
          reason: "الحقلان campaignTitle و copyText مطلوبان لإعداد مسودة المحتوى.",
        };
      }
      return { valid: true, value: { campaignTitle, copyText } };
    },
    async handler(input) {
      return {
        draftOnly: true,
        published: false,
        campaignTitle: String(input.campaignTitle),
        copyText: String(input.copyText),
      };
    },
  },

  // 8. inspect_codebase (principal_architect) — قراءة آمنة ومقيدة لمسارات محددة فقط
  {
    id: "inspect_codebase",
    name: "فحص ملف كود مصدر (قراءة آمنة)",
    description:
      "قراءة مقطع محدود من ملف كود مصدر داخل src/ أو supabase/migrations/ فقط (مشروع Next.js App Router؛ أمثلة: src/lib/ai-office/skill-guard.ts، src/lib/ai-office/tool-registry.ts، src/proxy.ts، src/app/api/agents/command/route.ts) مع منع اختراق المسارات والملفات السرية.",
    allowedRoles: Object.freeze(["principal_architect"]),
    riskLevel: "low",
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        relativePath: {
          type: "string",
          required: true,
          description:
            "المسار النسبي الذي يبدأ حصراً بـ src/ أو supabase/migrations/ (مثل src/lib/ai-office/skill-guard.ts أو src/proxy.ts؛ يُرفض أي مسار خارج هذين المجلدين مثل App.tsx أو .env).",
        },
        maxLines: {
          type: "number",
          required: false,
          description: "الحد الأقصى للأسطر المقروءة (1 إلى 120، الافتراضي 60).",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        relativePath: { type: "string", description: "المسار النسبي المفحوص." },
        totalLines: { type: "number", description: "إجمالي أسطر الملف." },
        returnedLines: { type: "number", description: "عدد الأسطر المعادة." },
        content: { type: "string", description: "المحتوى المقروء بعد التنقية." },
      },
    },
    validateInput(raw) {
      const rawPath = String(raw.relativePath ?? "").trim();
      if (!rawPath) {
        return { valid: false, reason: "الحقل relativePath مطلوب." };
      }
      if (
        rawPath.includes("..") ||
        rawPath.includes("\\") ||
        rawPath.startsWith("/") ||
        rawPath.includes("\0")
      ) {
        return {
          valid: false,
          reason: "مرفوض أمنياً: مسار غير آمن أو محاولة اختراق مسار (Path Traversal).",
        };
      }
      const normalized = path.posix.normalize(rawPath);
      const isAllowedPrefix = ALLOWED_INSPECT_PREFIXES.some((prefix) =>
        normalized.startsWith(prefix)
      );
      if (!isAllowedPrefix) {
        return {
          valid: false,
          reason:
            "مرفوض أمنياً: يُسمح بفحص الملفات داخل src/ أو supabase/migrations/ فقط.",
        };
      }
      for (const blocked of BLOCKED_FILE_PATTERNS) {
        if (blocked.test(normalized)) {
          return {
            valid: false,
            reason: "مرفوض أمنياً: يُحظر قراءة ملفات الأسرار أو البيئة أو المفاتيح.",
          };
        }
      }
      const lim = parseBoundedLimit(raw.maxLines, 60, 120);
      if (!lim.valid) return lim;
      return {
        valid: true,
        value: { relativePath: normalized, maxLines: lim.value },
      };
    },
    async handler(input, ctx) {
      const rel = String(input.relativePath);
      const maxLines = Number(input.maxLines);
      const resolvedRoot = fs.realpathSync(ctx.projectRoot);
      const candidatePath = path.resolve(resolvedRoot, rel);
      if (
        !candidatePath.startsWith(resolvedRoot + path.sep) ||
        !fs.existsSync(candidatePath)
      ) {
        throw new Error("الملف المطلوب غير موجود داخل نطاق المشروع المسموح.");
      }
      const realTarget = fs.realpathSync(candidatePath);
      if (!realTarget.startsWith(resolvedRoot + path.sep)) {
        throw new Error("مرفوض أمنياً: الرابط الرمزي يخرج عن نطاق المشروع.");
      }
      const stat = fs.statSync(realTarget);
      if (!stat.isFile()) {
        throw new Error("المسار المطلوب ليس ملفاً قابلاً للقراءة.");
      }
      const rawContent = fs.readFileSync(realTarget, "utf8");
      const allLines = rawContent.split(/\r?\n/);
      const slice = allLines
        .slice(0, maxLines)
        .map((line) => sanitizeTextForAudit(line, 300))
        .join("\n");
      return {
        relativePath: rel,
        totalLines: allLines.length,
        returnedLines: Math.min(allLines.length, maxLines),
        content: slice,
      };
    },
  },

  // 9. read_audit_logs (privacy_compliance)
  {
    id: "read_audit_logs",
    name: "قراءة سجل التدقيق الأمني",
    description:
      "قراءة آخر سجلات public.ai_audit_logs لمراجعة الامتثال والنشاط (للقراءة فقط).",
    allowedRoles: Object.freeze(["privacy_compliance"]),
    riskLevel: "low",
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          required: false,
          description: "عدد السجلات المطلوبة (1 إلى 50، الافتراضي 25).",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "عدد السجلات المسترجعة." },
        logs: { type: "array", description: "قائمة سجلات التدقيق." },
      },
    },
    validateInput(raw) {
      const lim = parseBoundedLimit(raw.limit, 25, 50);
      if (!lim.valid) return lim;
      return { valid: true, value: { limit: lim.value } };
    },
    async handler(input, ctx) {
      return ctx.readOnlyDataProvider.readAuditLogsSummary(Number(input.limit));
    },
  },

  // 10. analyze_agent_performance (skills_architect)
  {
    id: "analyze_agent_performance",
    name: "تحليل أداء فريق الوكلاء",
    description:
      "قراءة إحصاءات أداء الوكلاء وحالات المهام بدون تعديل أي مهارات أو صلاحيات.",
    allowedRoles: Object.freeze(["skills_architect"]),
    riskLevel: "low",
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {},
    },
    outputSchema: {
      type: "object",
      properties: {
        agentsCount: { type: "number", description: "عدد الوكلاء المسجلين." },
        recentTasksCount: { type: "number", description: "عدد المهام الحديثة." },
        taskByStatus: { type: "object", description: "توزيع المهام حسب الحالة." },
      },
    },
    validateInput() {
      return { valid: true, value: {} };
    },
    async handler(_input, ctx) {
      return ctx.readOnlyDataProvider.readAgentPerformanceSummary();
    },
  },

  // 11. analyze_command (orchestrator)
  {
    id: "analyze_command",
    name: "تحليل وتصنيف أمر إداري",
    description:
      "تحليل أمر المدير وتحديد الوكيل المختص المقترح بدون تنفيذ أي عمليات جانبية.",
    allowedRoles: Object.freeze(["orchestrator"]),
    riskLevel: "low",
    requiresApproval: false,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        commandText: {
          type: "string",
          required: true,
          description: "نص الأمر الإداري المراد تحليله.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        suggestedRole: { type: "string", description: "الدور المقترح للتنفيذ." },
        commandLength: { type: "number", description: "طول الأمر بعد التنقية." },
      },
    },
    validateInput(raw) {
      const commandText = sanitizeTextForAudit(raw.commandText, 800);
      if (!commandText) {
        return { valid: false, reason: "الحقل commandText مطلوب لتحليل الأمر." };
      }
      return { valid: true, value: { commandText } };
    },
    async handler(input) {
      const text = String(input.commandText).toLowerCase();
      let suggestedRole: GovernedAgentRole = "operations";
      if (/أمان|ثغر|كود|sql|rls|معماري|github|pr|تحديث/.test(text)) {
        suggestedRole = "principal_architect";
      } else if (/مهار|تدريب|كفاءة|طارق/.test(text)) {
        suggestedRole = "skills_architect";
      } else if (/عميل|رد|دعم|شكوى|استفسار|بلاغ/.test(text)) {
        suggestedRole = "support";
      } else if (/تسويق|حملة|منشور|إعلان|محتوى/.test(text)) {
        suggestedRole = "marketing";
      } else if (/خصوصية|امتثال|تدقيق/.test(text)) {
        suggestedRole = "privacy_compliance";
      }
      return {
        suggestedRole,
        commandLength: text.length,
      };
    },
  },

  // 12. propose_patch (principal_architect) — يتطلب موافقة إدارية، مسودة فقط في المرحلة A
  {
    id: "propose_patch",
    name: "اقتراح رقعة برمجية (يتطلب موافقة)",
    description:
      "تجهيز مقترح تعديل برمجي للمراجعة الإدارية بعد اعتماد الموافقة (لا يكتب ملفات ولا ينشر على الإنتاج).",
    allowedRoles: Object.freeze(["principal_architect"]),
    riskLevel: "high",
    requiresApproval: true,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        targetFile: {
          type: "string",
          required: true,
          description: "المسار النسبي للملف المستهدف داخل src/.",
        },
        summary: {
          type: "string",
          required: true,
          description: "وصف مختصر للرقعة المقترحة.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        applied: { type: "boolean", description: "دائماً false في المرحلة A." },
        targetFile: { type: "string", description: "الملف المستهدف." },
        summary: { type: "string", description: "ملخص المقترح." },
      },
    },
    validateInput(raw) {
      const targetFile = String(raw.targetFile ?? "").trim();
      const summary = sanitizeTextForAudit(raw.summary, 400);
      if (
        !targetFile ||
        targetFile.includes("..") ||
        !targetFile.startsWith("src/") ||
        !summary
      ) {
        return {
          valid: false,
          reason:
            "يجب تحديد targetFile صالح داخل src/ و summary واضح لاقتراح الرقعة.",
        };
      }
      return { valid: true, value: { targetFile, summary } };
    },
    async handler(input) {
      return {
        applied: false,
        proposalOnly: true,
        targetFile: String(input.targetFile),
        summary: String(input.summary),
      };
    },
  },

  // 13. propose_skill_draft (skills_architect) — يتطلب موافقة ويمر عبر validateSkillProposal
  {
    id: "propose_skill_draft",
    name: "اقتراح مسودة مهارة (يتطلب موافقة)",
    description:
      "فحص وتجهيز مسودة مهارة جديدة لوكيل آخر عبر validateSkillProposal بعد الموافقة (لا يفعّل المهارة تلقائياً).",
    allowedRoles: Object.freeze(["skills_architect"]),
    riskLevel: "medium",
    requiresApproval: true,
    readOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        skillName: {
          type: "string",
          required: true,
          description: "اسم المهارة المقترحة.",
        },
        targetAgentRole: {
          type: "string",
          required: true,
          description: "دور الوكيل المستهدف (يُحظر skills_architect).",
        },
        skillInstructions: {
          type: "string",
          required: true,
          description: "تعليمات المهارة المقترحة.",
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        activated: { type: "boolean", description: "دائماً false في المرحلة A." },
        skillName: { type: "string", description: "اسم المهارة المنقح." },
        targetAgentRole: { type: "string", description: "الدور المستهدف." },
      },
    },
    validateInput(raw) {
      const check = validateSkillProposal({
        skillName: String(raw.skillName ?? ""),
        targetAgentRole: String(raw.targetAgentRole ?? ""),
        description: String(raw.description ?? ""),
        skillInstructions: String(raw.skillInstructions ?? ""),
      });
      if (!check.valid) {
        return {
          valid: false,
          reason: check.reason || "مسودة المهارة غير صالحة أمنياً.",
        };
      }
      return {
        valid: true,
        value: {
          skillName: check.sanitizedName!,
          targetAgentRole: String(raw.targetAgentRole).trim().toLowerCase(),
          skillInstructions: check.sanitizedInstructions!,
        },
      };
    },
    async handler(input) {
      return {
        activated: false,
        status: "pending_admin_review",
        skillName: String(input.skillName),
        targetAgentRole: String(input.targetAgentRole),
      };
    },
  },
];

const REGISTERED_TOOL_LIST: readonly ToolDefinition[] = Object.freeze(
  REGISTERED_TOOL_LIST_ITEMS
);

/** خريطة السجل المركزي غير القابلة للتعديل */
export const TOOL_REGISTRY: ReadonlyMap<string, ToolDefinition> = new Map(
  REGISTERED_TOOL_LIST.map((tool) => [tool.id, tool])
);

// =============================================================================
// 6. دوال الاستعلام عن السجل (Registry Inspection Helpers)
// =============================================================================

export function getToolDefinition(toolId: string): ToolDefinition | null {
  const cleanId = String(toolId || "").trim();
  return TOOL_REGISTRY.get(cleanId) ?? null;
}

export function listRegisteredTools(): readonly ToolDefinition[] {
  return REGISTERED_TOOL_LIST;
}

export function getRegisteredToolsForRole(
  agentRole: GovernedAgentRole
): readonly ToolDefinition[] {
  const allowlist = SERVER_AGENT_TOOL_ALLOWLIST[agentRole] || [];
  return REGISTERED_TOOL_LIST.filter(
    (tool) =>
      tool.allowedRoles.includes(agentRole) && allowlist.includes(tool.id)
  );
}

// =============================================================================
// 7. بوابة التنفيذ الآمنة المركزية (Centralized Governed Tool Executor)
// =============================================================================

export async function executeRegisteredTool<
  TOutput extends Record<string, unknown> = Record<string, unknown>,
>(
  ctx: ToolExecutionContext,
  toolId: string,
  rawInput: unknown = {}
): Promise<ToolExecutionResult<TOutput>> {
  const startedAt = Date.now();
  const cleanToolId = String(toolId || "").trim();
  const cleanRole = String(ctx.agentRole || "").trim();
  const actorName =
    sanitizeTextForAudit(ctx.agentName || cleanRole || "unknown_agent", 120) ||
    "unknown_agent";
  const auditLogger = ctx.auditLogger ?? defaultAiAuditLogger;
  const dataProvider = ctx.readOnlyDataProvider ?? defaultReadOnlyDataProvider;
  const projectRoot = ctx.projectRoot ?? process.cwd();
  const safeInputMeta = sanitizeInputKeysForMetadata(rawInput);

  const recordAudit = async (params: {
    outcome: ToolAuditOutcome;
    riskLevel: ToolRiskLevel;
    reason?: string;
    extraMeta?: Record<string, unknown>;
  }): Promise<boolean> => {
    const res = await auditLogger({
      actor_type: "agent",
      actor_id: ctx.agentId ?? null,
      actor_name: actorName,
      action: `tool_call:${cleanToolId || "empty"}`,
      resource_type: "ai_tool",
      resource_id: cleanToolId || "unregistered",
      risk_level: params.riskLevel,
      approval_id:
        ctx.approvalGranted && ctx.approvalId && UUID_REGEX.test(ctx.approvalId)
          ? ctx.approvalId
          : null,
      outcome: params.outcome,
      metadata: {
        agent_role: cleanRole || "empty",
        delegated_by_role: ctx.delegatedByRole ?? null,
        task_id: ctx.taskId ?? null,
        input_summary: safeInputMeta,
        reason: params.reason ? sanitizeTextForAudit(params.reason, 240) : null,
        duration_ms: Date.now() - startedAt,
        ...(params.extraMeta ?? {}),
      },
    });
    return res.logged;
  };

  // الخطوة 1: التحقق من تسجيل الأداة في السجل المركزي
  const tool = TOOL_REGISTRY.get(cleanToolId);
  if (!tool) {
    const reason = `مرفوض أمنياً: الأداة (${cleanToolId || "empty"}) غير مسجلة في السجل المركزي للأدوات.`;
    const auditLogged = await recordAudit({
      outcome: "blocked",
      riskLevel: "high",
      reason,
      extraMeta: { error_code: "UNREGISTERED_TOOL" },
    });
    return {
      ok: false,
      toolId: cleanToolId,
      outcome: "blocked",
      error: reason,
      errorCode: "UNREGISTERED_TOOL",
      auditLogged,
      durationMs: Date.now() - startedAt,
    };
  }

  // الخطوة 2: التحقق الخادمي من صلاحية الوكيل عبر skill-guard.ts + قائمة السجل
  const guardDecision = assertAgentToolAllowed(
    cleanRole,
    tool.id,
    ctx.delegatedByRole ?? undefined
  );
  const roleAllowedInRegistry = tool.allowedRoles.includes(
    cleanRole as GovernedAgentRole
  );

  if (!guardDecision.allowed || !roleAllowedInRegistry) {
    const reason =
      guardDecision.reason ||
      `صلاحية مرفوضة: الوكيل (${cleanRole}) غير مصرح له بالأداة (${tool.id}).`;
    const auditLogged = await recordAudit({
      outcome: "blocked",
      riskLevel: tool.riskLevel === "low" ? "medium" : tool.riskLevel,
      reason,
      extraMeta: { error_code: "UNAUTHORIZED_ROLE" },
    });
    return {
      ok: false,
      toolId: tool.id,
      outcome: "blocked",
      error: reason,
      errorCode: "UNAUTHORIZED_ROLE",
      auditLogged,
      durationMs: Date.now() - startedAt,
    };
  }

  // الخطوة 3: فحص التلاعب بالمدخلات ومحاولات تصعيد الصلاحيات وحقن SQL/الأسرار
  const tamperingCheck = detectInputTampering(rawInput);
  if (tamperingCheck.blocked) {
    const auditLogged = await recordAudit({
      outcome: "blocked",
      riskLevel: "high",
      reason: tamperingCheck.reason,
      extraMeta: { error_code: "PRIVILEGE_ESCALATION_BLOCKED" },
    });
    return {
      ok: false,
      toolId: tool.id,
      outcome: "blocked",
      error: tamperingCheck.reason,
      errorCode: "PRIVILEGE_ESCALATION_BLOCKED",
      auditLogged,
      durationMs: Date.now() - startedAt,
    };
  }

  // الخطوة 4: بوابة الموافقة الإدارية الخادمية (لا يكفي approvalGranted أو UUID وحدهما)
  if (tool.requiresApproval) {
    const hasValidApprovalId =
      typeof ctx.approvalId === "string" && UUID_REGEX.test(ctx.approvalId);
    if (!ctx.approvalGranted || !hasValidApprovalId || !ctx.approvalVerifier) {
      const reason = !ctx.approvalVerifier
        ? `الأداة (${tool.id}) تنتظر الموافقة الإدارية: التحقق الخادمي الذري من ai_task_approvals غير متاح حالياً، ولا يكفي approvalGranted أو UUID وحدهما.`
        : `الأداة (${tool.id}) تنتظر الموافقة الإدارية المعتمدة وسجل approvalId صالح قبل التنفيذ.`;
      const auditLogged = await recordAudit({
        outcome: "pending",
        riskLevel: tool.riskLevel,
        reason,
        extraMeta: {
          error_code: "APPROVAL_REQUIRED",
          awaiting_approval: true,
        },
      });
      return {
        ok: false,
        toolId: tool.id,
        outcome: "pending",
        error: reason,
        errorCode: "APPROVAL_REQUIRED",
        auditLogged,
        durationMs: Date.now() - startedAt,
      };
    }

    const verification = await ctx.approvalVerifier({
      approvalId: ctx.approvalId!,
      taskId: ctx.taskId ?? null,
      agentRole: cleanRole as GovernedAgentRole,
      toolId: tool.id,
      input: tamperingCheck.record,
    });
    if (!verification.verified) {
      const reason =
        verification.reason ||
        `تعذر التحقق الخادمي من سجل الموافقة (${ctx.approvalId}) للأداة (${tool.id}).`;
      const auditLogged = await recordAudit({
        outcome: "blocked",
        riskLevel: tool.riskLevel,
        reason,
        extraMeta: { error_code: "APPROVAL_REQUIRED" },
      });
      return {
        ok: false,
        toolId: tool.id,
        outcome: "blocked",
        error: reason,
        errorCode: "APPROVAL_REQUIRED",
        auditLogged,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  // الخطوة 5: التحقق الصارم من مخطط المدخلات الخاص بالأداة
  const validation = tool.validateInput(tamperingCheck.record);
  if (!validation.valid) {
    const auditLogged = await recordAudit({
      outcome: "blocked",
      riskLevel: tool.riskLevel,
      reason: validation.reason,
      extraMeta: { error_code: "INVALID_INPUT" },
    });
    return {
      ok: false,
      toolId: tool.id,
      outcome: "blocked",
      error: validation.reason,
      errorCode: "INVALID_INPUT",
      auditLogged,
      durationMs: Date.now() - startedAt,
    };
  }

  // الخطوة 6: التنفيذ المعزول مع معالجة آمنة للأخطاء وتسجيل التدقيق
  try {
    const output = (await tool.handler(validation.value, {
      agentRole: cleanRole as GovernedAgentRole,
      agentId: ctx.agentId ?? null,
      agentName: actorName,
      taskId: ctx.taskId ?? null,
      readOnlyDataProvider: dataProvider,
      projectRoot,
    })) as TOutput;

    const auditLogged = await recordAudit({
      outcome: "success",
      riskLevel: tool.riskLevel,
      extraMeta: {
        read_only: tool.readOnly,
        requires_approval: tool.requiresApproval,
      },
    });

    return {
      ok: true,
      toolId: tool.id,
      outcome: "success",
      data: output,
      auditLogged,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const safeErr = sanitizeTextForAudit(
      err instanceof Error ? err.message : String(err),
      220
    );
    const auditLogged = await recordAudit({
      outcome: "failed",
      riskLevel: tool.riskLevel,
      reason: safeErr,
      extraMeta: { error_code: "EXECUTION_FAILED" },
    });
    return {
      ok: false,
      toolId: tool.id,
      outcome: "failed",
      error: `تعذر تنفيذ الأداة (${tool.id}): ${safeErr}`,
      errorCode: "EXECUTION_FAILED",
      auditLogged,
      durationMs: Date.now() - startedAt,
    };
  }
}

// =============================================================================
// 7. متحققات الموافقات الإدارية الخادمية (Server-Side Approval Verifiers)
// - تربط الموافقة بالمهمة والأداة والدور والمدخلات وصاحب الصلاحية والمهلة.
// - تمنع إعادة استخدام الموافقة (Anti-Replay) أو استخدامها لمهمة أو مدخلات أخرى.
// - تفشل بالإغلاق الآمن (Fail-Closed) ولا تثق أبداً بمدخلات العميل.
// =============================================================================

export interface TrustedApprovalRecord {
  id: string;
  taskId: string;
  requestedByRole: GovernedAgentRole;
  actionCode: string;
  actionPayload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled" | "executed";
  expiresAt: string;
  decidedByAdminId: string | null;
  executedAt: string | null;
}

function stablePayloadFingerprint(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload || {}).sort();
  const normalized: Record<string, unknown> = {};
  for (const k of keys) {
    normalized[k] = payload[k];
  }
  return JSON.stringify(normalized);
}

/**
 * متحقق موافقات خادمي في الذاكرة للاختبارات المحلية الآمنة بدون كتابة في قاعدة البيانات.
 */
export function createInMemoryApprovalVerifier(
  initialRecords: TrustedApprovalRecord[] = []
) {
  const store = new Map<string, TrustedApprovalRecord>();
  for (const rec of initialRecords) {
    store.set(rec.id, { ...rec });
  }

  const verify: NonNullable<ToolExecutionContext["approvalVerifier"]> = async (
    params
  ) => {
    const rec = store.get(params.approvalId);
    if (!rec) {
      return {
        verified: false,
        reason: "سجل الموافقة غير موجود في المخزن الخادمي الموثوق.",
      };
    }
    if (rec.status !== "approved") {
      return {
        verified: false,
        reason: `حالة الموافقة (${rec.status}) لا تسمح بالتنفيذ.`,
      };
    }
    if (rec.executedAt) {
      return {
        verified: false,
        reason: "تم استخدام هذه الموافقة مسبقاً؛ يُحظر إعادة استخدام الموافقات (Anti-Replay).",
      };
    }
    if (!rec.decidedByAdminId || !rec.decidedByAdminId.trim()) {
      return {
        verified: false,
        reason: "الموافقة تفتقد معرّف المشرف المعتمد (decided_by_admin_id).",
      };
    }
    if (new Date(rec.expiresAt).getTime() <= Date.now()) {
      rec.status = "expired";
      return {
        verified: false,
        reason: "انتهت صلاحية سجل الموافقة قبل التنفيذ.",
      };
    }
    if (!params.taskId || rec.taskId !== params.taskId) {
      return {
        verified: false,
        reason: "الموافقة مرتبطة بمهمة أخرى ولا يجوز استخدامها لهذه المهمة.",
      };
    }
    if (rec.actionCode !== params.toolId) {
      return {
        verified: false,
        reason: "الموافقة مرتبطة بأداة أخرى ولا تطابق الأداة المطلوبة.",
      };
    }
    if (rec.requestedByRole !== params.agentRole) {
      return {
        verified: false,
        reason: "الموافقة مرتبطة بدور وكيل آخر غير الدور المنفّذ.",
      };
    }
    const expectedFp = stablePayloadFingerprint(rec.actionPayload);
    const actualFp = stablePayloadFingerprint(params.input);
    if (expectedFp !== actualFp) {
      return {
        verified: false,
        reason: "مدخلات الأداة لا تطابق المدخلات التي تمت الموافقة عليها.",
      };
    }

    // استهلاك أحادي لمنع إعادة الاستخدام
    rec.executedAt = new Date().toISOString();
    rec.status = "executed";
    return { verified: true };
  };

  return { store, verify };
}

/**
 * متحقق موافقات خادمي مرتبط بجدول public.ai_task_approvals في Supabase.
 * يُفعّل الاستهلاك الذري في القاعدة فقط عند تمرير consumeAtomically: true.
 */
export function createSupabaseApprovalVerifier(options?: {
  consumeAtomically?: boolean;
}): NonNullable<ToolExecutionContext["approvalVerifier"]> {
  return async (params) => {
    if (!params.approvalId || !UUID_REGEX.test(params.approvalId)) {
      return { verified: false, reason: "معرّف الموافقة غير صالح." };
    }
    if (!params.taskId) {
      return {
        verified: false,
        reason: "لا يمكن التحقق من الموافقة دون ربطها بمعرّف مهمة (taskId).",
      };
    }

    const { data, error } = await supabaseAdmin
      .from("ai_task_approvals")
      .select(
        "id, task_id, requested_by_role, action_code, action_payload, status, expires_at, decided_by_admin_id, executed_at"
      )
      .eq("id", params.approvalId)
      .maybeSingle();

    if (error || !data) {
      return {
        verified: false,
        reason: error
          ? `تعذر قراءة سجل الموافقة: ${sanitizeTextForAudit(error.message, 140)}`
          : "سجل الموافقة غير موجود في ai_task_approvals.",
      };
    }

    if (data.status !== "approved") {
      return {
        verified: false,
        reason: `حالة الموافقة الحالية (${String(data.status)}) غير معتمدة للتنفيذ.`,
      };
    }
    if (data.executed_at) {
      return {
        verified: false,
        reason: "هذه الموافقة استُهلكت سابقاً ولا يمكن إعادة استخدامها.",
      };
    }
    if (!data.decided_by_admin_id) {
      return {
        verified: false,
        reason: "الموافقة تفتقد هوية المشرف المعتمد.",
      };
    }
    if (!data.expires_at || new Date(String(data.expires_at)).getTime() <= Date.now()) {
      return { verified: false, reason: "انتهت صلاحية سجل الموافقة." };
    }
    if (String(data.task_id) !== String(params.taskId)) {
      return { verified: false, reason: "الموافقة لا تطابق المهمة الحالية." };
    }
    if (String(data.action_code) !== params.toolId) {
      return { verified: false, reason: "الموافقة لا تطابق الأداة المطلوبة." };
    }
    if (String(data.requested_by_role) !== params.agentRole) {
      return { verified: false, reason: "الموافقة لا تطابق دور الوكيل المنفّذ." };
    }

    const expectedFp = stablePayloadFingerprint(
      (data.action_payload && typeof data.action_payload === "object"
        ? data.action_payload
        : {}) as Record<string, unknown>
    );
    const actualFp = stablePayloadFingerprint(params.input);
    if (expectedFp !== actualFp) {
      return {
        verified: false,
        reason: "مدخلات الأداة لا تطابق الحمولة المعتمدة في سجل الموافقة.",
      };
    }

    if (!options?.consumeAtomically) {
      return {
        verified: false,
        reason:
          "التحقق في وضع القراءة فقط: لا يُسمح بتفعيل التنفيذ الفعلي للأداة الحساسة دون الاستهلاك الذري المعتمد.",
      };
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("ai_task_approvals")
      .update({
        status: "executed",
        executed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", params.approvalId)
      .eq("status", "approved")
      .is("executed_at", null)
      .select("id")
      .maybeSingle();

    if (updateErr || !updated) {
      return {
        verified: false,
        reason:
          "فشل الاستهلاك الذري للموافقة أو تم استهلاكها في طلب متزامن آخر.",
      };
    }

    return { verified: true };
  };
}
