"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
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
  Coffee,
  Cog,
  X,
  MessageSquare,
  Monitor,
  Radar,
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
  { label: string; shortLabel: string; dotClass: string; badgeClass: string; pulse: boolean }
> = {
  idle: {
    label: "متاح (Idle)",
    shortLabel: "متاح",
    dotClass: "bg-emerald-400",
    badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/35",
    pulse: false,
  },
  working: {
    label: "قيد التنفيذ (Working)",
    shortLabel: "يعمل",
    dotClass: "bg-[#ED001B]",
    badgeClass: "bg-[#ED001B]/20 text-rose-100 border-[#ED001B]/60",
    pulse: true,
  },
  meeting: {
    label: "اجتماع تنسيقي (Meeting)",
    shortLabel: "اجتماع",
    dotClass: "bg-amber-400",
    badgeClass: "bg-amber-500/20 text-amber-200 border-amber-500/45",
    pulse: true,
  },
  auditing: {
    label: "فحص أمني وهندسي (Auditing)",
    shortLabel: "يفحص",
    dotClass: "bg-[#ED001B]",
    badgeClass: "bg-[#ED001B]/30 text-white border-[#ED001B]",
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

// إحداثيات المكاتب وطاولة الاجتماعات وركن القهوة على خريطة 1000x620 (بالنسبة المئوية)
const OFFICE_COORDS: Record<
  AgentRole,
  {
    desk: { x: number; y: number };
    meeting: { x: number; y: number };
    coffee: { x: number; y: number };
    avatarGradient: string;
    ringColor: string;
    shortRole: string;
  }
> = {
  principal_architect: {
    desk: { x: 83.5, y: 23.5 },
    meeting: { x: 61.5, y: 55 },
    coffee: { x: 82, y: 53 },
    avatarGradient: "from-[#ED001B] via-[#b80015] to-[#1a0508]",
    ringColor: "ring-[#ED001B]",
    shortRole: "الأمن والبرمجة والتصميم",
  },
  orchestrator: {
    desk: { x: 16, y: 21 },
    meeting: { x: 50, y: 42 },
    coffee: { x: 88, y: 53 },
    avatarGradient: "from-white via-slate-200 to-slate-400",
    ringColor: "ring-white/80",
    shortRole: "المدير العام",
  },
  marketing: {
    desk: { x: 15, y: 50 },
    meeting: { x: 38.5, y: 55 },
    coffee: { x: 85, y: 53.5 },
    avatarGradient: "from-fuchsia-500 via-rose-500 to-slate-900",
    ringColor: "ring-fuchsia-400/70",
    shortRole: "التسويق والمحتوى",
  },
  operations: {
    desk: { x: 16, y: 79 },
    meeting: { x: 43, y: 69 },
    coffee: { x: 79, y: 54 },
    avatarGradient: "from-amber-400 via-orange-500 to-slate-900",
    ringColor: "ring-amber-400/70",
    shortRole: "العمليات والمخزون",
  },
  support: {
    desk: { x: 83.5, y: 79 },
    meeting: { x: 57, y: 69 },
    coffee: { x: 91, y: 54 },
    avatarGradient: "from-emerald-400 via-teal-500 to-slate-900",
    ringColor: "ring-emerald-400/70",
    shortRole: "خدمة العملاء",
  },
};

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

function summarizeSpeechBubble(raw: string): string {
  const withoutCode = raw.replace(/```[\s\S]*?```/g, " [كود جاهز]").trim();
  const singleLine = withoutCode.replace(/\s+/g, " ");
  return singleLine.length > 76 ? `${singleLine.slice(0, 74)}...` : singleLine;
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

  // التفاعل البصري في المكتب ثنائي الأبعاد
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(
    null
  );
  const [coffeeGuestRole, setCoffeeGuestRole] = React.useState<AgentRole | null>(
    null
  );

  const feedEndRef = React.useRef<HTMLDivElement | null>(null);
  const commandInputRef = React.useRef<HTMLInputElement | null>(null);

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

  // حركة طبيعية هادئة: عندما يكون الموظفون متاحين (idle)، يتناوب أحدهم أحياناً على استراحة قصيرة عند ركن القهوة
  React.useEffect(() => {
    const rotation: Array<AgentRole | null> = [
      null,
      "support",
      null,
      "marketing",
      null,
      "operations",
    ];
    let idx = 0;
    const timer = window.setInterval(() => {
      idx = (idx + 1) % rotation.length;
      setCoffeeGuestRole(rotation[idx]);
    }, 11000);
    return () => window.clearInterval(timer);
  }, []);

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

  const handleDirectOrderToAgent = (agent: AiAgentRecord) => {
    if (agent.role === "principal_architect") {
      setTargetRole("principal_architect");
    } else if (agent.role === "orchestrator") {
      setTargetRole("orchestrator");
    } else {
      setTargetRole("orchestrator");
      setCommandInput((prev) =>
        prev.trim() ? prev : `إلى ${agent.name} (${agent.title}): `
      );
    }
    setSelectedAgentId(agent.id);
    window.setTimeout(() => {
      commandInputRef.current?.focus();
    }, 60);
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

  const agentByRole = React.useMemo(() => {
    const map = new Map<AgentRole, AiAgentRecord>();
    for (const a of agents) map.set(a.role, a);
    return map;
  }, [agents]);

  const latestLogByAgentId = React.useMemo(() => {
    const map = new Map<string, AgentLogRecord>();
    for (const l of logs) {
      if (l.agent_id) {
        map.set(l.agent_id, l);
      }
    }
    return map;
  }, [logs]);

  const selectedAgent = selectedAgentId
    ? agentById.get(selectedAgentId) || null
    : null;

  const activeAgents = agents.filter((a) => a.status !== "idle");
  const isMeetingActive = agents.some((a) => a.status === "meeting");
  const isAuditActive = agents.some((a) => a.status === "auditing");

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
          جارٍ تجهيز المكتب الافتراضي لغرفة العمليات — منصة بَلِّغْنِي...
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

  const karim = agentByRole.get("principal_architect");
  const rami = agentByRole.get("orchestrator");
  const omar = agentByRole.get("operations");
  const sara = agentByRole.get("support");
  const layla = agentByRole.get("marketing");

  const deskMonitorGlow = (agent?: AiAgentRecord) =>
    agent && (agent.status === "working" || agent.status === "auditing");

  return (
    <div
      dir="rtl"
      className="flex min-h-screen flex-col bg-[#0B0D13] text-white selection:bg-[#ED001B] selection:text-white"
    >
      {/* الترويسة التنفيذية لغرفة العمليات */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0D13]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/80 transition hover:border-[#ED001B]/50 hover:text-white"
              title="العودة للوحة الإدارة"
            >
              <ArrowRight className="h-4 w-4" />
            </Link>
            <div className="flex items-center gap-2.5">
              <BalaghniLogo className="h-8 w-auto" variant="dark" />
              <div className="hidden sm:block">
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-black tracking-tight text-white">
                    مقر العمليات الافتراضي
                  </h1>
                  <span className="rounded-full bg-[#ED001B]/20 px-2 py-0.5 text-[10px] font-black text-[#ff4d62] ring-1 ring-[#ED001B]/45">
                    2D LIVE HQ
                  </span>
                </div>
                <p className="text-[11px] text-white/60">
                  المؤسس: {adminName || "الأدمن الرئيسي"} • المهام المنجزة:{" "}
                  <strong className="text-white">
                    {tasks.filter((t) => t.status === "completed").length}
                  </strong>
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 pb-44 pt-5 sm:px-6">
        {errorMsg && (
          <div className="flex items-start gap-3 rounded-2xl border border-[#ED001B]/50 bg-[#ED001B]/10 px-4 py-3 text-xs text-rose-100">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#ED001B]" />
            <div className="flex-1 leading-relaxed">{errorMsg}</div>
          </div>
        )}

        {/* شريط الحالة السريع للموظفين (للهواتف والانتقال السريع لأي موظف) */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#ED001B]" />
            <h2 className="text-sm font-black text-white">
              خريطة المكتب التفاعلية الحية (انقر على أي مكتب أو موظف)
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {agents.map((agent) => {
              const st = STATUS_META[agent.status] || STATUS_META.idle;
              const isSelected = selectedAgentId === agent.id;
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() =>
                    setSelectedAgentId(isSelected ? null : agent.id)
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                    isSelected
                      ? "border-[#ED001B] bg-[#ED001B]/20 text-white"
                      : "border-white/10 bg-[#131620] text-white/75 hover:border-white/25 hover:text-white"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${st.dotClass} ${
                      st.pulse ? "animate-pulse" : ""
                    }`}
                  />
                  <span>{agent.name}</span>
                  <span className="text-[10px] text-white/45">
                    ({st.shortLabel})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 1. المشهد البصري التفاعلي للمكتب (2D Interactive Virtual Office Canvas) */}
        <section className="relative overflow-hidden rounded-3xl border border-white/15 bg-[#0D1018] shadow-[0_20px_70px_rgba(0,0,0,0.65)]">
          {/* تلميح التمرير للهواتف الصغيرة */}
          <div className="flex items-center justify-between border-b border-white/10 bg-[#121622] px-4 py-2 text-[11px] text-white/60 sm:hidden">
            <span>اسحب أفقياً لاستعراض كامل المكتب الافتراضي</span>
            <span className="font-mono text-[#ED001B]">2D MAP</span>
          </div>

          <div className="overflow-x-auto">
            <div className="relative mx-auto min-w-[820px] max-w-[1220px] aspect-[1000/620] select-none bg-[#0B0D13]">
              {/* الطبقة المعمارية SVG (المخطط، الجدران، المكاتب، طاولة الاجتماعات، ركن القهوة) */}
              <svg
                viewBox="0 0 1000 620"
                className="absolute inset-0 h-full w-full"
                preserveAspectRatio="xMidYMid meet"
              >
                <defs>
                  {/* شبكة أرضية المكتب المعمارية */}
                  <pattern
                    id="officeFloorGrid"
                    width="32"
                    height="32"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 32 0 L 0 0 0 32"
                      fill="none"
                      stroke="rgba(255,255,255,0.035)"
                      strokeWidth="1"
                    />
                  </pattern>

                  {/* توهج نيون أحمر بلّغني */}
                  <filter
                    id="neonRedGlow"
                    x="-30%"
                    y="-30%"
                    width="160%"
                    height="160%"
                  >
                    <feGaussianBlur stdDeviation="5" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>

                  <radialGradient id="centerFloorGlow" cx="50%" cy="54%" r="36%">
                    <stop offset="0%" stopColor="rgba(237,0,27,0.12)" />
                    <stop offset="65%" stopColor="rgba(237,0,27,0.03)" />
                    <stop offset="100%" stopColor="rgba(11,13,19,0)" />
                  </radialGradient>

                  <radialGradient id="karimSuiteGlow" cx="50%" cy="50%" r="55%">
                    <stop offset="0%" stopColor="rgba(237,0,27,0.22)" />
                    <stop offset="100%" stopColor="rgba(15,18,28,0.4)" />
                  </radialGradient>

                  <linearGradient id="deskSurface" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#1D2231" />
                    <stop offset="100%" stopColor="#121622" />
                  </linearGradient>

                  <linearGradient
                    id="karimDeskSurface"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#26141B" />
                    <stop offset="100%" stopColor="#15131C" />
                  </linearGradient>

                  <linearGradient
                    id="conferenceTable"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#1E2333" />
                    <stop offset="100%" stopColor="#12151F" />
                  </linearGradient>
                </defs>

                {/* الأرضية الرئيسية */}
                <rect width="1000" height="620" fill="#0B0D13" />
                <rect width="1000" height="620" fill="url(#officeFloorGrid)" />
                <rect width="1000" height="620" fill="url(#centerFloorGlow)" />

                {/* الإطار الخارجي لجدران المكتب */}
                <rect
                  x="12"
                  y="12"
                  width="976"
                  height="596"
                  rx="24"
                  fill="none"
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth="2"
                />

                {/* شريط إضاءة نيون أحمر علوي على جدار الهوية الرئيسي */}
                <line
                  x1="340"
                  y1="14"
                  x2="660"
                  y2="14"
                  stroke="#ED001B"
                  strokeWidth="3.5"
                  filter="url(#neonRedGlow)"
                />

                {/* ================= جناح كريم التنفيذي الخاص (أعلى اليمين) ================= */}
                <g>
                  <rect
                    x="695"
                    y="26"
                    width="280"
                    height="226"
                    rx="20"
                    fill="url(#karimSuiteGlow)"
                    stroke={
                      karim?.status === "auditing" ||
                      karim?.status === "working"
                        ? "#ED001B"
                        : "rgba(237,0,27,0.5)"
                    }
                    strokeWidth={
                      karim?.status === "auditing" ||
                      karim?.status === "working"
                        ? "2.5"
                        : "1.5"
                    }
                  />
                  {/* فاصل زجاجي تقني */}
                  <line
                    x1="695"
                    y1="72"
                    x2="695"
                    y2="215"
                    stroke="#ED001B"
                    strokeWidth="2"
                    strokeDasharray="6 4"
                    opacity="0.7"
                  />
                  {/* مكتب كريم الهندسي (U-Desk) */}
                  <rect
                    x="742"
                    y="62"
                    width="186"
                    height="56"
                    rx="12"
                    fill="url(#karimDeskSurface)"
                    stroke="rgba(237,0,27,0.45)"
                    strokeWidth="1.5"
                  />
                  {/* شاشتان عريضتان لكريم */}
                  <rect
                    x="764"
                    y="70"
                    width="64"
                    height="12"
                    rx="3"
                    fill={deskMonitorGlow(karim) ? "#ED001B" : "#252B3D"}
                    filter={deskMonitorGlow(karim) ? "url(#neonRedGlow)" : undefined}
                  />
                  <rect
                    x="840"
                    y="70"
                    width="64"
                    height="12"
                    rx="3"
                    fill={deskMonitorGlow(karim) ? "#ED001B" : "#252B3D"}
                    filter={deskMonitorGlow(karim) ? "url(#neonRedGlow)" : undefined}
                  />
                  {/* خادم أمني مصغّر بجانب مكتب كريم */}
                  <rect
                    x="940"
                    y="48"
                    width="22"
                    height="78"
                    rx="6"
                    fill="#141824"
                    stroke="rgba(255,255,255,0.12)"
                  />
                  <circle cx="951" cy="64" r="2.5" fill="#22c55e" />
                  <circle cx="951" cy="76" r="2.5" fill="#ED001B" />
                  <circle cx="951" cy="88" r="2.5" fill="#22c55e" />
                  <circle cx="951" cy="100" r="2.5" fill="#ED001B" />

                  {/* رادار الفحص الأمني التفاعلي عند حالة auditing */}
                  {karim?.status === "auditing" && (
                    <g opacity="0.85">
                      <circle
                        cx="835"
                        cy="145"
                        r="54"
                        fill="none"
                        stroke="#ED001B"
                        strokeWidth="1.5"
                        strokeDasharray="6 6"
                      />
                      <circle
                        cx="835"
                        cy="145"
                        r="84"
                        fill="none"
                        stroke="#ED001B"
                        strokeWidth="1"
                        opacity="0.45"
                      />
                    </g>
                  )}
                </g>

                {/* ================= مكتب رامي — المدير العام (أعلى اليسار) ================= */}
                <g>
                  <rect
                    x="25"
                    y="26"
                    width="275"
                    height="196"
                    rx="18"
                    fill="rgba(255,255,255,0.03)"
                    stroke={
                      rami && rami.status !== "idle"
                        ? "#ED001B"
                        : "rgba(255,255,255,0.14)"
                    }
                    strokeWidth="1.5"
                  />
                  <rect
                    x="76"
                    y="58"
                    width="172"
                    height="48"
                    rx="11"
                    fill="url(#deskSurface)"
                    stroke="rgba(255,255,255,0.15)"
                  />
                  {/* شاشة حاسوب رامي */}
                  <rect
                    x="126"
                    y="66"
                    width="72"
                    height="11"
                    rx="3"
                    fill={deskMonitorGlow(rami) ? "#ED001B" : "#293044"}
                    filter={deskMonitorGlow(rami) ? "url(#neonRedGlow)" : undefined}
                  />
                </g>

                {/* ================= مكتب ليلى — التسويق والمحتوى (منتصف اليسار) ================= */}
                <g>
                  <rect
                    x="25"
                    y="236"
                    width="250"
                    height="144"
                    rx="18"
                    fill="rgba(255,255,255,0.025)"
                    stroke={
                      layla && layla.status !== "idle"
                        ? "#ED001B"
                        : "rgba(255,255,255,0.11)"
                    }
                    strokeWidth="1.5"
                  />
                  <rect
                    x="62"
                    y="256"
                    width="156"
                    height="42"
                    rx="10"
                    fill="url(#deskSurface)"
                    stroke="rgba(255,255,255,0.12)"
                  />
                  <rect
                    x="108"
                    y="263"
                    width="64"
                    height="10"
                    rx="3"
                    fill={deskMonitorGlow(layla) ? "#ED001B" : "#293044"}
                    filter={deskMonitorGlow(layla) ? "url(#neonRedGlow)" : undefined}
                  />
                </g>

                {/* ================= مكتب عمر — العمليات والمخزون (أسفل اليسار) ================= */}
                <g>
                  <rect
                    x="25"
                    y="394"
                    width="275"
                    height="198"
                    rx="18"
                    fill="rgba(255,255,255,0.025)"
                    stroke={
                      omar && omar.status !== "idle"
                        ? "#ED001B"
                        : "rgba(255,255,255,0.12)"
                    }
                    strokeWidth="1.5"
                  />
                  <rect
                    x="76"
                    y="514"
                    width="172"
                    height="46"
                    rx="11"
                    fill="url(#deskSurface)"
                    stroke="rgba(255,255,255,0.14)"
                  />
                  <rect
                    x="126"
                    y="540"
                    width="72"
                    height="10"
                    rx="3"
                    fill={deskMonitorGlow(omar) ? "#ED001B" : "#293044"}
                    filter={deskMonitorGlow(omar) ? "url(#neonRedGlow)" : undefined}
                  />
                </g>

                {/* ================= ركن الاستراحة والقهوة (منتصف اليمين) ================= */}
                <g>
                  <rect
                    x="725"
                    y="266"
                    width="250"
                    height="114"
                    rx="18"
                    fill="rgba(245,158,11,0.05)"
                    stroke="rgba(245,158,11,0.28)"
                    strokeWidth="1.5"
                    strokeDasharray="5 4"
                  />
                  {/* بار القهوة */}
                  <rect
                    x="914"
                    y="284"
                    width="44"
                    height="78"
                    rx="10"
                    fill="#1C1917"
                    stroke="rgba(245,158,11,0.4)"
                  />
                  {/* طاولة قهوة دائرية */}
                  <circle
                    cx="850"
                    cy="326"
                    r="24"
                    fill="#191B24"
                    stroke="rgba(255,255,255,0.15)"
                    strokeWidth="1.5"
                  />
                  <circle cx="850" cy="326" r="6" fill="rgba(245,158,11,0.35)" />
                </g>

                {/* ================= مكتب سارة — خدمة العملاء (أسفل اليمين) ================= */}
                <g>
                  <rect
                    x="695"
                    y="394"
                    width="280"
                    height="198"
                    rx="18"
                    fill="rgba(255,255,255,0.025)"
                    stroke={
                      sara && sara.status !== "idle"
                        ? "#ED001B"
                        : "rgba(255,255,255,0.12)"
                    }
                    strokeWidth="1.5"
                  />
                  <rect
                    x="748"
                    y="514"
                    width="174"
                    height="46"
                    rx="11"
                    fill="url(#deskSurface)"
                    stroke="rgba(255,255,255,0.14)"
                  />
                  <rect
                    x="798"
                    y="540"
                    width="74"
                    height="10"
                    rx="3"
                    fill={deskMonitorGlow(sara) ? "#ED001B" : "#293044"}
                    filter={deskMonitorGlow(sara) ? "url(#neonRedGlow)" : undefined}
                  />
                </g>

                {/* ================= منطقة الاجتماعات المركزية (المنتصف) ================= */}
                <g>
                  {/* سجادة/إطار غرفة الاجتماعات */}
                  <rect
                    x="325"
                    y="112"
                    width="350"
                    height="422"
                    rx="28"
                    fill="rgba(255,255,255,0.018)"
                    stroke={
                      isMeetingActive
                        ? "rgba(237,0,27,0.65)"
                        : "rgba(255,255,255,0.08)"
                    }
                    strokeWidth={isMeetingActive ? "2" : "1.2"}
                    strokeDasharray={isMeetingActive ? undefined : "8 6"}
                  />

                  {/* طاولة الاجتماعات البيضاوية في المنتصف */}
                  <ellipse
                    cx="500"
                    cy="346"
                    rx="118"
                    ry="72"
                    fill="url(#conferenceTable)"
                    stroke={
                      isMeetingActive ? "#ED001B" : "rgba(255,255,255,0.18)"
                    }
                    strokeWidth={isMeetingActive ? "2.5" : "1.5"}
                    filter={isMeetingActive ? "url(#neonRedGlow)" : undefined}
                  />
                  {/* حلقة داخلية مضيئة على سطح طاولة الاجتماعات */}
                  <ellipse
                    cx="500"
                    cy="346"
                    rx="78"
                    ry="40"
                    fill="none"
                    stroke="rgba(237,0,27,0.32)"
                    strokeWidth="1.2"
                  />

                  {/* كراسي طاولة الاجتماعات الـ 5 */}
                  <circle cx="500" cy="258" r="11" fill="#181C28" stroke="rgba(255,255,255,0.15)" />
                  <circle cx="624" cy="340" r="11" fill="#181C28" stroke="rgba(255,255,255,0.15)" />
                  <circle cx="376" cy="340" r="11" fill="#181C28" stroke="rgba(255,255,255,0.15)" />
                  <circle cx="572" cy="430" r="11" fill="#181C28" stroke="rgba(255,255,255,0.15)" />
                  <circle cx="428" cy="430" r="11" fill="#181C28" stroke="rgba(255,255,255,0.15)" />
                </g>

                {/* لمسات نباتات مكتبية في الزوايا */}
                <g opacity="0.75">
                  <circle cx="318" cy="566" r="12" fill="#0f291e" stroke="#10b981" strokeWidth="1" />
                  <circle cx="682" cy="566" r="12" fill="#0f291e" stroke="#10b981" strokeWidth="1" />
                </g>
              </svg>

              {/* ================= طبقة الهوية البصرية التفاعلية (HTML Overlay متزامن بدقة) ================= */}

              {/* 1. جدار الهوية الرسمي لشعار بلّغني مع إضاءة نيون حمراء (#ED001B) */}
              <div className="pointer-events-none absolute left-1/2 top-[3.4%] z-10 -translate-x-1/2">
                <div className="flex items-center gap-2.5 rounded-2xl border border-[#ED001B]/60 bg-[#0B0D13]/95 px-4 py-1.5 shadow-[0_0_25px_rgba(237,0,27,0.45)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/balaghni-logo.jpg"
                    alt="شعار بلّغني الرسمي"
                    className="h-8 w-8 rounded-full border border-[#ED001B]/70 object-cover shadow-[0_0_12px_rgba(237,0,27,0.7)]"
                  />
                  <div className="text-right leading-tight">
                    <p className="text-xs font-black tracking-wide text-white">
                      بَلِّغْنِي{" "}
                      <span className="font-mono text-[#ED001B]">HQ</span>
                    </p>
                    <p className="text-[9px] font-bold tracking-widest text-white/60">
                      BALAGHNI OPERATIONS CENTER
                    </p>
                  </div>
                </div>
              </div>

              {/* 2. شاشة العرض الذكية في غرفة الاجتماعات (تظهر شعار بلّغني وحالة العمليات لحظياً) */}
              <div className="pointer-events-none absolute left-1/2 top-[19.5%] z-10 w-[26%] -translate-x-1/2">
                <div
                  className={`rounded-2xl border bg-[#090B10]/95 px-3 py-2 text-center shadow-xl transition-all ${
                    isAuditActive || isMeetingActive
                      ? "border-[#ED001B] shadow-[0_0_24px_rgba(237,0,27,0.35)]"
                      : "border-white/15"
                  }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/balaghni-logo.jpg"
                      alt="شاشة عرض بلّغني"
                      className="h-6 w-6 rounded-full border border-[#ED001B]/60 object-cover"
                    />
                    <span className="text-[11px] font-black text-white">
                      شاشة العمليات الذكية
                    </span>
                    <Monitor className="h-3.5 w-3.5 text-[#ED001B]" />
                  </div>
                  <div className="mt-1.5 flex items-center justify-center gap-2 text-[10px]">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${
                        activeAgents.length > 0
                          ? "bg-[#ED001B]/25 text-rose-200"
                          : "bg-emerald-500/15 text-emerald-300"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          activeAgents.length > 0
                            ? "animate-pulse bg-[#ED001B]"
                            : "bg-emerald-400"
                        }`}
                      />
                      {isAuditActive
                        ? "فحص أمني جارٍ"
                        : isMeetingActive
                        ? "اجتماع تنسيقي نشط"
                        : activeAgents.length > 0
                        ? `قيد التنفيذ (${activeAgents.length})`
                        : "النظام مستقر وجاهز"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. تسميات الأجنحة والمكاتب وركن القهوة */}
              {/* جناح كريم الخاص */}
              <button
                type="button"
                onClick={() => karim && setSelectedAgentId(karim.id)}
                className="absolute right-[3.5%] top-[5.2%] z-10 flex items-center gap-1.5 rounded-lg bg-[#ED001B] px-2.5 py-0.5 text-[10px] font-black text-white shadow-md transition hover:scale-105"
              >
                <ShieldCheck className="h-3 w-3" />
                <span>جناح كريم • الأمن والبرمجة والتصميم (+20 سنة)</span>
              </button>

              {/* تسمية مكتب رامي */}
              <button
                type="button"
                onClick={() => rami && setSelectedAgentId(rami.id)}
                className="absolute left-[3.5%] top-[5.2%] z-10 flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#141824]/90 px-2.5 py-0.5 text-[10px] font-bold text-white/90 transition hover:border-white/40"
              >
                <Crown className="h-3 w-3 text-amber-300" />
                <span>مكتب رامي • المدير العام</span>
              </button>

              {/* تسمية مكتب ليلى */}
              <button
                type="button"
                onClick={() => layla && setSelectedAgentId(layla.id)}
                className="absolute left-[3.5%] top-[39%] z-10 flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#141824]/90 px-2.5 py-0.5 text-[10px] font-bold text-white/85 transition hover:border-white/40"
              >
                <Megaphone className="h-3 w-3 text-fuchsia-300" />
                <span>مكتب ليلى • التسويق</span>
              </button>

              {/* تسمية مكتب عمر */}
              <button
                type="button"
                onClick={() => omar && setSelectedAgentId(omar.id)}
                className="absolute left-[3.5%] bottom-[5%] z-10 flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#141824]/90 px-2.5 py-0.5 text-[10px] font-bold text-white/85 transition hover:border-white/40"
              >
                <PackageCheck className="h-3 w-3 text-amber-300" />
                <span>مكتب عمر • العمليات والمخزون</span>
              </button>

              {/* تسمية مكتب سارة */}
              <button
                type="button"
                onClick={() => sara && setSelectedAgentId(sara.id)}
                className="absolute right-[3.5%] bottom-[5%] z-10 flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#141824]/90 px-2.5 py-0.5 text-[10px] font-bold text-white/85 transition hover:border-white/40"
              >
                <Headphones className="h-3 w-3 text-emerald-300" />
                <span>مكتب سارة • خدمة العملاء</span>
              </button>

              {/* تسمية ركن القهوة والاستراحة */}
              <div className="pointer-events-none absolute right-[4%] top-[44.5%] z-10 flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-950/60 px-2.5 py-0.5 text-[10px] font-bold text-amber-200">
                <Coffee className="h-3 w-3 text-amber-400" />
                <span>ركن القهوة والاستراحة</span>
              </div>

              {/* تسمية طاولة الاجتماعات */}
              <div className="pointer-events-none absolute left-1/2 top-[55.5%] z-10 -translate-x-1/2 -translate-y-1/2 text-center">
                <p className="text-[10px] font-black tracking-wide text-white/50">
                  طاولة التنسيق والاجتماعات
                </p>
              </div>

              {/* ================= الشخصيات المتحركة (Realtime Animated Avatars) ================= */}
              {agents.map((agent) => {
                const coords = OFFICE_COORDS[agent.role] || OFFICE_COORDS.orchestrator;
                const Icon = getRoleIcon(agent.role);
                const st = STATUS_META[agent.status] || STATUS_META.idle;
                const isSelected = selectedAgentId === agent.id;
                const isAtCoffee =
                  agent.status === "idle" && coffeeGuestRole === agent.role;
                const targetPos =
                  agent.status === "meeting"
                    ? coords.meeting
                    : isAtCoffee
                    ? coords.coffee
                    : coords.desk;

                const latestLog = latestLogByAgentId.get(agent.id);
                const showSpeechBubble =
                  agent.status === "meeting" ||
                  ((agent.status === "working" || agent.status === "auditing") &&
                    Boolean(agent.current_task || latestLog));

                const speechText =
                  agent.status === "meeting" && latestLog
                    ? summarizeSpeechBubble(latestLog.message)
                    : agent.current_task
                    ? summarizeSpeechBubble(agent.current_task)
                    : latestLog
                    ? summarizeSpeechBubble(latestLog.message)
                    : "";

                return (
                  <motion.div
                    key={agent.id}
                    initial={false}
                    animate={{
                      left: `${targetPos.x}%`,
                      top: `${targetPos.y}%`,
                    }}
                    transition={{
                      type: "spring",
                      stiffness: 110,
                      damping: 18,
                      mass: 0.9,
                    }}
                    className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
                  >
                    {/* فقاعة الحوار الحية (تظهر أثناء الاجتماع أو التنفيذ النشط) */}
                    <AnimatePresence>
                      {showSpeechBubble && speechText && (
                        <motion.div
                          initial={{ opacity: 0, y: 6, scale: 0.92 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 4, scale: 0.92 }}
                          className="pointer-events-none absolute bottom-[calc(100%+12px)] left-1/2 z-30 w-48 -translate-x-1/2 rounded-2xl border border-[#ED001B]/60 bg-[#0F131E]/95 px-3 py-2 text-center shadow-[0_8px_24px_rgba(0,0,0,0.6)] backdrop-blur-md"
                        >
                          <p className="line-clamp-2 text-[10px] font-bold leading-relaxed text-white">
                            {speechText}
                          </p>
                          <div className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-[#ED001B]/60 bg-[#0F131E]" />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* مؤثر رادار الفحص الأمني حول الشخصية عند حالة auditing */}
                    {agent.status === "auditing" && (
                      <motion.div
                        animate={{ scale: [1, 1.85], opacity: [0.75, 0] }}
                        transition={{
                          repeat: Infinity,
                          duration: 1.8,
                          ease: "easeOut",
                        }}
                        className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#ED001B]"
                      />
                    )}

                    {/* زر الشخصية القابل للنقر */}
                    <motion.button
                      type="button"
                      onClick={() =>
                        setSelectedAgentId(isSelected ? null : agent.id)
                      }
                      animate={
                        agent.status === "working"
                          ? { y: [0, -3, 0] }
                          : agent.status === "auditing"
                          ? { scale: [1, 1.05, 1] }
                          : { y: 0, scale: 1 }
                      }
                      transition={
                        agent.status === "working"
                          ? { repeat: Infinity, duration: 0.65 }
                          : agent.status === "auditing"
                          ? { repeat: Infinity, duration: 1.4 }
                          : { duration: 0.3 }
                      }
                      className="group relative flex flex-col items-center focus:outline-none"
                    >
                      {/* أيقونة الحالة الطافية فوق الرأس (تروس/كود لـ working، درع/رادار لـ auditing، قهوة لـ coffee) */}
                      {agent.status === "working" && (
                        <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-[#ED001B] px-2 py-0.5 text-[9px] font-black text-white shadow-md">
                          <Cog className="h-3 w-3 animate-spin" />
                          <Code2 className="h-3 w-3" />
                        </span>
                      )}
                      {agent.status === "auditing" && (
                        <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-[#ED001B] px-2 py-0.5 text-[9px] font-black text-white shadow-[0_0_12px_rgba(237,0,27,0.8)]">
                          <Radar className="h-3 w-3 animate-spin" />
                          <span>فحص أمني</span>
                        </span>
                      )}
                      {isAtCoffee && (
                        <span className="mb-1 inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-950/90 px-2 py-0.5 text-[9px] font-bold text-amber-200">
                          <Coffee className="h-2.5 w-2.5 text-amber-400" />
                          استراحة
                        </span>
                      )}

                      {/* دائرة الأفاتار */}
                      <div
                        className={`relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${coords.avatarGradient} ring-2 transition-transform group-hover:scale-110 ${
                          isSelected
                            ? "ring-[#ED001B] ring-offset-2 ring-offset-[#0B0D13] scale-110"
                            : agent.status !== "idle"
                            ? "ring-[#ED001B] shadow-[0_0_20px_rgba(237,0,27,0.55)]"
                            : coords.ringColor
                        }`}
                      >
                        <Icon
                          className={`h-5 w-5 ${
                            agent.role === "orchestrator"
                              ? "text-[#0B0D13]"
                              : "text-white"
                          }`}
                        />
                        {/* نقطة الحالة الحية */}
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#0B0D13] ${
                            st.dotClass
                          } ${st.pulse ? "animate-pulse" : ""}`}
                        />
                      </div>

                      {/* بطاقة الاسم والدور تحت الشخصية */}
                      <div className="mt-1.5 rounded-xl border border-white/15 bg-[#0B0D13]/92 px-2.5 py-0.5 text-center shadow-lg backdrop-blur-sm">
                        <p className="text-[11px] font-black leading-tight text-white">
                          {agent.name}
                        </p>
                        <p className="text-[9px] font-semibold text-white/60">
                          {coords.shortRole}
                        </p>
                      </div>
                    </motion.button>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* بطاقة التفاصيل السريعة عند النقر على أي موظف أو مكتب */}
          <AnimatePresence>
            {selectedAgent && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="border-t border-[#ED001B]/40 bg-[#131724] px-5 py-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                        selectedAgent.role === "principal_architect"
                          ? "bg-[#ED001B] text-white"
                          : selectedAgent.role === "orchestrator"
                          ? "bg-white text-[#0B0D13]"
                          : "bg-white/10 text-white"
                      }`}
                    >
                      {React.createElement(getRoleIcon(selectedAgent.role), {
                        className: "h-6 w-6",
                      })}
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-black text-white">
                          {selectedAgent.name} — {selectedAgent.title}
                        </h3>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                            STATUS_META[selectedAgent.status]?.badgeClass
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              STATUS_META[selectedAgent.status]?.dotClass
                            }`}
                          />
                          {STATUS_META[selectedAgent.status]?.label}
                        </span>
                      </div>
                      <p className="text-xs text-white/70">
                        {selectedAgent.current_task
                          ? `المهمة الحالية: ${selectedAgent.current_task}`
                          : latestLogByAgentId.get(selectedAgent.id)
                          ? `آخر نشاط: ${summarizeSpeechBubble(
                              latestLogByAgentId.get(selectedAgent.id)!.message
                            )}`
                          : "الموظف متاح ومستعد لاستلام تعليماتك الفورية."}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDirectOrderToAgent(selectedAgent)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#ED001B] px-4 py-2 text-xs font-black text-white shadow-md transition hover:bg-[#c90017]"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>
                        {selectedAgent.role === "principal_architect"
                          ? "توجيه أمر مباشر لكريم"
                          : `إرسال مهمة إلى ${selectedAgent.name}`}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedAgentId(null)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                      aria-label="إغلاق البطاقة"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* 2. لوحة السجل المباشر (Live Feed) + أزرار نسخ الأكواد وفلاتر التصنيف */}
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

          <div className="max-h-[540px] space-y-3.5 overflow-y-auto p-5">
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Terminal className="h-10 w-10 text-white/20" />
                <p className="mt-3 text-sm font-bold text-white/70">
                  لا توجد سجلات بعد في غرفة العمليات
                </p>
                <p className="mt-1 text-xs text-white/45">
                  أرسل أول أمر من شريط القيادة بالأسفل وشاهد الطاقم يتحرك وينسق في المكتب مباشرة.
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
                    commandInputRef.current?.focus();
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold text-white/75 transition hover:border-[#ED001B]/50 hover:bg-[#ED001B]/10 hover:text-white disabled:opacity-50"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSendCommand} className="flex items-center gap-2.5">
            <input
              ref={commandInputRef}
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
