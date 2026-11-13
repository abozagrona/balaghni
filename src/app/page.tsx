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
import { PricingSection } from "@/components/brand/pricing-section";
import { Button } from "@/components/ui/button";

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
        <PricingSection />

        {/* 6. قسم الأسئلة الشائعة القابل للطي (Accordion) قبل الفوتر */}
        <FaqAccordionSection />
      </main>

      {/* الفوتر الشامل */}
      <SiteFooter />
    </div>
  );
}
