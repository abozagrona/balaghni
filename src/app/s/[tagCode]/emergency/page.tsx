"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ShieldAlert,
  PhoneCall,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  LoaderCircle,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { Button } from "@/components/ui/button";
import { LibyaPhoneInput } from "@/components/ui/libya-phone-input";
import { formatBalaghniTagCode, formatFullLibyaE164 } from "@/lib/utils";
import { getBrowserFingerprint } from "@/lib/image-compression";

export default function EmergencyScanPage() {
  const params = useParams<{ tagCode: string }>();
  const formattedCode = formatBalaghniTagCode(params?.tagCode || "LY-123456");

  const [senderPhone, setSenderPhone] = React.useState("");
  const [note, setNote] = React.useState("");
  const [isSending, setIsSending] = React.useState(false);
  const [isSent, setIsSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleEmergencySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSending) return;
    setError(null);

    const fullPhone = senderPhone.trim()
      ? formatFullLibyaE164(senderPhone)
      : null;

    if (senderPhone.trim() && !fullPhone) {
      setError("يرجى إدخال رقم هاتف ليبي صحيح يبدأ بـ 91 أو 92 أو 93 أو 94.");
      return;
    }

    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append("reason", "emergency");
      formData.append(
        "note",
        note.trim() || "بلاغ طوارئ عاجل من موقع السيارة"
      );
      if (fullPhone) formData.append("senderPhone", fullPhone);
      formData.append("fingerprint", getBrowserFingerprint());

      const res = await fetch(
        `/api/tags/${encodeURIComponent(formattedCode)}/notify`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "تعذر إرسال نداء الطوارئ، حاول مرة أخرى.");
        setIsSending(false);
        return;
      }

      setIsSending(false);
      setIsSent(true);
    } catch {
      setError("تأكد من الاتصال بالإنترنت وحاول مرة أخرى.");
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-dvh bg-balaghni-obsidian text-white flex flex-col">
      <header className="border-b border-white/10 bg-balaghni-charcoal/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <BalaghniLogo size="sm" variant="dark" showTagline />
          <span
            dir="ltr"
            className="rounded-full border border-primary/40 bg-primary/15 px-3 py-1 font-mono text-xs font-bold text-primary-accent"
          >
            {formattedCode}
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-6">
        {isSent ? (
          <div className="rounded-3xl border border-emerald-500/30 bg-balaghni-charcoal p-6 text-center shadow-card-dark">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <h1 className="mt-4 text-xl font-bold text-white">
              تم إرسال نداء الطوارئ العاجل!
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-white/75">
              تم إبلاغ صاحب السيارة وجهات الاتصال الموثوقة لعائلته فوراً عبر
              الرسائل القصيرة وواتساب.
            </p>
            <Button asChild size="lg" className="mt-6 w-full rounded-2xl">
              <Link href={`/s/${encodeURIComponent(formattedCode)}`}>
                العودة لصفحة الملصق
              </Link>
            </Button>
          </div>
        ) : (
          <div className="rounded-3xl border border-primary/35 bg-balaghni-charcoal p-5 sm:p-6 shadow-card-dark">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-gradient text-white shadow-primary-glow">
                <ShieldAlert className="h-6 w-6" />
              </span>
              <div>
                <span className="text-xs font-bold text-primary-accent">
                  بوابة الطوارئ العاجلة
                </span>
                <h1 className="text-lg font-bold text-white sm:text-xl">
                  هل هناك خطر مباشر على سلامة صاحب السيارة؟
                </h1>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs leading-relaxed text-amber-200">
              <div className="flex items-center gap-1.5 font-bold text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>تنبيه قانوني هام</span>
              </div>
              <p className="mt-1">
                هذا الخيار مخصص فقط للحوادث المرورية أو الحالات الطارئة، حيث يتم
                إرسال تنبيه عاجل إلى صاحب السيارة و 3 من أفراد عائلته. إذا كانت
                السيارة تعيق الطريق فقط، يرجى استخدام التنبيه العادي.
              </p>
            </div>

            <form onSubmit={handleEmergencySubmit} className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="emergency-note"
                  className="mb-1.5 block text-xs font-bold text-white/90"
                >
                  وصف مختصر للحالة أو المكان (اختياري)
                </label>
                <textarea
                  id="emergency-note"
                  rows={2}
                  maxLength={80}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="مثال: حادث بسيط في طريق الشط قرب..."
                  className="w-full rounded-2xl border border-white/15 bg-balaghni-obsidian px-3.5 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-primary focus:outline-none"
                />
              </div>

              <div className="dark">
                <label
                  htmlFor="emergency-phone"
                  className="mb-1.5 block text-xs font-bold text-white/90"
                >
                  رقم هاتفك للتواصل معك في موقع الحدث (اختياري)
                </label>
                <LibyaPhoneInput
                  id="emergency-phone"
                  value={senderPhone}
                  onValueChange={setSenderPhone}
                />
              </div>

              {error && (
                <p className="rounded-xl bg-primary/20 px-3 py-2 text-xs font-bold text-primary-accent">
                  {error}
                </p>
              )}

              <div className="pt-2 space-y-2.5">
                <Button
                  type="submit"
                  size="xl"
                  disabled={isSending}
                  className="w-full rounded-2xl text-base"
                >
                  {isSending ? (
                    <>
                      <LoaderCircle className="h-5 w-5 animate-spin" />
                      <span>جاري إرسال نداء الطوارئ...</span>
                    </>
                  ) : (
                    <>
                      <PhoneCall className="h-5 w-5" />
                      <span>تأكيد وإبلاغ جهات الطوارئ الآن</span>
                    </>
                  )}
                </Button>

                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="w-full rounded-2xl border-white/15 bg-transparent text-white hover:bg-white/10"
                >
                  <Link
                    href={`/s/${encodeURIComponent(
                      formattedCode
                    )}?reason=blocking`}
                  >
                    <ArrowRight className="h-4 w-4" />
                    <span>العودة للتنبيه العادي (السيارة تعيق الطريق)</span>
                  </Link>
                </Button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
