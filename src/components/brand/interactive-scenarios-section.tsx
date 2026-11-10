"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CarFront,
  Lightbulb,
  DoorOpen,
  AlertTriangle,
  CheckCheck,
  ShieldCheck,
  QrCode,
  MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SCENARIOS = [
  {
    id: "01",
    icon: CarFront,
    title: "السيارة تعيق الطريق",
    msg: "«السلام عليكم، سيارتك قافلة عليا الطريق، أرجو تحريكها مشكوراً.»",
    urgency: "تنبيه موقف طارئ",
  },
  {
    id: "02",
    icon: Lightbulb,
    title: "أضواء السيارة تعمل",
    msg: "«تنبيه: أضواء سيارتك مفتوحة وقد تنفد البطارية.»",
    urgency: "حماية بطارية المركبة",
  },
  {
    id: "03",
    icon: DoorOpen,
    title: "نافذة أو باب مفتوح",
    msg: "«يرجى الانتباه، نافذة سيارتك مفتوحة.»",
    urgency: "تنبيه أمان وحماية",
  },
  {
    id: "04",
    icon: AlertTriangle,
    title: "حالات الطوارئ والحوادث",
    msg: "«نداء طوارئ عاجل لصاحب السيارة وجهات الاتصال الموثوقة.»",
    urgency: "أولوية قصوى • طوارئ",
  },
];

export function InteractiveScenariosSection() {
  const [activeId, setActiveId] = React.useState<string>("01");

  const activeScenario =
    SCENARIOS.find((item) => item.id === activeId) || SCENARIOS[0];

  return (
    <section id="situations" className="py-16 sm:py-24">
      <div className="shell">
        {/* تقسيم القسم إلى عمودين: اليمين القائمة التفاعلية المرقمة + اليسار بطاقة إشعار واتساب الحية */}
        <div className="grid items-center gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-12">
          {/* العمود الأيمن: عنوان "ملصق واحد. مواقف كثيرة." وتحته القائمة التفاعلية المرقمة (01، 02، 03، 04) */}
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-black text-foreground sm:text-4xl">
                ملصق واحد. <span className="text-primary">مواقف كثيرة.</span>
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                اضغط أو مرّر على أي موقف لمعاينة الرسالة الفورية التي تصلك على
                هاتفك:
              </p>
            </div>

            <div className="space-y-3">
              {SCENARIOS.map((item) => {
                const Icon = item.icon;
                const isSelected = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveId(item.id)}
                    onMouseEnter={() => setActiveId(item.id)}
                    className={cn(
                      "group flex w-full items-center justify-between gap-4 rounded-3xl border p-4 text-right transition-all duration-300 sm:p-5",
                      isSelected
                        ? "border-primary bg-secondary/70 shadow-primary-glow ring-1 ring-primary/40"
                        : "border-border bg-card shadow-card-soft hover:border-primary/40"
                    )}
                  >
                    <div className="flex items-center gap-3.5 sm:gap-4">
                      <span
                        className={cn(
                          "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl font-mono text-base font-black transition-colors duration-300",
                          isSelected
                            ? "bg-primary text-white shadow-primary-glow"
                            : "bg-primary/10 text-primary"
                        )}
                      >
                        {item.id}
                      </span>

                      <div>
                        <span
                          className={cn(
                            "text-base font-black transition-colors sm:text-lg",
                            isSelected ? "text-primary" : "text-foreground"
                          )}
                        >
                          {item.title}
                        </span>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.urgency}
                        </p>
                      </div>
                    </div>

                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                        isSelected
                          ? "bg-primary/15 text-primary"
                          : "bg-muted/70 text-muted-foreground"
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* العمود الأيسر: بطاقة إشعار واتساب أنيقة بتصميم حي */}
          <div className="relative mx-auto w-full max-w-md">
            {/* توهج خلفي خفيف */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-3 rounded-[36px] bg-gradient-to-tr from-[#25D366]/15 via-primary/10 to-transparent blur-2xl"
            />

            <div className="relative overflow-hidden rounded-[32px] border border-border bg-[#0B0D13] p-5 text-white shadow-[0_24px_60px_rgba(11,13,19,0.22)] sm:p-6">
              {/* شريط إشعار واتساب العلوي */}
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-3">
                  {/* أيقونة واتساب خضراء */}
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#25D366] text-white shadow-[0_8px_20px_rgba(37,211,102,0.35)]">
                    <MessageCircle className="h-6 w-6 fill-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-sm font-black text-white sm:text-base">
                        بَلِّغْنِي - تنبيه فوري
                      </h4>
                      <span className="rounded-full bg-[#25D366]/20 px-2 py-0.5 text-[10px] font-bold text-[#25D366]">
                        واتساب رسمي
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-white/60">
                      إشعار مركبة • كود الملصق{" "}
                      <span dir="ltr" className="font-mono font-bold text-white/90">
                        LY-123456
                      </span>
                    </p>
                  </div>
                </div>

                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-emerald-400">
                  الآن
                </span>
              </div>

              {/* منطقة الرسالة المتغيرة بنعومة عبر AnimatePresence */}
              <div className="my-5 min-h-[165px]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeScenario.id}
                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.98 }}
                    transition={{ duration: 0.24, ease: "easeOut" }}
                    className="relative rounded-2xl rounded-tr-sm border border-[#25D366]/30 bg-[#14231C] p-4 text-white shadow-inner sm:p-5"
                  >
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1.5 font-bold text-[#25D366]">
                        <QrCode className="h-3.5 w-3.5" />
                        <span>
                          الموقف {activeScenario.id}: {activeScenario.title}
                        </span>
                      </span>
                      <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80">
                        {activeScenario.urgency}
                      </span>
                    </div>

                    <div
                      className="text-base font-bold leading-relaxed text-white !text-white sm:text-lg"
                      style={{ color: "#FFFFFF" }}
                    >
                      <span
                        className="font-bold text-white !text-white"
                        style={{ color: "#FFFFFF" }}
                      >
                        {activeScenario.msg}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2.5 text-[11px] text-white/60">
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5 text-[#25D366]" />
                        تم الإرسال دون إظهار رقم هاتفك
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-[#25D366]">
                        <span>تم الاستلام</span>
                        <CheckCheck className="h-4 w-4" />
                      </span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* تذييل البطاقة */}
              <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-2.5 text-xs text-white/75">
                <span>يصل الإشعار عبر واتساب + SMS معاً</span>
                <span className="font-mono font-bold text-primary">
                  +218 •••••••
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
