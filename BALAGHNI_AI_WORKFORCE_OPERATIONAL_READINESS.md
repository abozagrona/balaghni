# BALAGHNI — AI WORKFORCE OPERATIONAL READINESS REPORT

**التاريخ:** 2026-11-24
**نوع المراجعة:** مراجعة جاهزية تشغيلية محلية فقط (قراءة وفحص دون أي تعديل على الكود أو الإعدادات أو قاعدة البيانات).
**الجاهزية للتشغيل التجريبي:** ✅ **جاهز للتشغيل التجريبي المحلي المعزول على مشروع الاختبار (`yemhfpfdinmixhbfszvq`) فقط** — ⛔ **غير جاهز للنشر أو الاتصال بالإنتاج.**

---

## 1. قائمة التحقق من الجاهزية التشغيلية (البنود 1–6)

| # | البند | الحالة | التحقق الفعلي من الكود والبيئة المحلية |
|---|---|---|---|
| 1 | **حالة Feature Flag لمحرك الفريق** | ✅ آمن (معطّل افتراضياً) | `AI_OFFICE_MULTI_AGENT_ENABLED` غير مضبوط في `.env.local` ولا `.env.test.local`، والدالة `isMultiAgentEngineEnabled()` في `src/lib/ai-office/workforce-dispatcher.ts` تُرجع `false` افتراضياً (المسار القديم `legacy_single_agent` يظل الافتراضي الآمن حتى التفعيل الصريح على الخادم). |
| 2 | **استقلالية الموظفين الستة (التعليمات والأدوات والصلاحيات)** | ✅ مكتمل ومفصول | جميع الموظفين الستة معرفون بصلاحيات خادمية مستقلة في `SERVER_AGENT_TOOL_ALLOWLIST` (`src/lib/ai-office/skill-guard.ts`) و`AGENT_PROFILE_MAP` (`src/lib/ai-office/task-orchestrator.ts`) و`TOOL_REGISTRY` (`src/lib/ai-office/tool-registry.ts`):<br>1. **رامي** (`orchestrator`): `analyze_command` + تنسيق وتجميع الأدلة.<br>2. **كريم** (`principal_architect`): `inspect_codebase` (مقيد بـ `src/` و`supabase/migrations/` فقط) + `propose_patch` (مقفل بموافقة).<br>3. **طارق** (`skills_architect`): `analyze_agent_performance` + `propose_skill_draft` (مقفل بموافقة).<br>4. **عمر** (`operations`): `read_orders`, `read_tags`, `read_subscriptions`, `read_maintenance_reminders`.<br>5. **سارة** (`support`): `read_support_context`, `draft_customer_reply` (مسودة فقط).<br>6. **ليلى** (`marketing`): `draft_marketing_copy` (مسودة فقط بدون نشر). |
| 3 | **توزيع المهام وجمع الأدلة بواسطة رامي** | ✅ مُثبت حياً | `buildDefaultPlanForCommand` و`orchestrateMultiAgentTask` يوزّعان المهام باحترام الاعتماديات والتوازي المحدود للمستقلات، وكل أداة تمر عبر `executeRegisteredTool` وتنتج `ToolExecutionEvidence`، ولا تُغلق المهمة `completed/verified` إلا بتحقق جميع الخطوات. |
| 4 | **حماية المهام الحساسة بالموافقة الخادمية** | ✅ مقفلة (Fail-Closed) | الأداتان الحساسان المسجلتان (`propose_patch` و`propose_skill_draft`) موسومتان بـ `requiresApproval: true`. في `executeRegisteredTool` يُرفض التنفيذ تلقائياً دون `approvalVerifier` خادمي موثوق (ولا يكفي `approvalGranted` أو `approvalId` من العميل). وتم إثبات `createSupabaseApprovalVerifier` على 7 حالات ضد `ai_task_approvals` بما فيها Anti-Replay. |
| 5 | **واجهة `/admin/office` (الحالة، الاستئناف، الأدلة)** | ✅ جاهزة بالكود / ⛔ لم تُختبر بصرياً في متصفح | تم التحقق من وجود `handleResumeTask` (السطر 640)، وشارات الحالات الست (`مكتمل ومتحقق ✓`، `قيد التنفيذ`، `مكتمل جزئياً`، `فاشل`، `بانتظار موافقة`، `متوقف ويحتاج إلى استئناف`)، وزر **استئناف التنفيذ** (السطر 1951)، وقسم **أدلة تنفيذ الأدوات** (السطر 2034) في `src/app/admin/office/page.tsx`. |
| 6 | **عزل الإنتاج وعدم وجود نشر غير مصرح به** | ⚠️ يتطلب التزاماً صارماً عند التشغيل | لم يُنفّذ أي `git commit` أو `push` أو `deploy` على Vercel، والحارس الخادمي `src/lib/supabase/test-env-guard.ts` مربوط في `client.ts` و`workforce-dispatcher.ts`. **تنبيه مهم:** ملف `.env.local` المحلي لا يزال يحتوي رابط الإنتاج (`aivxhxnvgqxylugqrjei`) ومفاتيح مزودي الرسائل؛ لذلك يجب عند تشغيل أي تجربة محلية تمرير متغيرات الاختبار صراحةً (`SUPABASE_URL` → `yemhfpfdinmixhbfszvq`، `BALAGHNI_STRICT_TEST_SUPABASE_GUARD=true`، `WHATSAPP_ACTIVE_PROVIDER=disabled`، وتصفير مفاتيح الرسائل وPostgres) وعدم الاعتماد على `.env.local` كما هو. |

---

## 2. العوائق المتبقية قبل التشغيل الكامل

1. **اختبار المتصفح الفعلي (`BROWSER E2E = BLOCKED`):** لم تُختبر واجهة `/admin/office` بصرياً في متصفح Chromium/Playwright لعدم توفره في بيئة Android Sandbox.
2. **حصة نموذج `gemini-3.8-flash`:** بلغت حد الخطة المجانية (`20 req/day`)؛ لذلك يُنصح في التشغيل التجريبي المحلي باستخدام النموذج الاحتياطي المعتمد في المشروع (`GEMINI_PRIMARY_MODEL=gemini-3.5-flash-lite`) والذي أثبت استجابة سريعة (12–14 ثانية للفريق بالكامل).
3. **الاستئناف التلقائي في الخلفية:** غير متاح بدون Worker/Scheduler خارجي؛ الاستئناف المتاح حالياً هو الاستئناف الصريح عبر زر **استئناف التنفيذ** أو إعادة استدعاء `POST /api/agents/command` بنفس `idempotencyKey`.
4. **منع التكرار الموزّع:** `inFlightByIdempotencyKey` يحمي داخل مثيل الخادم الواحد فقط.
5. **تفعيل `AI_OFFICE_MULTI_AGENT_ENABLED`:** لا يزال `false` افتراضياً ولن يُغيَّر إلا بموافقتك الصريحة عند بدء التجربة.

---

## 3. السيناريو التجريبي المقترح لتشغيل الموظفين الستة معاً (للمراجعة قبل التنفيذ)

> [!IMPORTANT]
> **لم يتم تنفيذ هذا السيناريو بعد.** بانتظار مراجعتك وموافقتك الصريحة على نص الأمر وخطواته.

### نص الأمر المقترح (بيانات اصطناعية بالكامل)
> «[تشغيل تجريبي اصطناعي — PILOT-01] راجع حالة الطلبات والملصقات وسجلات الصيانة، وقيّم تجربة المواطن والبلاغات الحالية مع إعداد مسودة رد (بدون إرسال)، وأعدّ مسودة حملة توعوية للمواطنين حول أهمية تحديث بيانات الملصق (بدون نشر)، وافحص كود الأمان في حارس الصلاحيات، وراجع أداء الوكلاء ومهارات الفريق، ثم قدّم تقريراً تنفيذياً موحداً بالأدلة.»

### خطوات التنفيذ المتوقعة (جميع الموظفين الستة)

| المرحلة | الموظف | الدور | الوضع والاعتمادية | الأدوات المتوقعة (قراءة / مسودة فقط) | المخرج المتوقع |
|---|---|---|---|---|---|
| التخطيط | **رامي** | `orchestrator` | نقطة الدخول | تقسيم الأمر وتوزيع 5 خطوات فرعية | خطة موثّقة في `agent_tasks` و`ai_task_steps` |
| الموجة 1 (توازٍ) | **عمر** | `operations` | `parallel` (`dependsOn: []`) | `read_orders`, `read_tags`, `read_subscriptions`, `read_maintenance_reminders` | ملخص تشغيلي بالأرقام الفعلية من `yemhfpfdinmixhbfszvq` دون اختلاق |
| الموجة 1 (توازٍ) | **كريم** | `principal_architect` | `parallel` (`dependsOn: []`) | `inspect_codebase` (داخل `src/` فقط، مثل `src/lib/ai-office/skill-guard.ts`) | تقرير فحص أمني ومعماري موثّق بدون تعديل كود |
| الموجة 1 (توازٍ) | **طارق** | `skills_architect` | `parallel` (`dependsOn: []`) | `analyze_agent_performance` | تقييم أداء الفريق والمهارات المتاحة دون تعديل صلاحيات |
| الموجة 2 (بعد عمر) | **سارة** | `support` | `sequential` (`dependsOn: ["ops_analysis"]`) | `read_support_context`, `draft_customer_reply` | تحليل البلاغات (بدون PII) + مسودة رد مهذبة **بدون إرسال** |
| الموجة 2 (بعد عمر) | **ليلى** | `marketing` | `parallel` (`dependsOn: ["ops_analysis"]`) | `draft_marketing_copy` | مسودة محتوى توعوي للمراجعة الإدارية **بدون نشر** |
| الإغلاق | **رامي** | `orchestrator` | بعد اكتمال الموجة 2 | التحقق من `ToolExecutionEvidence` وكشف التعارضات | تقرير تنفيذي موحد مع حالة تحقق صريحة (`verified` أو `partial` أو `failed`) |

### المخاطر المحتملة وإجراءات التخفيف

| الخطر | مستوى الخطر | إجراء التخفيف المطبّق |
|---|---|---|
| اتصال عرضي بمشروع الإنتاج `aivxhxnvgqxylugqrjei` | حرج (مُحكم المنع) | تشغيل الخادم المحلي بـ `BALAGHNI_STRICT_TEST_SUPABASE_GUARD=true` و`SUPABASE_URL` مشيراً حصراً إلى `yemhfpfdinmixhbfszvq` (الحارس يرفض التشغيل فوراً عند أي مخالفة). |
| إرسال رسالة WhatsApp أو SMS أو نشر محتوى فعلي | حرج (مُحكم المنع) | تعطيل جميع مزودي الرسائل (`WHATSAPP_ACTIVE_PROVIDER=disabled` وتصفير المفاتيح)؛ أدوات سارة وليلى تنتج مسودات فقط ولا توجد أي أداة إرسال في `TOOL_REGISTRY`. |
| تجاوز مهلة HTTP (60 ثانية) لوجود 5 خطوات | متوسط | استخدام `GEMINI_PRIMARY_MODEL=gemini-3.5-flash-lite` + التنفيذ المتوازي للموجة 1 + `stageTimeBudgetMs: 42000` (إن طالت المهمة تتوقف بأمان بحالة `paused` و`HTTP 202` وتُستأنف بنفس `idempotencyKey` دون إعادة الخطوات المكتملة). |
| تعديل بيانات مواطنين أو حذف سجلات سابقة | منعدم | جميع أدوات القراءة `readOnly: true`؛ والكتابة الوحيدة هي سجلات المهمة التجريبية الجديدة في جداول AI Office داخل قاعدة الاختبار `yemhfpfdinmixhbfszvq` فقط. |

---

## 4. تأكيدات التوقف وعدم التغيير

- لم يتم تعديل أي ملف كود أو صلاحية أو Feature Flag.
- لم يتم تنفيذ السيناريو التجريبي بعد.
- لم يُنفَّذ أي SQL أو Migration أو Rollback أو Commit أو Push أو Deploy.

**بانتظار مراجعتك وموافقتك الصريحة على نص الأمر والسيناريو لبدء التشغيل التجريبي.**
