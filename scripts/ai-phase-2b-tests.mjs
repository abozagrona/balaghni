import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

// بيئة اختبار محلية معزولة بالكامل — لا اتصال بـ Gemini الحي أو Supabase الحي
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://balaghni-phase-2b-test.supabase.co";
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.AI_OFFICE_MULTI_AGENT_ENABLED;

const projectRoot = process.cwd();

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }
    if (specifier.startsWith("@/")) {
      const base = path.join(projectRoot, "src", specifier.slice(2));
      for (const candidate of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        path.join(base, "index.ts"),
      ]) {
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
const registry = await import("@/lib/ai-office/tool-registry");

const results = [];
async function runTest(kind, id, name, fn) {
  try {
    await fn();
    results.push({ kind, id, name, status: "PASS" });
    console.log(`✅ [${kind}][${id}] PASS: ${name}`);
  } catch (err) {
    results.push({
      kind,
      id,
      name,
      status: "FAIL",
      error: err instanceof Error ? err.message : String(err),
    });
    console.error(
      `❌ [${kind}][${id}] FAIL: ${name} -> ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function createAuditStore() {
  const entries = [];
  const logger = async (entry) => {
    entries.push(structuredClone(entry));
    return { logged: true };
  };
  return { entries, logger };
}

function createSyntheticProvider(delayMs = 0) {
  let ordersCalls = 0;
  return {
    getOrdersCalls: () => ordersCalls,
    provider: {
      async readOrdersSummary(limit) {
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        ordersCalls += 1;
        return {
          count: 2,
          limitUsed: limit,
          byStatus: { pending: 2 },
          recent: [{ id: "SYNTH_ORD_1", status: "pending", city: "طرابلس" }],
        };
      },
      async readTagsSummary(limit) {
        return { count: 3, limitUsed: limit, byStatus: { active: 3 }, recent: [] };
      },
      async readSubscriptionsSummary(limit) {
        return { sampled: limit, activeCount: 8, expiredCount: 1 };
      },
      async readMaintenanceRemindersSummary(limit) {
        return { count: 1, limitUsed: limit, recent: [] };
      },
      async readSupportContextSummary(limit) {
        return {
          count: 1,
          limitUsed: limit,
          recentReports: [{ id: "SYNTH_RPT_1", reason: "تأخر التوصيل", status: "open" }],
        };
      },
      async readAuditLogsSummary(limit) {
        return { count: 1, limitUsed: limit, logs: [] };
      },
      async readAgentPerformanceSummary() {
        return { agentsCount: 6, recentTasksCount: 3, taskByStatus: { completed: 3 } };
      },
    },
  };
}

// =============================================================================
// 1. UNIT TEST: Feature Flag معطّل افتراضياً والمسار القديم يعمل عند التعطيل (سيناريو 8)
// =============================================================================

await runTest("UNIT", "2B-08", "Feature Flag معطّل افتراضياً واستمرار المسار القديم دون تغيير عند تعطيله", async () => {
  delete process.env.AI_OFFICE_MULTI_AGENT_ENABLED;
  assert.equal(dispatcher.isMultiAgentEngineEnabled(), false);

  const audit = createAuditStore();
  let legacyCalled = false;
  const res = await dispatcher.dispatchOfficeCommand({
    command: "تقرير سريع عن الطلبات",
    targetRole: "orchestrator",
    adminId: "admin-1",
    adminName: "المدير",
    _testOverrides: {
      auditLogger: audit.logger,
      legacyExecutor: async (p) => {
        legacyCalled = true;
        return {
          ok: true,
          task: { id: "legacy-task-1", title: p.command },
          delegatedTo: null,
          summary: "رد من المسار القديم",
          agents: [],
          logs: [],
          skills: [],
        };
      },
    },
  });

  assert.equal(legacyCalled, true);
  assert.equal(res.ok, true);
  assert.equal(res.enginePath, "legacy_single_agent");
  assert.equal(res.multiAgentEnabled, false);
  assert.equal(res.orchestratedTask, undefined);
  assert.ok(audit.entries.some((e) => e.action === "dispatcher:route_selected" && e.resource_id === "legacy_single_agent"));
});

// =============================================================================
// 2. MOCK INTEGRATION: السيناريوهات 1–7 عبر dispatchOfficeCommand مع تفعيل Feature Flag
// (وصول الأمر لرامي + Task Orchestrator + Gemini Tool Runner + توزيع على عدة موظفين +
//  تسليم سياق + تجميع في تقرير واحد + ظهور الأدلة في استجابة API)
// =============================================================================

await runTest("MOCK", "2B-01..07", "تفعيل Feature Flag يربط الأمر بـ Task Orchestrator وGemini Tool Runner ويوزع على عمر وسارة ويُرجع الأدلة في استجابة API", async () => {
  process.env.AI_OFFICE_MULTI_AGENT_ENABLED = "true";
  assert.equal(dispatcher.isMultiAgentEngineEnabled(), true);

  const audit = createAuditStore();
  const synth = createSyntheticProvider();
  const store = orchestrator.createInMemoryTaskStore();
  let geminiRunnerInvocations = 0;
  let supportReceivedScopedCtx = "";

  const invoker = async (req) => {
    geminiRunnerInvocations += 1;
    const toolNames = req.tools.map((t) => t.name);
    const hasFnResult = req.history.some((h) => h.type === "function_result");

    if (toolNames.includes("read_orders")) {
      if (!hasFnResult) {
        return {
          text: "",
          functionCalls: [{ callId: "c1", name: "read_orders", arguments: { limit: 10 } }],
        };
      }
      return {
        text: "تقرير عمر: يوجد طلبان معلقان في طرابلس، والرقم 0912345678 والبريد citizen@ly.test يجب حجبهما.",
        functionCalls: [],
      };
    }

    if (toolNames.includes("draft_customer_reply")) {
      // التقاط السياق الممرر إلى سارة للتحقق من فلترة PII (سيناريو 5 و 12)
      const firstInput = req.history[0];
      if (firstInput && firstInput.type === "user_input") {
        supportReceivedScopedCtx = JSON.stringify(firstInput.content || "");
      }
      if (!hasFnResult) {
        return {
          text: "",
          functionCalls: [
            { callId: "c2", name: "read_support_context", arguments: { limit: 5 } },
            {
              callId: "c3",
              name: "draft_customer_reply",
              arguments: {
                topic: "تحديث حول الطلبات",
                draftBody: "مرحباً، طلبك قيد التجهيز في طرابلس.",
              },
            },
          ],
        };
      }
      return {
        text: "تقرير سارة لرامي: تم إعداد مسودة الرد الآمنة بدون إرسال.",
        functionCalls: [],
      };
    }

    throw new Error(`Unexpected tools: ${toolNames.join(",")}`);
  };

  const res = await dispatcher.dispatchOfficeCommand({
    command: "راجع حالة الطلبات المعلقة وأعد مسودة رد لشكاوى العملاء",
    targetRole: "orchestrator",
    adminId: "admin-1",
    adminName: "المؤسس",
    priority: "high",
    idempotencyKey: "PHASE_2B_LIVE_LINK_01",
    _testOverrides: {
      modelInvoker: invoker,
      auditLogger: audit.logger,
      readOnlyDataProvider: synth.provider,
      persistence: store.adapter,
      skipSnapshotRefresh: true,
    },
  });

  // إثبات استدعاء المحركين وتوزيع المهام وظهور الأدلة
  assert.equal(res.ok, true);
  assert.equal(res.enginePath, "multi_agent_v2");
  assert.equal(res.multiAgentEnabled, true);
  assert.ok(geminiRunnerInvocations >= 4, "Gemini Tool Runner must be called for multi-turn tool execution");
  assert.ok(res.orchestratedTask, "orchestratedTask must be returned in API response");
  assert.equal(res.orchestratedTask.status, "completed");
  assert.equal(res.orchestratedTask.verificationStatus, "verified");
  assert.equal(res.orchestratedTask.steps.length, 2);
  assert.deepEqual(
    res.orchestratedTask.steps.map((s) => s.assignedRole),
    ["operations", "support"]
  );
  assert.ok(res.orchestratedTask.steps[0].evidence.some((e) => e.toolId === "read_orders" && e.verified));
  assert.ok(res.orchestratedTask.steps[1].evidence.some((e) => e.toolId === "draft_customer_reply" && e.verified));
  assert.ok(res.summary.includes("التقرير الموحد من رامي"));

  // سيناريو 12: عدم تسريب بيانات المواطنين بين عمر وسارة
  assert.ok(!supportReceivedScopedCtx.includes("0912345678"), "Phone leaked from Omar to Sara!");
  assert.ok(!supportReceivedScopedCtx.includes("citizen@ly.test"), "Email leaked from Omar to Sara!");
  assert.ok(supportReceivedScopedCtx.includes("[PHONE_REDACTED]"));
});

// =============================================================================
// 3. UNIT TEST: منع تنفيذ الأدوات التي تتطلب موافقة غير متحققة (سيناريو 9)
// =============================================================================

await runTest("UNIT", "2B-09", "منع تنفيذ الأدوات التي تتطلب موافقة حتى مع approvalGranted وUUID بدون تحقق ذري من ai_task_approvals", async () => {
  const audit = createAuditStore();
  const res = await registry.executeRegisteredTool(
    {
      agentRole: "principal_architect",
      agentName: "كريم",
      approvalGranted: true,
      approvalId: "11111111-2222-4333-8444-555555555555",
      auditLogger: audit.logger,
    },
    "propose_patch",
    { targetFile: "src/lib/ai-office/workforce-dispatcher.ts", summary: "تعديل تجريبي" }
  );

  assert.equal(res.ok, false);
  assert.equal(res.outcome, "pending");
  assert.equal(res.errorCode, "APPROVAL_REQUIRED");
  assert.match(res.error, /تنتظر الموافقة/);
});

// =============================================================================
// 4. MOCK INTEGRATION: فشل موظف لا يعلن نجاح المهمة ولا يسقط للمسار القديم (سيناريو 10)
// =============================================================================

await runTest("MOCK", "2B-10", "فشل موظف في المسار الجديد لا يعلن نجاح المهمة ولا يتحول تلقائياً للمسار القديم", async () => {
  process.env.AI_OFFICE_MULTI_AGENT_ENABLED = "true";
  const audit = createAuditStore();
  const store = orchestrator.createInMemoryTaskStore();
  let legacyFallbackCalled = false;

  const res = await dispatcher.dispatchOfficeCommand({
    command: "افحص الطلبات المعلقة",
    targetRole: "orchestrator",
    adminId: "admin-1",
    idempotencyKey: "PHASE_2B_FAIL_10",
    _testOverrides: {
      legacyExecutor: async () => {
        legacyFallbackCalled = true;
        throw new Error("Legacy must NOT be called!");
      },
      modelInvoker: async () => {
        throw new Error("Simulated model failure");
      },
      auditLogger: audit.logger,
      persistence: store.adapter,
      skipSnapshotRefresh: true,
    },
  });

  assert.equal(legacyFallbackCalled, false, "Must NEVER fall back to legacy path on failure");
  assert.equal(res.ok, false);
  assert.equal(res.enginePath, "multi_agent_v2");
  assert.equal(res.orchestratedTask.status, "failed");
  assert.ok(res.orchestratedTask.escalations.length >= 1);
});

// =============================================================================
// 5. MOCK INTEGRATION: منع التكرار عند الطلبات المتزامنة بنفس idempotencyKey (سيناريو 11)
// =============================================================================

await runTest("MOCK", "2B-11", "منع التكرار عند وصول طلبين متزامنين بنفس idempotencyKey داخل العملية", async () => {
  process.env.AI_OFFICE_MULTI_AGENT_ENABLED = "true";
  const audit = createAuditStore();
  const synth = createSyntheticProvider(40);
  const store = orchestrator.createInMemoryTaskStore();

  const invoker = async (req) => {
    const hasFnResult = req.history.some((h) => h.type === "function_result");
    if (!hasFnResult) {
      return {
        text: "",
        functionCalls: [{ callId: "dedup_1", name: "read_orders", arguments: { limit: 5 } }],
      };
    }
    return { text: "تقرير موثّق واحد.", functionCalls: [] };
  };

  const sharedParams = {
    command: "راجع الطلبات",
    targetRole: "orchestrator",
    adminId: "admin-1",
    idempotencyKey: "PHASE_2B_CONCURRENT_11",
    _testOverrides: {
      modelInvoker: invoker,
      auditLogger: audit.logger,
      readOnlyDataProvider: synth.provider,
      persistence: store.adapter,
      skipSnapshotRefresh: true,
    },
  };

  const [r1, r2] = await Promise.all([
    dispatcher.dispatchOfficeCommand(sharedParams),
    dispatcher.dispatchOfficeCommand(sharedParams),
  ]);

  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(synth.getOrdersCalls(), 1, "readOrdersSummary must execute ONLY once for concurrent identical requests");
  assert.ok(r1.deduplicatedInFlight || r2.deduplicatedInFlight, "One concurrent caller must reuse the in-flight promise");
});

// تنظيف متغير البيئة بعد الاختبارات
delete process.env.AI_OFFICE_MULTI_AGENT_ENABLED;

const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\n📊 AI Phase 2B Integration Tests Summary: ${passed}/${results.length} PASS, ${failed} FAIL`);
console.log("ℹ️  Live Gemini API Tests: NOT EXECUTED (local mock invoker used).");
console.log("ℹ️  Live Supabase DB Tests: NOT EXECUTED (local in-memory persistence used).");
if (failed > 0) {
  process.exit(1);
}
