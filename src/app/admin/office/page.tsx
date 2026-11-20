"use client";

import * as React from "react";
import Link from "next/link";
import {
  ShieldAlert,
  ShieldCheck,
  Code2,
  Palette,
  Crown,
  PackageCheck,
  Headphones,
  Megaphone,
  Send,
  Copy,
  Check,
  RefreshCw,
  ArrowRight,
  Radio,
  Sparkles,
  LoaderCircle,
  Terminal,
  LockKeyhole,
  Activity,
  Briefcase,
  FileCode2,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { supabaseRealtime } from "@/lib/supabase/realtime";

type AgentRole =
  | "orchestrator"
  | "principal_architect"
  | "operations"
  | "support"
  | "marketing";

type AgentStatus = "idle" | "working" | "meeting" | "auditing";
type AgentLogType =
  | "info"
  | "security_alert"
  | "code_patch"
  | "design_proposal";

interface AiAgentRecord {
  id: string;
  name: string;
  role: AgentRole;
  title: string;
  system_prompt: string;
  status: AgentStatus;
  current_task: string | null;
  updated_at: string;
}

interface AgentTaskRecord {
  id: string;
  title: string;
  description: string;
  assigned_to: string | null;
  status: "pending" | "in_progress" | "completed" | "failed";
  result: string | null;
  created_at: string;
}

interface AgentLogRecord {
  id: string;
  agent_id: string | null;
  task_id: string | null;
  message: string;
  log_type: AgentLogType;
  created_at: string;
}

const STATUS_META: Record<
  AgentStatus,
  { label: string; dotClass: string; badgeClass: string; pulse: boolean }
> = {
  idle: {
    label: "متاح (Idle)",
    dotClass: "bg-emerald-400",
    badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    pulse: false,
  },
  working: {
    label: "قيد التنفيذ (Working)",
    dotClass: "bg-[#ED001B]",
    badgeClass: "bg-[#ED001B]/20 text-rose-200 border-[#ED001B]/50",
    pulse: true,
  },
  meeting: {
    label: "اجتماع تنسيقي (Meeting)",
    dotClass: "bg-amber-400",
    badgeClass: "bg-amber-500/15 text-amber-200 border-amber-500/40",
    pulse: true,
  },
  auditing: {
    label: "فحص أمني وهندسي (Auditing)",
    dotClass: "bg-[#ED001B]",
    badgeClass: "bg-[#ED001B]/25 text-white border-[#ED001B]",
    pulse: true,
  },
};

const QUICK_COMMANDS: Array<{
  label: string;
  target: "orchestrator" | "principal_architect";
  command: string;
}> = [
  {
    label: "فحص ثغرات الأمان و RLS",
    target: "principal_architect",
    command:
      "افحص سياسات RLS وأمن مسارات API في منصة بلّغني، وحدد أي نقاط ضعف محتملة مع كتابة كود الترقيع الجاهز.",
  },
  {
    label: "تحسين UI/UX بهوية بلّغني",
    target: "principal_architect",
    command:
      "اقترح تحسيناً بصرياً وتصميمياً لصفحة مسح الملصق يلتزم بهوية بلّغني (#ED001B والأسود المطفي) مع كود TSX جاهز.",
  },
  {
    label: "تقرير المخزون والطلبات",
    target: "orchestrator",
    command:
      "أريد تقريراً تنفيذياً فورياً عن حالة مخزون ملصقات QR والطلبات المعلقة والمكتملة في Supabase.",
  },
  {
    label: "حملة تسويقية ليبية",
    target: "orchestrator",
    command:
      "اكتب منشوراً ترويجياً جذاباً باللهجة الليبية لباقة نبّهني (100 د.ل) يبرز الخصوصية والمكالمة المشفرة.",
  },
];

function getRoleIcon(role: AgentRole) {
  switch (role) {
    case "orchestrator":
      return Crown;
    case "principal_architect":
      return ShieldCheck;
    case "operations":
      return PackageCheck;
    case "support":
      return Headphones;
    case "marketing":
      return Megaphone;
    default:
      return Briefcase;
  }
}

function parseMessageParts(
  message: string
): Array<{ type: "text" | "code"; content: string; lang?: string }> {
  const parts: Array<{ type: "text" | "code"; content: string; lang?: string }> =
    [];
  const regex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(message)) !== null) {
    if (match.index > lastIndex) {
      const textChunk = message.slice(lastIndex, match.index).trim();
      if (textChunk) parts.push({ type: "text", content: textChunk });
    }
    const codeChunk = (match[2] || "").trim();
    if (codeChunk) {
      parts.push({
        type: "code",
        lang: (match[1] || "code").trim(),
        content: codeChunk,
      });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < message.length) {
    const rest = message.slice(lastIndex).trim();
    if (rest) parts.push({ type: "text", content: rest });
  }

  if (parts.length === 0) {
    parts.push({ type: "text", content: message });
  }
  return parts;
}

export default function AdminOfficePage() {
  const [loading, setLoading] = React.useState(true);
  const [authenticated, setAuthenticated] = React.useState(false);
  const [adminName, setAdminName] = React.useState<string>("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [agents, setAgents] = React.useState<AiAgentRecord[]>([]);
  const [tasks, setTasks] = React.useState<AgentTaskRecord[]>([]);
  const [logs, setLogs] = React.useState<AgentLogRecord[]>([]);
  const [realtimeConnected, setRealtimeConnected] = React.useState(false);

  const [commandInput, setCommandInput] = React.useState("");
  const [targetRole, setTargetRole] = React.useState<
    "orchestrator" | "principal_architect"
  >("orchestrator");
  const [isExecuting, setIsExecuting] = React.useState(false);
  const [logFilter, setLogFilter] = React.useState<"all" | AgentLogType>("all");
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  const feedEndRef = React.useRef<HTMLDivElement | null>(null);

  const fetchOfficeState = React.useCallback(async () => {
    try {
      const res = await fetch("/api/agents/office", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403 || !data.authenticated) {
        setAuthenticated(false);
        setErrorMsg(
          data.error ||
            "هذه الصفحة محمية للأدمن الرئيسي فقط. يرجى تسجيل الدخول من لوحة الإدارة."
        );
        setLoading(false);
        return;
      }

      setAuthenticated(true);
      if (data.adminProfile?.fullName) {
        setAdminName(String(data.adminProfile.fullName));
      }

      if (!data.ok) {
        setErrorMsg(data.error || "تعذر تحميل بيانات غرفة العمليات.");
        setLoading(false);
        return;
      }

      setErrorMsg(null);
      setAgents(Array.isArray(data.agents) ? data.agents : []);
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setLoading(false);
    } catch {
      setErrorMsg("تعذر الاتصال بخادم غرفة العمليات.");
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchOfficeState();
  }, [fetchOfficeState]);

  // اشتراك Supabase Realtime اللحظي لمتابعة حالات الموظفين وسجل الحوارات
  React.useEffect(() => {
    if (!authenticated) return;

    const channel = supabaseRealtime
      .channel("ai-office:live")
      .on("broadcast", { event: "office-event" }, ({ payload }) => {
        if (!payload) return;
        if (payload.type === "agent_update" && payload.agent?.id) {
          setAgents((prev) =>
            prev.map((a) =>
              a.id === payload.agent.id ? { ...a, ...payload.agent } : a
            )
          );
        } else if (payload.type === "log_created" && payload.log?.id) {
          setLogs((prev) => {
            if (prev.some((l) => l.id === payload.log.id)) return prev;
            return [...prev, payload.log as AgentLogRecord];
          });
        } else if (payload.type === "task_update" && payload.task?.id) {
          setTasks((prev) => {
            const exists = prev.some((t) => t.id === payload.task.id);
            if (exists) {
              return prev.map((t) =>
                t.id === payload.task.id ? (payload.task as AgentTaskRecord) : t
              );
            }
            return [payload.task as AgentTaskRecord, ...prev];
          });
        } else {
          void fetchOfficeState();
        }
      })
      .subscribe((status) => {
        setRealtimeConnected(status === "SUBSCRIBED");
      });

    return () => {
      void supabaseRealtime.removeChannel(channel);
    };
  }, [authenticated, fetchOfficeState]);

  React.useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const handleCopyCode = async (key: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2200);
    } catch {
      // ignore
    }
  };

  const handleSendCommand = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = commandInput.trim();
    if (!trimmed || isExecuting) return;

    setIsExecuting(true);
    setErrorMsg(null);
    setCommandInput("");

    try {
      const res = await fetch("/api/agents/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          command: trimmed,
          targetRole,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || "تعذر تنفيذ الأمر حالياً.");
      }
      if (Array.isArray(data.agents)) setAgents(data.agents);
      if (Array.isArray(data.logs)) setLogs(data.logs);
      await fetchOfficeState();
    } catch {
      setErrorMsg("حدث خطأ في الاتصال أثناء إرسال الأمر.");
    } finally {
      setIsExecuting(false);
    }
  };

  const agentById = React.useMemo(() => {
    const map = new Map<string, AiAgentRecord>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  const karim = agents.find((a) => a.role === "principal_architect") || null;
  const otherAgents = agents.filter((a) => a.role !== "principal_architect");

  const filteredLogs = React.useMemo(() => {
    if (logFilter === "all") return logs;
    return logs.filter((l) => l.log_type === logFilter);
  }, [logs, logFilter]);

  if (loading) {
    return (
      <div
        dir="rtl"
        className="flex min-h-screen flex-col items-center justify-center bg-[#0B0D13] px-4 text-white"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#ED001B]/15 text-[#ED001B] ring-1 ring-[#ED001B]/40">
          <LoaderCircle className="h-8 w-8 animate-spin" />
        </div>
        <p className="mt-4 text-sm font-bold text-white/80">
          جارٍ تهيئة غرفة العمليات الذكية — منصة بَلِّغْنِي...
        </p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div
        dir="rtl"
        className="flex min-h-screen items-center justify-center bg-[#0B0D13] px-4 text-white"
      >
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#131620] p-7 text-center shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ED001B]/15 text-[#ED001B] ring-1 ring-[#ED001B]/40">
            <LockKeyhole className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-xl font-black text-white">
            غرفة العمليات محمية للأدمن فقط
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-white/70">
            {errorMsg ||
              "يرجى تسجيل الدخول بحساب الأدمن الرئيسي أولاً للوصول إلى فريق الذكاء الاصطناعي."}
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <Link
              href="/admin/login"
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#ED001B] px-5 py-3 text-sm font-black text-white transition hover:bg-[#c90017]"
            >
              تسجيل الدخول كأدمن
            </Link>
            <Link
              href="/admin"
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-5 py-2.5 text-xs font-bold text-white/80 transition hover:bg-white/10"
            >
              العودة للوحة الإدارة
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      dir="rtl"
      className="flex min-h-screen flex-col bg-[#0B0D13] text-white selection:bg-[#ED001B] selection:text-white"
    >
      {/* الترويسة التنفيذية لغرفة العمليات */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0D13]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/80 transition hover:border-[#ED001B]/50 hover:text-white"
              title="العودة للوحة الإدارة"
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
            <div className="flex items-center gap-2.5">
              <BalaghniLogo className="h-8 w-auto" />
              <div className="hidden sm:block">
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-black tracking-tight text-white">
                    غرفة العمليات الذكية
                  </h1>
                  <span className="rounded-full bg-[#ED001B]/20 px-2 py-0.5 text-[10px] font-black text-[#ff4d62] ring-1 ring-[#ED001B]/40">
                    AI OFFICE
                  </span>
                </div>
                <p className="text-[11px] text-white/60">
                  القيادة التنفيذية • المؤسس: {adminName || "الأدمن الرئيسي"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${
                realtimeConnected
                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                  : "border-white/15 bg-white/5 text-white/60"
              }`}
            >
              <Radio
                className={`h-3.5 w-3.5 ${
                  realtimeConnected ? "animate-pulse text-emerald-400" : ""
                }`}
              />
              {realtimeConnected ? "Realtime متصل" : "جارٍ الاتصال..."}
            </span>
            <button
              type="button"
              onClick={() => void fetchOfficeState()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/85 transition hover:border-white/25 hover:bg-white/10"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">تحديث</span>
            </button>
          </div>
        </div>
      </header>

      {/* المحتوى الرئيسي */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 pb-44 pt-6 sm:px-6">
        {errorMsg && (
          <div className="flex items-start gap-3 rounded-2xl border border-[#ED001B]/50 bg-[#ED001B]/10 px-4 py-3.5 text-xs text-rose-100">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#ED001B]" />
            <div className="flex-1 leading-relaxed">{errorMsg}</div>
          </div>
        )}

        {/* 1. المساحة البصرية التفاعلية لفريق العمل (مكتب كريم البارز + مكاتب الطاقم الأربعة) */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#ED001B]" />
              <h2 className="text-sm font-black text-white">
                خريطة المكاتب والحالة اللحظية للطاقم (5 موظفين)
              </h2>
            </div>
            <span className="text-[11px] font-semibold text-white/50">
              المهام المنجزة:{" "}
              <strong className="text-white">
                {tasks.filter((t) => t.status === "completed").length}
              </strong>
            </span>
          </div>

          {/* مكتب كريم الخاص: قسم البرمجة والأمن السيبراني والتصميم (مُبرز بتصميم خاص) */}
          {karim && (
            <div
              className={`relative overflow-hidden rounded-3xl border p-5 transition-all ${
                karim.status !== "idle"
                  ? "border-[#ED001B] bg-gradient-to-l from-[#ED001B]/20 via-[#151824] to-[#11131B] shadow-[0_0_35px_rgba(237,0,27,0.22)]"
                  : "border-[#ED001B]/45 bg-gradient-to-l from-[#ED001B]/10 via-[#141722] to-[#10121A]"
              }`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-4">
                  <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#ED001B] text-white shadow-lg shadow-[#ED001B]/30">
                    <ShieldCheck className="h-7 w-7" />
                    {karim.status !== "idle" && (
                      <span className="absolute -left-1 -top-1 flex h-4 w-4">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex h-4 w-4 rounded-full bg-white" />
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-[#ED001B] px-2 py-0.5 text-[10px] font-black text-white">
                        المكتب التنفيذي الخاص • الأمن والبرمجة والتصميم
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                          STATUS_META[karim.status]?.badgeClass
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            STATUS_META[karim.status]?.dotClass
                          } ${STATUS_META[karim.status]?.pulse ? "animate-pulse" : ""}`}
                        />
                        {STATUS_META[karim.status]?.label}
                      </span>
                    </div>
                    <h3 className="text-lg font-black text-white">
                      {karim.name} —{" "}
                      <span className="text-sm font-bold text-white/80">
                        {karim.title}
                      </span>
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/70">
                      <span className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-0.5">
                        <ShieldAlert className="h-3 w-3 text-[#ED001B]" />
                        أمن سيبراني & RLS
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-0.5">
                        <Code2 className="h-3 w-3 text-emerald-400" />
                        ترقيعات برمجية (Code Patches)
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-0.5">
                        <Palette className="h-3 w-3 text-rose-300" />
                        UI/UX بهوية #ED001B
                      </span>
                    </div>
                    {karim.current_task && (
                      <p className="mt-2 rounded-xl border border-white/10 bg-black/35 px-3 py-1.5 text-xs font-semibold text-rose-100">
                        المهمة الحالية: {karim.current_task}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTargetRole("principal_architect");
                    }}
                    className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-black transition ${
                      targetRole === "principal_architect"
                        ? "bg-white text-[#0B0D13] shadow-lg"
                        : "bg-[#ED001B] text-white hover:bg-[#c90017]"
                    }`}
                  >
                    <Terminal className="h-4 w-4" />
                    {targetRole === "principal_architect"
                      ? "مُحدد للأمر المباشر ✓"
                      : "أمر مباشر لكريم"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* شبكة مكاتب الموظفين الأربعة الآخرين */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {otherAgents.map((agent) => {
              const Icon = getRoleIcon(agent.role);
              const st = STATUS_META[agent.status] || STATUS_META.idle;
              const isOrchestrator = agent.role === "orchestrator";
              return (
                <div
                  key={agent.id}
                  className={`relative flex flex-col justify-between rounded-2xl border p-4 transition-all ${
                    agent.status !== "idle"
                      ? "border-[#ED001B]/70 bg-[#171A26] shadow-lg shadow-[#ED001B]/10"
                      : "border-white/10 bg-[#131620] hover:border-white/20"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                          isOrchestrator
                            ? "bg-white text-[#0B0D13]"
                            : "bg-white/10 text-white"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${st.badgeClass}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${st.dotClass} ${
                            st.pulse ? "animate-pulse" : ""
                          }`}
                        />
                        {st.label.split(" ")[0]}
                      </span>
                    </div>

                    <h3 className="mt-3 text-base font-black text-white">
                      {agent.name}
                    </h3>
                    <p className="text-xs font-semibold text-white/65">
                      {agent.title}
                    </p>
                  </div>

                  <div className="mt-3 border-t border-white/10 pt-2.5">
                    {agent.current_task ? (
                      <p className="line-clamp-2 text-[11px] font-medium text-rose-200">
                        ⚡ {agent.current_task}
                      </p>
                    ) : (
                      <p className="text-[11px] text-white/40">
                        في انتظار تعليمات القيادة...
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 2. لوحة السجل المباشر (Live Feed) */}
        <section className="flex flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#11141E] shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#151824] px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-[#ED001B]" />
              <h2 className="text-sm font-black text-white">
                السجل المباشر لنقاشات الفريق والترقيعات (Live Feed)
              </h2>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/80">
                {filteredLogs.length}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "all", label: "الكل" },
                  { id: "security_alert", label: "تنبيهات أمنية" },
                  { id: "code_patch", label: "ترقيعات برمجية" },
                  { id: "design_proposal", label: "مقترحات تصميم" },
                  { id: "info", label: "حوارات" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLogFilter(tab.id)}
                  className={`rounded-xl px-2.5 py-1 text-[11px] font-bold transition ${
                    logFilter === tab.id
                      ? "bg-[#ED001B] text-white"
                      : "bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[560px] space-y-3.5 overflow-y-auto p-5">
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <Terminal className="h-10 w-10 text-white/20" />
                <p className="mt-3 text-sm font-bold text-white/70">
                  لا توجد سجلات بعد في غرفة العمليات
                </p>
                <p className="mt-1 text-xs text-white/45">
                  أرسل أول أمر من شريط القيادة بالأسفل ليبدأ رامي وكريم والطاقم بالعمل فوراً.
                </p>
              </div>
            ) : (
              filteredLogs.map((log) => {
                const speaker = log.agent_id
                  ? agentById.get(log.agent_id)
                  : undefined;
                const SpeakerIcon = speaker
                  ? getRoleIcon(speaker.role)
                  : Terminal;
                const parts = parseMessageParts(log.message);
                const isSecurity = log.log_type === "security_alert";
                const isCodePatch = log.log_type === "code_patch";
                const isDesign = log.log_type === "design_proposal";

                return (
                  <div
                    key={log.id}
                    className={`rounded-2xl border p-4 transition ${
                      isSecurity
                        ? "border-[#ED001B]/60 bg-[#ED001B]/10"
                        : isCodePatch
                        ? "border-emerald-500/35 bg-[#0D1318]"
                        : isDesign
                        ? "border-fuchsia-500/35 bg-fuchsia-950/20"
                        : "border-white/10 bg-[#161925]"
                    }`}
                  >
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                            speaker?.role === "principal_architect"
                              ? "bg-[#ED001B] text-white"
                              : speaker?.role === "orchestrator"
                              ? "bg-white text-[#0B0D13]"
                              : "bg-white/10 text-white"
                          }`}
                        >
                          <SpeakerIcon className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-white">
                              {speaker?.name || "النظام"}
                            </span>
                            <span className="text-[10px] font-semibold text-white/55">
                              {speaker?.title || "غرفة العمليات"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isSecurity && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#ED001B] px-2.5 py-0.5 text-[10px] font-black text-white">
                            <ShieldAlert className="h-3 w-3" />
                            تنبيه / تشخيص أمني
                          </span>
                        )}
                        {isCodePatch && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-black text-emerald-300 ring-1 ring-emerald-500/40">
                            <FileCode2 className="h-3 w-3" />
                            ترقيع برمجي جاهز
                          </span>
                        )}
                        {isDesign && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-500/20 px-2.5 py-0.5 text-[10px] font-black text-fuchsia-200 ring-1 ring-fuchsia-500/40">
                            <Palette className="h-3 w-3" />
                            مقترح تصميم UI/UX
                          </span>
                        )}
                        <span
                          dir="ltr"
                          className="font-mono text-[10px] text-white/45"
                        >
                          {new Date(log.created_at).toLocaleTimeString("ar-LY", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {parts.map((part, idx) =>
                        part.type === "code" ? (
                          <div
                            key={`${log.id}-code-${idx}`}
                            className="overflow-hidden rounded-xl border border-white/15 bg-[#07090E]"
                          >
                            <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-3 py-1.5">
                              <span
                                dir="ltr"
                                className="font-mono text-[10px] font-bold uppercase text-white/60"
                              >
                                {part.lang || "patch"}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleCopyCode(
                                    `${log.id}-${idx}`,
                                    part.content
                                  )
                                }
                                className="inline-flex items-center gap-1.5 rounded-lg bg-[#ED001B] px-2.5 py-1 text-[11px] font-black text-white transition hover:bg-[#c90017]"
                              >
                                {copiedKey === `${log.id}-${idx}` ? (
                                  <>
                                    <Check className="h-3 w-3" />
                                    تم النسخ
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3" />
                                    نسخ الكود
                                  </>
                                )}
                              </button>
                            </div>
                            <pre
                              dir="ltr"
                              className="overflow-x-auto p-3.5 font-mono text-xs leading-relaxed text-emerald-200"
                            >
                              <code>{part.content}</code>
                            </pre>
                          </div>
                        ) : (
                          <p
                            key={`${log.id}-txt-${idx}`}
                            className="whitespace-pre-wrap text-xs leading-relaxed text-white/90"
                          >
                            {part.content}
                          </p>
                        )
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={feedEndRef} />
          </div>
        </section>
      </main>

      {/* 3. شريط الأوامر السفلي المثبّت (Command Dock) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0B0D13]/95 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl space-y-2.5 px-4 py-3.5 sm:px-6">
          {/* أزرار التوجيه السريع + مقترحات الأوامر */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-xl border border-white/10 bg-[#131620] p-1">
              <button
                type="button"
                onClick={() => setTargetRole("orchestrator")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black transition ${
                  targetRole === "orchestrator"
                    ? "bg-white text-[#0B0D13]"
                    : "text-white/65 hover:text-white"
                }`}
              >
                <Crown className="h-3.5 w-3.5" />
                إلى رامي (توزيع ذكي)
              </button>
              <button
                type="button"
                onClick={() => setTargetRole("principal_architect")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black transition ${
                  targetRole === "principal_architect"
                    ? "bg-[#ED001B] text-white"
                    : "text-white/65 hover:text-white"
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                أمر مباشر لكريم (الأمن والبرمجة)
              </button>
            </div>

            <div className="hidden flex-wrap items-center gap-1.5 md:flex">
              {QUICK_COMMANDS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  disabled={isExecuting}
                  onClick={() => {
                    setTargetRole(q.target);
                    setCommandInput(q.command);
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold text-white/75 transition hover:border-[#ED001B]/50 hover:bg-[#ED001B]/10 hover:text-white disabled:opacity-50"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* حقل إدخال الأمر */}
          <form onSubmit={handleSendCommand} className="flex items-center gap-2.5">
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              disabled={isExecuting}
              placeholder={
                targetRole === "principal_architect"
                  ? "اكتب أمراً مباشراً إلى كريم (فحص ثغرات، RLS، كود، أو تحسين UI/UX)..."
                  : "اكتب أمرك التنفيذي إلى رامي المدير العام ليوزعه على الفريق..."
              }
              className="h-12 flex-1 rounded-2xl border border-white/15 bg-[#131620] px-4 text-sm text-white placeholder:text-white/40 focus:border-[#ED001B] focus:outline-none focus:ring-2 focus:ring-[#ED001B]/30 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isExecuting || !commandInput.trim()}
              className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#ED001B] px-5 text-sm font-black text-white shadow-lg shadow-[#ED001B]/25 transition hover:bg-[#c90017] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExecuting ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  <span>جارٍ التنفيذ...</span>
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  <span>إرسال الأمر</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
