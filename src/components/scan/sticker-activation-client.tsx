"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Gift,
  CreditCard,
  LoaderCircle,
  AlertTriangle,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LibyaPhoneInput } from "@/components/ui/libya-phone-input";
import { SmartOtpModal } from "@/components/auth/smart-otp-modal";
import { PACKAGES, type PackageType } from "@/lib/packages";
import { cn, formatFullLibyaE164 } from "@/lib/utils";
import { saveOwnerSession } from "@/lib/auth-session";

interface StickerActivationClientProps {
  code: string;
  initialMode: "unactivated" | "gift_ready" | "expired";
}

export function StickerActivationClient({
  code,
  initialMode,
}: StickerActivationClientProps) {
  const [mode, setMode] = React.useState(initialMode);
  const [selectedPkg, setSelectedPkg] = React.useState<PackageType>("nabbihni");
  const [phoneDigits, setPhoneDigits] = React.useState("");
  const [ownerName, setOwnerName] = React.useState("");
  const [vehicleInfo, setVehicleInfo] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [unassignedOrderId, setUnassignedOrderId] = React.useState<string | null>(
    null
  );
  const [activatedDetails, setActivatedDetails] = React.useState<{
    code: string;
    packageName: string;
    expiresAt: string;
    isGift: boolean;
  } | null>(null);
  const [otpModalOpen, setOtpModalOpen] = React.useState(false);
  const [phoneForOtp, setPhoneForOtp] = React.useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUnassignedOrderId(null);

    const fullPhone = formatFullLibyaE164(phoneDigits);
    if (!fullPhone) {
      setError("يرجى إدخال رقم هاتف ليبي صحيح (091 / 092 / 093 / 094 / 095).");
      return;
    }

    setPhoneForOtp(fullPhone);
    setOtpModalOpen(true);
  };

  const handleOtpVerified = async (verifiedPhone: string, otpProofToken?: string) => {
    setOtpModalOpen(false);
    setLoading(true);
    setError(null);

    const finalPhone = verifiedPhone || phoneForOtp;

    try {
      const res = await fetch(
        `/api/stickers/${encodeURIComponent(code)}/activate-online`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            mode: mode === "gift_ready" ? "gift" : "online",
            packageType: selectedPkg,
            phone: finalPhone,
            otpProofToken: otpProofToken || "",
            ownerName,
            vehicleInfo,
            allowExpiredRenewal: mode === "expired",
          }),
        }
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        if (data.alreadyRedeemed) {
          setMode("unactivated");
        }
        if (data.unassignedPaid && data.orderId) {
          setUnassignedOrderId(String(data.orderId));
        }
        setError(data.error || "تعذر إتمام التفعيل حالياً.");
        setLoading(false);
        return;
      }

      saveOwnerSession({
        tagCode: code,
        vehicleInfo: vehicleInfo.trim() || "مركبة مفعلة",
        city: "طرابلس",
        ownerPhone: finalPhone,
        activatedAt: new Date().toISOString(),
      });

      const isGift = mode === "gift_ready";
      const fallbackExpiry = new Date(
        Date.now() + (isGift ? 30 : 365) * 24 * 60 * 60 * 1000
      )
        .toISOString()
        .slice(0, 10);
      const rawExpiry =
        data.sticker?.subscription_expires_at ||
        data.sticker?.subscriptionExpiresAt ||
        fallbackExpiry;
      const pkgLabel = isGift
        ? "باقة نَبِّهْنِي (هدية 30 يوماً)"
        : PACKAGES[selectedPkg]?.name || "باقة نَبِّهْنِي";

      setActivatedDetails({
        code,
        packageName: pkgLabel,
        expiresAt: String(rawExpiry).slice(0, 10),
        isGift,
      });
      setLoading(false);
    } catch {
      setError("حدث خطأ أثناء الاتصال بالخادم.");
      setLoading(false);
    }
  };

  if (activatedDetails) {
    return (
      <div className="rounded-3xl border border-emerald-200 bg-card p-6 text-center shadow-card-soft sm:p-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600">
          <CheckCircle2 className="h-9 w-9" />
        </div>
        <h2 className="mt-4 text-2xl font-black text-foreground">
          تم تفعيل ملصقك بنجاح
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {activatedDetails.isGift
            ? "تم تفعيل شهرك المجاني بنجاح لمدة 30 يوماً بكامل مزايا باقة نَبِّهْنِي."
            : "تم ربط الملصق برقم هاتفك وتفعيل اشتراكك السنوي لمدة 365 يوماً."}
        </p>

        <div className="mt-5 space-y-2.5">
          <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-emerald-900">
            <p className="text-xs font-bold">كود الملصق المفعّل:</p>
            <p dir="ltr" className="mt-1 font-mono text-xl font-black tracking-wider">
              {activatedDetails.code}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-muted/40 p-3 text-xs font-bold text-foreground">
            <div>
              <span className="text-muted-foreground">الباقة:</span>{" "}
              <span>{activatedDetails.packageName}</span>
            </div>
            <div>
              <span className="text-muted-foreground">صالح حتى:</span>{" "}
              <span dir="ltr" className="font-mono">
                {activatedDetails.expiresAt}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <Button asChild size="lg" className="w-full rounded-2xl">
            <Link href={`/dashboard?tag=${encodeURIComponent(activatedDetails.code)}`}>
              <span>الانتقال إلى لوحة تحكم سيارتي</span>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full rounded-2xl">
            <Link href="/">العودة للصفحة الرئيسية</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-card-soft sm:p-7">
      {mode === "gift_ready" ? (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center">
          <Gift className="mx-auto h-8 w-8 text-amber-600" />
          <h2 className="mt-2 text-base font-black leading-relaxed text-amber-950">
            مبروك! حصلت على ملصق بَلِّغْنِي هدية مع اشتراك مجاني لمدة 30 يوماً — أدخل بياناتك لتفعيل الحماية على سيارتك فوراً
          </h2>
        </div>
      ) : mode === "expired" ? (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-center">
          <RefreshCw className="mx-auto h-8 w-8 text-red-600" />
          <h2 className="mt-2 text-lg font-black text-red-950">
            انتهى اشتراك هذا الملصق ({code})
          </h2>
          <p className="mt-1 text-xs text-red-800">
            اختر الباقة المناسبة لتجديد اشتراكك لمدة 365 يوماً واستمرار الخدمة.
          </p>
        </div>
      ) : (
        <div className="mb-5 space-y-2 text-center">
          <h2 className="text-xl font-black text-foreground">
            تفعيل الملصق ({code})
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            اختر الباقة المناسبة وفعّل ملصقك أونلاين فوراً.
          </p>
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] font-bold text-amber-900">
            في حال استلامك الملصق من إحدى نقاط البيع المعتمدة، يمكنك تفعيله مباشرة من هنا بعد تأكيد رقم هاتفك
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode !== "gift_ready" && (
          <div className="grid gap-3 sm:grid-cols-2">
            {([PACKAGES.basic, PACKAGES.nabbihni] as const).map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                onClick={() => setSelectedPkg(pkg.id)}
                className={cn(
                  "rounded-2xl border p-3.5 text-start transition-all",
                  selectedPkg === pkg.id
                    ? "border-2 border-primary bg-secondary/40"
                    : "border-border bg-white"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-foreground">
                    {pkg.name}
                  </span>
                  <span className="font-mono text-sm font-black text-primary">
                    {pkg.priceLyd} د.ل
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {pkg.id === "basic"
                    ? "واتساب فقط • 365 يوماً"
                    : "SMS + واتساب + نَبِّهْنِي + طوارئ"}
                </p>
              </button>
            ))}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-bold text-foreground">
            رقم هاتف المالك (ليبي) *
          </label>
          <LibyaPhoneInput
            value={phoneDigits}
            onValueChange={setPhoneDigits}
            required
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-bold text-foreground">
              الاسم (اختياري)
            </label>
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="محمد العلي"
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-foreground">
              نوع السيارة (اختياري)
            </label>
            <input
              type="text"
              value={vehicleInfo}
              onChange={(e) => setVehicleInfo(e.target.value)}
              placeholder="كيا اوتيما بيضاء"
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div>
                <p>{error}</p>
                {unassignedOrderId && (
                  <p className="mt-1 font-mono text-[11px] text-red-900">
                    رقم الرصيد المحفوظ: {unassignedOrderId}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          disabled={loading}
          className="w-full rounded-2xl"
        >
          {loading ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : mode === "gift_ready" ? (
            <Gift className="h-4 w-4" />
          ) : (
            <CreditCard className="h-4 w-4" />
          )}
          <span>
            {mode === "gift_ready"
              ? "تفعيل الشهر الهدية مجاناً الآن"
              : mode === "expired"
              ? `تجديد الاشتراك (${PACKAGES[selectedPkg].priceLyd} د.ل)`
              : `ادفع وفعّل الملصق أونلاين (${PACKAGES[selectedPkg].priceLyd} د.ل)`}
          </span>
        </Button>
      </form>

      <SmartOtpModal
        isOpen={otpModalOpen}
        phone={phoneForOtp}
        onClose={() => setOtpModalOpen(false)}
        onVerified={handleOtpVerified}
        title="التحقق من رقم الهاتف لتفعيل الملصق"
        subtitle="أدخل رمز التحقق المرسل إلى رقمك لإتمام تفعيل الملصق وربطه بحسابك"
      />
    </div>
  );
}
