// =============================================================================
// بَلِّغْنِي | BALAGHNI — خدمة الذاكرة السياقية والمعرفة المؤسسية (Memory Service)
// - تستخدم الجداول القائمة فعلياً (public.ai_agent_memory و public.agent_skills) دون أي Migration.
// - تفصل الذاكرة الشخصية لكل موظف عن المعرفة المؤسسية المشتركة المعتمدة (is_reviewed=true).
// - لا تحفظ أي إجابة غير متحقق منها (يشترط verified=true ودليل أداة صالح).
// - تنقي البيانات الشخصية (PII) وتمنع تسرب ذاكرة موظف أو مواطن إلى سياق غير مخول.
// - ترصد المعلومات القديمة أو المتعارضة وتوسمها للمراجعة بدلاً من اعتمادها تلقائياً.
// =============================================================================

import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/client";
import { sanitizeTextForAudit } from "@/lib/ai-office/tool-registry";
import type { GovernedAgentRole } from "@/lib/ai-office/skill-guard";

export type MemoryScope = "personal" | "institutional";

export interface AgentMemoryEntry {
  id: string;
  scope: MemoryScope;
  agentRole: GovernedAgentRole | "shared";
  memoryType: "short_term" | "long_term_summary";
  summary: string;
  sourceTaskId: string | null;
  verified: boolean;
  isReviewed: boolean;
  needsReview?: boolean;
  reviewReason?: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface MemoryRetrievalResult {
  personal: AgentMemoryEntry[];
  institutional: AgentMemoryEntry[];
  flaggedForReview: AgentMemoryEntry[];
  formattedContext: string;
}

export interface SaveVerifiedLessonParams {
  scope: MemoryScope;
  agentRole: GovernedAgentRole;
  summary: string;
  sourceTaskId: string | null;
  verified: boolean;
  evidenceCount: number;
  memoryType?: "short_term" | "long_term_summary";
  isReviewed?: boolean;
  ttlDays?: number;
}

export interface MemoryServiceAdapter {
  retrieveRelevantMemories: (params: {
    agentRole: GovernedAgentRole;
    queryText: string;
    limit?: number;
  }) => Promise<MemoryRetrievalResult>;
  saveVerifiedLesson: (
    params: SaveVerifiedLessonParams
  ) => Promise<{ saved: boolean; entry?: AgentMemoryEntry; reason?: string }>;
}

const MEMORY_PII_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\+?218[\s\-]?9\d[\s\-]?\d{3}[\s\-]?\d{4}/g, replacement: "[PHONE_REDACTED]" },
  { pattern: /\b09[1-5]\d{7}\b/g, replacement: "[PHONE_REDACTED]" },
  { pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, replacement: "[EMAIL_REDACTED]" },
  { pattern: /\b(iban|bank_account|national_id|passport|pin_code|otp_code|owner_phone)\s*[:=]\s*["']?[^\s"',;}{]+/gi, replacement: "$1=[PII_REDACTED]" },
];

export function sanitizeMemorySummary(raw: string, maxLen = 400): string {
  let clean = sanitizeTextForAudit(raw, maxLen);
  for (const rule of MEMORY_PII_RULES) {
    clean = clean.replace(rule.pattern, rule.replacement);
  }
  return clean;
}

function extractArabicAndLatinTokens(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 20);
}

function relevanceScore(summary: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 1;
  const hay = summary.toLowerCase();
  let score = 0;
  for (const tok of queryTokens) {
    if (hay.includes(tok)) score += 1;
  }
  return score;
}

function isStaleMemory(entry: AgentMemoryEntry, staleDays = 30): boolean {
  const ageMs = Date.now() - new Date(entry.createdAt).getTime();
  return ageMs > staleDays * 24 * 60 * 60 * 1000;
}

function detectPotentialConflict(a: string, b: string): boolean {
  const negA = /فشل|خطأ|غير موجود|معطل|مرفوض/.test(a);
  const posB = /ناجح|مكتمل|يعمل|معتمد|متاح/.test(b);
  const negB = /فشل|خطأ|غير موجود|معطل|مرفوض/.test(b);
  const posA = /ناجح|مكتمل|يعمل|معتمد|متاح/.test(a);
  return (negA && posB) || (negB && posA);
}

function buildFormattedMemoryContext(
  personal: AgentMemoryEntry[],
  institutional: AgentMemoryEntry[],
  flagged: AgentMemoryEntry[]
): string {
  const parts: string[] = [];
  if (personal.length > 0) {
    parts.push(
      `[ذاكرة الموظف الموثّقة (${personal.length})]:\n` +
        personal.map((m) => `- ${m.summary}`).join("\n")
    );
  }
  if (institutional.length > 0) {
    parts.push(
      `[المعرفة المؤسسية المشتركة المعتمدة (${institutional.length})]:\n` +
        institutional.map((m) => `- ${m.summary}`).join("\n")
    );
  }
  if (flagged.length > 0) {
    parts.push(
      `[تنبيه: توجد ${flagged.length} معلومة قديمة أو متعارضة تحتاج مراجعة ولم تُعتمد تلقائياً].`
    );
  }
  return parts.join("\n\n");
}

/**
 * مخزن ذاكرة في الذاكرة المحلية للاختبارات المعزولة (بدون كتابة في Supabase).
 */
export function createInMemoryMemoryService(
  initialEntries: AgentMemoryEntry[] = []
) {
  const entries: AgentMemoryEntry[] = initialEntries.map((e) => ({ ...e }));

  const adapter: MemoryServiceAdapter = {
    async retrieveRelevantMemories({ agentRole, queryText, limit = 4 }) {
      const now = Date.now();
      const tokens = extractArabicAndLatinTokens(queryText);

      const active = entries.filter(
        (e) =>
          e.verified &&
          (!e.expiresAt || new Date(e.expiresAt).getTime() > now)
      );

      // فصل صارم: الذاكرة الشخصية تعود لنفس الدور فقط، والمؤسسية للمعتمد فقط
      const personalCandidates = active.filter(
        (e) => e.scope === "personal" && e.agentRole === agentRole
      );
      const institutionalCandidates = active.filter(
        (e) => e.scope === "institutional" && e.isReviewed
      );

      const flaggedForReview: AgentMemoryEntry[] = [];
      const selectSafe = (list: AgentMemoryEntry[]) => {
        const ranked = list
          .map((item) => ({ item, score: relevanceScore(item.summary, tokens) }))
          .filter((x) => x.score > 0 || tokens.length === 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((x) => x.item);

        const accepted: AgentMemoryEntry[] = [];
        for (const item of ranked) {
          if (isStaleMemory(item)) {
            flaggedForReview.push({
              ...item,
              needsReview: true,
              reviewReason: "معلومة قديمة تتطلب مراجعة قبل الاعتماد.",
            });
            continue;
          }
          const conflictsExisting = accepted.some((acc) =>
            detectPotentialConflict(acc.summary, item.summary)
          );
          if (conflictsExisting) {
            flaggedForReview.push({
              ...item,
              needsReview: true,
              reviewReason: "تعارض محتمل مع معلومة أحدث؛ تم تعليقها للمراجعة.",
            });
            continue;
          }
          accepted.push(item);
        }
        return accepted;
      };

      const personal = selectSafe(personalCandidates);
      const institutional = selectSafe(institutionalCandidates);

      return {
        personal,
        institutional,
        flaggedForReview,
        formattedContext: buildFormattedMemoryContext(
          personal,
          institutional,
          flaggedForReview
        ),
      };
    },

    async saveVerifiedLesson(params) {
      // منع تحويل إجابات Gemini غير المتحقق منها إلى حقائق محفوظة
      if (!params.verified || params.evidenceCount <= 0) {
        return {
          saved: false,
          reason:
            "UNVERIFIED_MEMORY_REJECTED: لا يُسمح بحفظ دروس أو نتائج غير متحقق منها بدون دليل أداة صالح.",
        };
      }
      const cleanSummary = sanitizeMemorySummary(params.summary, 400);
      if (!cleanSummary) {
        return { saved: false, reason: "ملخص الذاكرة فارغ بعد التنقية." };
      }
      const now = new Date();
      const ttlDays = params.ttlDays ?? (params.memoryType === "long_term_summary" ? 90 : 14);
      const entry: AgentMemoryEntry = {
        id: crypto.randomUUID(),
        scope: params.scope,
        agentRole: params.scope === "institutional" ? "shared" : params.agentRole,
        memoryType: params.memoryType ?? "short_term",
        summary: cleanSummary,
        sourceTaskId: params.sourceTaskId,
        verified: true,
        isReviewed: params.scope === "institutional" ? Boolean(params.isReviewed) : true,
        expiresAt: new Date(now.getTime() + ttlDays * 86400000).toISOString(),
        createdAt: now.toISOString(),
      };
      entries.push(entry);
      return { saved: true, entry };
    },
  };

  return { entries, adapter };
}

/**
 * قراءة الذاكرة المتاحة من Supabase (ai_agent_memory + agent_skills) بدون أي تعديل على المخطط.
 * في وضع القراءة فقط (allowWrite=false)، لا تُنفذ أي عملية كتابة على Supabase.
 */
export function createSupabaseMemoryService(options?: {
  allowWrite?: boolean;
}): MemoryServiceAdapter {
  return {
    async retrieveRelevantMemories({ agentRole, queryText, limit = 4 }) {
      const tokens = extractArabicAndLatinTokens(queryText);
      const nowIso = new Date().toISOString();

      const personal: AgentMemoryEntry[] = [];
      const institutional: AgentMemoryEntry[] = [];
      const flaggedForReview: AgentMemoryEntry[] = [];

      // 1. جلب agent_id الخاص بالدور فقط (عزل الذاكرة الشخصية)
      const { data: agentRow } = await supabaseAdmin
        .from("ai_agents")
        .select("id")
        .eq("role", agentRole)
        .maybeSingle();

      if (agentRow?.id) {
        const { data: memRows } = await supabaseAdmin
          .from("ai_agent_memory")
          .select("id, memory_type, summary, source_task_id, is_reviewed, expires_at, created_at")
          .eq("agent_id", agentRow.id)
          .order("created_at", { ascending: false })
          .limit(limit * 2);

        for (const r of memRows || []) {
          if (r.expires_at && String(r.expires_at) <= nowIso) continue;
          const entry: AgentMemoryEntry = {
            id: String(r.id),
            scope: "personal",
            agentRole,
            memoryType:
              r.memory_type === "long_term_summary"
                ? "long_term_summary"
                : "short_term",
            summary: sanitizeMemorySummary(String(r.summary || ""), 400),
            sourceTaskId: r.source_task_id ? String(r.source_task_id) : null,
            verified: true,
            isReviewed: Boolean(r.is_reviewed),
            expiresAt: r.expires_at ? String(r.expires_at) : null,
            createdAt: String(r.created_at || nowIso),
          };
          if (isStaleMemory(entry)) {
            flaggedForReview.push({
              ...entry,
              needsReview: true,
              reviewReason: "ذاكرة قديمة تحتاج مراجعة.",
            });
          } else if (relevanceScore(entry.summary, tokens) > 0 || personal.length < limit) {
            if (personal.length < limit) personal.push(entry);
          }
        }
      }

      // 2. جلب المعرفة المؤسسية المشتركة المعتمدة فقط من agent_skills (is_active=true)
      const { data: skillRows } = await supabaseAdmin
        .from("agent_skills")
        .select("id, name, description, created_at")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(limit);

      for (const s of skillRows || []) {
        const summary = sanitizeMemorySummary(
          `${String(s.name || "")}: ${String(s.description || "")}`,
          300
        );
        if (!summary) continue;
        institutional.push({
          id: String(s.id),
          scope: "institutional",
          agentRole: "shared",
          memoryType: "long_term_summary",
          summary,
          sourceTaskId: null,
          verified: true,
          isReviewed: true,
          expiresAt: null,
          createdAt: String(s.created_at || nowIso),
        });
      }

      return {
        personal,
        institutional,
        flaggedForReview,
        formattedContext: buildFormattedMemoryContext(
          personal,
          institutional,
          flaggedForReview
        ),
      };
    },

    async saveVerifiedLesson(params) {
      if (!params.verified || params.evidenceCount <= 0) {
        return {
          saved: false,
          reason:
            "UNVERIFIED_MEMORY_REJECTED: لا يُسمح بحفظ نتائج غير متحقق منها.",
        };
      }
      if (!options?.allowWrite) {
        return {
          saved: false,
          reason: "READ_ONLY_MODE: حفظ الذاكرة في Supabase معطّل في وضع القراءة فقط.",
        };
      }
      const { data: agentRow } = await supabaseAdmin
        .from("ai_agents")
        .select("id")
        .eq("role", params.agentRole)
        .maybeSingle();

      if (!agentRow?.id) {
        return { saved: false, reason: "تعذر العثور على سجل الوكيل في ai_agents." };
      }

      const cleanSummary = sanitizeMemorySummary(params.summary, 400);
      const { data, error } = await supabaseAdmin
        .from("ai_agent_memory")
        .insert({
          agent_id: agentRow.id,
          memory_type: params.memoryType ?? "short_term",
          summary: cleanSummary,
          source_task_id: params.sourceTaskId,
          is_reviewed: Boolean(params.isReviewed),
        })
        .select("id, created_at")
        .single();

      if (error || !data) {
        return {
          saved: false,
          reason: sanitizeTextForAudit(error?.message || "memory_insert_failed", 140),
        };
      }

      return {
        saved: true,
        entry: {
          id: String(data.id),
          scope: params.scope,
          agentRole: params.agentRole,
          memoryType: params.memoryType ?? "short_term",
          summary: cleanSummary,
          sourceTaskId: params.sourceTaskId,
          verified: true,
          isReviewed: Boolean(params.isReviewed),
          expiresAt: null,
          createdAt: String(data.created_at),
        },
      };
    },
  };
}
