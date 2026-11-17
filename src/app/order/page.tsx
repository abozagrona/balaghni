"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Truck,
  ShieldCheck,
  BellRing,
  ArrowRight,
  LoaderCircle,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { BellStickerPreview } from "@/components/brand/bell-sticker-preview";
import { Button } from "@/components/ui/button";
import { LibyaPhoneInput } from "@/components/ui/libya-phone-input";
import { SmartOtpModal } from "@/components/auth/smart-otp-modal";
import { cn, formatFullLibyaE164 } from "@/lib/utils";

const TIERS = [
  { id: "basic", name: "الباقة الأساسية", price: 50, badge: "واتساب فقط • 50 د.ل" },
  {
    id: "nabbihni",
    name: "باقة نَبِّهْنِي",
    price: 100,
    badge: "الأكثر طلباً • SMS + واتساب + نَبِّهْنِي",
  },
];

const LIBYA_CITIES = [
  "طرابلس",
  "بنغازي",
  "مصراتة",
  "الزاوية",
  "زليتن",
  "البيضاء",
  "طبرق",
  "سبها",
  "الخمس",
  "صبراتة",
  "غريان",
  "درنة",
  "سرت",
  "أجدابيا",
];

export default function OrderPage() {
  const [selectedTier, setSelectedTier] = React.useState("nabbihni");
  const [paymentMethod, setPaymentMethod] = React.useState<"cod" | "online">("cod");
  const [quantity, setQuantity] = React.useState(1);
  const [fullName, setFullName] = React.useState("");
  const [phoneDigits, setPhoneDigits] = React.useState("");
  const [city, setCity] = React.useState("طرابلس");
  const [address, setAddress] = React.useState("");

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [otpModalOpen, setOtpModalOpen] = React.useState(false);
  const [phoneForOtp, setPhoneForOtp] = React.useState("");
  const [activatedOrder, setActivatedOrder] = React.useState<{
    stickerCode: string;
    stickerCodes: string[];
    packageName: string;
    paymentMethod: "online" | "cod";
    expiresAt: string;
    totalLyd: number;
    city: string;
    address: string;
    quantity: number;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const activeTierObj =
    TIERS.find((t) => t.id === selectedTier) || TIERS[1];
  const shippingCost = quantity >= 2 ? 0 : 15;
  const totalLyd = activeTierObj.price * quantity + shippingCost;

  const handleOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    const formattedPhone = formatFullLibyaE164(phoneDigits);
    if (!formattedPhone) {
      setError(
        "يرجى إدخال رقم هاتف ليبي صحيح مكون من 9 أرقام ويبدأ بـ 91 أو 92 أو 093 أو 094."
      );
      return;
    }

    if (!fullName.trim() || !address.trim()) {
      setError("يرجى تعبئة الاسم الكامل وعنوان التوصيل.");
      return;
    }

    setPhoneForOtp(formattedPhone);
    setOtpModalOpen(true);
  };

  const handleOrderOtpVerified = async (
    verifiedPhone: string,
    otpProofToken?: string
  ) => {
    setOtpModalOpen(false);
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          packageType: selectedTier,
          tier: selectedTier,
          paymentMethod,
          quantity,
          customerName: fullName.trim(),
          fullName: fullName.trim(),
          customerPhone: verifiedPhone,
          phone: verifiedPhone,
          city,
          address: address.trim(),
          totalLyd,
          otpProofToken,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.stickerCode) {
        setError(
          data.error || "تعذر إتمام الطلب أو سحب كود ملصق متاح حالياً."
        );
        setIsSubmitting(false);
        return;
      }

      const codes: string[] = Array.isArray(data.stickerCodes) && data.stickerCodes.length > 0
        ? data.stickerCodes
        : [data.stickerCode];

      setActivatedOrder({
        stickerCode: data.stickerCode,
        stickerCodes: codes,
        packageName: data.packageName || activeTierObj.name,
        paymentMethod: data.paymentMethod === "online" ? "online" : "cod",
        expiresAt: data.subscriptionExpiresAt || "",
        totalLyd,
        city,
        address: address.trim(),
        quantity,
      });
      setIsSubmitting(false);
    } catch {
      setError("تأكد من الاتصال بالإنترنت وحاول مرة أخرى.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card/90 backdrop-blur-md">
        <div className="shell flex items-center justify-between py-3.5">
          <Link href="/">
            <BalaghniLogo size="md" showTagline />
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <ArrowRight className="h-4 w-4" />
              <span>العودة للرئيسية</span>
            </Link>
          </Button>
        </div>
      </header>

      <main className="shell flex-1 py-8 sm:py-12">
        {activatedOrder ? (
          <div className="mx-auto max-w-lg rounded-3xl border border-emerald-500/30 bg-card p-8 text-center shadow-card-soft">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <h1 className="mt-4 text-2xl font-bold text-foreground">
              {activatedOrder.paymentMethod === "online"
                ? "تم الشراء وتفعيل ملصقك بنجاح"
                : "تم الشراء واستلام طلبك بنجاح"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {activatedOrder.paymentMethod === "online" ? (
                <>
                  تم تفعيل {activatedOrder.stickerCodes.length > 1 ? "ملصقاتك" : "ملصقك"} بنجاح وهي جاهزة للربط. عند استلام الملصق، امسح رمز QR أو اضغط على «تفعيل وربط ملصق جديد» لربطه برقم هاتف المالك وبيانات السيارة.
                </>
              ) : (
                <>
                  تم تسجيل طلبك بحالة <strong className="text-foreground">بانتظار التوصيل</strong> إلى{" "}
                  <strong className="text-foreground">{activatedOrder.city}</strong>، وسيتم التواصل معك عبر الواتساب لتأكيد موعد التسليم.
                </>
              )}
            </p>
            <div className="mt-4 space-y-2.5">
              <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-emerald-800">
                <p className="text-xs font-bold">
                  {activatedOrder.paymentMethod === "online"
                    ? activatedOrder.stickerCodes.length > 1
                      ? `أكواد الملصقات المفعّلة والجاهزة للربط (${activatedOrder.stickerCodes.length}):`
                      : "كود الملصق المفعّل والجاهز للربط (365 يوماً):"
                    : activatedOrder.stickerCodes.length > 1
                      ? `أكواد الملصقات المحجوزة لطلبك (${activatedOrder.stickerCodes.length}):`
                      : "كود الملصق المخصص لطلبك:"}
                </p>
                <div className="mt-1.5 space-y-1">
                  {activatedOrder.stickerCodes.map((codeItem) => (
                    <p
                      key={codeItem}
                      dir="ltr"
                      className="font-mono text-xl font-black tracking-wider"
                    >
                      {codeItem}
                    </p>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-muted/40 p-3 text-xs font-bold text-foreground text-start">
                <div>
                  <span className="text-muted-foreground">الباقة:</span>{" "}
                  <span>{activatedOrder.packageName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">طريقة الدفع:</span>{" "}
                  <span>
                    {activatedOrder.paymentMethod === "online"
                      ? "دفع أونلاين"
                      : "كاش عند الاستلام"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">الإجمالي:</span>{" "}
                  <span className="font-mono">{activatedOrder.totalLyd} د.ل</span>
                </div>
                <div>
                  <span className="text-muted-foreground">حالة الطلب:</span>{" "}
                  <span>
                    {activatedOrder.paymentMethod === "online"
                      ? "مفعّل وجاهز للربط"
                      : "بانتظار التوصيل"}
                  </span>
                </div>
                {activatedOrder.paymentMethod === "cod" && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">العنوان:</span>{" "}
                    <span>
                      {activatedOrder.city} — {activatedOrder.address}
                    </span>
                  </div>
                )}
                {activatedOrder.expiresAt && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">صالح حتى:</span>{" "}
                    <span dir="ltr" className="font-mono">
                      {activatedOrder.expiresAt.slice(0, 10)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2.5">
              {activatedOrder.paymentMethod === "online" ? (
                <>
                  <Button asChild size="lg" className="w-full rounded-2xl">
                    <Link
                      href={`/activate?tag=${encodeURIComponent(
                        activatedOrder.stickerCode
                      )}`}
                    >
                      تفعيل وربط الملصق بسيارتي الآن
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="w-full rounded-2xl"
                  >
                    <Link href="/">العودة للصفحة الرئيسية</Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button asChild size="lg" className="w-full rounded-2xl">
                    <Link href="/activate">
                      تفعيل وربط ملصق عند الاستلام
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="w-full rounded-2xl"
                  >
                    <Link href="/">الانتقال للصفحة الرئيسية</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] items-start">
            {/* نموذج الطلب */}
            <form
              onSubmit={handleOrderSubmit}
              className="space-y-6 rounded-3xl border border-border bg-card p-5 sm:p-8 shadow-card-soft"
            >
              <div>
                <span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold text-primary">
                  الدفع كاش عند الاستلام أو أونلاين في جميع مدن ليبيا
                </span>
                <h1 className="mt-2.5 text-2xl font-bold text-foreground">
                  اطلب ملصق «بَلِّغْنِي | BALAGHNI»
                </h1>
              </div>

              {/* 1. اختيار الباقة */}
              <div className="space-y-2.5">
                <label className="block text-sm font-bold text-foreground">
                  1. اختر الباقة السنوية
                </label>
                <div className="grid gap-2.5">
                  {TIERS.map((t) => {
                    const active = selectedTier === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTier(t.id)}
                        className={cn(
                          "flex items-center justify-between rounded-2xl border p-4 text-start transition",
                          active
                            ? "border-primary bg-secondary/70 shadow-sm"
                            : "border-border bg-surface hover:border-primary/30"
                        )}
                      >
                        <div>
                          <p className="text-sm font-bold text-foreground">
                            {t.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t.badge}
                          </p>
                        </div>
                        <div className="font-mono text-lg font-bold text-primary">
                          {t.price} <span className="font-sans text-xs">د.ل</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. عدد الملصقات */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-bold text-foreground">
                    2. عدد الملصقات (شحن مجاني عند طلب ملصقين أو أكثر)
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {[1, 2, 3].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setQuantity(num)}
                      className={cn(
                        "rounded-2xl border py-3 text-center text-sm font-bold transition",
                        quantity === num
                          ? "border-primary bg-primary text-white shadow-primary-glow"
                          : "border-border bg-surface text-foreground"
                      )}
                    >
                      {num === 1
                        ? "ملصق واحد"
                        : num === 2
                        ? "ملصقان (شحن مجاني)"
                        : "3 ملصقات (شحن مجاني)"}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. بيانات المستلم والتوصيل (+218) */}
              <div className="space-y-4 pt-2">
                <h2 className="text-sm font-bold text-foreground">
                  3. بيانات المستلم والتوصيل (+218)
                </h2>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-foreground">
                    الاسم الكامل للمستلم *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="مثال: محمد السنوسي"
                    className="h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="order-libya-phone"
                    className="mb-1.5 block text-xs font-bold text-foreground"
                  >
                    رقم هاتف المستلم (مربوط بالواتساب لتأكيد الطلب والتوصيل) *
                  </label>
                  <LibyaPhoneInput
                    id="order-libya-phone"
                    required
                    value={phoneDigits}
                    onValueChange={setPhoneDigits}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      المدينة *
                    </label>
                    <select
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="h-12 w-full rounded-2xl border border-input bg-surface px-3.5 text-sm font-bold text-foreground focus:border-primary focus:outline-none"
                    >
                      {LIBYA_CITIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      العنوان بالتفصيل *
                    </label>
                    <input
                      type="text"
                      required
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="المنطقة، الشارع، أقرب نقطة دالة..."
                      className="h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {error && (
                <p className="rounded-2xl bg-secondary px-4 py-3 text-xs font-bold text-primary">
                  {error}
                </p>
              )}

              {/* 4. اختيار طريقة الدفع */}
              <div className="space-y-2.5">
                <label className="block text-sm font-bold text-foreground">
                  4. اختر طريقة الدفع
                </label>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("cod")}
                    className={cn(
                      "rounded-2xl border p-3.5 text-start transition-all",
                      paymentMethod === "cod"
                        ? "border-2 border-primary bg-secondary/70 text-primary shadow-sm"
                        : "border-border bg-white text-foreground hover:border-primary/30"
                    )}
                  >
                    <p className="text-xs font-black">الدفع كاش عند الاستلام (توصيل)</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      الدفع نقداً عند استلام الملصق — حالة الطلب: بانتظار التوصيل
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("online")}
                    className={cn(
                      "rounded-2xl border p-3.5 text-start transition-all",
                      paymentMethod === "online"
                        ? "border-2 border-primary bg-secondary/70 text-primary shadow-sm"
                        : "border-border bg-white text-foreground hover:border-primary/30"
                    )}
                  >
                    <p className="text-xs font-black">الدفع أونلاين فوري</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      تفعيل فوري للملصق (الوضع المؤقت لحين ربط بوابة الدفع)
                    </p>
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                size="xl"
                disabled={isSubmitting}
                className="w-full rounded-2xl text-base"
              >
                {isSubmitting ? (
                  <>
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                    <span>جاري تأكيد الطلب...</span>
                  </>
                ) : (
                  <>
                    <BellRing className="h-5 w-5" />
                    <span>
                      تأكيد الطلب ({totalLyd} د.ل —{" "}
                      {paymentMethod === "online"
                        ? "دفع أونلاين"
                        : "الدفع عند الاستلام"}
                      )
                    </span>
                  </>
                )}
              </Button>
            </form>

            {/* ملخص الطلب الجانبي + معاينة الصورة الرسمية */}
            <aside className="space-y-6 lg:sticky lg:top-24">
              <div className="rounded-3xl bg-white p-2">
                <BellStickerPreview tagCode="LY-123456" size="md" />
              </div>

              <div className="rounded-3xl border border-white/10 bg-dark-hero-gradient p-6 text-white shadow-card-dark">
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between text-white/80">
                    <span>
                      {activeTierObj.name} × {quantity}
                    </span>
                    <span className="font-mono font-bold text-white">
                      {activeTierObj.price * quantity} د.ل
                    </span>
                  </div>
                  <div className="flex justify-between text-white/80">
                    <span>التوصيل ({city})</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {shippingCost === 0 ? "مجاني" : `${shippingCost} د.ل`}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-white/10 pt-3 text-base font-bold text-white">
                    <span>الإجمالي المطلوب</span>
                    <span className="font-mono text-xl text-primary-accent">
                      {totalLyd} د.ل
                    </span>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2.5 text-[11px] text-white/75">
                  <div className="flex items-center gap-1.5 rounded-xl bg-white/5 p-2.5">
                    <Truck className="h-4 w-4 text-primary-accent shrink-0" />
                    <span>
                      {paymentMethod === "online"
                        ? "دفع أونلاين مؤمّن"
                        : "دفع عند الاستلام"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-xl bg-white/5 p-2.5">
                    <ShieldCheck className="h-4 w-4 text-primary-accent shrink-0" />
                    <span>اشتراك فعّال 365 يوماً</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>

      <SmartOtpModal
        isOpen={otpModalOpen}
        phone={phoneForOtp}
        onClose={() => setOtpModalOpen(false)}
        onVerified={handleOrderOtpVerified}
        title="تأكيد رقم هاتف المستلم لإتمام الطلب"
        subtitle="سيتم تأكيد طلبك عبر واتساب أو رسالة SMS دون ربط الملصق بالسيارة بعد"
      />
    </div>
  );
}
