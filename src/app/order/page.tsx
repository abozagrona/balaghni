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
  const [vehicleModel, setVehicleModel] = React.useState("");

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [activatedOrder, setActivatedOrder] = React.useState<{
    stickerCode: string;
    packageName: string;
    paymentMethod: "online" | "cod";
    expiresAt: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const activeTierObj =
    TIERS.find((t) => t.id === selectedTier) || TIERS[1];
  const shippingCost = quantity >= 2 ? 0 : 15;
  const totalLyd = activeTierObj.price * quantity + shippingCost;

  const handleOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const formattedPhone = formatFullLibyaE164(phoneDigits);
    if (!formattedPhone) {
      setError(
        "يرجى إدخال رقم هاتف ليبي صحيح مكون من 9 أرقام ويبدأ بـ 91 أو 92 أو 93 أو 94."
      );
      return;
    }

    if (!fullName.trim() || !address.trim()) {
      setError("يرجى تعبئة الاسم الكامل وعنوان التوصيل.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageType: selectedTier,
          tier: selectedTier,
          paymentMethod,
          quantity,
          customerName: fullName.trim(),
          fullName: fullName.trim(),
          customerPhone: formattedPhone,
          phone: formattedPhone,
          city,
          address: address.trim(),
          vehicleModel: vehicleModel.trim(),
          totalLyd,
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

      setActivatedOrder({
        stickerCode: data.stickerCode,
        packageName: data.packageName || activeTierObj.name,
        paymentMethod: data.paymentMethod === "online" ? "online" : "cod",
        expiresAt: data.subscriptionExpiresAt || "",
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
              تم تأكيد طلبك وتفعيل ملصقك بنجاح!
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              تم سحب وتفعيل كود ملصقك الحقيقي من المخزن مباشرة وإرسال التفاصيل إلى رقمك عبر الواتساب للتوصيل إلى{" "}
              <strong className="text-foreground">{city}</strong>.
            </p>
            <div className="mt-4 space-y-2.5">
              <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-emerald-800">
                <p className="text-xs font-bold">كود الملصق المفعّل (365 يوماً):</p>
                <p dir="ltr" className="mt-1 font-mono text-xl font-black tracking-wider">
                  {activatedOrder.stickerCode}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-muted/40 p-3 text-xs font-bold text-foreground">
                <div>
                  <span className="text-muted-foreground">الباقة:</span>{" "}
                  <span>{activatedOrder.packageName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">الدفع:</span>{" "}
                  <span>
                    {activatedOrder.paymentMethod === "online"
                      ? "أونلاين"
                      : "عند الاستلام"}
                  </span>
                </div>
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
              <Button asChild size="lg" className="w-full rounded-2xl">
                <Link href="/login">دخول لوحة تحكم سيارتي</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="w-full rounded-2xl"
              >
                <Link href="/">العودة للصفحة الرئيسية</Link>
              </Button>
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
                  الدفع عند الاستلام في جميع مدن ليبيا
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

              {/* 3. بيانات التوصيل ورقم الهاتف الليبي (+218) */}
              <div className="space-y-4 pt-2">
                <h2 className="text-sm font-bold text-foreground">
                  3. بيانات المستلم ورقم الهاتف (+218)
                </h2>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-foreground">
                    الاسم الكامل *
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
                    رقم الهاتف الليبي (سيتم ربط الملصق به) *
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
                      نوع وموديل السيارة (اختياري)
                    </label>
                    <input
                      type="text"
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      placeholder="مثال: Hyundai Elantra"
                      className="h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground focus:border-primary focus:outline-none"
                    />
                  </div>
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

              {error && (
                <p className="rounded-2xl bg-secondary px-4 py-3 text-xs font-bold text-primary">
                  {error}
                </p>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("cod")}
                  className={cn(
                    "rounded-2xl border p-3 text-xs font-bold transition-all",
                    paymentMethod === "cod"
                      ? "border-primary bg-secondary text-primary"
                      : "border-border bg-white text-foreground"
                  )}
                >
                  دفع عند الاستلام (COD)
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("online")}
                  className={cn(
                    "rounded-2xl border p-3 text-xs font-bold transition-all",
                    paymentMethod === "online"
                      ? "border-primary bg-secondary text-primary"
                      : "border-border bg-white text-foreground"
                  )}
                >
                  دفع أونلاين فوري
                </button>
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
    </div>
  );
}
