import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Scale, ArrowRight, Calendar } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

export const metadata: Metadata = {
  title: "الشروط والأحكام لمنصة «بَلِّغْنِي» | BALAGHNI",
  description:
    "القواعد والبنود التي تنظم استخدامك لخدمات منصة «بَلِّغْنِي».",
};

const TERMS_SECTIONS = [
  {
    number: "1",
    title: "1. الموافقة والأهلية",
    paragraphs: [
      "تُعد شروط الاستخدام هذه اتفاقاً قانونياً ملزماً بينك وبين منصة «بَلِّغْنِي». بإنشائك لحساب، أو تفعيلك لملصق ذكي، أو استخدامك للموقع الإلكتروني أو لوحة التحكم أو خدمات التنبيه، فإنك توافق تماماً على هذه الشروط وعلى سياسة الخصوصية الخاصة بنا. إن لم تكن موافقاً، يُرجى عدم استخدام الخدمة. يجب أن تكون مؤهلاً قانونياً لإبرام هذا الاتفاق.",
    ],
  },
  {
    number: "2",
    title: "2. طبيعة الخدمة",
    paragraphs: [
      "تُقدم منصة «بَلِّغْنِي» حلاً ذكياً يربط الملصقات الذكية (QR Codes) بمركبتك، مما يتيح للأشخاص تنبيهك في حالات الطوارئ أو الإزعاج المروري عبر لوحة التحكم وقنوات التواصل المتاحة. الخدمة هي وسيلة لتسهيل التواصل فقط وليست خدمة طوارئ حكومية رسمية، ولا تغني عن الاتصال بالجهات المختصة (كالشرطة أو الإسعاف أو المطافئ). التنبيه يعتمد على توفر الإنترنت وتغطية شبكات المحمول، ولا نضمن وصول كل رسالة بشكل فوري في حال انقطاع الشبكة.",
    ],
  },
  {
    number: "3",
    title: "3. الحسابات وملكية الملصقات",
    paragraphs: [
      "أنت مسؤول عن تقديم بيانات صحيحة، والحفاظ على سرية معلومات حسابك وكلمة المرور، وتحديث بيانات التواصل والتنبيه بسرعة. أنت مسؤول عن كافة الأنشطة التي تتم من خلال حسابك والمركبات المرتبطة به.",
    ],
  },
  {
    number: "4",
    title: "4. الاستخدام العادل والمقبول",
    intro:
      "تخضع التنبيهات اليومية لسياسة الاستخدام العادل لحماية موثوقية الخدمة ومنع الإساءة:",
    bullets: [
      "مُمنع تماماً استخدام الخدمة للتهديد، أو التحرش، أو الإزعاج، أو انتحال الصفة، أو إرسال بلاغات مضللة أو مسيئة متكررة.",
      "تحظر محاولة كشف بيانات التواصل الخاصة بصاحب المركبة بطرق غير مشروعة، أو تعطيل عمل المنصة.",
      "في حال تجاوز حدود الاستخدام العادل أو إساءة الاستخدام، يحق لنا تقييد الحساب أو إيقافه مؤقتاً أو نهائياً.",
    ],
  },
  {
    number: "5",
    title: "5. الباقات والأسعار والتجديد",
    paragraphs: [
      "تظهر تفاصيل الباقات والأسعار وسياسات الدفع بوضوح قبل إتمام الاشتراك. إنشاء الحساب لا يترتب عليه أي خصم تلقائي بدون موافقتك الصريحة ودفعك للرسوم المقررة.",
    ],
  },
  {
    number: "6",
    title: "6. الملكية الفكرية",
    paragraphs: [
      "جميع حقوق الملكية الفكرية، التصاميم، النصوص، البرمجيات، والعلامات التجارية الخاصة بمنصة «بَلِّغْنِي» مملوكة لنا بالكامل ومحمية بموجب القوانين. نمنحك حقاً محدوداً وغير حصري وقابل للإلغاء لاستخدام الخدمة لأغراضها المخصصة.",
    ],
  },
  {
    number: "7",
    title: "7. الإيقاف وإنهاء الاستخدام",
    paragraphs: [
      "يحق لنا إيقاف أو إنهاء الوصول للخدمة في حال ثبت وجود إساءة، أو احتيال، أو خطر أمني، أو مخالفة صريحة للشروط والأحكام، مع إشعار المستخدم متى ما كان ذلك مُمكناً وعملياً.",
    ],
  },
  {
    number: "8",
    title: "8. إخلاء المسؤولية",
    paragraphs: [
      'تُقدم الخدمة على أساس "كما هي" و"حسب الإتاحة". لا نضمن خلو الخدمة تماماً من الأخطاء أو الانقطاعات المفاجئة في شبكات الاتصال. لأقصى حد يجلبه القانون، لا تتحمل منصة «بَلِّغْنِي» مسؤولية أي أضرار غير مباشرة ناتجة عن تأخر أو عدم نجاح توصيل أي رسالة تنبيه.',
    ],
  },
  {
    number: "9",
    title: "9. القوانين الحاكمة",
    paragraphs: [
      "تخضع هذه الشروط والأحكام وتُفسر وفقاً للتشريعات والقوانين المعمول بها في الدولة، مع مراعاة حقوق المستهلك الإلزامية.",
    ],
  },
  {
    number: "10",
    title: "10. التواصل معنا",
    paragraphs: [
      "لأية استفسارات حول هذه الشروط والأحكام، يرافقنا تواصلكم عبر البريد الإلكتروني الرسمي للمنصة أو قنوات الدعم الفني.",
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1 py-12 sm:py-16">
        <div className="shell">
          <div className="mx-auto max-w-4xl">
            {/* زر العودة للرئيسية */}
            <div className="mb-6">
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-bold text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
              >
                <ArrowRight className="h-3.5 w-3.5" />
                <span>العودة إلى الصفحة الرئيسية</span>
              </Link>
            </div>

            {/* ترويسة صفحة الشروط والأحكام */}
            <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#0B0D13] p-7 text-white shadow-[0_24px_60px_rgba(11,13,19,0.18)] sm:p-10">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-primary/25 blur-3xl"
              />
              <div className="relative z-10 space-y-4">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/15 px-3.5 py-1 text-xs font-bold text-primary">
                    <Scale className="h-4 w-4" />
                    وثيقة قانونية رسمية
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1 text-xs font-semibold text-white/80">
                    <Calendar className="h-3.5 w-3.5 text-primary" />
                    آخر تحديث: 7 نوفمبر 2026
                  </span>
                </div>

                <h1 className="text-2xl font-black tracking-tight text-white sm:text-4xl">
                  الشروط والأحكام لمنصة «بَلِّغْنِي»
                </h1>

                <p className="text-sm leading-relaxed text-white/80 sm:text-base">
                  القواعد والبنود التي تنظم استخدامك لخدمات منصة «بَلِّغْنِي».
                </p>
              </div>
            </div>

            {/* محتوى البنود العشرة */}
            <div className="mt-8 space-y-5">
              {TERMS_SECTIONS.map((section) => (
                <section
                  key={section.number}
                  className="rounded-3xl border border-border bg-card p-6 shadow-card-soft transition-colors hover:border-primary/25 sm:p-8"
                >
                  <div className="flex items-start gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-secondary font-mono text-sm font-black text-primary">
                      {section.number.padStart(2, "0")}
                    </span>

                    <div className="flex-1 space-y-3">
                      <h3 className="text-lg font-black text-foreground sm:text-xl">
                        {section.title}
                      </h3>

                      {section.intro && (
                        <p className="text-sm font-semibold leading-relaxed text-foreground/90 sm:text-base">
                          {section.intro}
                        </p>
                      )}

                      {section.paragraphs?.map((paragraph, pIdx) => (
                        <p
                          key={pIdx}
                          className="text-sm leading-relaxed text-muted-foreground sm:text-base"
                        >
                          {paragraph}
                        </p>
                      ))}

                      {section.bullets && (
                        <ul className="mt-2 space-y-2.5 text-sm leading-relaxed text-muted-foreground sm:text-base">
                          {section.bullets.map((bullet, bIdx) => (
                            <li
                              key={bIdx}
                              className="flex items-start gap-2.5"
                            >
                              <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
