"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  ShieldCheck,
  CarFront,
  AlertCircle,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LibyaPhoneInput } from "@/components/ui/libya-phone-input";
import { SmartOtpModal } from "@/components/auth/smart-otp-modal";
import { formatFullLibyaE164 } from "@/lib/utils";

const LIBYA_CITIES = [
  "طرابلس",
  "بنغازي",
  "مصراتة",
  "الزاوية",
  "سبها",
  "زليتن",
  "الخمس",
  "غريان",
  "درنة",
  "طبرق",
  "البيضاء",
  "أجدابيا",
];

interface TagActivationFormProps {
  tagCode: string;
}

export function TagActivationForm({ tagCode }: TagActivationFormProps) {
  const router = useRouter();
  const [pin, setPin] = React.useState("");
  const [ownerPhone, setOwnerPhone] = React.useState("");
  const [vehicleInfo, setVehicleInfo] = React.useState("");
  const [city, setCity] = React.useState("طرابلس");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [otpModalOpen, setOtpModalOpen] = React.useState(false);

  const formattedOwnerPhone =
    formatFullLibyaE164(ownerPhone) || `+218${ownerPhone.replace(/\D/g, "")}`;

  // 1. عند الضغط على "تأكيد وتفعيل": فحص الحقول وفتح نافذة الـ OTP أولاً دون الحفظ المباشر
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    const cleanPin = pin.trim();
    if (!/^\d{4,8}$/.test(cleanPin)) {
      setError(
        "يرجى إدخال رمز الخدش السري المكون من 6 أرقام الموجود تحت طبقة الخدش بالبطاقة."
      );
      return;
    }

    const fullPhone = formatFullLibyaE164(ownerPhone);
    if (!fullPhone) {
      setError(
        "يرجى إدخال رقم هاتف ليبي صحيح (+218) يبدأ بـ (091, 092, 093, 094, 095)."
      );
      return;
    }

    if (!vehicleInfo.trim() || vehicleInfo.trim().length < 2) {
      setError(
        "يرجى إدخال نوع وموديل ولون السيارة (مثال: كيا سيراتو - أبيض)."
      );
      return;
    }

    // إيقاف الحفظ المباشر وفتح نافذة التحقق الذكية (SmartOtpModal)
    setOtpModalOpen(true);
  };

  // 2. بعد تأكيد رمز الـ OTP بنجاح: يتم اعتماد الحفظ والتفعيل في قاعدة البيانات
  const handleOtpVerified = async (verifiedPhone: string) => {
    setOtpModalOpen(false);
    setLoading(true);
    setError(null);

    const phoneToUse = verifiedPhone || formattedOwnerPhone;

    try {
      const res = await fetch(
        `/api/tags/${encodeURIComponent(tagCode)}/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pin: pin.trim(),
            ownerPhone: phoneToUse,
            vehicleInfo: vehicleInfo.trim(),
            city,
          }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(
          data.error || "تعذر تفعيل الملصق. تأكد من رمز PIN وحاول مجدداً."
        );
        setLoading(false);
        return;
      }

      // حفظ بيانات التفعيل الأولي والانتقال الفوري إلى صفحة تأمين الحساب المستقلة (/activate/security)
      try {
        window.localStorage.setItem(
          "balaghni_owner_active_tag",
          JSON.stringify({
            tagCode,
            vehicleInfo: vehicleInfo.trim(),
            city,
            ownerPhone: phoneToUse,
            activatedAt: new Date().toISOString(),
          })
        );
      } catch {
        // ignore storage errors
      }

      router.push(`/activate/security?tag=${encodeURIComponent(tagCode)}`);
    } catch {
      setError(
        "تعذر الاتصال بالخادم. يرجى التحقق من الإنترنت والمحاولة مجدداً."
      );
      setLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-card-soft sm:p-7">
      <div className="mb-5 flex items-start gap-3.5 border-b border-border pb-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-primary-glow">
          <LockKeyhole className="h-6 w-6" />
        </span>
        <div>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-bold text-primary">
            <Sparkles className="h-3 w-3" />
            الخطوة 1 من 2 • تفعيل الملصق الذاتي
          </span>
          <h2 className="mt-1 text-lg font-black text-foreground sm:text-xl">
            ربط وتفعيل الملصق برقم هاتفك
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            امسح طبقة الخدش الفضية على بطاقة الملصق وأدخل رمز الـ PIN السري
            لتفعيل استلام التنبيهات على هاتفك.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 1. رمز الخدش السري PIN */}
        <div>
          <label
            htmlFor="activation-pin"
            className="mb-1.5 flex items-center justify-between text-xs font-bold text-foreground sm:text-sm"
          >
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="h-4 w-4 text-primary" />
              رمز الخدش السري (PIN)
            </span>
            <span className="text-[11px] font-normal text-muted-foreground">
              مكون من 6 أرقام تحت طبقة الخدش
            </span>
          </label>
          <input
            id="activation-pin"
            type="text"
            inputMode="numeric"
            dir="ltr"
            maxLength={8}
            required
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="••••••"
            className="h-12 w-full rounded-2xl border border-input bg-surface px-4 text-center font-mono text-xl font-black tracking-[0.35em] text-foreground placeholder:tracking-normal placeholder:text-placeholder focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* 2. رقم الهاتف الليبي (+218) */}
        <div>
          <label className="mb-1.5 flex items-center justify-between text-xs font-bold text-foreground sm:text-sm">
            <span>رقم هاتف المالك (لاستلام التنبيهات)</span>
            <span className="text-[11px] font-semibold text-emerald-600">
              مخفي 100% عن العامة
            </span>
          </label>
          <LibyaPhoneInput
            value={ownerPhone}
            onValueChange={setOwnerPhone}
            placeholder="91 234 5678"
            required
          />
        </div>

        {/* 3. معلومات المركبة والمدينة */}
        <div className="grid gap-3 sm:grid-cols-[1.4fr_0.6fr]">
          <div>
            <label
              htmlFor="vehicle-info"
              className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-foreground sm:text-sm"
            >
              <CarFront className="h-4 w-4 text-primary" />
              نوع ولون السيارة (يظهر للماسحين)
            </label>
            <input
              id="vehicle-info"
              type="text"
              required
              value={vehicleInfo}
              onChange={(e) => setVehicleInfo(e.target.value)}
              placeholder="مثال: كيا سيراتو - أبيض"
              className="h-12 w-full rounded-2xl border border-input bg-surface px-3.5 text-sm font-medium text-foreground placeholder:text-placeholder focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label
              htmlFor="vehicle-city"
              className="mb-1.5 block text-xs font-bold text-foreground sm:text-sm"
            >
              المدينة
            </label>
            <select
              id="vehicle-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="h-12 w-full rounded-2xl border border-input bg-surface px-3 text-sm font-bold text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {LIBYA_CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-primary/30 bg-secondary p-3.5 text-xs font-bold text-primary">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="rounded-2xl bg-muted/70 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-bold text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            ضمان الخصوصية:
          </span>{" "}
          رقم هاتفك يُحفظ مشفراً لاستقبال إشعارات واتساب و SMS فقط، ولن يظهر لأي
          شخص يقوم بمسح الملصق.
        </div>

        <Button
          type="submit"
          size="xl"
          disabled={loading}
          className="w-full rounded-2xl"
        >
          {loading ? (
            <>
              <LoaderCircle className="h-5 w-5 animate-spin" />
              <span>جاري التحقق وتفعيل الملصق...</span>
            </>
          ) : (
            <>
              <ShieldCheck className="h-5 w-5" />
              <span>تأكيد وتفعيل الملصق الآن</span>
            </>
          )}
        </Button>
      </form>

      {/* نافذة التحقق الذكية برمز الـ OTP عبر واتساب ورسائل SMS */}
      <SmartOtpModal
        isOpen={otpModalOpen}
        phone={ownerPhone}
        onClose={() => setOtpModalOpen(false)}
        onVerified={handleOtpVerified}
        title="التحقق من رقم الهاتف لتفعيل الملصق"
        subtitle="لتأكيد ملكية رقمك وربطه بملصق المركبة، سنرسل رمز التحقق أولاً إلى واتساب مع التحويل الفوري لرسالة SMS إن تعذر ذلك"
      />
    </div>
  );
}

