import * as React from "react";
import Link from "next/link";
import {
  ShieldCheck,
  LockKeyhole,
  Zap,
  ArrowDown,
  Check,
  ArrowLeft,
} from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import HeroVehicleVisual from "@/components/brand/hero-vehicle-visual";
import { HowItWorksSection } from "@/components/brand/how-it-works-section";
import { InteractiveScenariosSection } from "@/components/brand/interactive-scenarios-section";
import { PrivacyAndChannelsSection } from "@/components/brand/privacy-and-channels-section";
import { FaqAccordionSection } from "@/components/brand/faq-accordion-section";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";

const PRICING_TIERS = [
  {
    id: "standard",
    name: "الباقة الأساسية",
    priceLyd: "45",
    oldPriceLyd: "75",
    period: "سنوياً",
    description: "مثالية للاستخدام اليومي داخل المدينة مع حماية كاملة لخصوصية رقمك.",
    featured: false,
    features: [
      "ملصق «بَلِّغْنِي» الأصلي المقاوم للشمس والماء",
      "استلام التنبيهات عبر واتساب أو SMS",
      "إخفاء تام لرقم هاتفك عن الماسحين",
      "كود تعريفي ليبي خاص (مثال: LY-123456)",
    ],
  },
  {
    id: "premium",
    name: "باقة بريميوم",
    badge: "الأكثر طلباً في ليبيا",
    priceLyd: "75",
    oldPriceLyd: "120",
    period: "سنوياً",
    description: "تغطية مزدوجة تضمن وصول التنبيه حتى عند انقطاع الإنترنت عن هاتفك.",
    featured: true,
    features: [
      "استلام التنبيهات عبر SMS + واتساب معاً في نفس اللحظة",
      "إرفاق صور توضيحية وموقع السيارة الجغرافي",
      "حماية ذكية ضد الإزعاج والرسائل غير اللائقة",
      "استبدال مجاني للملصق عند تغيير الزجاج",
    ],
  },
  {
    id: "elite",
    name: "باقة إيليت للطوارئ",
    priceLyd: "135",
    oldPriceLyd: "210",
    period: "سنوياً",
    description: "أقصى درجات الأمان لك ولعائلتك على الطرق السريعة وداخل المدن.",
    featured: false,
    features: [
      "جميع مزايا باقة بريميوم (SMS + واتساب معاً)",
      "بوابة طوارئ لإبلاغ 3 من أفراد عائلتك عند الحوادث",
      "أولوية قصوى في توصيل الإشعارات الفورية",
      "ملصق إضافي مجاني للسيارة الثانية أو الخلفية",
    ],
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* 1. قسم الـ Hero الرئيسي بخلفية بيضاء نقية تندمج مع الصورة الأصلية بدون أي إطارات */}
        <section className="bg-white pt-3 pb-12 sm:pt-4 sm:pb-16">
          <div className="shell">
            <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
              {/* العمود الأيمن: النصوص وأزرار الدعوة لاتخاذ إجراء */}
              <div className="space-y-6 text-start">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-secondary px-3.5 py-1 text-xs font-bold text-primary">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    آمن 100%
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1 text-xs font-bold text-foreground">
                    <LockKeyhole className="h-3.5 w-3.5 text-primary" />
                    بدون إظهار رقمك
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1 text-xs font-bold text-foreground">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    لا يحتاج تطبيقاً
                  </span>
                </div>

                <div>
                  <h1 className="home-hero-headline">
                    <span className="home-hero-headline__question">
                      مْسَكِّر على حد؟
                    </span>
                    <span className="home-hero-headline__question home-hero-headline__question--secondary">
                      أو
                      <br />
                      حد مْسَكِّر عليك بسيارته؟
                    </span>
                    <span className="home-hero-headline__prefix">
                      في الحالتين..
                    </span>
                    <span className="home-hero-headline__answer">
                      يوصلك البلاغ في ثواني!
                    </span>
                  </h1>
                  <p className="mt-14 max-w-xl text-base leading-relaxed sm:text-lg">
                    <span className=" rounded-md bg-secondary px-2 py-0.5 font-normal text-primary">
                      من غير ماتحمل اي تطبيق، و من غير مايطلع رقمك لحد.
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3.5 pt-10">
                  <Button asChild size="xl" className="rounded-full px-8">
                    <Link href="/order">
                      <span>اطلب ملصقك الآن</span>
                      <ArrowLeft className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="xl"
                    className="rounded-full border-primary/25 bg-secondary/50 px-6 text-foreground hover:border-primary hover:bg-secondary transition-all"
                  >
                    <Link href="#how-it-works">
                      <span>كيف يعمل؟</span>
                      <ArrowDown className="h-4 w-4 text-primary" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* العمود الأيسر: عرض مكون HeroVehicleVisual المنظم */}
              <div className="flex items-center justify-center">
                <HeroVehicleVisual tagCode="LY-123456" />
              </div>
            </div>
          </div>
        </section>

        {/* 2. كيف يعمل «بَلِّغْنِي»؟ (طريقة العمل في 4 خطوات مباشرة بعد الـ Hero) */}
        <HowItWorksSection />

        {/* 3. المواقف اليومية التفاعلية مع معاينة إشعار واتساب المباشر */}
        <InteractiveScenariosSection />

        {/* 4. خصوصية تامة + نوصلك بأكثر من طريقة (قبل قسم الباقات) */}
        <PrivacyAndChannelsSection />

        {/* 5. قسم الباقات والأسعار بالدينار الليبي (د.ل) */}
        <section id="pricing" className="py-16 sm:py-24">
          <div className="shell">
            <div className="mx-auto max-w-2xl text-center">
              <span className="rounded-full bg-secondary px-3.5 py-1 text-xs font-bold text-primary">
                الباقات السنوية بالدينار الليبي
              </span>
              <h2 className="mt-3 text-2xl font-bold text-foreground sm:text-4xl">
                اختر باقة «بَلِّغْنِي» المناسبة لسيارتك
              </h2>
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                توصيل لكافة المدن الليبية (طرابلس، بنغازي، مصراتة، الزاوية، سبها، وكافة المناطق) مع الدفع عند الاستلام.
              </p>
            </div>

            <div className="mt-14 grid items-center gap-6 lg:grid-cols-3 lg:gap-8">
              {PRICING_TIERS.map((tier) => (
                <div
                  key={tier.id}
                  className={
                    tier.featured
                      ? "relative z-10 flex flex-col rounded-3xl border-[2.5px] border-primary bg-card p-7 shadow-primary-glow ring-4 ring-primary/15 transition-transform sm:p-8 lg:scale-105"
                      : "relative flex flex-col rounded-3xl border border-border bg-card p-6 shadow-card-soft sm:p-7"
                  }
                >
                  {tier.badge && (
                    <span className="absolute -top-4 start-6 rounded-full bg-primary-gradient px-4 py-1 text-xs font-bold text-white shadow-md">
                      {tier.badge}
                    </span>
                  )}

                  <div>
                    <h3 className="text-xl font-bold text-foreground">
                      {tier.name}
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {tier.description}
                    </p>
                  </div>

                  <div className="my-6 flex items-baseline gap-2 border-y border-border py-4">
                    <span className="font-mono text-4xl font-bold text-foreground">
                      {tier.priceLyd}
                    </span>
                    <span className="text-base font-bold text-primary">
                      د.ل
                    </span>
                    <span className="text-xs text-muted-foreground">
                      / {tier.period}
                    </span>
                    <span className="ms-auto font-mono text-sm text-muted-foreground line-through">
                      {tier.oldPriceLyd} د.ل
                    </span>
                  </div>

                  <ul className="mb-7 flex-1 space-y-3 text-sm">
                    {tier.features.map((feat, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </span>
                        <span className="text-foreground/90">{feat}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    asChild
                    variant={tier.featured ? "default" : "outline"}
                    size="lg"
                    className="w-full rounded-2xl"
                  >
                    <Link href={`/order?tier=${tier.id}`}>
                      اطلب {tier.name}
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 6. قسم الأسئلة الشائعة القابل للطي (Accordion) قبل الفوتر */}
        <FaqAccordionSection />
      </main>

      {/* الفوتر الشامل */}
      <SiteFooter />
    </div>
  );
}
