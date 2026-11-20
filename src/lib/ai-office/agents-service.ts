import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { Client as PgClient } from "pg";
import { supabaseAdmin } from "@/lib/supabase/client";

export type AgentRole =
  | "orchestrator"
  | "principal_architect"
  | "operations"
  | "support"
  | "marketing";

export type AgentStatus = "idle" | "working" | "meeting" | "auditing";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

export type AgentLogType =
  | "info"
  | "security_alert"
  | "code_patch"
  | "design_proposal";

export interface AiAgentRecord {
  id: string;
  name: string;
  role: AgentRole;
  title: string;
  system_prompt: string;
  status: AgentStatus;
  current_task: string | null;
  updated_at: string;
}

export interface AgentTaskRecord {
  id: string;
  title: string;
  description: string;
  assigned_to: string | null;
  status: TaskStatus;
  result: string | null;
  created_at: string;
}

export interface AgentLogRecord {
  id: string;
  agent_id: string | null;
  task_id: string | null;
  message: string;
  log_type: AgentLogType;
  created_at: string;
}

export interface DefaultAgentSeed {
  name: string;
  role: AgentRole;
  title: string;
  system_prompt: string;
}

export const DEFAULT_AI_AGENTS: DefaultAgentSeed[] = [
  {
    name: "رامي",
    role: "orchestrator",
    title: "المدير العام",
    system_prompt:
      "أنت رامي، المدير العام لمنصة بَلِّغْنِي (balaghni.ly) في ليبيا. مهمتك استلام أوامر المؤسس، تحليلها بدقة، اختيار الموظف الأنسب لتنفيذها من فريقك (كريم للأمن والبرمجة والتصميم، عمر للعمليات والمخزون والطلبات، سارة لخدمة العملاء باللهجة الليبية، ليلى للتسويق والمحتوى)، توجيه التعليمات بوضوح، ثم تجميع التقرير التنفيذي النهائي للمؤسس باختصار واحترافية عالية.",
  },
  {
    name: "كريم",
    role: "principal_architect",
    title: "كبير المهندسين وخبير الأمن والتصميم - خبرة +20 سنة",
    system_prompt:
      "أنت كريم، كبير المهندسين وخبير الأمن السيبراني وتصميم UI/UX في منصة بَلِّغْنِي (balaghni.ly) بخبرة تتجاوز 20 عاماً في هندسة البرمجيات، Next.js، Supabase PostgreSQL، سياسات RLS، والأمن السيبراني. مهمتك فحص كود المشروع وقواعد البيانات، اكتشاف الثغرات الأمنية وإغلاقها بكتابة ترقيعات برمجية جاهزة (Code Patches & RLS Policies)، واقتراح وتنفيذ تحسينات بصرية وتصميمية فائقة الجودة تلتزم بهوية بلّغني (#ED001B الأحمر الحيوي، الأسود المطفي #0B0D13، والأبيض النقي). قدّم تقاريرك دائماً بهيكل واضح: (1) التشخيص الأمني أو التصميمي الدقيق، (2) الكود الجاهز للتنفيذ أو الترقيع داخل كتل كود واضحة.",
  },
  {
    name: "عمر",
    role: "operations",
    title: "مسؤول العمليات والمخزون",
    system_prompt:
      "أنت عمر، مسؤول العمليات والمخزون في منصة بَلِّغْنِي (balaghni.ly). تتابع الطلبات (الكاش والأونلاين)، حالة ملصقات QR في Supabase (LOCKED / ACTIVE / REVOKED)، عهدة الموزعين، وتجهز تقارير التوصيل والمخزون بدقة وأرقام واضحة وتوصيات عملية فورية.",
  },
  {
    name: "سارة",
    role: "support",
    title: "مسؤولة خدمة العملاء",
    system_prompt:
      "أنتِ سارة، مسؤولة خدمة العملاء في منصة بَلِّغْنِي (balaghni.ly) في ليبيا. تردين على استفسارات الزبائن ومالكي المركبات باللهجة الليبية المهذبة والودودة، وتجهزين ردود واتساب احترافية وسريعة تحل مشاكل التفعيل والربط والبلاغات بوضوح ولباقة.",
  },
  {
    name: "ليلى",
    role: "marketing",
    title: "مسؤولة التسويق والمحتوى",
    system_prompt:
      "أنتِ ليلى، مسؤولة التسويق والمحتوى في منصة بَلِّغْنِي (balaghni.ly) في ليبيا. تكتبين نصوصاً إعلانية وحملات ومنشورات سوشيال ميديا جذابة باللهجة الليبية العصرية تناسب هوية بلّغني (#ED001B الأحمر الحيوي والأسود المطفي) وتبرز قيمة الخصوصية والأمان لأصحاب السيارات في ليبيا.",
  },
];

let schemaBootstrapped = false;

export async function ensureAiOfficeSchemaAndSeed(): Promise<{
  ok: boolean;
  migrated?: boolean;
  error?: string;
}> {
  // 1. تحقق سريع من وجود جدول ai_agents
  const { data: existingAgents, error: checkErr } = await supabaseAdmin
    .from("ai_agents")
    .select("id, role");

  if (!checkErr && Array.isArray(existingAgents)) {
    if (existingAgents.length < DEFAULT_AI_AGENTS.length) {
      await supabaseAdmin.from("ai_agents").upsert(
        DEFAULT_AI_AGENTS.map((a) => ({
          name: a.name,
          role: a.role,
          title: a.title,
          system_prompt: a.system_prompt,
          status: "idle",
        })),
        { onConflict: "role" }
      );
    }
    schemaBootstrapped = true;
    return { ok: true, migrated: false };
  }

  // 2. إذا لم تكن الجداول موجودة بعد، نفّذ ملف الهجرة تلقائياً عبر POSTGRES_URL_NON_POOLING
  const pgUrl = (
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    ""
  ).trim();

  if (!pgUrl) {
    return {
      ok: false,
      error:
        "جداول غرفة العمليات (ai_agents, agent_tasks, agent_logs) غير منشأة بعد في Supabase. يرجى تنفيذ ملف supabase/ai_office_agents.sql في Supabase SQL Editor.",
    };
  }

  if (schemaBootstrapped) {
    return { ok: true };
  }

  try {
    const sqlPath = path.join(process.cwd(), "supabase", "ai_office_agents.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");
    const pgClient = new PgClient({
      connectionString: pgUrl,
      ssl: { rejectUnauthorized: false },
    });
    await pgClient.connect();
    try {
      await pgClient.query(sql);
    } finally {
      await pgClient.end();
    }
    schemaBootstrapped = true;
    return { ok: true, migrated: true };
  } catch (err) {
    return {
      ok: false,
      error: `تعذر تنفيذ الهجرة التلقائية: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

export async function broadcastAiOfficeEvent(payload: {
  type: "agent_update" | "log_created" | "task_update" | "refresh";
  agent?: Partial<AiAgentRecord>;
  log?: AgentLogRecord;
  task?: AgentTaskRecord;
}): Promise<void> {
  try {
    const channel = supabaseAdmin.channel("ai-office:live", {
      config: { broadcast: { self: false } },
    });
    await new Promise<void>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          void supabaseAdmin.removeChannel(channel);
          resolve();
        }
      }, 1500);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED" && !settled) {
          settled = true;
          clearTimeout(timer);
          void channel
            .send({
              type: "broadcast",
              event: "office-event",
              payload: { ...payload, at: new Date().toISOString() },
            })
            .finally(() => {
              setTimeout(() => {
                void supabaseAdmin.removeChannel(channel);
                resolve();
              }, 120);
            });
        }
      });
    });
  } catch {
    // ignore realtime broadcast failures
  }
}

const STUCK_AGENT_TIMEOUT_MS = 2 * 60 * 1000; // دقيقتان كحد أقصى قبل التعافي التلقائي

/**
 * آلية التعافي التلقائي (Auto-Recovery):
 * إذا بقي أي موظف في حالة (working أو auditing أو meeting) لأكثر من دقيقتين دون تحديث جديد،
 * يُعاد تلقائياً إلى حالة (idle) ويُغلق أي سجل مهمة عالق لضمان عدم تجمد أي موظف في الواجهة.
 */
export async function recoverStuckAgents(): Promise<number> {
  try {
    const cutoffIso = new Date(Date.now() - STUCK_AGENT_TIMEOUT_MS).toISOString();
    const { data: stuckAgents, error } = await supabaseAdmin
      .from("ai_agents")
      .select("id, name, status, updated_at")
      .in("status", ["working", "auditing", "meeting"])
      .lt("updated_at", cutoffIso);

    if (error || !Array.isArray(stuckAgents) || stuckAgents.length === 0) {
      return 0;
    }

    const nowIso = new Date().toISOString();
    const stuckIds = stuckAgents.map((a) => String(a.id));

    await supabaseAdmin
      .from("ai_agents")
      .update({
        status: "idle",
        current_task: null,
        updated_at: nowIso,
      })
      .in("id", stuckIds);

    await supabaseAdmin
      .from("agent_tasks")
      .update({
        status: "failed",
        result:
          "تم إنهاء المهمة وإعادة الموظف تلقائياً إلى وضع الاستعداد بعد تجاوز مهلة الدقيقتين (Auto-Recovery).",
      })
      .eq("status", "in_progress")
      .lt("created_at", cutoffIso);

    await Promise.allSettled(
      stuckIds.map((id) =>
        broadcastAiOfficeEvent({
          type: "agent_update",
          agent: {
            id,
            status: "idle",
            current_task: null,
            updated_at: nowIso,
          },
        })
      )
    );

    return stuckIds.length;
  } catch {
    return 0;
  }
}

export async function getAiOfficeSnapshot(): Promise<{
  agents: AiAgentRecord[];
  tasks: AgentTaskRecord[];
  logs: AgentLogRecord[];
}> {
  // تشغيل فحص التعافي التلقائي للموظفين العالقين (> دقيقتين) قبل جلب اللقطة الحية
  await recoverStuckAgents();

  const [agentsRes, tasksRes, logsRes] = await Promise.all([
    supabaseAdmin.from("ai_agents").select("*"),
    supabaseAdmin
      .from("agent_tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25),
    supabaseAdmin
      .from("agent_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const roleOrder: Record<string, number> = {
    orchestrator: 0,
    principal_architect: 1,
    operations: 2,
    support: 3,
    marketing: 4,
  };

  const agents = ((agentsRes.data || []) as AiAgentRecord[]).sort(
    (a, b) => (roleOrder[a.role] ?? 99) - (roleOrder[b.role] ?? 99)
  );
  const tasks = (tasksRes.data || []) as AgentTaskRecord[];
  const logs = ((logsRes.data || []) as AgentLogRecord[]).reverse();

  return { agents, tasks, logs };
}

async function updateAgentState(
  agentId: string,
  status: AgentStatus,
  currentTask: string | null
): Promise<void> {
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from("ai_agents")
    .update({
      status,
      current_task: currentTask,
      updated_at: nowIso,
    })
    .eq("id", agentId);

  await broadcastAiOfficeEvent({
    type: "agent_update",
    agent: {
      id: agentId,
      status,
      current_task: currentTask,
      updated_at: nowIso,
    },
  });
}

async function appendAgentLog(params: {
  agentId: string | null;
  taskId: string | null;
  message: string;
  logType: AgentLogType;
}): Promise<AgentLogRecord | null> {
  const { data } = await supabaseAdmin
    .from("agent_logs")
    .insert({
      agent_id: params.agentId,
      task_id: params.taskId,
      message: params.message,
      log_type: params.logType,
    })
    .select("*")
    .single();

  if (data) {
    const rec = data as AgentLogRecord;
    await broadcastAiOfficeEvent({
      type: "log_created",
      log: rec,
    });
    return rec;
  }
  return null;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("المتغير GEMINI_API_KEY غير مضبوط في إعدادات البيئة.");
  }
  return new GoogleGenAI({ apiKey });
}

async function callGeminiAgent(params: {
  systemInstruction: string;
  input: string;
  model?: string;
}): Promise<string> {
  const client = getGeminiClient();
  const modelName = params.model || "gemini-3.8-flash";

  const interaction = await client.interactions.create({
    model: modelName,
    system_instruction: params.systemInstruction,
    input: params.input,
    store: false,
  });

  const text = (interaction.output_text || "").trim();
  if (!text) {
    throw new Error("لم يتم استلام رد نصي من نموذج Gemini.");
  }
  return text;
}

function safeReadSnippet(relPath: string, maxChars = 2600): string {
  try {
    const abs = path.join(process.cwd(), relPath);
    if (!fs.existsSync(abs)) return "";
    const content = fs.readFileSync(abs, "utf8");
    return `--- ملف: ${relPath} ---\n${content.slice(0, maxChars)}\n`;
  } catch {
    return "";
  }
}

async function gatherLiveContextForRole(
  role: AgentRole,
  command: string
): Promise<string> {
  if (role === "principal_architect") {
    const lower = command.toLowerCase();
    const snippets: string[] = [];

    snippets.push(safeReadSnippet("next.config.mjs", 1800));
    if (
      /أمن|ثغر|rls|سياس|قاعد|بيان|security|sql|auth|صلاحي/i.test(lower)
    ) {
      snippets.push(safeReadSnippet("supabase/security_hardening_rls.sql", 2800));
      snippets.push(safeReadSnippet("supabase/ai_office_agents.sql", 2000));
      snippets.push(safeReadSnippet("src/app/api/admin/route.ts", 2400));
    } else if (
      /تصميم|ديزاين|واجه|لون|ui|ux|صفح|زر|شاش|css|tailwind/i.test(lower)
    ) {
      snippets.push(safeReadSnippet("src/app/globals.css", 2400));
      snippets.push(safeReadSnippet("tailwind.config.ts", 1800));
      snippets.push(safeReadSnippet("src/components/scan/scan-form.tsx", 2200));
    } else {
      snippets.push(safeReadSnippet("supabase/security_hardening_rls.sql", 2000));
      snippets.push(safeReadSnippet("src/app/api/notify/route.ts", 2000));
    }

    return [
      "بيئة المشروع الحقيقية: Next.js 16 (App Router) + TypeScript + Tailwind CSS + Supabase PostgreSQL + Twilio WhatsApp + WebRTC.",
      "الهوية البصرية الرسمية لمنصة بلّغني: الأحمر الحيوي #ED001B، الأسود المطفي #0B0D13، الأبيض النقي #FFFFFF.",
      snippets.filter(Boolean).join("\n"),
    ].join("\n\n");
  }

  if (role === "operations") {
    try {
      const [tagsRes, stickersRes, ordersRes, reportsRes] = await Promise.all([
        supabaseAdmin.from("tags").select("status", { count: "exact" }).limit(500),
        supabaseAdmin.from("stickers").select("status, plan_type").limit(500),
        supabaseAdmin
          .from("orders")
          .select("status, payment_method, total_lyd, city, created_at")
          .order("created_at", { ascending: false })
          .limit(30),
        supabaseAdmin
          .from("reports")
          .select("id, tag_code, reason_title, reason_badge, created_at")
          .order("created_at", { ascending: false })
          .limit(15),
      ]);

      const tagRows = tagsRes.data || [];
      const activeTags = tagRows.filter(
        (t) => String(t.status || "").toUpperCase() === "ACTIVE"
      ).length;
      const lockedTags = tagRows.filter(
        (t) => String(t.status || "").toUpperCase() === "LOCKED"
      ).length;
      const stickerRows = stickersRes.data || [];
      const orderRows = ordersRes.data || [];
      const pendingCod = orderRows.filter(
        (o) => String(o.status || "") === "pending_delivery"
      ).length;
      const completedOrders = orderRows.filter(
        (o) => String(o.status || "") === "completed"
      ).length;
      const totalRevenueLyd = orderRows
        .filter((o) => String(o.status || "") === "completed")
        .reduce((sum, o) => sum + Number(o.total_lyd || 0), 0);

      return JSON.stringify(
        {
          liveSupabaseStats: {
            totalTagsSampled: tagRows.length,
            activeTags,
            lockedStockTags: lockedTags,
            stickersCount: stickerRows.length,
            recentOrdersCount: orderRows.length,
            pendingCodDeliveries: pendingCod,
            completedOrders,
            recentCompletedRevenueLyd: totalRevenueLyd,
            recentReportsCount: (reportsRes.data || []).length,
            latestOrders: orderRows.slice(0, 6),
          },
        },
        null,
        2
      );
    } catch {
      return "تعذر جلب بعض إحصائيات Supabase اللحظية، قدّم خطة تشغيلية دقيقة لمتابعة المخزون والتوصيل.";
    }
  }

  return "معلومات منصة بَلِّغْنِي (balaghni.ly) في ليبيا: ملصق QR ذكي للسيارات يحمي خصوصية رقم هاتف المالك (Zero-Leak). الباقات: الباقة الأساسية (50 د.ل/سنة - واتساب فوري)، باقة نبّهني (100 د.ل/سنة - واتساب + SMS احتياطي + تذكير الوثائق والزيت + مرفقات صور + مكالمة صوتية مشفرة)، وباقة الهدية (30 يوم مجاني). الهوية: #ED001B والأسود المطفي.";
}

function heuristicRouteRole(command: string): AgentRole {
  if (
    /ثغر|أمن|حماي|كود|برمج|ترقيع|rls|sql|supabase|api|تصميم|ديزاين|واجه|ui|ux|لون|خطأ|bug|patch|audit|فحص|شاش|مكون/i.test(
      command
    )
  ) {
    return "principal_architect";
  }
  if (
    /مخزون|طلب|طلبات|توصيل|شحن|ملصق|ملصقات|كاش|موزع|مبيعات|جرد|عملي|تقرير.*مخزون/i.test(
      command
    )
  ) {
    return "operations";
  }
  if (
    /زبون|عميل|عملاء|رد.*واتس|شكوى|استفسار|دعم|خدمة العملاء|رسالة للعميل|تفعيل ملصق/i.test(
      command
    )
  ) {
    return "support";
  }
  if (
    /تسويق|إعلان|اعلان|منشور|بوست|محتوى|حمل|فيسبوك|انستغرام|تيك توك|ترويج|سوشيال/i.test(
      command
    )
  ) {
    return "marketing";
  }
  return "principal_architect";
}

function extractJsonBlock(raw: string): Record<string, unknown> | null {
  try {
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
  } catch {
    // ignore
  }
  return null;
}

export async function executeFounderCommand(params: {
  command: string;
  targetRole?: "orchestrator" | "principal_architect";
  adminName?: string;
}): Promise<{
  ok: boolean;
  task: AgentTaskRecord | null;
  delegatedTo: AiAgentRecord | null;
  summary: string;
  agents: AiAgentRecord[];
  logs: AgentLogRecord[];
  error?: string;
}> {
  const command = String(params.command || "").trim();
  if (!command) {
    throw new Error("يرجى كتابة الأمر المطلوب تنفيذه.");
  }

  const bootstrap = await ensureAiOfficeSchemaAndSeed();
  if (!bootstrap.ok) {
    throw new Error(bootstrap.error || "قاعدة بيانات غرفة العمليات غير جاهزة.");
  }

  const snapshot = await getAiOfficeSnapshot();
  const byRole = new Map<AgentRole, AiAgentRecord>();
  for (const a of snapshot.agents) {
    byRole.set(a.role, a);
  }

  const rami = byRole.get("orchestrator") || snapshot.agents[0];
  const karim = byRole.get("principal_architect");

  if (!rami) {
    throw new Error("لم يتم العثور على المدير العام (رامي) في جدول ai_agents.");
  }

  const isDirectToKarim =
    params.targetRole === "principal_architect" && Boolean(karim);

  // 1. إنشاء سجل المهمة مبدئياً
  const { data: createdTask } = await supabaseAdmin
    .from("agent_tasks")
    .insert({
      title: command.slice(0, 90),
      description: command,
      assigned_to: isDirectToKarim && karim ? karim.id : rami.id,
      status: "in_progress",
    })
    .select("*")
    .single();

  const task = (createdTask as AgentTaskRecord) || null;
  const taskId = task?.id || null;

  if (task) {
    await broadcastAiOfficeEvent({ type: "task_update", task });
  }

  let selectedSpecialist: AiAgentRecord = karim || rami;

  try {
    // 2. تغيير حالة رامي إلى working وتسجيل استلام أمر المؤسس
    await updateAgentState(
      rami.id,
      "working",
      `تحليل أمر المؤسس: ${command.slice(0, 60)}`
    );

    await appendAgentLog({
      agentId: rami.id,
      taskId,
      logType: "info",
      message: isDirectToKarim
        ? `📥 تم استلام أمر مباشر من المؤسس (${params.adminName || "الأدمن الرئيسي"}) ومُوجّه فوراً إلى مكتب كريم (كبير المهندسين والأمن والتصميم): «${command}»`
        : `📥 تم استلام أمر المؤسس (${params.adminName || "الأدمن الرئيسي"}): «${command}» — جارٍ التحليل وتحديد المسؤول الأنسب من الفريق.`,
    });

    let delegationNote = "";
    let specialistBrief = command;

    if (isDirectToKarim && karim) {
      selectedSpecialist = karim;
      delegationNote = `تم تحويل المهمة مباشرة إلى كريم (${karim.title}) للفحص الفني وإعداد الترقيع/المقترح.`;
    } else {
      // 3. رامي يحلل الأمر عبر Gemini ويقرر من سيستلم المهمة
      const routingPrompt = `
أمر المؤسس:
"${command}"

فريقك المتاح:
- principal_architect (كريم): كبير المهندسين وخبير الأمن والتصميم (+20 سنة خبرة) — يستلم فوراً أي طلب فحص ثغرات، أمن سيبراني، RLS، برمجة، كود، أخطاء تقنية، أو تعديل/تحسين تصميم UI/UX.
- operations (عمر): مسؤول العمليات والمخزون — يستلم متابعة الطلبات، ملصقات QR، المخزون، والتوصيل.
- support (سارة): مسؤولة خدمة العملاء — تستلم ردود الزبائن باللهجة الليبية ورسائل واتساب الدعم الفني.
- marketing (ليلى): مسؤولة التسويق والمحتوى — تستلم الإعلانات، المنشورات، والحملات باللهجة الليبية.

أرجع JSON فقط بهذا الشكل الدقيق دون أي نص خارجه:
{
  "target_role": "principal_architect | operations | support | marketing",
  "task_title": "عنوان مختصر للمهمة",
  "delegation_message": "رسالة قصيرة من رامي يوجّه فيها الموظف المختار",
  "brief": "تعليمات تنفيذ دقيقة للموظف المختار"
}
`;
      let targetRole: AgentRole = heuristicRouteRole(command);
      try {
        const routeRaw = await callGeminiAgent({
          systemInstruction: rami.system_prompt,
          input: routingPrompt,
        });
        const parsed = extractJsonBlock(routeRaw);
        const candidateRole = String(parsed?.target_role || "").trim() as AgentRole;
        if (
          candidateRole === "principal_architect" ||
          candidateRole === "operations" ||
          candidateRole === "support" ||
          candidateRole === "marketing"
        ) {
          targetRole = candidateRole;
        }
        if (typeof parsed?.delegation_message === "string" && parsed.delegation_message.trim()) {
          delegationNote = parsed.delegation_message.trim();
        }
        if (typeof parsed?.brief === "string" && parsed.brief.trim()) {
          specialistBrief = parsed.brief.trim();
        }
        if (taskId && typeof parsed?.task_title === "string" && parsed.task_title.trim()) {
          await supabaseAdmin
            .from("agent_tasks")
            .update({ title: parsed.task_title.trim().slice(0, 100) })
            .eq("id", taskId);
        }
      } catch {
        targetRole = heuristicRouteRole(command);
      }

      selectedSpecialist = byRole.get(targetRole) || karim || rami;
      if (!delegationNote) {
        delegationNote = `أحلتُ المهمة إلى ${selectedSpecialist.name} (${selectedSpecialist.title}) للبدء بالتنفيذ الفوري.`;
      }
    }

    // 4. تحديث المهمة وإدخال رامي في اجتماع وتفعيل الموظف المختص
    const specialistStatus: AgentStatus =
      selectedSpecialist.role === "principal_architect" ? "auditing" : "working";

    await Promise.all([
      taskId
        ? supabaseAdmin
            .from("agent_tasks")
            .update({ assigned_to: selectedSpecialist.id })
            .eq("id", taskId)
        : Promise.resolve(),
      updateAgentState(rami.id, "meeting", `متابعة التنفيذ مع ${selectedSpecialist.name}`),
      updateAgentState(
        selectedSpecialist.id,
        specialistStatus,
        command.slice(0, 80)
      ),
      appendAgentLog({
        agentId: rami.id,
        taskId,
        logType: "info",
        message: `🎯 توجيه إلى ${selectedSpecialist.name}: ${delegationNote}`,
      }),
    ]);

    // 5. تنفيذ المهمة بواسطة الموظف المختص مع سياق المشروع الحي
    const liveContext = await gatherLiveContextForRole(
      selectedSpecialist.role,
      command
    );

    let specialistFullResult = "";

    if (selectedSpecialist.role === "principal_architect") {
      const karimPrompt = `
لديك مهمة عاجلة من المؤسس عبر المدير العام رامي:
الأمر: "${command}"
التوجيه: "${specialistBrief}"

السياق الحقيقي من كود وبيئة مشروع بَلِّغْنِي:
${liveContext}

أخرج استجابتك بصيغة JSON صالحة فقط (داخل كتلة \`\`\`json ... \`\`\`) بهذا الهيكل الدقيق:
{
  "focus": "security | design | code",
  "diagnosis_title": "عنوان التشخيص الفني أو الأمني أو التصميمي",
  "diagnosis_details": "شرح دقيق ومباشر للثغرات أو المشاكل المكتشفة أو نقاط التحسين البصري وفق هوية بلّغني (#ED001B والأسود المطفي)",
  "patch_summary": "وصف مختصر للترقيع أو الكود الجاهز",
  "code_patch": "الكود الكامل الجاهز للتنفيذ (TypeScript / TSX / SQL RLS) بدون علامات ثلاثية داخله"
}
`;
      const karimRaw = await callGeminiAgent({
        systemInstruction: selectedSpecialist.system_prompt,
        input: karimPrompt,
      });

      const parsedKarim = extractJsonBlock(karimRaw);
      if (parsedKarim) {
        const focus = String(parsedKarim.focus || "security").toLowerCase();
        const diagTitle = String(
          parsedKarim.diagnosis_title || "تقرير الفحص الفني"
        ).trim();
        const diagDetails = String(
          parsedKarim.diagnosis_details || karimRaw
        ).trim();
        const patchSummary = String(
          parsedKarim.patch_summary || "كود الترقيع الجاهز للتنفيذ"
        ).trim();
        const codePatch = String(parsedKarim.code_patch || "").trim();

        const diagLogType: AgentLogType =
          focus === "design" ? "design_proposal" : "security_alert";

        await appendAgentLog({
          agentId: selectedSpecialist.id,
          taskId,
          logType: diagLogType,
          message: `🔍 ${diagTitle}\n\n${diagDetails}`,
        });

        if (codePatch) {
          await appendAgentLog({
            agentId: selectedSpecialist.id,
            taskId,
            logType: "code_patch",
            message: `${patchSummary}\n\n\`\`\`\n${codePatch}\n\`\`\``,
          });
        }

        specialistFullResult = `${diagTitle}\n${diagDetails}${
          codePatch ? `\n\n--- الكود المقترح ---\n${codePatch}` : ""
        }`;
      } else {
        const isDesign = /تصميم|ديزاين|ui|ux|لون|واجه/i.test(command);
        await appendAgentLog({
          agentId: selectedSpecialist.id,
          taskId,
          logType: isDesign ? "design_proposal" : "security_alert",
          message: karimRaw,
        });
        specialistFullResult = karimRaw;
      }
    } else {
      const specialistPrompt = `
لديك مهمة من المؤسس عبر المدير العام رامي:
الأمر: "${command}"
التوجيه: "${specialistBrief}"

بيانات وسياق منصة بَلِّغْنِي الحالية:
${liveContext}

قدّم ردك التنفيذي الاحترافي الكامل والمباشر باللغة العربية (وباللهجة الليبية المهذبة إن كان دورك خدمة عملاء أو تسويق).
`;
      specialistFullResult = await callGeminiAgent({
        systemInstruction: selectedSpecialist.system_prompt,
        input: specialistPrompt,
      });

      await appendAgentLog({
        agentId: selectedSpecialist.id,
        taskId,
        logType: "info",
        message: specialistFullResult,
      });
    }

    // 6. عودة المختص إلى idle وتجميع رامي للتقرير التنفيذي النهائي للمؤسس
    await updateAgentState(selectedSpecialist.id, "idle", null);
    await updateAgentState(rami.id, "working", "تجميع التقرير التنفيذي النهائي للمؤسس");

    let executiveSummary = "";
    try {
      executiveSummary = await callGeminiAgent({
        systemInstruction: rami.system_prompt,
        input: `أكمل ${selectedSpecialist.name} (${selectedSpecialist.title}) تنفيذ أمر المؤسس: "${command}".
مخرجات ${selectedSpecialist.name}:
${specialistFullResult.slice(0, 3500)}

اكتب خلاصة تنفيذية موجزة واحترافية للمؤسس في 3 إلى 5 نقاط مركّزة توضح ما تم إنجازه والخطوة التالية المقترحة.`,
      });
    } catch {
      executiveSummary = `تم تنفيذ المهمة بواسطة ${selectedSpecialist.name} بنجاح، ويمكنك مراجعة التفاصيل والترقيعات الكاملة في السجل المباشر أعلاه.`;
    }

    await appendAgentLog({
      agentId: rami.id,
      taskId,
      logType: "info",
      message: `📋 التقرير التنفيذي النهائي للمؤسس:\n${executiveSummary}`,
    });

    if (taskId) {
      const { data: updatedTask } = await supabaseAdmin
        .from("agent_tasks")
        .update({
          status: "completed",
          result: `${executiveSummary}\n\n---\n${specialistFullResult}`,
        })
        .eq("id", taskId)
        .select("*")
        .single();
      if (updatedTask) {
        await broadcastAiOfficeEvent({
          type: "task_update",
          task: updatedTask as AgentTaskRecord,
        });
      }
    }

    await updateAgentState(rami.id, "idle", null);

    const finalSnapshot = await getAiOfficeSnapshot();
    return {
      ok: true,
      task:
        finalSnapshot.tasks.find((t) => t.id === taskId) || task,
      delegatedTo: selectedSpecialist,
      summary: executiveSummary,
      agents: finalSnapshot.agents,
      logs: finalSnapshot.logs,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await Promise.allSettled([
      updateAgentState(rami.id, "idle", null),
      selectedSpecialist ? updateAgentState(selectedSpecialist.id, "idle", null) : Promise.resolve(),
      taskId
        ? supabaseAdmin
            .from("agent_tasks")
            .update({ status: "failed", result: errMsg })
            .eq("id", taskId)
        : Promise.resolve(),
      appendAgentLog({
        agentId: rami.id,
        taskId,
        logType: "security_alert",
        message: `⚠️ تعذر إكمال تنفيذ المهمة: ${errMsg}`,
      }),
    ]);

    const finalSnapshot = await getAiOfficeSnapshot();
    return {
      ok: false,
      task,
      delegatedTo: selectedSpecialist,
      summary: "",
      agents: finalSnapshot.agents,
      logs: finalSnapshot.logs,
      error: errMsg,
    };
  }
}
