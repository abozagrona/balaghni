"use client";

import * as React from "react";
import Link from "next/link";
import {
  Check,
  ArrowLeft,
  Building2,
  X,
  LoaderCircle,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CORPORATE_FEATURE_OPTIONS,
  PACKAGES,
} from "@/lib/packages";

export function PricingSection() {
  const [corporateModalOpen, setCorporateModalOpen] = React.useState(false);
  const [companyName, setCompanyName] = React.useState("");
  const [city, setCity] = React.useState("طرابلس");
  const [fleetCount, setFleetCount] = React.useState(10);
  const [contactPhone, setContactPhone] = React.useState("");
  const [selectedFeatures, setSelectedFeatures] = React.useState<string[]>([
    "whatsapp",
    "sms_and_whatsapp",
    "nabbihni_reminders",
  ]);
  const [submitting, setSubmitting] = React.useState(false);
  const [modalError, setModalError] = React.useState<string | null>(null);

  const toggleFeature = (label: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(label) ? prev.filter((f) => f !== label) : [...prev, label]
    );
  };

  const handleCorporateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    if (!companyName.trim() || !city.trim()) {
      setModalError("يرجى إدخال اسم الشركة والمدينة.");
      return;
    }
    if (fleetCount < 10) {
      setModalError("الحد الأدنى لباقة إيليت للشركات هو 10 سيارات.");
      return;
    }

    setSubmitting(true);
    try {
      const featureLabels = CORPORATE_FEATURE_OPTIONS.filter((f) =>
        selectedFeatures.includes(f.id)
      ).map((f) => f.label);

      const res = await fetch("/api/corporate-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          city: city.trim(),
          fleetCount,
          selectedFeatures: featureLabels,
          contactPhone: contactPhone.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setModalError(data.error || "تعذر إرسال الطلب حالياً.");
        setSubmitting(false);
        return;
      }

      const adminPhone = String(data.adminWhatsappNumber || "218919009899");
      const waText = [
        `مرحباً فريق بَلِّغْنِي، نرغب في تخصيص باقة إيليت للشركات:`,
        `• اسم الشركة: ${companyName.trim()}`,
        `• المدينة: ${city.trim()}`,
        `• عدد السيارات: ${fleetCount}`,
        `• المزايا المطلوبة: ${featureLabels.join("، ") || "حسب الاتفاق"}`,
        ...(contactPhone.trim() ? [`• رقم التواصل: ${contactPhone.trim()}`] : []),
      ].join("\n");

      const waUrl = `https://wa.me/${adminPhone}?text=${encodeURIComponent(
        waText
      )}`;
      window.open(waUrl, "_blank", "noopener,noreferrer");
      setSubmitting(false);
      setCorporateModalOpen(false);
    } catch {
      setModalError("تعذر الاتصال بالخادم، حاول مرة أخرى.");
      setSubmitting(false);
    }
  };

  const orderedPackages = [PACKAGES.basic, PACKAGES.nabbihni, PACKAGES.elite];

  return (
    <section
      id="pricing"
      className="border-t border-border bg-card py-14 sm:py-20"
    >
      <div className="shell">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-block rounded-full bg-secondary px-3.5 py-1 text-xs font-bold text-primary">
            باقات وخطط بَلِّغْنِي
          </span>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-foreground sm:text-3xl">
            اختر الباقة المناسبة لسيارتك أو أسطولك
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            حماية فورية لخصوصية رقمك مع تغطية واتساب وSMS وتذكيرات «نَبِّهْنِي»
            الذكية — باشتراك سنوي واضح أو تسعير مخصص للشركات.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {orderedPackages.map((tier) => (
            <div
              key={tier.id}
              className={`relative flex flex-col justify-between rounded-2xl border p-6 transition-all ${
                tier.featured
                  ? "border-2 border-primary bg-secondary/40 shadow-glow-red"
                  : "border-border bg-white shadow-card-soft"
              }`}
            >
              {tier.badge && (
                <span className="absolute -top-3 right-6 rounded-full bg-primary px-3 py-1 text-[11px] font-bold text-white shadow-sm">
                  {tier.badge}
                </span>
              )}

              <div>
                <h3 className="text-lg font-extrabold text-foreground">
                  {tier.name}
                </h3>

                {tier.priceLyd !== null ? (
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-3xl font-black text-foreground">
                      {tier.priceLyd} د.ل
                    </span>
                    {tier.oldPriceLyd && (
                      <span className="text-sm text-muted-foreground line-through">
                        {tier.oldPriceLyd} د.ل
                      </span>
                    )}
                    <span className="text-xs font-medium text-muted-foreground">
                      / {tier.period}
                    </span>
                  </div>
                ) : (
                  <div className="mt-4">
                    <div className="text-2xl font-black text-primary">
                      {tier.headerText}
                    </div>
                    <div className="mt-0.5 text-xs font-bold text-muted-foreground">
                      {tier.subheaderText}
                    </div>
                  </div>
                )}

                <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                  {tier.description}
                </p>

                <ul className="mt-5 space-y-2.5 text-sm">
                  {tier.featuresList.map((feat) => (
                    <li
                      key={feat}
                      className="flex items-start gap-2.5 text-foreground"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </span>
                      <span className="leading-snug">{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {tier.id === "elite" ? (
                <Button
                  type="button"
                  onClick={() => setCorporateModalOpen(true)}
                  variant="outline"
                  size="lg"
                  className="mt-7 w-full rounded-xl"
                >
                  <Building2 className="h-4 w-4" />
                  <span>{tier.ctaLabel}</span>
                </Button>
              ) : (
                <Button
                  asChild
                  variant={tier.featured ? "default" : "outline"}
                  size="lg"
                  className="mt-7 w-full rounded-xl"
                >
                  <Link href={`/order?tier=${tier.id}`}>
                    <span>{tier.ctaLabel}</span>
                    <ArrowLeft className="h-4 w-4" />
                  </Link>
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      {corporateModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-3xl border border-border bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-lg font-black text-foreground">
                  تخصيص باقة إيليت للشركات
                </h3>
                <p className="text-xs text-muted-foreground">
                  لأسطول 10 سيارات فأكثر — تسعير مخصص حسب المزايا المطلوبة
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCorporateModalOpen(false)}
                className="rounded-xl p-1.5 text-muted-foreground hover:bg-secondary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCorporateSubmit} className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-foreground">
                    اسم الشركة *
                  </label>
                  <input
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="شركة الأفق للنقل"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-foreground">
                    المدينة *
                  </label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="طرابلس"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-foreground">
                    عدد السيارات (الحد الأدنى 10) *
                  </label>
                  <input
                    type="number"
                    min={10}
                    required
                    value={fleetCount}
                    onChange={(e) => setFleetCount(Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-foreground">
                    رقم التواصل (اختياري)
                  </label>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="091XXXXXXX"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-foreground">
                  المزايا المطلوبة للأسطول:
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {CORPORATE_FEATURE_OPTIONS.map((opt) => (
                    <label
                      key={opt.id}
                      className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-secondary/20 px-3 py-2 text-xs font-semibold text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFeatures.includes(opt.id)}
                        onChange={() => toggleFeature(opt.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {modalError && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                  {modalError}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                disabled={submitting}
                className="w-full rounded-xl"
              >
                {submitting ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageCircle className="h-4 w-4" />
                )}
                <span>أرسل التفاصيل للتفاوض عبر واتساب</span>
              </Button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
