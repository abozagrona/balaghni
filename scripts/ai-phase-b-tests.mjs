import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

// بيئة اختبار محلية معزولة بالكامل — بدون اتصال بقاعدة البيانات أو Gemini الحي
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://balaghni-phase-b-test.supabase.co";
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.GEMINI_API_KEY;

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

const runner = await import("@/lib/ai-office/gemini-tool-runner");
const orchestrator = await import("@/lib/ai-office/task-orchestrator");

const results = [];
async function runTest(id, name, fn) {
  try {
    await fn();
    results.push({ id, name, status: "PASS" });
    console.log(`✅ [${id}] PASS: ${name}`);
  } catch (err) {
    results.push({
      id,
      name,
      status: "FAIL",
      error: err instanceof Error ? err.message : String(err),
    });
    console.error(
      `❌ [${id}] FAIL: ${name} -> ${err instanceof Error ? err.message : String(err)}`
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

function createSyntheticProvider() {
  const callCounts = {
    readOrdersSummary: 0,
    readTagsSummary: 0,
    readSupportContextSummary: 0,
  };
  return {
    callCounts,
    provider: {
      async readOrdersSummary(limit) {
        callCounts.readOrdersSummary += 1;
        return {
          count: 3,
          limitUsed: limit,
          byStatus: { pending: 2, shipped: 1 },
          recent: [
            { id: "BALAGHNI_SYNTH_ORD_1", status: "pending", city: "طرابلس" },
            { id: "BALAGHNI_SYNTH_ORD_2", status: "pending", city: "بنغازي" },
          ],
        };
      },
      async readTagsSummary(limit) {
        callCounts.readTagsSummary += 1;
        return {
          count: 4,
          limitUsed: limit,
          byStatus: { active: 3, pending: 1 },
          recent: [{ id: "BALAGHNI_SYNTH_TAG_1", tag_code: "SYNTH-01", status: "active" }],
        };
      },
      async readSubscriptionsSummary(limit) {
        return { sampled: limit, activeCount: 12, expiredCount: 1 };
      },
      async readMaintenanceRemindersSummary(limit) {
        return { count: 2, limitUsed: limit, recent: [] };
      },
      async readSupportContextSummary(limit) {
        callCounts.readSupportContextSummary += 1;
        return {
          count: 2,
          limitUsed: limit,
          recentReports: [
            { id: "BALAGHNI_SYNTH_RPT_1", reason: "تأخر شحن ملصق", status: "open" },
          ],
        };
      },
      async readAuditLogsSummary(limit) {
        return { count: 1, limitUsed: limit, logs: [] };
      },
      async readAgentPerformanceSummary() {
        return { agentsCount: 6, recentTasksCount: 5, taskByStatus: { completed: 5 } };
      },
    },
  };
}

// =============================================================================
// السيناريو 1 + 2 + 4 + 5:
// رامي يقسّم أمراً إلى 3 مهام (عمر، سارة، ليلى)، عمر يحلل بأداة مسجلة،
// سارة تعيد تقريراً موثّقاً، ورامي يجمع النتائج ويغلق المهمة بعد التحقق.
// =============================================================================

await runTest("B-01/02/04/05", "رامي يقسّم أمراً إلى 3 مهام، عمر وسارة وليلى ينفذون بالأدوات المسجلة، ورامي يغلق المهمة بعد التحقق", async () => {
  const audit = createAuditStore();
  const synth = createSyntheticProvider();
  const store = orchestrator.createInMemoryTaskStore();

  // التأكد أن buildDefaultPlanForCommand ينتج 3 مهام فرعية للأمر المركب
  const command =
    "راجع حالة الطلبات والملصقات، وأعد مسودة رد لشكاوى العملاء، وجهّز مسودة حملة تسويقية للعملاء.";
  const plan = orchestrator.buildDefaultPlanForCommand(command);
  assert.equal(plan.length, 3, `Expected 3 subtasks, got ${plan.length}`);
  assert.deepEqual(
    plan.map((p) => p.assignedRole),
    ["operations", "support", "marketing"]
  );

  const invoker = async (req) => {
    const toolNames = req.tools.map((t) => t.name);
    const hasFnResult = req.history.some((h) => h.type === "function_result");

    // التحقق أن النموذج لا يستلم أبداً أدوات خارج صلاحية الدور
    if (toolNames.includes("read_orders")) {
      assert.ok(!toolNames.includes("inspect_codebase"), "operations must not receive inspect_codebase");
      if (!hasFnResult) {
        return {
          text: "",
          functionCalls: [
            { callId: "c_ops_1", name: "read_orders", arguments: { limit: 10 } },
            { callId: "c_ops_2", name: "read_tags", arguments: { limit: 10 } },
          ],
          tokenUsage: 180,
        };
      }
      return {
        text: "تقرير عمر التشغيلي: يوجد طلبان قيد المعالجة في طرابلس وبنغازي و3 ملصقات نشطة.",
        functionCalls: [],
        tokenUsage: 140,
      };
    }

    if (toolNames.includes("draft_customer_reply")) {
      assert.ok(!toolNames.includes("read_orders"), "support must not receive read_orders");
      if (!hasFnResult) {
        return {
          text: "",
          functionCalls: [
            { callId: "c_sup_1", name: "read_support_context", arguments: { limit: 5 } },
            {
              callId: "c_sup_2",
              name: "draft_customer_reply",
              arguments: {
                topic: "متابعة طلبات الشحن",
                draftBody: "مرحباً، طلبك قيد التجهيز وسيتم التواصل معك قريباً.",
              },
            },
          ],
          tokenUsage: 160,
        };
      }
      return {
        text: "تقرير سارة لرامي: تمت مراجعة سياق الدعم وتجهيز مسودة رد آمنة للمراجعة (بدون إرسال).",
        functionCalls: [],
        tokenUsage: 120,
      };
    }

    if (toolNames.includes("draft_marketing_copy")) {
      if (!hasFnResult) {
        return {
          text: "",
          functionCalls: [
            {
              callId: "c_mkt_1",
              name: "draft_marketing_copy",
              arguments: {
                campaignTitle: "حملة بلّغني الآمنة",
                copyText: "فعّل ملصق بَلِّغْنِي الذكي لمركبتك اليوم.",
              },
            },
          ],
          tokenUsage: 150,
        };
      }
      return {
        text: "تقرير ليلى لرامي: تم تجهيز مسودة المحتوى التسويقي بنجاح (مسودة فقط).",
        functionCalls: [],
        tokenUsage: 110,
      };
    }

    throw new Error(`Unexpected tool set: ${toolNames.join(",")}`);
  };

  const res = await orchestrator.orchestrateMultiAgentTask({
    command,
    idempotencyKey: "BALAGHNI_PHASE_B_TEST_01",
    priority: "high",
    createdByAdminId: "admin-test-1",
    modelInvoker: invoker,
    auditLogger: audit.logger,
    readOnlyDataProvider: synth.provider,
    persistence: store.adapter,
    projectRoot,
  });

  assert.equal(res.ok, true);
  assert.equal(res.task.status, "completed");
  assert.equal(res.task.verificationStatus, "verified");
  assert.equal(res.task.steps.length, 3);
  assert.ok(res.task.steps.every((s) => s.status === "completed" && s.verified));
  assert.ok(res.task.steps[0].evidence.some((e) => e.toolId === "read_orders" && e.verified));
  assert.ok(res.task.steps[1].evidence.some((e) => e.toolId === "draft_customer_reply" && e.verified));
  assert.ok(res.task.finalReport && res.task.finalReport.includes("التقرير الموحد من رامي"));
  assert.ok(audit.entries.some((e) => e.action === "orchestrator:task_closed" && e.outcome === "success"));
});

// =============================================================================
// السيناريو 3: عمر يسلّم نتيجة إلى سارة عبر آلية التسليم الخادمي المضبوط
// =============================================================================

await runTest("B-03", "عمر يسلّم نتيجة إلى سارة عبر تسليم خادمي مضبوط وسارة تعيد التقرير لرامي", async () => {
  const audit = createAuditStore();
  const synth = createSyntheticProvider();
  const store = orchestrator.createInMemoryTaskStore();

  const invoker = async (req) => {
    const toolNames = req.tools.map((t) => t.name);
    const hasFnResult = req.history.some((h) => h.type === "function_result");

    if (toolNames.includes("read_orders")) {
      if (!hasFnResult) {
        return {
          text: "",
          functionCalls: [{ callId: "h_ops_1", name: "read_orders", arguments: { limit: 5 } }],
        };
      }
      return {
        text: `رصد عمر تأخراً في طلبين ويقترح تسليم المتابعة لسارة.
[HANDOFF_REQUEST]
{
  "targetRole": "support",
  "reason": "تجهيز مسودة اعتذار وتوضيح للعملاء المتأثرين",
  "requestedAction": "أعدّي مسودة رد مهذبة حول تأخر الشحن بناءً على السياق المصفي",
  "payloadSummary": "يوجد طلبان متأخران في طرابلس وبنغازي، بدون كشف أرقام هواتف"
}
[/HANDOFF_REQUEST]`,
        functionCalls: [],
      };
    }

    if (toolNames.includes("draft_customer_reply")) {
      if (!hasFnResult) {
        return {
          text: "",
          functionCalls: [
            {
              callId: "h_sup_1",
              name: "draft_customer_reply",
              arguments: {
                topic: "تأخر شحن الطلبات",
                draftBody: "نعتذر عن التأخر، شحنتك قيد الأولوية.",
              },
            },
          ],
        };
      }
      return {
        text: "تم استلام التسليم من عمر وتجهيز مسودة الرد وإعادتها لرامي.",
        functionCalls: [],
      };
    }

    throw new Error("Unexpected role invocation");
  };

  const res = await orchestrator.orchestrateMultiAgentTask({
    command: "افحص الطلبات المتأخرة",
    idempotencyKey: "BALAGHNI_PHASE_B_HANDOFF_03",
    customPlan: [
      {
        stepKey: "ops_check",
        title: "فحص الطلبات",
        instruction: "افحص الطلبات واطلب مساعدة سارة إذا لزم",
        assignedRole: "operations",
        requireToolEvidence: true,
      },
    ],
    modelInvoker: invoker,
    auditLogger: audit.logger,
    readOnlyDataProvider: synth.provider,
    persistence: store.adapter,
  });

  assert.equal(res.ok, true);
  assert.equal(res.task.steps.length, 2, "Expected dynamic controlled handoff step to be created");
  assert.equal(res.task.steps[1].assignedRole, "support");
  assert.equal(res.task.steps[1].handoffFromRole, "operations");
  assert.equal(res.task.steps[1].handoffDepth, 1);
  assert.equal(res.task.steps[1].verified, true);
  assert.ok(audit.entries.some((e) => e.action === "orchestrator:controlled_handoff"));
});

// =============================================================================
// السيناريو 6: رفض أداة غير مصرح بها حتى لو حاول النموذج استدعاءها
// =============================================================================

await runTest("B-06", "رفض أداة غير مصرح بها يحاول النموذج استدعاءها وتوثيق الرفض بدون اعتماد النتيجة", async () => {
  const audit = createAuditStore();

  const invoker = async (req) => {
    const hasFnResult = req.history.some((h) => h.type === "function_result");
    if (!hasFnResult) {
      // النموذج يحاول استدعاء أداة غير مصرح بها لدور marketing
      return {
        text: "",
        functionCalls: [{ callId: "bad_1", name: "read_orders", arguments: { limit: 5 } }],
      };
    }
    return {
      text: "حاولت قراءة الطلبات لكنها رُفضت.",
      functionCalls: [],
    };
  };

  const runRes = await runner.runAgentWithTools({
    agentRole: "marketing",
    agentName: "ليلى",
    systemPrompt: "أنتِ ليلى مديرة التسويق.",
    userPrompt: "اقرئي الطلبات",
    requireToolEvidence: true,
    modelInvoker: invoker,
    auditLogger: audit.logger,
  });

  assert.equal(runRes.ok, false);
  assert.equal(runRes.verified, false);
  assert.equal(runRes.errorCode, "UNVERIFIED_OUTPUT");
  assert.equal(runRes.evidence.length, 1);
  assert.equal(runRes.evidence[0].outcome, "blocked");
  assert.equal(runRes.evidence[0].verified, false);
  assert.equal(runRes.evidence[0].errorCode, "UNAUTHORIZED_ROLE");
  assert.ok(audit.entries.some((e) => e.outcome === "blocked" && e.resource_id === "read_orders"));
});

// =============================================================================
// السيناريو 7: فشل موظف في إحدى الخطوات وتصعيد المشكلة وإلغاء الخطوات التابعة
// =============================================================================

await runTest("B-07", "فشل موظف في إحدى الخطوات يصعّد المشكلة ويلغي الخطوة التابعة دون إغلاق ناجح", async () => {
  const audit = createAuditStore();
  const store = orchestrator.createInMemoryTaskStore();

  const failingInvoker = async () => {
    throw new Error("Simulated Gemini 503 outage");
  };

  const res = await orchestrator.orchestrateMultiAgentTask({
    command: "افحص الطلبات ثم أعدّ رد دعم",
    idempotencyKey: "BALAGHNI_PHASE_B_FAIL_07",
    customPlan: [
      {
        stepKey: "step_ops",
        title: "تحليل العمليات",
        instruction: "اقرأ الطلبات",
        assignedRole: "operations",
        maxAttempts: 2,
        priority: "high",
      },
      {
        stepKey: "step_sup",
        title: "مسودة الدعم",
        instruction: "أعد رد دعم",
        assignedRole: "support",
        dependsOn: ["step_ops"],
      },
    ],
    modelInvoker: failingInvoker,
    auditLogger: audit.logger,
    persistence: store.adapter,
  });

  assert.equal(res.ok, false);
  assert.equal(res.task.status, "failed");
  assert.equal(res.task.steps[0].status, "failed");
  assert.equal(res.task.steps[0].attempts, 2);
  assert.equal(res.task.steps[1].status, "cancelled");
  assert.equal(res.task.escalations.length, 1);
  assert.equal(res.task.escalations[0].stepKey, "step_ops");
  assert.equal(res.task.escalations[0].severity, "critical");
  assert.ok(audit.entries.some((e) => e.action === "orchestrator:step_escalated"));
});

// =============================================================================
// السيناريو 8: انقطاع التنفيذ واستعادته دون تكرار الخطوة المكتملة
// =============================================================================

await runTest("B-08", "انقطاع التنفيذ بعد الخطوة 1 واستعادته بنفس idempotencyKey دون تكرار الخطوة 1", async () => {
  const audit = createAuditStore();
  const synth = createSyntheticProvider();
  const store = orchestrator.createInMemoryTaskStore();
  const key = "BALAGHNI_PHASE_B_RESUME_08";

  const invoker = async (req) => {
    const toolNames = req.tools.map((t) => t.name);
    const hasFnResult = req.history.some((h) => h.type === "function_result");

    if (toolNames.includes("read_orders")) {
      if (!hasFnResult) {
        return {
          text: "",
          functionCalls: [{ callId: "r_1", name: "read_orders", arguments: { limit: 5 } }],
        };
      }
      return { text: "اكتمل فحص عمر.", functionCalls: [] };
    }

    if (toolNames.includes("draft_customer_reply")) {
      if (!hasFnResult) {
        return {
          text: "",
          functionCalls: [
            {
              callId: "r_2",
              name: "draft_customer_reply",
              arguments: { topic: "متابعة", draftBody: "رد تجريبي آمن." },
            },
          ],
        };
      }
      return { text: "اكتملت مسودة سارة.", functionCalls: [] };
    }
    throw new Error("Unexpected role");
  };

  const plan = [
    {
      stepKey: "step_1_ops",
      title: "فحص الطلبات",
      instruction: "اقرأ الطلبات",
      assignedRole: "operations",
    },
    {
      stepKey: "step_2_sup",
      title: "إعداد مسودة رد",
      instruction: "أعد مسودة رد",
      assignedRole: "support",
      dependsOn: ["step_1_ops"],
    },
  ];

  // التشغيل الأول: ينقطع بعد step_1_ops
  const firstRun = await orchestrator.orchestrateMultiAgentTask({
    command: "اختبار الانقطاع والاستئناف",
    idempotencyKey: key,
    customPlan: plan,
    simulateInterruptAfterStepKey: "step_1_ops",
    modelInvoker: invoker,
    auditLogger: audit.logger,
    readOnlyDataProvider: synth.provider,
    persistence: store.adapter,
  });

  assert.equal(firstRun.interrupted, true);
  assert.equal(firstRun.task.status, "paused");
  assert.equal(synth.callCounts.readOrdersSummary, 1);

  // التشغيل الثاني (الاستئناف): يجب تخطي step_1_ops دون إعادة استدعاء readOrdersSummary
  const secondRun = await orchestrator.orchestrateMultiAgentTask({
    command: "اختبار الانقطاع والاستئناف",
    idempotencyKey: key,
    customPlan: plan,
    modelInvoker: invoker,
    auditLogger: audit.logger,
    readOnlyDataProvider: synth.provider,
    persistence: store.adapter,
  });

  assert.equal(secondRun.ok, true);
  assert.equal(secondRun.resumedFromCheckpoint, true);
  assert.deepEqual(secondRun.skippedStepKeys, ["step_1_ops"]);
  assert.deepEqual(secondRun.executedStepKeys, ["step_2_sup"]);
  assert.equal(
    synth.callCounts.readOrdersSummary,
    1,
    "readOrdersSummary must NOT be called again on resume!"
  );
  assert.equal(secondRun.task.status, "completed");
  assert.equal(secondRun.task.verificationStatus, "verified");
});

// =============================================================================
// السيناريو 9: منع الحلقات اللانهائية (Loop Detection)
// =============================================================================

await runTest("B-09", "منع الحلقات اللانهائية في Function Calling بإيقاف فوري LOOP_DETECTED", async () => {
  const audit = createAuditStore();
  const synth = createSyntheticProvider();

  // نموذج عالق يكرر نفس الاستدعاء بلا نهاية
  const loopingInvoker = async () => ({
    text: "",
    functionCalls: [{ callId: "loop_call", name: "read_orders", arguments: { limit: 5 } }],
  });

  const runRes = await runner.runAgentWithTools({
    agentRole: "operations",
    agentName: "عمر",
    systemPrompt: "أنت عمر.",
    userPrompt: "اقرأ الطلبات",
    maxTurns: 6,
    maxToolCalls: 8,
    modelInvoker: loopingInvoker,
    auditLogger: audit.logger,
    readOnlyDataProvider: synth.provider,
  });

  assert.equal(runRes.ok, false);
  assert.equal(runRes.errorCode, "LOOP_DETECTED");
  assert.equal(runRes.toolCallsUsed, 2, "Must break on the 3rd identical call before executing it");
});

// =============================================================================
// السيناريو 10: عدم تسريب بيانات مواطن أو موظف إلى موظف آخر دون حاجة وصلاحية
// =============================================================================

await runTest("B-10", "منع تسريب أرقام الهواتف والبريد والتفاصيل المالية المحظورة عند تمرير السياق بين الموظفين", async () => {
  const leakedInput =
    "العميل صاحب الرقم 0912345678 والرقم الدولي +218921112233 وبريده citizen@example.ly لديه total_amount=450 و iban=LY00112233 و owner_phone=0919998877.";

  const scopedForSupport = orchestrator.buildScopedHandoffContext({
    fromRole: "operations",
    toRole: "support",
    rawSummary: leakedInput,
    evidenceSummaries: ["read_orders: count=1, phone=0912345678"],
  });

  assert.ok(!scopedForSupport.includes("0912345678"), "Libyan local phone leaked!");
  assert.ok(!scopedForSupport.includes("+218921112233"), "International phone leaked!");
  assert.ok(!scopedForSupport.includes("citizen@example.ly"), "Email leaked!");
  assert.ok(!scopedForSupport.includes("LY00112233"), "IBAN leaked to support!");
  assert.ok(!scopedForSupport.includes("0919998877"), "owner_phone leaked!");
  assert.ok(scopedForSupport.includes("[PHONE_REDACTED]"));
  assert.ok(scopedForSupport.includes("[EMAIL_REDACTED]"));
  assert.ok(scopedForSupport.includes("[RESTRICTED_FOR_ROLE]"));
});

// =============================================================================
// الملخص النهائي
// =============================================================================
const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\n📊 AI Phase B Tests Summary: ${passed}/${results.length} PASS, ${failed} FAIL`);
if (failed > 0) {
  process.exit(1);
}
