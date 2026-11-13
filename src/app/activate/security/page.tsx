"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  KeyRound,
  Download,
  Copy,
  Check,
  AlertCircle,
  LoaderCircle,
  LayoutDashboard,
  LockKeyhole,
  QrCode,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { Button } from "@/components/ui/button";
import { formatBalaghniTagCode } from "@/lib/utils";
import { saveOwnerSession } from "@/lib/auth-session";

function generateRecoveryKeyShort(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const digits = "0123456789";
  const pick = (pool: string, len: number) =>
    Array.from({ length: len }, () =>
      pool.charAt(Math.floor(Math.random() * pool.length))
    ).join("");
  return `BK-${pick(digits, 4)}-${pick(chars, 4)}`;
}

function SecuritySetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTag = searchParams?.get("tag") || "";
  const tagCode = formatBalaghniTagCode(rawTag || "LY-000000");

  const [recoveryKey, setRecoveryKey] = React.useState("BK-8492-X7M1");
  const [vehicleInfo, setVehicleInfo] = React.useState("سيارة مسجلة");
  const [ownerPhone, setOwnerPhone] = React.useState("+218912345678");
  const [city, setCity] = React.useState("طرابلس");

  const [copiedKey, setCopiedKey] = React.useState(false);
  const [cardSaved, setCardSaved] = React.useState(false);

  // الخطوة 2: رمز مرور الحساب (PIN من 6 أرقام) وتأكيده
  const [ownerPin, setOwnerPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const generatedKey = generateRecoveryKeyShort();
    setRecoveryKey(generatedKey);

    try {
      const savedRaw = window.localStorage.getItem("balaghni_owner_active_tag");
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw);
        if (parsed.vehicleInfo) setVehicleInfo(parsed.vehicleInfo);
        if (parsed.ownerPhone) setOwnerPhone(parsed.ownerPhone);
        if (parsed.city) setCity(parsed.city);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleCopyRecoveryKey = () => {
    navigator.clipboard?.writeText(recoveryKey).catch(() => {});
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  // حفظ بطاقة كود أمان الطوارئ الرقمية كصورة PNG
  const handleDownloadSecurityCard = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 680;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bgGrad = ctx.createLinearGradient(0, 0, 1080, 680);
    bgGrad.addColorStop(0, "#0B0D13");
    bgGrad.addColorStop(1, "#181C28");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1080, 680);

    const redGrad = ctx.createLinearGradient(0, 0, 1080, 0);
    redGrad.addColorStop(0, "#E51926");
    redGrad.addColorStop(1, "#B9111C");
    ctx.fillStyle = redGrad;
    ctx.fillRect(0, 0, 1080, 18);

    ctx.strokeStyle = "rgba(229, 25, 38, 0.45)";
    ctx.lineWidth = 3;
    ctx.strokeRect(36, 42, 1008, 600);

    ctx.fillStyle = "#E51926";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(
      "بَلِّغْنِي | BALAGHNI — بطاقة الأمان الرقمية للمالك",
      1000,
      115
    );

    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "22px sans-serif";
    ctx.fillText(
      "احتفظ بهذه البطاقة في ألبوم صورك لاسترداد حسابك أو إعادة تعيين رمز الدخول",
      1000,
      160
    );

    ctx.fillStyle = "rgba(229, 25, 38, 0.14)";
    ctx.fillRect(80, 210, 920, 155);
    ctx.strokeStyle = "#E51926";
    ctx.lineWidth = 2;
    ctx.strokeRect(80, 210, 920, 155);

    ctx.fillStyle = "#FF6B72";
    ctx.font = "bold 20px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      "EMERGENCY RECOVERY KEY • كود أمان الطوارئ الرقمي",
      540,
      255
    );

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 56px monospace";
    ctx.fillText(recoveryKey, 540, 330);

    ctx.textAlign = "right";
    ctx.fillStyle = "#9BA3B8";
    ctx.font = "22px sans-serif";
    ctx.fillText(`كود الملصق: ${tagCode}`, 1000, 440);
    ctx.fillText(`المركبة: ${vehicleInfo} (${city})`, 1000, 495);
    ctx.fillText(`رقم المالك المسجل: ${ownerPhone}`, 1000, 550);

    ctx.fillStyle = "#10B981";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(
      "✓ مشفر ومحمي 100% — لا تشارك كود الاسترداد مع أي شخص",
      1000,
      608
    );

    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `Balaghni-Security-Card-${tagCode}.png`;
    link.href = dataUrl;
    link.click();
    setCardSaved(true);
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!/^\d{6}$/.test(ownerPin)) {
      setError("يرجى تعيين رمز مرور للحساب مكون من 6 أرقام.");
      return;
    }

    if (ownerPin !== confirmPin) {
      setError("رمز المرور وتأكيد رمز المرور غير متطابقين.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/tags/${encodeURIComponent(tagCode)}/security`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerPin,
            recoveryKey,
          }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || "تعذر حفظ إعدادات الأمان. حاول مرة أخرى.");
        setSubmitting(false);
        return;
      }

      // حفظ جلسة المالك المحلية ومزامنتها للانتقال السلس للوحة التحكم
      saveOwnerSession({
        tagCode,
        vehicleInfo: data.tag?.vehicleInfo || vehicleInfo,
        city: data.tag?.city || city,
        ownerPhone: data.tag?.ownerPhone || ownerPhone,
        activatedAt: new Date().toISOString(),
      });

      router.push(`/dashboard?tag=${encodeURIComponent(tagCode)}`);
    } catch {
      setError("تعذر الاتصال بالخادم. يرجى التحقق من الإنترنت.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#0B0D13] text-white flex flex-col">
      {/* شريط علوي */}
      <header className="border-b border-white/10 bg-[#0B0D13]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3.5">
          <Link href="/">
            <BalaghniLogo variant="dark" size="sm" showTagline />
          </Link>

          <span
            dir="ltr"
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-3 py-1 font-mono text-xs font-bold text-white"
          >
            <QrCode className="h-3.5 w-3.5 text-primary" />
            <span>{tagCode}</span>
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 space-y-6">
        {/* ترويسة صفحة إعداد الأمان المستقلة */}
        <div className="text-center space-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3.5 py-1 text-xs font-bold text-emerald-400">
            <LockKeyhole className="h-3.5 w-3.5" />
            الخطوة 2 من 2 • تأمين حساب المالك
          </span>
          <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
            إعداد أمان حساب سيارتك
          </h1>
          <p className="text-xs leading-relaxed text-white/70 sm:text-sm">
            احفظ بطاقة الطوارئ الرقمية وعيّن رمز المرور الخاص بك للدخول إلى لوحة
            تحكم سيارتك في أي وقت
          </p>
        </div>

        <form onSubmit={handleFinalSubmit} className="space-y-6">
          {/* الخطوة 1: بطاقة كود أمان الطوارئ الرقمية (BK-XXXX-XXXX) */}
          <div className="relative overflow-hidden rounded-3xl border border-primary/35 bg-[#141721] p-6 shadow-2xl sm:p-7">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-16 -left-16 h-48 w-48 rounded-full bg-primary/20 blur-3xl"
            />
            <div className="relative z-10">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-3 py-1 text-xs font-bold text-primary">
                  <ShieldCheck className="h-4 w-4" />
                  الخطوة 1 • بطاقة كود أمان الطوارئ الرقمية
                </span>
                <span className="text-[11px] font-bold text-emerald-400">
                  مهم للاسترداد
                </span>
              </div>

              <p className="mt-2.5 text-xs leading-relaxed text-white/75">
                هذا هو كود الطوارئ السري الخاص بملصقك. ستحتاجه في حال نسيت رمز
                الدخول مستقبلاً:
              </p>

              <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-[#0B0D13] px-4 py-4">
                <span
                  dir="ltr"
                  className="font-mono text-xl font-black tracking-widest text-white sm:text-2xl"
                >
                  {recoveryKey}
                </span>

                <button
                  type="button"
                  onClick={handleCopyRecoveryKey}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/20"
                >
                  {copiedKey ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-400">تم النسخ</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>نسخ الكود</span>
                    </>
                  )}
                </button>
              </div>

              <Button
                type="button"
                onClick={handleDownloadSecurityCard}
                size="lg"
                className="mt-4 w-full rounded-2xl bg-white text-[#0B0D13] hover:bg-white/90"
              >
                <Download className="h-4 w-4 text-primary" />
                <span>
                  {cardSaved
                    ? "تم حفظ البطاقة كصورة ✓ (اضغط للتحميل مجدداً)"
                    : "حفظ كصورة"}
                </span>
              </Button>
            </div>
          </div>

          {/* الخطوة 2: تعيين رمز مرور للحساب (PIN من 6 أرقام) وتأكيده */}
          <div className="rounded-3xl border border-white/12 bg-[#141721] p-6 space-y-4 sm:p-7">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/20 font-mono text-xs font-black text-primary">
                02
              </span>
              <div>
                <h2 className="text-base font-black text-white sm:text-lg">
                  تعيين رمز مرور الحساب (PIN من 6 أرقام)
                </h2>
                <p className="text-xs text-white/65">
                  يُحفظ مشفراً (SHA-256 Hash) في قاعدة البيانات لتسجيل دخولك
                  بأمان
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="owner-pin"
                  className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-white/85"
                >
                  <KeyRound className="h-3.5 w-3.5 text-primary" />
                  <span>رمز المرور (6 أرقام)</span>
                </label>
                <input
                  id="owner-pin"
                  type="password"
                  inputMode="numeric"
                  dir="ltr"
                  maxLength={6}
                  required
                  value={ownerPin}
                  onChange={(e) =>
                    setOwnerPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="••••••"
                  className="h-12 w-full rounded-2xl border border-white/15 bg-[#0B0D13] px-3 text-center font-mono text-xl font-black tracking-[0.35em] text-white placeholder:tracking-normal placeholder:text-white/25 focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="confirm-pin"
                  className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-white/85"
                >
                  <KeyRound className="h-3.5 w-3.5 text-primary" />
                  <span>تأكيد رمز المرور</span>
                </label>
                <input
                  id="confirm-pin"
                  type="password"
                  inputMode="numeric"
                  dir="ltr"
                  maxLength={6}
                  required
                  value={confirmPin}
                  onChange={(e) =>
                    setConfirmPin(
                      e.target.value.replace(/\D/g, "").slice(0, 6)
                    )
                  }
                  placeholder="••••••"
                  className="h-12 w-full rounded-2xl border border-white/15 bg-[#0B0D13] px-3 text-center font-mono text-xl font-black tracking-[0.35em] text-white placeholder:tracking-normal placeholder:text-white/25 focus:border-primary focus:outline-none"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-primary/50 bg-primary/15 p-4 text-xs font-bold text-primary-accent">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* الزر النهائي: تأكيد والانتقال إلى لوحة التحكم */}
          <Button
            type="submit"
            size="xl"
            disabled={submitting}
            className="w-full rounded-2xl shadow-primary-glow"
          >
            {submitting ? (
              <>
                <LoaderCircle className="h-5 w-5 animate-spin" />
                <span>جاري تشفير وحفظ إعدادات الأمان...</span>
              </>
            ) : (
              <>
                <LayoutDashboard className="h-5 w-5" />
                <span>تأكيد والانتقال إلى لوحة التحكم</span>
              </>
            )}
          </Button>
        </form>
      </main>
    </div>
  );
}

export default function ActivateSecurityPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[#0B0D13] text-white">
          جاري تحميل إعدادات الأمان...
        </div>
      }
    >
      <SecuritySetupContent />
    </React.Suspense>
  );
}
