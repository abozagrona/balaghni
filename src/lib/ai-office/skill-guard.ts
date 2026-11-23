// =============================================================================
// بَلِّغْنِي | BALAGHNI — حارس الصلاحيات والمهارات الخادمي (Server-Side Agent & Skill Guard)
// يفرض قيود الصلاحيات برمجياً على الخادم بعيداً عن system_prompt:
// 1. مصفوفة الأدوات المسموحة لكل وكيل (لا يستطيع رامي تجاوزها بالتفويض).
// 2. منع طارق (skills_architect) من تعديل قواعد الأمان أو صلاحيات نفسه أو أي موظف آخر.
// 3. منع حقن التعليمات (Prompt Injection) وتجاوز الموافقات عبر المهارات.
// =============================================================================

export type GovernedAgentRole =
  | "orchestrator"
  | "principal_architect"
  | "skills_architect"
  | "operations"
  | "support"
  | "marketing"
  | "finance"
  | "qa_testing"
  | "data_analytics"
  | "integrations"
  | "privacy_compliance";

export const SERVER_AGENT_TOOL_ALLOWLIST: Record<
  GovernedAgentRole,
  readonly string[]
> = Object.freeze({
  orchestrator: Object.freeze([
    "analyze_command",
    "delegate_task",
    "aggregate_reports",
    "request_approval",
  ]),
  principal_architect: Object.freeze([
    "inspect_codebase",
    "audit_security",
    "propose_patch",
    "github_read",
    "github_create_pr",
  ]),
  skills_architect: Object.freeze([
    "research_skills",
    "analyze_agent_performance",
    "propose_skill_draft",
  ]),
  operations: Object.freeze([
    "read_orders",
    "read_tags",
    "read_subscriptions",
    "read_maintenance_reminders",
    "generate_ops_report",
  ]),
  support: Object.freeze([
    "read_support_context",
    "draft_customer_reply",
    "review_message_templates",
  ]),
  marketing: Object.freeze([
    "draft_marketing_copy",
    "plan_content_calendar",
    "read_campaign_metrics",
  ]),
  finance: Object.freeze([
    "read_orders",
    "read_subscriptions",
    "read_vendor_settlements",
    "generate_financial_report",
  ]),
  qa_testing: Object.freeze([
    "run_health_checks",
    "read_error_events",
    "verify_api_endpoints",
    "create_bug_report",
  ]),
  data_analytics: Object.freeze([
    "read_analytics_aggregates",
    "read_tags_stats",
    "read_orders_stats",
    "read_reports_stats",
    "generate_analytics_report",
  ]),
  integrations: Object.freeze([
    "test_integrations",
    "read_twilio_status",
    "read_messaging_metrics",
    "inspect_webhooks",
  ]),
  privacy_compliance: Object.freeze([
    "audit_rls_policies",
    "audit_admin_permissions",
    "read_audit_logs",
    "generate_compliance_report",
  ]),
});

/**
 * التحقق الخادمي المستقل من صلاحية الوكيل لاستخدام أداة محددة.
 * لا يمكن لرامي (orchestrator) أو أي وكيل آخر منح أداة خارج القائمة المصرح بها للوكيل المستهدف.
 */
export function assertAgentToolAllowed(
  agentRole: string,
  toolName: string,
  delegatedByRole?: string
): { allowed: boolean; reason?: string } {
  const cleanRole = String(agentRole || "").trim() as GovernedAgentRole;
  const cleanTool = String(toolName || "").trim();

  if (!cleanRole || !(cleanRole in SERVER_AGENT_TOOL_ALLOWLIST)) {
    return {
      allowed: false,
      reason: `دور الوكيل غير معروف أو غير مصرح به: ${cleanRole || "empty"}`,
    };
  }

  if (!cleanTool) {
    return { allowed: false, reason: "اسم الأداة مطلوب للتحقق من الصلاحية." };
  }

  const allowlist = SERVER_AGENT_TOOL_ALLOWLIST[cleanRole];
  if (!allowlist.includes(cleanTool)) {
    const delegationHint =
      delegatedByRole && delegatedByRole !== cleanRole
        ? ` (مرفوض حتى عند التفويض من ${delegatedByRole})`
        : "";
    return {
      allowed: false,
      reason: `صلاحية مرفوضة خادمياً: الوكيل (${cleanRole}) غير مصرح له باستخدام الأداة (${cleanTool})${delegationHint}.`,
    };
  }

  return { allowed: true };
}

/**
 * أنماط محظورة في المهارات المقترحة لمنع حقن التعليمات وتجاوز الصلاحيات أو الأمان
 */
const FORBIDDEN_SKILL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /ignore\s+(all\s+)?(previous|prior|system|security)\s+(instructions|rules|prompt)/i,
    reason: "محاولة تجاهل التعليمات الأمنية الأساسية (Prompt Injection).",
  },
  {
    pattern: /تجاهل\s+(كافة|جميع|كل)?\s*(التعليمات|القواعد|القيود)\s*(الأمنية|السابقة|الأساسية)?/i,
    reason: "محاولة تجاهل التعليمات الأمنية الأساسية بالعربية.",
  },
  {
    pattern: /bypass\s+(approval|rls|auth|permission|security|guardrail)/i,
    reason: "محاولة تجاوز نظام الموافقات أو الصلاحيات أو RLS.",
  },
  {
    pattern: /(تجاوز|إلغاء|تعطيل)\s+(الموافقة|الموافقات|نظام الموافقات|الصلاحيات|الحماية|الأمان|سياسات\s*rls)/i,
    reason: "محاولة تجاوز نظام الموافقات أو تعطيل الحماية الأمنية.",
  },
  {
    pattern: /\b(service_role|SUPABASE_SERVICE_ROLE_KEY|ADMIN_MASTER_SECRET|SESSION_HMAC_SECRET|GEMINI_API_KEY)\b/i,
    reason: "محاولة الوصول إلى مفاتيح سرية أو دور service_role.",
  },
  {
    pattern: /\b(allowed_tools|immutable_security_guardrails|admin_profiles|role\s*=\s*['"]?super_admin)\b/i,
    reason: "محاولة تعديل مصفوفة الصلاحيات أو قواعد الأمان الثابتة.",
  },
  {
    pattern: /(تعديل|تغيير|منح|رفع)\s+(صلاحيات|صلاحية|أدوات)\s+(نفسي|نفسه|طارق|رامي|المدير|الفريق|الوكلاء|الموظفين)/i,
    reason: "يُحظر تعديل صلاحيات طارق أو بقية الموظفين عبر المهارات.",
  },
  {
    pattern: /\b(drop\s+table|truncate\s+table|disable\s+row\s+level\s+security|grant\s+all\s+on\s+.*to\s+anon)\b/i,
    reason: "محاولة حقن أوامر SQL هدامة أو فتح RLS للعامة.",
  },
  {
    pattern: /(حذف\s+جدول|حذف\s+بيانات\s+العملاء|نشر\s+مباشر\s+دون\s+موافقة|إرسال\s+حملة\s+جماعية\s+تلقائياً)/i,
    reason: "محاولة تفويض عمليات عالية الخطورة دون موافقة المدير.",
  },
];

export interface SkillValidationResult {
  valid: boolean;
  reason?: string;
  sanitizedName?: string;
  sanitizedDescription?: string;
  sanitizedInstructions?: string;
}

/**
 * التحقق الخادمي الصارم من سلامة أي مهارة قبل حفظها أو تفعيلها.
 * يُمنع طارق من تعديل نفسه أو قواعد الأمان أو حقن تعليمات تتجاوز الصلاحيات.
 */
export function validateSkillProposal(input: {
  skillName: string;
  targetAgentRole: string;
  description?: string;
  skillInstructions: string;
}): SkillValidationResult {
  const targetRole = String(input.targetAgentRole || "").trim().toLowerCase();
  const cleanName = String(input.skillName || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 140);
  const cleanDesc = String(input.description || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 400);
  const cleanInstructions = String(input.skillInstructions || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, 1500);

  if (!cleanName || !cleanInstructions) {
    return {
      valid: false,
      reason: "اسم المهارة وتعليماتها مطلوبان ولا يمكن أن يكونا فارغين.",
    };
  }

  // منع طارق من تعديل قواعد أمانه أو تعليماته الخاصة لتفادي التصعيد الذاتي
  if (targetRole === "skills_architect") {
    return {
      valid: false,
      reason:
        "مرفوض أمنياً: لا يُسمح لطارق (skills_architect) بتعديل تعليماته أو صلاحياته الذاتية.",
    };
  }

  const combinedText = `${cleanName}\n${cleanDesc}\n${cleanInstructions}`;
  for (const rule of FORBIDDEN_SKILL_PATTERNS) {
    if (rule.pattern.test(combinedText)) {
      return {
        valid: false,
        reason: `مرفوض أمنياً: ${rule.reason}`,
      };
    }
  }

  return {
    valid: true,
    sanitizedName: cleanName,
    sanitizedDescription: cleanDesc,
    sanitizedInstructions: cleanInstructions,
  };
}

/**
 * دمج قواعد الأمان الثابتة بأعلى أولوية بعد system_prompt بحيث لا تستطيع أي مهارة تجاوزها
 */
export function buildProtectedAgentSystemPrompt(
  basePrompt: string,
  immutableGuardrails: string
): string {
  const cleanGuard = String(immutableGuardrails || "").trim();
  if (!cleanGuard) return basePrompt;
  return `${basePrompt}\n\n[قواعد أمان ثابتة غير قابلة للتجاوز — أولوية قصوى]:\n${cleanGuard}`;
}
