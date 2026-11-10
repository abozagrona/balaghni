import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, ArrowRight, Calendar } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

export const metadata: Metadata = {
  title: "سياسة الخصوصية لمنصة «بَلِّغْنِي» | BALAGHNI",
  description:
    "توضح هذه السياسة كيفية التعامل مع بياناتك الشخصية عند استخدام خدمات منصة «بَلِّغْنِي».",
};

const PRIVACY_SECTIONS = [
  {
    number: "1",
    title: "1. مقدمة",
    paragraphs: [
      'نرحّب بكم في منصة «بَلِّغْنِي» (المشار إليها بـ "نحن" أو "المنصة"). نحن نقدّم حلاً ذكياً وآمناً يتيح التواصل مع أصحاب المركبات في حالات الطوارئ أو الإزعاج المروري دون الكشف عن أرقام الهواتف الشخصية. توضح سياسة الخصوصية هذه طبيعة البيانات التي نجمعها، وكيفية استخدامها، وحمايتها، والخيارات المتاحة لك عند استخدام موقعنا الإلكتروني أو لوحة التحكم أو مسح الملصقات الذكية.',
    ],
  },
  {
    number: "2",
    title: "2. البيانات التي نجمعها",
    intro:
      "حسب طبيعة استخدامك لمنصة «بَلِّغْنِي»، قد نجمع الأنواع التالية من البيانات:",
    bullets: [
      "بيانات الحساب: الاسم، البريد الإلكتروني، رقم الهاتف المحمول، وكلمة المرور عند التسجيل أو إنشاء الحساب.",
      "بيانات الملصقات الذكية: تفاصيل المركبة، الوصف العام، ملاحظاتك الخاصة، وأكواد الملصقات المرتبطة بحسابك.",
      "التنبيهات المرسلة: سبب التنبيه المختار، الملاحظة النصية القصيرة (إن وجدت)، والصورة الاختيارية التي يرفعها الشخص الذي يقوم بمسح الرمز.",
      "بيانات الأمان: بصمة المتصفح وعنوان بروتوكول الإنترنت (IP) المشفر لضمان أمان الخدمة ومنع الرسائل المزعجة أو البلاغات الوهمية.",
      "بيانات تقنية: ملفات تعريف الارتباط (Cookies) الخاصة بالجلسة وتفضيل اللغة لضمان الأداء السليم للموقع.",
    ],
  },
  {
    number: "3",
    title: "3. كيف نستخدم البيانات؟",
    intro: "نستخدم البيانات التي نجمعها للأغراض التالية:",
    bullets: [
      "إنشاء وإدارة حسابك، وتفعيل وربط ملصقاتك الذكية برقم هاتفك.",
      "إيصال التنبيهات الفورية إلى هاتفك عبر رسائل SMS أو تطبيق واتساب فور مسح الرمز.",
      "ضمان الحفاظ التام على سرية أرقام الهواتف وإخفائها عن العامة في صفحات التنبيه.",
      "منع سوء الاستخدام، التحقق من حدود البلاغات، وحماية أمن المستخدمين والمركبات.",
      "صيانة وتحسين وتطوير الخدمة وحل أي إشكاليات تقنية قد تطرأ.",
    ],
  },
  {
    number: "4",
    title: "4. ما الذي يراه الشخص الذي يمسح الملصق؟",
    richParagraph: (
      <>
        عندما يقوم أي شخص بمسح ملصق «بَلِّغْنِي» على مركبتك،{" "}
        <strong className="font-bold text-foreground">لا يرى أبداً</strong> رقم
        هاتفك الشخصي أو بريدك الإلكتروني. تظهر له فقط واجهة إرسال التنبيه
        واختيار سبب المشكلة (مثل: السيارة تعيق الحركة، الأضواء تعمل، إلخ)، وتصلك
        الرسالة أنت مباشرة على هاتفك بكل سرية.
      </>
    ),
  },
  {
    number: "5",
    title: "5. مشاركة البيانات",
    intro:
      "نحن لا نبيع بياناتك الشخصية مطلقاً. وتتم مشاركة بيانات محدودة فقط في حالات الضرورة التشغيلية:",
    bullets: [
      "مزودو خدمات البنية التحتية والاستضافة وقنوات المراسلة الفورية (مثل Supabase وخدمات واتساب و SMS) لإرسال التنبيهات الفورية لرقم هاتفك.",
      "الجهات القانونية الرسمية: في حال تطلب القانون أو اللوائح التنظيمية ذلك، أو بناءً على إجراء قانوني لحماية حقوق وأمان المستخدمين والجمهور.",
    ],
  },
  {
    number: "6",
    title: "6. الموافقات وخيارات التواصل",
    paragraphs: [
      "عند إنشاء حسابك أو ربط رقم هاتفك، فإنك توافق على شروط الاستخدام وسياسة الخصوصية واستلام تنبيهات الطوارئ. يمكنك في أي وقت تحديث بياناتك، أو تعديل إعدادات التنبيه، أو طلب حذف حسابك ورقمك من خلال لوحة التحكم أو بالتواصل معنا.",
    ],
  },
  {
    number: "7",
    title: "7. ملفات تعريف الارتباط (Cookies)",
    paragraphs: [
      "نستخدم ملفات تعريف الارتباط الأساسية للحفاظ على تسجيل دخولك، وتذكر تفضيلات اللغة، وضمان عمل المنصة بالشكل الأمثل. يمكنك التحكم في إعدادات الكوكيز من خلال متصفحك الخاص.",
    ],
  },
  {
    number: "8",
    title: "8. الأمان والاحتفاظ بالبيانات",
    paragraphs: [
      "نحتفظ بالبيانات طالما كان حسابك فعالاً ومرتبطاً بملصقاتك لتقديم الخدمة المطلوبة. نطبق إجراءات تقنية وتنظيمية مشفرة لحماية بياناتك من الوصول غير المبرر أو التلاعب، مع العلم بأنه لا يوجد نظام إلكتروني آمن بنسبة 100% بالمطلق.",
    ],
  },
  {
    number: "9",
    title: "9. حقوقك والتواصل معنا",
    paragraphs: [
      "يحق لك دائماً الوصول إلى بياناتك الشخصية، أو تصحيحها، أو طلب حذفها. يمكنك إدارة حسابك مباشرة من لوحة التحكم، أو مراسلتنا عبر قنوات الدعم الرسمية لأي استفسارات تتعلق بالخصوصية.",
    ],
  },
];

export default function PrivacyPolicyPage() {
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

            {/* ترويسة صفحة سياسة الخصوصية */}
            <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#0B0D13] p-7 text-white shadow-[0_24px_60px_rgba(11,13,19,0.18)] sm:p-10">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-primary/25 blur-3xl"
              />
              <div className="relative z-10 space-y-4">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/15 px-3.5 py-1 text-xs font-bold text-primary">
                    <ShieldCheck className="h-4 w-4" />
                    وثيقة قانونية رسمية
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1 text-xs font-semibold text-white/80">
                    <Calendar className="h-3.5 w-3.5 text-primary" />
                    آخر تحديث: 7 نوفمبر 2026
                  </span>
                </div>

                <h1 className="text-2xl font-black tracking-tight text-white sm:text-4xl">
                  سياسة الخصوصية لمنصة «بَلِّغْنِي»
                </h1>

                <p className="text-sm leading-relaxed text-white/80 sm:text-base">
                  توضح هذه السياسة كيفية التعامل مع بياناتك الشخصية عند استخدام
                  خدمات منصة «بَلِّغْنِي».
                </p>
              </div>
            </div>

            {/* محتوى البنود التسعة */}
            <div className="mt-8 space-y-5">
              {PRIVACY_SECTIONS.map((section) => (
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

                      {section.richParagraph && (
                        <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                          {section.richParagraph}
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
