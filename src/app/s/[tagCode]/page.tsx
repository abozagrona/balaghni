import * as React from "react";
import Link from "next/link";
import {
  ShieldAlert,
  CarFront,
  QrCode,
  MapPin,
  LockKeyhole,
  AlertOctagon,
  ArrowRight,
  ShoppingBag,
  CheckCircle2,
  LogIn,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { ScanForm } from "@/components/scan/scan-form";
import { TagActivationForm } from "@/components/scan/tag-activation-form";
import { Button } from "@/components/ui/button";
import { getVehicleTagByCode } from "@/lib/supabase/client";
import { formatBalaghniTagCode } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface ScanPageProps {
  params: Promise<{ tagCode: string }>;
  searchParams?: Promise<{ reason?: string; intent?: string }>;
}

export async function generateMetadata({ params }: ScanPageProps) {
  const { tagCode } = await params;
  const formattedCode = formatBalaghniTagCode(tagCode);
  return {
    title: `ملصق «بَلِّغْنِي» (${formattedCode})`,
    description:
      "بَلِّغْنِي | BALAGHNI — امسح للتواصل مع صاحب السيارة فوراً وبخصوصية تامة.",
  };
}

export default async function PublicQrScanPage({
  params,
  searchParams,
}: ScanPageProps) {
  const { tagCode } = await params;
  const resolvedSearch = searchParams ? await searchParams : {};
  const formattedCode = formatBalaghniTagCode(tagCode);
  const isActivationIntent = resolvedSearch.intent === "activate";

  const tagRecord = await getVehicleTagByCode(formattedCode);

  // الحالة 1: الكود غير موجود في قاعدة البيانات أو ملغى (REVOKED) -> عرض تنبيه أمني
  if (!tagRecord || tagRecord.status === "REVOKED") {
    const isRevoked = tagRecord?.status === "REVOKED";
    return (
      <div className="scan-shell flex min-h-dvh flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-2.5">
            <Link href="/" aria-label="الصفحة الرئيسية لمنصة بَلِّغْنِي">
              <BalaghniLogo size="sm" showTagline />
            </Link>

            <span
              dir="ltr"
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-secondary px-3 py-1 font-mono text-xs font-bold text-primary"
            >
              <QrCode className="h-3.5 w-3.5" />
              <span>{formattedCode}</span>
            </span>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-8">
          <div className="rounded-3xl border-2 border-primary/30 bg-card p-6 text-center shadow-card-soft sm:p-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <AlertOctagon className="h-9 w-9" />
            </div>

            <span className="mt-4 inline-block rounded-full bg-secondary px-3.5 py-1 text-xs font-bold text-primary">
              تنبيه أمني • منظومة التحقق الذكي
            </span>

            <h1 className="mt-2.5 text-xl font-black text-foreground sm:text-2xl">
              {isRevoked
                ? "هذا الملصق ملغى ومسحوب من الخدمة"
                : "هذا الملصق غير مسجل في النظام"}
            </h1>

            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {isRevoked
                ? `تم إلغاء وسحب صلاحية الملصق (${formattedCode}) من الخدمة نهائياً عبر إدارة المنصة.`
                : `الكود (${formattedCode}) غير مدرج ضمن دفعات ملصقات «بَلِّغْنِي» الرسمية المعتمدة. يرجى التأكد من صحة الرابط أو الحصول على ملصق أصلي.`}
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="flex-1 rounded-2xl">
                <Link href="/activate">
                  <QrCode className="h-4 w-4" />
                  <span>إدخال كود ملصق آخر</span>
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="flex-1 rounded-2xl"
              >
                <Link href="/order">
                  <ShoppingBag className="h-4 w-4" />
                  <span>اطلب ملصقاً أصلياً</span>
                </Link>
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // الحالة 2: الكود بحالة LOCKED -> عرض واجهة التفعيل الذاتي للمشتري
  if (tagRecord.status === "LOCKED") {
    return (
      <div className="scan-shell flex min-h-dvh flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-2.5">
            <Link href="/" aria-label="الصفحة الرئيسية لمنصة بَلِّغْنِي">
              <BalaghniLogo size="sm" showTagline />
            </Link>

            <span
              dir="ltr"
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-mono text-xs font-bold text-amber-700"
            >
              <LockKeyhole className="h-3.5 w-3.5" />
              <span>{tagRecord.tagCode}</span>
            </span>
          </div>
        </header>

        <section className="relative overflow-hidden bg-[#0B0D13] text-white">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-12 -start-10 h-36 w-36 rounded-full bg-primary/25 blur-2xl"
          />
          <div className="relative mx-auto max-w-lg px-4 py-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/15 px-3 py-0.5 text-[11px] font-bold text-primary">
              <LockKeyhole className="h-3.5 w-3.5" />
              بانتظار التفعيل الأول (LOCKED)
            </span>
            <h1 className="mt-2 text-xl font-black tracking-tight sm:text-2xl">
              تفعيل ملصق «بَلِّغْنِي» الجديد
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-white/75 sm:text-sm">
              هذا الملصق أصلي ومسجل في النظام ولكنه غير مرتبط بمركبة بعد. إذا
              كنت صاحب الملصق، أدخل رمز الخدش السري لتفعيله فوراً.
            </p>
          </div>
        </section>

        <main className="mx-auto w-full max-w-lg flex-1 px-4 py-5">
          <TagActivationForm tagCode={tagRecord.tagCode} />
        </main>
      </div>
    );
  }

  // الحالة 3 (أ): الكود بحالة ACTIVE والمستخدم قادم بنية التفعيل (intent=activate) -> عرض بطاقة التنبيه النظيفة فقط وإخفاء نموذج البلاغات بالكامل
  const vehicleFullName =
    tagRecord.vehicleInfo ||
    `${tagRecord.vehicleBrand} ${tagRecord.vehicleModel}`.trim();

  if (isActivationIntent) {
    return (
      <div className="scan-shell flex min-h-dvh flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-2.5">
            <Link href="/" aria-label="الصفحة الرئيسية لمنصة بَلِّغْنِي">
              <BalaghniLogo size="sm" showTagline />
            </Link>

            <span
              dir="ltr"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-mono text-xs font-bold text-emerald-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{tagRecord.tagCode}</span>
            </span>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-8">
          <div className="rounded-3xl border-2 border-emerald-500/35 bg-card p-6 text-center shadow-card-soft sm:p-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600">
              <CheckCircle2 className="h-9 w-9" />
            </div>

            <span className="mt-4 inline-block rounded-full bg-emerald-500/10 px-3.5 py-1 text-xs font-bold text-emerald-700">
              مفعّل مسبقاً • ACTIVE
            </span>

            <h1 className="mt-2.5 text-xl font-black text-foreground sm:text-2xl">
              هذا الملصق مفعل مسبقاً ومرتبط بهذه المركبة
            </h1>

            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              الملصق رقم{" "}
              <span dir="ltr" className="font-mono font-bold text-primary">
                {tagRecord.tagCode}
              </span>{" "}
              مفعّل مسبقاً ومرتبط بمركبة ({vehicleFullName}). إذا كنت مالك هذه
              المركبة يمكنك تسجيل دخولك مباشرة، أو إدخال كود ملصق آخر لتفعيله.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="flex-1 rounded-2xl">
                <Link href="/login">
                  <LogIn className="h-4 w-4" />
                  <span>تسجيل دخولك للوحة التحكم</span>
                </Link>
              </Button>

              <Button
                asChild
                variant="outline"
                size="lg"
                className="flex-1 rounded-2xl"
              >
                <Link href="/activate">
                  <QrCode className="h-4 w-4" />
                  <span>إدخال كود ملصق آخر</span>
                </Link>
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // الحالة 3 (ب): الكود بحالة ACTIVE والزائر يمسح الملصق من الشارع بدون intent=activate -> عرض نموذج إرسال البلاغ لصاحب السيارة
  return (
    <div className="scan-shell flex min-h-dvh flex-col">
      {/* الشريط العلوي الخفيف لصفحة المسح */}
      <header className="sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-2.5">
          <Link href="/" aria-label="الصفحة الرئيسية لمنصة بَلِّغْنِي">
            <BalaghniLogo size="sm" showTagline />
          </Link>

          <span
            dir="ltr"
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-secondary px-3 py-1 font-mono text-xs font-bold text-primary"
          >
            <QrCode className="h-3.5 w-3.5" />
            <span>{tagRecord.tagCode}</span>
          </span>
        </div>
      </header>

      {/* ترويسة الملصق الحمراء الصريحة (#E51926 -> #EE1D23) مع بطاقة السيارة البيضاء الناصعة */}
      <section className="scan-hero-section relative overflow-hidden bg-primary-gradient text-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-12 -start-10 h-36 w-36 rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-12 -end-10 h-36 w-36 rounded-full bg-balaghni-obsidian/20 blur-2xl"
        />

        <div className="relative mx-auto max-w-lg px-4 py-5">
          <div className="mb-3.5 text-center sm:text-start">
            <span className="inline-block rounded-full bg-white/15 px-3 py-0.5 text-[11px] font-bold text-white backdrop-blur-sm">
              امسح للتواصل مع صاحب السيارة
            </span>
            <h1 className="mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">
              هل هناك أمر يخص هذه السيارة؟
            </h1>
            <p className="mt-0.5 text-xs text-white/90 sm:text-sm">
              اختر السبب بالأسفل وسيصل تنبيهك لصاحب السيارة في ثوانٍ
            </p>
          </div>

          {/* بطاقة هوية السيارة البيضاء الناصعة (#FFFFFF) */}
          <div className="scan-hero-car flex items-center justify-between gap-3 rounded-2xl border border-white/80 bg-white p-3.5 text-balaghni-obsidian shadow-card-soft">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CarFront className="h-6 w-6" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p
                    dir="ltr"
                    className="truncate text-base font-bold text-balaghni-obsidian"
                  >
                    {vehicleFullName}
                  </p>
                  {tagRecord.vehicleColor && (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                      {tagRecord.vehicleColor}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  <span
                    dir="ltr"
                    className="font-mono font-bold tracking-wider text-primary"
                  >
                    {tagRecord.tagCode}
                  </span>
                  {tagRecord.city && (
                    <>
                      <span>•</span>
                      <span className="inline-flex items-center gap-0.5">
                        <MapPin className="h-3 w-3 text-primary" />
                        {tagRecord.city}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              متصل
            </span>
          </div>
        </div>
      </section>

      {/* المحتوى الرئيسي لنموذج الإبلاغ الفوري للزائر العادي */}
      <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-4">
        {/* شريط طوارئ الطرقات (يظهر إذا كان الملصق يدعم جهات اتصال الطوارئ) */}
        {tagRecord.hasEmergencyContacts && (
          <section
            aria-labelledby="scan-emergency-banner"
            className="mb-4 rounded-2xl border border-primary/25 bg-secondary/80 p-3.5 shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
                  <ShieldAlert className="h-5 w-5" />
                </span>
                <div>
                  <h2
                    id="scan-emergency-banner"
                    className="text-xs font-bold text-foreground sm:text-sm"
                  >
                    هل صاحب السيارة في خطر طارئ الآن؟
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    حادث سير أو حالة صحية طارئة تستدعي إبلاغ عائلته فوراً
                  </p>
                </div>
              </div>

              <Link
                href={`/s/${encodeURIComponent(tagRecord.tagCode)}/emergency`}
                className="shrink-0 rounded-xl border border-primary/30 bg-white px-3 py-2 text-xs font-bold text-primary shadow-sm transition hover:bg-primary hover:text-white"
              >
                نداء طوارئ
              </Link>
            </div>
          </section>
        )}

        {/* نموذج إرسال التنبيه التفاعلي */}
        <ScanForm
          tagCode={tagRecord.tagCode}
          vehicleName={vehicleFullName}
          initialReason={resolvedSearch.reason}
        />
      </main>
    </div>
  );
}

