"use client";

import * as React from "react";
import Link from "next/link";
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useMotionValueEvent,
} from "framer-motion";
import {
  QrCode,
  MessageSquare,
  Smartphone,
  CarFront,
  Lightbulb,
  DoorOpen,
  AlertTriangle,
  CheckCircle2,
  BellRing,
  MapPin,
  Sparkles,
  ArrowLeft,
  ShieldCheck,
  Camera,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    index: 0,
    step: "01",
    icon: ShieldCheck,
    title: "الصق الملصق في مكانه",
    desc: "ثبّت ملصق «بَلِّغْنِي» الذكي على زجاج سيارتك الخلفي في مكان ظاهر للجميع.",
  },
  {
    index: 1,
    step: "02",
    icon: QrCode,
    title: "يمسح رمز الجرس بالكاميرا",
    desc: "يوجه أي شخص كاميرا هاتفه نحو ملصق «بَلِّغْنِي» على زجاج سيارتك فتفتح صفحة سريعة خفيفة فوراً.",
  },
  {
    index: 2,
    step: "03",
    icon: MessageSquare,
    title: "يختار سبب التنبيه بلمسة",
    desc: "يحدد السبب الجاهز (السيارة تعيق الطريق، الأضواء تعمل، نافذة مفتوحة) مع إمكانية إرفاق صورة.",
  },
  {
    index: 3,
    step: "04",
    icon: Smartphone,
    title: "يصلك الإشعار في ثوانٍ",
    desc: "تستلم رسالة فورية على رقمك الليبي (+218) عبر SMS وواتساب دون أن يظهر رقمك للطرف الآخر.",
  },
];

const SCAN_REASONS_PREVIEW = [
  {
    id: "blocking",
    label: "السيارة تعيق الطريق",
    subtitle: "يرجى تحريك السيارة في أقرب وقت",
    icon: CarFront,
  },
  {
    id: "lights_on",
    label: "أضواء السيارة تعمل",
    subtitle: "الأضواء مفتوحة وقد تنفد البطارية",
    icon: Lightbulb,
  },
  {
    id: "car_open",
    label: "نافذة أو باب السيارة مفتوح",
    subtitle: "يرجى تفقد السيارة وتأمينها",
    icon: DoorOpen,
  },
  {
    id: "hit",
    label: "اصطدمت بسيارتك عن غير قصد",
    subtitle: "أرغب في التواصل معك لتسوية الأمر",
    icon: AlertTriangle,
  },
];

export function HowItWorksSection() {
  const containerRef = React.useRef<HTMLElement | null>(null);
  const [activeStep, setActiveStep] = React.useState<number>(0);
  const [selectedReason, setSelectedReason] = React.useState<string>("blocking");

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  // تحديث الخطوة النشطة تلقائياً أثناء التمرير
  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    if (latest < 0.25) {
      setActiveStep(0);
    } else if (latest < 0.5) {
      setActiveStep(1);
    } else if (latest < 0.75) {
      setActiveStep(2);
    } else {
      setActiveStep(3);
    }
  });

  // إخفاء العنوان الرئيسي تدريجياً عند بدء التمرير لإعطاء مساحة كاملة للهاتف والبطاقات
  const headerOpacity = useTransform(scrollYProgress, [0, 0.14], [1, 0]);
  const headerY = useTransform(scrollYProgress, [0, 0.14], [0, -28]);
  const contentShiftY = useTransform(scrollYProgress, [0, 0.16], [0, -24]);

  // يبدأ الهاتف مائلاً ثلاثي الأبعاد ثم يعتدل تدريجياً مع حركة التمرير
  const phoneRotateZ = useTransform(scrollYProgress, [0, 0.75, 1], [-8, -2, 0]);
  const phoneRotateY = useTransform(scrollYProgress, [0, 0.75, 1], [15, 4, 0]);
  const phoneRotateX = useTransform(scrollYProgress, [0, 0.75, 1], [7, 2, 0]);
  const phoneScale = useTransform(scrollYProgress, [0, 0.5, 1], [0.95, 1, 1.01]);

  // إتاحة الضغط المباشر على أي خطوة للانتقال إليها ومعاينتها داخل الهاتف
  const handleSelectStep = (idx: number) => {
    setActiveStep(idx);
    if (!containerRef.current || typeof window === "undefined") return;
    const rect = containerRef.current.getBoundingClientRect();
    const sectionTop = window.scrollY + rect.top;
    const scrollableDistance =
      containerRef.current.offsetHeight - window.innerHeight;
    if (scrollableDistance > 0) {
      const targetProgress = idx * 0.28 + 0.05;
      window.scrollTo({
        top: sectionTop + scrollableDistance * Math.min(0.95, targetProgress),
        behavior: "smooth",
      });
    }
  };

  return (
    <section
      id="how-it-works"
      ref={containerRef}
      className="relative h-[300vh] bg-dark-hero-gradient text-white"
    >
      {/* الحاوية المثبتة أثناء التمرير مع مسافة علوية كافية أسفل الـ Navbar (z-50) */}
      <div className="sticky top-0 flex h-screen flex-col justify-center overflow-hidden pt-20 pb-6 sm:pt-24 sm:pb-8">
        {/* خلفية شبكية خفيفة */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        <div className="shell relative z-10 flex h-full flex-col justify-center">
          {/* 1. العنوان الرئيسي للقسم (يختفي تدريجياً عند بدء التمرير داخل الخطوات) */}
          <motion.div
            style={{ opacity: headerOpacity, y: headerY }}
            className="pointer-events-none mx-auto mb-4 max-w-2xl shrink-0 text-center sm:mb-6"
          >
            <span className="rounded-full bg-primary/20 px-3.5 py-1 text-xs font-bold text-primary-accent">
              طريقة العمل في 4 خطوات
            </span>
            <h2 className="mt-2 text-xl font-bold sm:text-3xl lg:text-4xl">
              امسح للتواصل مع صاحب السيارة — بدون كشف الأرقام
            </h2>
            <p className="mt-1 text-xs text-white/75 sm:text-sm">
              وداعاً لترك رقم هاتفك مكتوباً على ورقة فوق الطبلون معرضاً للإزعاج.
            </p>
          </motion.div>

          {/* 2. الشبكة التفاعلية في منتصف الشاشة: البطاقات الأربع المضغوطة على اليمين + الهاتف على اليسار */}
          <motion.div
            style={{ y: contentShiftY }}
            className="grid items-center gap-6 lg:grid-cols-[1.12fr_0.88fr] lg:gap-10"
          >
            {/* العمود الأيمن: البطاقات الأربع مضغوطة ومرتبة لتظهر جميعها كاملة داخل الشاشة الواحدة */}
            <div className="flex flex-col gap-2.5 sm:gap-3">
              {STEPS.map((item) => {
                const Icon = item.icon;
                const isActive = activeStep === item.index;
                return (
                  <button
                    key={item.step}
                    type="button"
                    onClick={() => handleSelectStep(item.index)}
                    className={cn(
                      "group relative w-full rounded-2xl border px-4 py-3 text-right transition-all duration-300 sm:rounded-3xl sm:px-5 sm:py-3.5",
                      isActive
                        ? "border-primary bg-balaghni-charcoal shadow-[0_10px_32px_rgba(229,25,38,0.28)] ring-1 ring-primary/60"
                        : "border-white/10 bg-balaghni-charcoal/55 opacity-70 hover:border-white/25 hover:opacity-95"
                    )}
                  >
                    <div className="flex items-start gap-3.5">
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-300 sm:h-11 sm:w-11",
                          isActive
                            ? "bg-primary-gradient text-white shadow-primary-glow"
                            : "bg-white/10 text-white/70"
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-bold text-white sm:text-base">
                            {item.title}
                          </h3>
                          <span
                            className={cn(
                              "font-mono text-lg font-bold transition-colors sm:text-xl",
                              isActive ? "text-primary" : "text-white/25"
                            )}
                          >
                            {item.step}
                          </span>
                        </div>
                        <p
                          className={cn(
                            "mt-1 text-xs leading-relaxed transition-colors sm:text-[13px]",
                            isActive ? "text-white/90" : "text-white/60"
                          )}
                        >
                          {item.desc}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* العمود الأيسر: مجسم الهاتف ثلاثي الأبعاد الذي يعتدل تدريجياً مع التمرير */}
            <div
              className="flex flex-col items-center justify-center"
              style={{ perspective: "1200px" }}
            >
              <motion.div
                style={{
                  rotateZ: phoneRotateZ,
                  rotateY: phoneRotateY,
                  rotateX: phoneRotateX,
                  scale: phoneScale,
                  transformStyle: "preserve-3d",
                }}
                className="relative h-[430px] w-[235px] rounded-[40px] border-[4px] border-[#383B47] bg-[#10131C] p-2.5 shadow-[0_28px_70px_rgba(0,0,0,0.65)] sm:h-[465px] sm:w-[252px]"
              >
                {/* الجزيرة التفاعلية (Dynamic Island) */}
                <div className="absolute top-4 left-1/2 z-30 h-3.5 w-16 -translate-x-1/2 rounded-full bg-black ring-1 ring-white/10" />

                {/* شاشة الهاتف الداخلية المرتبطة بصفحات ومكونات الموقع الفعلية */}
                <div
                  dir="rtl"
                  className="relative flex h-full w-full flex-col overflow-hidden rounded-[30px] bg-[#F9FAFC] text-[#0B0D13]"
                >
                  {/* الشريط العلوي الفعلي لصفحة المسح (/s/LY-123456) */}
                  <div className="flex items-center justify-between border-b border-black/10 bg-white px-3 pt-6 pb-2">
                    <BalaghniLogo size="sm" />
                    <span
                      dir="ltr"
                      className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-secondary px-2 py-0.5 font-mono text-[10px] font-bold text-primary"
                    >
                      <QrCode className="h-2.5 w-2.5" />
                      <span>LY-123456</span>
                    </span>
                  </div>

                  {/* محتوى الشاشة حسب الخطوة النشطة (01 -> 02 -> 03 -> 04) */}
                  <div className="relative flex-1 overflow-y-auto">
                    <AnimatePresence mode="wait">
                      {/* الخطوة 01: عرض تصميم الملصق (LY-123456) بحجم كبير وواضح في منتصف شاشة الهاتف بدون المربع النصي الأحمر العلوي */}
                      {activeStep === 0 && (
                        <motion.div
                          key="step-01-sticker"
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ duration: 0.25 }}
                          className="flex h-full flex-col items-center justify-between p-3.5 text-center"
                        >
                          <div className="my-auto flex w-full flex-col items-center justify-center rounded-2xl border border-black/10 bg-white p-3 shadow-card-soft">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src="/balaghni-sticker.jpg"
                              alt="معاينة ملصق LY-123456"
                              className="h-56 w-full rounded-xl object-contain"
                            />
                          </div>

                          <Link
                            href="/s/LY-123456"
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#0B0D13] py-2 text-[11px] font-bold text-white transition hover:bg-primary"
                          >
                            <QrCode className="h-3.5 w-3.5 text-primary" />
                            <span>معاينة ملصق LY-123456</span>
                          </Link>
                        </motion.div>
                      )}

                      {/* الخطوة 02: حركة مسح الرمز للانتقال إلى صفحة المسح */}
                      {activeStep === 1 && (
                        <motion.div
                          key="step-02-scan"
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ duration: 0.25 }}
                          className="flex h-full flex-col items-center justify-between bg-[#0B0D13] p-4 text-center text-white"
                        >
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold text-white/90">
                            <Camera className="h-3 w-3 text-primary" />
                            <span>جاري مسح رمز الجرس بالكاميرا</span>
                          </div>

                          {/* إطار المسح الضوئي لملصق الجرس */}
                          <div className="relative flex h-44 w-44 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-primary/70 bg-white p-2.5 shadow-primary-glow">
                            <span className="absolute right-2 top-2 h-4 w-4 border-r-2 border-t-2 border-primary" />
                            <span className="absolute left-2 top-2 h-4 w-4 border-l-2 border-t-2 border-primary" />
                            <span className="absolute bottom-2 right-2 h-4 w-4 border-b-2 border-r-2 border-primary" />
                            <span className="absolute bottom-2 left-2 h-4 w-4 border-b-2 border-l-2 border-primary" />

                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src="/balaghni-sticker.jpg"
                              alt="مسح ملصق LY-123456"
                              className="h-full w-full object-contain"
                            />

                            {/* خط الليزر المتحرك */}
                            <motion.div
                              animate={{ y: [-65, 65, -65] }}
                              transition={{
                                repeat: Infinity,
                                duration: 1.3,
                                ease: "easeInOut",
                              }}
                              className="absolute inset-x-2 h-[2.5px] bg-primary shadow-[0_0_12px_#E51926]"
                            />
                          </div>

                          <Link
                            href="/s/LY-123456"
                            className="flex w-full items-center justify-between rounded-xl bg-primary px-3 py-2 text-[11px] font-bold text-white shadow-primary-glow"
                          >
                            <span>فتح صفحة المسح (LY-123456)</span>
                            <ArrowLeft className="h-3.5 w-3.5" />
                          </Link>
                        </motion.div>
                      )}

                      {/* الخطوة 03: واجهة «تجربة صفحة المسح» الفعلية الموجودة في الموقع (/s/LY-123456) */}
                      {activeStep === 2 && (
                        <motion.div
                          key="step-03-page"
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -12 }}
                          transition={{ duration: 0.25 }}
                          className="flex h-full flex-col justify-between pb-2.5"
                        >
                          {/* ترويسة صفحة المسح الحمراء وبطاقة السيارة البيضاء الفعلية */}
                          <div className="bg-primary-gradient px-3 py-2 text-white">
                            <p className="text-[10.5px] font-bold">
                              هل هناك أمر يخص هذه السيارة؟
                            </p>
                            <div className="mt-1.5 flex items-center justify-between rounded-xl bg-white p-2 text-[#0B0D13] shadow-sm">
                              <div className="flex items-center gap-2">
                                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                  <CarFront className="h-4 w-4" />
                                </div>
                                <div className="text-right">
                                  <p
                                    dir="ltr"
                                    className="text-[10.5px] font-bold leading-none"
                                  >
                                    Toyota Hilux 2024
                                  </p>
                                  <p className="mt-0.5 flex items-center gap-1 text-[8.5px] text-slate-500">
                                    <span className="font-mono font-bold text-primary">
                                      LY-123456
                                    </span>
                                    <span>•</span>
                                    <MapPin className="h-2.5 w-2.5 text-primary" />
                                    <span>طرابلس</span>
                                  </p>
                                </div>
                              </div>
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[8.5px] font-bold text-emerald-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                متصل
                              </span>
                            </div>
                          </div>

                          {/* قائمة أسباب التنبيه الفعلية من مكون ScanForm */}
                          <div className="space-y-1 px-2.5 pt-1.5">
                            <p className="text-[10px] font-bold text-[#0B0D13]">
                              شنو المشكلة في السيارة؟{" "}
                              <span className="text-primary">*</span>
                            </p>
                            {SCAN_REASONS_PREVIEW.map((r) => {
                              const RIcon = r.icon;
                              const selected = selectedReason === r.id;
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => setSelectedReason(r.id)}
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-xl border p-1.5 text-right transition",
                                    selected
                                      ? "border-primary bg-secondary/70 shadow-sm"
                                      : "border-black/10 bg-white"
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                                      selected
                                        ? "bg-primary text-white"
                                        : "bg-slate-100 text-slate-600"
                                    )}
                                  >
                                    <RIcon className="h-3.5 w-3.5" />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-[9.5px] font-bold text-[#0B0D13]">
                                      {r.label}
                                    </p>
                                    <p className="truncate text-[8px] text-slate-500">
                                      {r.subtitle}
                                    </p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          <div className="px-2.5 pt-1">
                            <Link
                              href="/s/LY-123456"
                              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-1.5 text-[10px] font-bold text-white shadow-primary-glow"
                            >
                              <BellRing className="h-3 w-3" />
                              <span>إرسال التنبيه لصاحب السيارة</span>
                            </Link>
                          </div>
                        </motion.div>
                      )}

                      {/* الخطوة 04: حالة تأكيد إرسال البلاغ ووصول الإشعار المعتمدة في النظام */}
                      {activeStep === 3 && (
                        <motion.div
                          key="step-04-success"
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ duration: 0.25 }}
                          className="flex h-full flex-col justify-between p-3"
                        >
                          {/* بطاقة تأكيد الإبلاغ المعتمدة في ScanForm */}
                          <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-500/25 bg-white px-3 py-3.5 text-center shadow-card-soft">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600">
                              <CheckCircle2 className="h-5 w-5" />
                            </div>
                            <span className="mt-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[9px] font-bold text-emerald-700">
                              تم الإبلاغ بنجاح
                            </span>
                            <h4 className="mt-1 text-xs font-bold text-[#0B0D13]">
                              وصل تنبيهك لصاحب السيارة!
                            </h4>
                            <p className="mt-1 text-[9px] leading-relaxed text-slate-600">
                              تم إرسال إشعار فوري عبر الرسائل القصيرة (SMS)
                              وواتساب إلى مالك{" "}
                              <strong className="text-[#0B0D13]">
                                Toyota Hilux 2024
                              </strong>{" "}
                              دون كشف هوية أو رقم أي طرف.
                            </p>
                          </div>

                          {/* البطاقة التسويقية الداكنة المعتمدة في النظام */}
                          <div className="rounded-2xl border border-white/10 bg-dark-hero-gradient p-3 text-right text-white shadow-card-dark">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="inline-flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[8.5px] font-bold text-primary-accent">
                                  <Sparkles className="h-2.5 w-2.5" />
                                  احمِ سيارتك في كل مشوار
                                </span>
                                <h5 className="mt-1 text-[11px] font-bold text-white">
                                  تبي ملصق «بَلِّغْنِي» لسيارتك؟
                                </h5>
                                <p className="mt-0.5 text-[8.5px] leading-relaxed text-white/75">
                                  خلي الناس توصلك في ثواني من غير ما رقمك يظهر
                                  لأي شخص.
                                </p>
                              </div>
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary-gradient text-white">
                                <BellRing className="h-3.5 w-3.5 animate-bell-ring" />
                              </div>
                            </div>

                            <Link
                              href="/order"
                              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-1.5 text-[9.5px] font-bold text-white"
                            >
                              <span>اطلب ملصقك الآن</span>
                              <ArrowLeft className="h-3 w-3" />
                            </Link>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>

              {/* مؤشرات الخطوات السريعة أسفل الهاتف */}
              <div className="mt-3 flex items-center gap-2">
                {STEPS.map((s) => (
                  <button
                    key={s.step}
                    type="button"
                    aria-label={`الانتقال إلى الخطوة ${s.step}`}
                    onClick={() => handleSelectStep(s.index)}
                    className={cn(
                      "h-2 rounded-full transition-all duration-300",
                      activeStep === s.index
                        ? "w-8 bg-primary"
                        : "w-2 bg-white/25 hover:bg-white/45"
                    )}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
