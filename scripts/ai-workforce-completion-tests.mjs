// =============================================================================
// بَلِّغْنِي | BALAGHNI — اختبارات القبول الشاملة لفريق الوكلاء الذكيين (20 اختباراً)
// الفئة: LOCAL UNIT / MOCK فقط — لا اتصال بـ Gemini الحي أو Supabase الحي.
// =============================================================================

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://yemhfpfdinmixhbfszvq.supabase.co";
process.env.BALAGHNI_STRICT_TEST_SUPABASE_GUARD = "true";
process.env.WHATSAPP_ACTIVE_PROVIDER = "disabled";
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.AI_OFFICE_MULTI_AGENT_ENABLED;

const projectRoot = process.cwd();

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier.startsWith("@/")) {
      const base = path.join(projectRoot, "src", specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const dispatcher = await import("@/lib/ai-office/workforce-dispatcher");
const orchestrator = await import("@/lib/ai-office/task-orchestrator");
const runner = await import("@/lib/ai-office/gemini-tool-runner");
const registry = await import("@/lib/ai-office/tool-registry");
const memory = await import("@/lib/ai-office/memory-service");
const guard = await import("@/lib/supabase/test-env-guard");

const results = [];
async function runTest(id, name, fn) {
  try {
    await fn();
    results.push({ id, name, status: "PASS", category: "LOCAL UNIT / MOCK" });
    console.log(`✅ [LOCAL UNIT / MOCK][${id}] PASS: ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ id, name, status: "FAIL", category: "LOCAL UNIT / MOCK", error: msg });
    console.error(`❌ [LOCAL UNIT / MOCK][${id}] FAIL: ${name} -> ${msg}`);
  }
}

const okAudit = async () => ({ logged: true });

function makeSyntheticProvider(overrides = {}) {
  return {
    readOrdersSummary: async () => ({ count: 2, hasData: true, byStatus: { pending_delivery: 2 }, recent: [] }),
    readTagsSummary: async () => ({ count: 3, hasData: true, byStatus: { ACTIVE: 2, LOCKED: 1 }, recent: [] }),
    readSubscriptionsSummary: async () => ({ sampled: 3, hasData: true, activeCount: 2, expiredCount: 1 }),
    readMaintenanceRemindersSummary: async () => ({ sourceTable: "maintenance_records", count: 1, hasData: true, recent: [] }),
    readSupportContextSummary: async () => ({ sourceTable: "reports", count: 1, hasData: true, byDeliveryStatus: { sent: 1 }, recentReports: [] }),
    readAuditLogsSummary: async () => ({ count: 1, logs: [] }),
    readAgentPerformanceSummary: async () => ({ agentsCount: 6, recentTasksCount: 4, taskByStatus: { completed: 4 } }),
    ...overrides,
  };
}

function makeRoleMockInvoker(overrides = {}) {
  return async (req) => {
    const sys = req.systemInstruction || "";
    const firstTurn = req.history.length === 1;
    if (overrides.onTurn) {
      const custom = await overrides.onTurn(req, firstTurn);
      if (custom) return custom;
    }
    if (firstTurn) {
      if (sys.includes("أنت طارق")) {
        return { text: "", functionCalls: [{ callId: "c_skl", name: "analyze_agent_performance", arguments: {} }], tokenUsage: 25 };
      }
      if (sys.includes("أنتِ ليلى")) {
        return { text: "", functionCalls: [{ callId: "c_mkt", name: "draft_marketing_copy", arguments: { campaignTitle: "تحديث ملصق الطوارئ", copyText: "مسودة توعوية: تأكد من تحديث بيانات ملصقك في بَلِّغْنِي." } }], tokenUsage: 25 };
      }
      if (sys.includes("أنت عمر")) {
        return { text: "", functionCalls: [{ callId: "c_ops", name: "read_orders", arguments: { limit: 5 } }], tokenUsage: 25 };
      }
      if (sys.includes("أنتِ سارة")) {
        return { text: "", functionCalls: [{ callId: "c_sup", name: "read_support_context", arguments: { limit: 5 } }], tokenUsage: 25 };
      }
      if (sys.includes("أنت كريم")) {
        return { text: "", functionCalls: [{ callId: "c_arch", name: "inspect_codebase", arguments: { relativePath: "src/lib/ai-office/skill-guard.ts", maxLines: 20 } }], tokenUsage: 25 };
      }
    }
    return { text: "تم تنفيذ المهمة بالأدلة الموثّقة دون أي عمليات خارجية.", functionCalls: [], tokenUsage: 30 };
  };
}

// 1 & 2. رامي يوزع مهمة على عمر وسارة وكريم + كل موظف يستخدم أدواته المصرح بها
await runTest("T-01/02", "رامي يوزع مهمة على عمر وسارة وكريم وكل موظف يستخدم أدواته المصرح بها عبر executeRegisteredTool", async () => {
  const mem = orchestrator.createInMemoryTaskStore();
  const auditEvents = [];
  const res = await orchestrator.orchestrateMultiAgentTask({
    command: "راجع الطلبات والملصقات وتجربة المواطن وافحص الأمان في الكود.",
    idempotencyKey: "t01_02",
    persistence: mem.adapter,
    auditLogger: async (e) => { auditEvents.push(e); return { logged: true }; },
    readOnlyDataProvider: makeSyntheticProvider(),
    modelInvoker: makeRoleMockInvoker(),
    projectRoot,
  });
  assert.equal(res.ok, true);
  assert.equal(res.task.status, "completed");
  assert.equal(res.task.verificationStatus, "verified");
  const roles = res.task.steps.map((s) => s.assignedRole);
  assert.ok(roles.includes("operations") && roles.includes("support") && roles.includes("principal_architect"));
  assert.ok(auditEvents.some((e) => e.action === "tool_call:read_orders" && e.outcome === "success"));
  assert.ok(auditEvents.some((e) => e.action === "tool_call:read_support_context" && e.outcome === "success"));
  assert.ok(auditEvents.some((e) => e.action === "tool_call:inspect_codebase" && e.outcome === "success"));
});

// 3. طارق يراجع إجراءً أو معرفة متاحة ويقدم نتيجة موثقة
await runTest("T-03", "طارق يراجع أداء الوكلاء والمعرفة المتاحة ويقدم نتيجة موثّقة", async () => {
  const mem = orchestrator.createInMemoryTaskStore();
  const res = await orchestrator.orchestrateMultiAgentTask({
    command: "راجع أداء الوكلاء ومهارات الفريق والمعرفة التشغيلية.",
    idempotencyKey: "t03",
    persistence: mem.adapter,
    auditLogger: okAudit,
    readOnlyDataProvider: makeSyntheticProvider(),
    modelInvoker: makeRoleMockInvoker(),
  });
  assert.equal(res.ok, true);
  assert.ok(res.task.steps.some((s) => s.assignedRole === "skills_architect" && s.verified));
});

// 4. ليلى تنتج مسودة توعوية دون نشرها
await runTest("T-04", "ليلى تنتج مسودة توعوية عبر draft_marketing_copy دون نشرها", async () => {
  const mem = orchestrator.createInMemoryTaskStore();
  const res = await orchestrator.orchestrateMultiAgentTask({
    command: "أعدّ حملة توعوية ومسودة محتوى للمواطنين حول أهمية تحديث الملصق.",
    idempotencyKey: "t04",
    persistence: mem.adapter,
    auditLogger: okAudit,
    readOnlyDataProvider: makeSyntheticProvider(),
    modelInvoker: makeRoleMockInvoker(),
  });
  assert.equal(res.ok, true);
  const laylaStep = res.task.steps.find((s) => s.assignedRole === "marketing");
  assert.ok(laylaStep && laylaStep.verified);
  assert.ok(laylaStep.evidence.some((e) => e.toolId === "draft_marketing_copy" && e.verified));
});

// 5. سارة تنتج أدلة أو تعلن بوضوح عدم توفر البيانات
await runTest("T-05", "سارة تنتج أدلة وتوضح بوضوح نقص البيانات عند count=0 دون اختلاق", async () => {
  const res = await runner.runAgentWithTools({
    agentRole: "support",
    agentName: "سارة",
    systemPrompt: orchestrator.getAgentProfile("support").systemPrompt,
    userPrompt: "حللي شكاوى المواطنين الحالية.",
    requireToolEvidence: true,
    auditLogger: okAudit,
    readOnlyDataProvider: makeSyntheticProvider({
      readSupportContextSummary: async () => ({ sourceTable: "reports", count: 0, hasData: false, recentReports: [] }),
    }),
    modelInvoker: async (req) => {
      if (req.history.length === 1) {
        return { text: "", functionCalls: [{ callId: "s1", name: "read_support_context", arguments: { limit: 10 } }], tokenUsage: 20 };
      }
      return { text: "لا تتوفر حالياً بيانات بلاغات (count=0)؛ ينقصنا سجل شكاوى لتحليل الأثر.", functionCalls: [], tokenUsage: 25 };
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.verified, true);
  assert.ok(res.text.includes("count=0") || res.text.includes("لا تتوفر"));
});

// 6. عمر يقرأ البيانات المتاحة دون افتراض مخططات غير موجودة (ويفشل بصدق عند خطأ الجدول)
await runTest("T-06", "عمر يقرأ البيانات المتاحة ويرجع فشلاً صريحاً عند خطأ جدول بدلاً من نجاح وهمي", async () => {
  const errRes = await registry.executeRegisteredTool(
    {
      agentRole: "operations",
      agentName: "عمر",
      auditLogger: okAudit,
      readOnlyDataProvider: makeSyntheticProvider({
        readMaintenanceRemindersSummary: async () => {
          throw new Error("maintenance_read_failed: table not found");
        },
      }),
    },
    "read_maintenance_reminders",
    { limit: 5 }
  );
  assert.equal(errRes.ok, false);
  assert.equal(errRes.outcome, "failed");
});

// 7. كريم يفحص الكود دون تجاوز حدود المسارات
await runTest("T-07", "كريم يفحص ملفاً مسموحاً داخل src/ وينجح بدليل موثّق", async () => {
  const res = await registry.executeRegisteredTool(
    { agentRole: "principal_architect", agentName: "كريم", auditLogger: okAudit, projectRoot },
    "inspect_codebase",
    { relativePath: "src/lib/ai-office/skill-guard.ts", maxLines: 15 }
  );
  assert.equal(res.ok, true);
  assert.equal(res.outcome, "success");
  assert.ok(res.data && Number(res.data.returnedLines) > 0);
});

// 8 & 9. رامي يجمع النتائج ويكشف فشل أي موظف + فشل موظف يمنع إعلان نجاح المهمة
await runTest("T-08/09", "فشل موظف واحد (كريم) يُكشف ويُصعّد ويمنع إعلان نجاح المهمة كلها", async () => {
  const mem = orchestrator.createInMemoryTaskStore();
  const res = await orchestrator.orchestrateMultiAgentTask({
    command: "راجع الطلبات وافحص الأمان في الكود.",
    idempotencyKey: "t08_09",
    persistence: mem.adapter,
    auditLogger: okAudit,
    readOnlyDataProvider: makeSyntheticProvider(),
    modelInvoker: makeRoleMockInvoker({
      onTurn: async (req) => {
        if ((req.systemInstruction || "").includes("كريم")) {
          throw new Error("Simulated Karim model error");
        }
        return null;
      },
    }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.task.status, "failed");
  assert.equal(res.task.verificationStatus, "partial");
  assert.ok(res.task.escalations.some((e) => e.agentRole === "principal_architect"));
});

// 10. عدم وجود أدلة يمنع إعلان الإنجاز
await runTest("T-10", "عدم وجود أدلة أداة يمنع إعلان الإنجاز (UNVERIFIED_OUTPUT)", async () => {
  const res = await runner.runAgentWithTools({
    agentRole: "support",
    agentName: "سارة",
    systemPrompt: "اختبار الأدلة",
    userPrompt: "أجيبي بدون أدوات",
    requireToolEvidence: true,
    auditLogger: okAudit,
    modelInvoker: async () => ({ text: "تم الحل بنجاح!", functionCalls: [], tokenUsage: 15 }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.verified, false);
  assert.equal(res.errorCode, "UNVERIFIED_OUTPUT");
});

// 11. طلب مكرر لا يكرر التنفيذ
await runTest("T-11", "طلب مكرر بنفس idempotencyKey لا يكرر التنفيذ (Idempotent + In-Flight Dedup)", async () => {
  process.env.AI_OFFICE_MULTI_AGENT_ENABLED = "true";
  const mem = orchestrator.createInMemoryTaskStore();
  let calls = 0;
  const slow = async (req) => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 80));
    if (req.history.length === 1) {
      return { text: "", functionCalls: [{ callId: "d1", name: "read_orders", arguments: { limit: 3 } }], tokenUsage: 10 };
    }
    return { text: "تم", functionCalls: [], tokenUsage: 10 };
  };
  const opts = {
    command: "راجع الطلبات فقط",
    targetRole: "orchestrator",
    idempotencyKey: "t11_dedup",
    _testOverrides: {
      modelInvoker: slow,
      auditLogger: okAudit,
      persistence: mem.adapter,
      readOnlyDataProvider: makeSyntheticProvider(),
      skipSnapshotRefresh: true,
    },
  };
  const [a, b] = await Promise.all([
    dispatcher.dispatchOfficeCommand(opts),
    dispatcher.dispatchOfficeCommand(opts),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(Boolean(a.deduplicatedInFlight || b.deduplicatedInFlight), true);
  const callsAfterConcurrent = calls;
  const c = await dispatcher.dispatchOfficeCommand(opts);
  assert.equal(c.ok, true);
  assert.equal(calls, callsAfterConcurrent, "Second sequential call must not re-run completed task");
});

// 12. استئناف المهمة لا يعيد الخطوات المكتملة (تشمل stageTimeBudgetMs pause + resume)
await runTest("T-12", "استئناف مهمة متوقفة (paused) لا يعيد تنفيذ الخطوات المكتملة", async () => {
  const mem = orchestrator.createInMemoryTaskStore();
  const executedRoles = [];
  const invoker = makeRoleMockInvoker({
    onTurn: async (req, firstTurn) => {
      if (firstTurn) {
        if (req.systemInstruction.includes("عمر")) executedRoles.push("operations");
        if (req.systemInstruction.includes("سارة")) executedRoles.push("support");
      }
      return null;
    },
  });
  const first = await orchestrator.orchestrateMultiAgentTask({
    command: "راجع الطلبات ورد على شكاوى العملاء",
    idempotencyKey: "t12_resume",
    persistence: mem.adapter,
    auditLogger: okAudit,
    readOnlyDataProvider: makeSyntheticProvider(),
    modelInvoker: invoker,
    simulateInterruptAfterStepKey: "ops_analysis",
  });
  assert.equal(first.interrupted, true);
  assert.equal(first.needsResume, true);
  assert.equal(first.task.status, "paused");

  const second = await orchestrator.orchestrateMultiAgentTask({
    command: "راجع الطلبات ورد على شكاوى العملاء",
    idempotencyKey: "t12_resume",
    persistence: mem.adapter,
    auditLogger: okAudit,
    readOnlyDataProvider: makeSyntheticProvider(),
    modelInvoker: invoker,
  });
  assert.equal(second.ok, true);
  assert.equal(second.resumedFromCheckpoint, true);
  assert.ok(second.skippedStepKeys.includes("ops_analysis"));
  assert.equal(executedRoles.filter((r) => r === "operations").length, 1, "Omar must NOT re-execute");
  assert.equal(executedRoles.filter((r) => r === "support").length, 1, "Sara must execute on resume");
});

// 13. Timeout لا يؤدي إلى فقدان حالة المهمة (تُحفظ كـ paused قابلة للاستئناف)
await runTest("T-13", "انتهاء ميزانية المرحلة الزمنية يحفظ حالة المهمة كـ paused بدون فقدان التقدم", async () => {
  const mem = orchestrator.createInMemoryTaskStore();
  const customPlan = [
    { stepKey: "s1", title: "خطوة 1", instruction: "اقرأ الطلبات", assignedRole: "operations", executionMode: "sequential", dependsOn: [] },
    { stepKey: "s2", title: "خطوة 2", instruction: "اقرأ الدعم", assignedRole: "support", executionMode: "sequential", dependsOn: ["s1"] },
  ];
  const r1 = await orchestrator.orchestrateMultiAgentTask({
    command: "مهمة طويلة على مرحلتين",
    idempotencyKey: "t13_budget",
    customPlan,
    stageTimeBudgetMs: 1000,
    persistence: mem.adapter,
    auditLogger: okAudit,
    readOnlyDataProvider: makeSyntheticProvider(),
    modelInvoker: async (req) => {
      await new Promise((r) => setTimeout(r, 600));
      if (req.history.length === 1) {
        const isOps = req.systemInstruction.includes("عمر");
        return { text: "", functionCalls: [{ callId: "x", name: isOps ? "read_orders" : "read_support_context", arguments: { limit: 2 } }], tokenUsage: 10 };
      }
      return { text: "مكتمل", functionCalls: [], tokenUsage: 10 };
    },
  });
  assert.equal(r1.interrupted, true);
  assert.equal(r1.needsResume, true);
  assert.equal(r1.task.status, "paused");
  assert.equal(r1.task.steps[0].status, "completed");
  assert.equal(r1.task.steps[1].status, "pending");
});

// 14. مدخلات العميل لا تغير الصلاحيات أو الهوية أو Feature Flag
await runTest("T-14", "مدخلات العميل لا تغير الصلاحيات أو الهوية أو Feature Flag (فحص route.ts + tool-registry)", async () => {
  const routeSrc = fs.readFileSync(path.join(projectRoot, "src/app/api/agents/command/route.ts"), "utf8");
  assert.equal(/body\?\.featureFlag|body\?\.multiAgentEnabled|body\?\.approvalGranted|body\?\.approvalId/.test(routeSrc), false);
  const tampered = await registry.executeRegisteredTool(
    { agentRole: "support", agentName: "سارة", auditLogger: okAudit },
    "read_support_context",
    { limit: 5, overrideRole: "principal_architect", bypassApproval: true }
  );
  assert.equal(tampered.ok, false);
  assert.equal(tampered.errorCode, "PRIVILEGE_ESCALATION_BLOCKED");
});

// 15. الأدوات الحساسة تظل محمية بالموافقة الخادمية المربوطة ومنع إعادة الاستخدام
await runTest("T-15", "الأدوات الحساسة محمية بالموافقة الخادمية المربوطة بالمهمة والأداة والمدخلات مع منع إعادة الاستخدام", async () => {
  const taskId = crypto.randomUUID();
  const approvalId = crypto.randomUUID();
  const input = { targetFile: "src/lib/ai-office/skill-guard.ts", summary: "مقترح اختباري" };

  // بدون verifier -> مرفوض
  const noVerifier = await registry.executeRegisteredTool(
    { agentRole: "principal_architect", agentName: "كريم", taskId, approvalGranted: true, approvalId, auditLogger: okAudit },
    "propose_patch",
    input
  );
  assert.equal(noVerifier.ok, false);
  assert.equal(noVerifier.outcome, "pending");

  // مع verifier خادمي موثوق: ربط بالمهمة والمدخلات + استهلاك أحادي (Anti-Replay)
  const verifier = registry.createInMemoryApprovalVerifier([
    {
      id: approvalId,
      taskId,
      requestedByRole: "principal_architect",
      actionCode: "propose_patch",
      actionPayload: input,
      status: "approved",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      decidedByAdminId: "admin_test_1",
      executedAt: null,
    },
  ]);

  // مهمة مختلفة -> مرفوض
  const wrongTask = await registry.executeRegisteredTool(
    { agentRole: "principal_architect", agentName: "كريم", taskId: crypto.randomUUID(), approvalGranted: true, approvalId, approvalVerifier: verifier.verify, auditLogger: okAudit },
    "propose_patch",
    input
  );
  assert.equal(wrongTask.ok, false);

  // نفس المهمة والمدخلات -> ينجح مرة واحدة
  const firstUse = await registry.executeRegisteredTool(
    { agentRole: "principal_architect", agentName: "كريم", taskId, approvalGranted: true, approvalId, approvalVerifier: verifier.verify, auditLogger: okAudit },
    "propose_patch",
    input
  );
  assert.equal(firstUse.ok, true);

  // إعادة استخدام نفس الموافقة -> مرفوض (Anti-Replay)
  const replay = await registry.executeRegisteredTool(
    { agentRole: "principal_architect", agentName: "كريم", taskId, approvalGranted: true, approvalId, approvalVerifier: verifier.verify, auditLogger: okAudit },
    "propose_patch",
    input
  );
  assert.equal(replay.ok, false);
  assert.equal(replay.errorCode, "APPROVAL_REQUIRED");
});

// 16. فشل قاعدة البيانات لا يؤدي إلى نجاح وهمي
await runTest("T-16", "فشل قاعدة البيانات أثناء الحفظ يُظهر خطأً صريحاً ولا يؤدي إلى نجاح وهمي", async () => {
  let threw = false;
  try {
    await orchestrator.orchestrateMultiAgentTask({
      command: "راجع الطلبات",
      idempotencyKey: "t16_db_fail",
      persistence: {
        findTaskByIdempotencyKey: async () => null,
        upsertTask: async () => { throw new Error("task_persist_failed: db_down"); },
        upsertStep: async () => { throw new Error("step_persist_failed: db_down"); },
        appendLog: async () => {},
      },
      auditLogger: okAudit,
      modelInvoker: makeRoleMockInvoker(),
    });
  } catch (e) {
    threw = String(e.message).includes("task_persist_failed");
  }
  assert.equal(threw, true);
});

// 17. فشل Gemini يعالج بالتصعيد الصحيح
await runTest("T-17", "فشل Gemini يعالج بحالة failed وتصعيد مسجل", async () => {
  const mem = orchestrator.createInMemoryTaskStore();
  const res = await orchestrator.orchestrateMultiAgentTask({
    command: "راجع الطلبات",
    idempotencyKey: "t17_gem_fail",
    persistence: mem.adapter,
    auditLogger: okAudit,
    modelInvoker: async () => { throw new Error("Simulated Gemini outage"); },
  });
  assert.equal(res.ok, false);
  assert.equal(res.task.status, "failed");
  assert.ok(res.task.escalations.length >= 1);
});

// 18. اختبار تسرب البيانات الشخصية بين الموظفين + عزل الذاكرة ورفض الذاكرة غير الموثّقة
await runTest("T-18", "منع تسرب PII بين الموظفين وفصل ذاكرة الموظفين ومنع حفظ إجابات غير متحقق منها", async () => {
  const scoped = orchestrator.buildScopedHandoffContext({
    fromRole: "operations",
    toRole: "support",
    rawSummary: "هاتف 0918887766 وبريد citizen@balaghni.ly وحساب iban=LY11223344",
  });
  assert.equal(scoped.includes("0918887766"), false);
  assert.equal(scoped.includes("citizen@balaghni.ly"), false);
  assert.equal(scoped.includes("LY11223344"), false);

  const memSvc = memory.createInMemoryMemoryService();
  const rejected = await memSvc.adapter.saveVerifiedLesson({
    scope: "personal",
    agentRole: "operations",
    summary: "تخمين غير مؤكد",
    sourceTaskId: null,
    verified: false,
    evidenceCount: 0,
  });
  assert.equal(rejected.saved, false);

  const saved = await memSvc.adapter.saveVerifiedLesson({
    scope: "personal",
    agentRole: "operations",
    summary: "درس تشغيلي مؤكد لهاتف 0921112233 حول الطلبات",
    sourceTaskId: crypto.randomUUID(),
    verified: true,
    evidenceCount: 1,
  });
  assert.equal(saved.saved, true);
  assert.equal(saved.entry.summary.includes("0921112233"), false);

  const saraMem = await memSvc.adapter.retrieveRelevantMemories({ agentRole: "support", queryText: "الطلبات" });
  assert.equal(saraMem.personal.length, 0, "Sara must not see Omar personal memory");
  const omarMem = await memSvc.adapter.retrieveRelevantMemories({ agentRole: "operations", queryText: "الطلبات" });
  assert.equal(omarMem.personal.length, 1);
});

// 19. اختبار منع Path Traversal وقراءة الأسرار + منع الاتصال بمشروع الإنتاج
await runTest("T-19", "منع Path Traversal وقراءة .env ومنع مشروع Supabase الإنتاجي", async () => {
  for (const badPath of ["../.env.local", ".env", "src/../../.env.test.local", "App.tsx"]) {
    const r = await registry.executeRegisteredTool(
      { agentRole: "principal_architect", agentName: "كريم", auditLogger: okAudit, projectRoot },
      "inspect_codebase",
      { relativePath: badPath }
    );
    assert.equal(r.ok, false);
    assert.equal(r.outcome, "blocked");
  }
  assert.throws(() => guard.assertTestSupabaseTarget("https://aivxhxnvgqxylugqrjei.supabase.co", { forceEnforce: true }));
});

// 20. اختبار استمرار عمل المسار القديم عندما يكون Feature Flag معطلاً
await runTest("T-20", "استمرار عمل المسار القديم (legacy_single_agent) عند تعطيل AI_OFFICE_MULTI_AGENT_ENABLED", async () => {
  delete process.env.AI_OFFICE_MULTI_AGENT_ENABLED;
  let legacyCalled = false;
  const res = await dispatcher.dispatchOfficeCommand({
    command: "اختبار المسار القديم",
    targetRole: "orchestrator",
    _testOverrides: {
      auditLogger: okAudit,
      legacyExecutor: async () => {
        legacyCalled = true;
        return { ok: true, summary: "legacy ok" };
      },
    },
  });
  assert.equal(legacyCalled, true);
  assert.equal(res.enginePath, "legacy_single_agent");
  assert.equal(res.multiAgentEnabled, false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
console.log(`\n📊 AI WORKFORCE COMPLETION TESTS (LOCAL UNIT / MOCK): ${passCount}/${results.length} PASS, ${failCount} FAIL`);
if (failCount > 0) process.exit(1);
