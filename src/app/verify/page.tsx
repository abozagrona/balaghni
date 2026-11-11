"use client";

import * as React from "react";
import Link from "next/link";
import {
  MessageCircle,
  MessageSquare,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  Phone,
  Sparkles,
  ArrowRight,
  Send,
  RotateCcw,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { Button } from "@/components/ui/button";
import { LibyaPhoneInput } from "@/components/ui/libya-phone-input";
import { SmartOtpModal } from "@/components/auth/smart-otp-modal";
import { formatLibyaPhoneForOtp, formatLibyaPhoneDisplay } from "@/lib/utils";

export default function SmartOtpVerifyPage() {
  const [phoneInput, setPhoneInput] = React.useState("912345678");
  const [modalOpen, setModalOpen] = React.useState(false);
  const [verifiedPhone, setVerifiedPhone] = React.useState<string | null>(null);
  const [lastMessage, setLastMessage] = React.useState<string | null>(null);

  const formattedOtpPhone = formatLibyaPhoneForOtp(phoneInput);

  const handleStartVerification = () => {
    if (!formattedOtpPhone) {
      alert("يرجى إدخال رقم هاتف ليبي صحيح (يبدأ بـ 91, 92, 93, 94, 95).");
      return;
    }
    setVerifiedPhone(null);
    setModalOpen(true);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[#07090E] text-white selection:bg-primary selection:text-white">
      {/* رأس الصفحة */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0B0D13]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link href="/" aria-label="الصفحة الرئيسية">
            <BalaghniLogo size="sm" showTagline />
          </Link>

          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white/70 transition hover:text-white"
          >
            <span>تسجيل الدخول</span>
            <ArrowRight className="h-3.5 w-3.5 rotate-180" />
          </Link>
        </div>
      </header>

      {/* المحتوى الرئيسي */}
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-10">
        <div className="rounded-3xl border border-white/15 bg-[#0F121C] p-6 shadow-2xl sm:p-8">
          <div className="text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1 text-xs font-bold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              <span>منظومة التحقق الذكية (Smart Multi-level Fallback)</span>
            </span>

            <h1 className="mt-3 text-2xl font-black text-white sm:text-3xl">
              إرسال رمز التحقق OTP
            </h1>

            <p className="mt-2 text-xs leading-relaxed text-white/65 sm:text-sm">
              نظام ذكي يختبر توفر حساب واتساب للرقم تلقائياً (WhatsApp First)
              مع التحويل الفوري لرسائل SMS عبر منصة رسالة في كافة حالات عدم التوفر.
            </p>
          </div>

          {/* بطاقة توضيح الخطوات الذكية */}
          <div className="mt-6 grid grid-cols-1 gap-2.5 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-white/80 sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#25D366]/20 font-bold text-[#25D366]">
                1
              </span>
              <span>
                <strong>الواتساب أولاً:</strong> فحص وجود حساب عبر Green-API.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 font-bold text-primary">
                2
              </span>
              <span>
                <strong>تحويل فوري SMS:</strong> عبر Resala عند عدم توفر الواتساب.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20 font-bold text-white">
                3
              </span>
              <span>
                <strong>رابط الـ 15 ثانية:</strong> للتحويل اليدوي للـ SMS بدون انتظار.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20 font-bold text-white">
                4
              </span>
              <span>
                <strong>خيارات الـ 60 ثانية:</strong> إعادة عبر واتساب أو كـ SMS.
              </span>
            </div>
          </div>

          {/* نموذج إدخال رقم الهاتف */}
          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-white/85">
                رقم الهاتف الليبي (091, 092, 093, 094, 095)
              </label>
              <div
                dir="ltr"
                className="flex h-12 w-full items-center overflow-hidden rounded-xl border border-white/15 bg-[#07090E] transition focus-within:border-primary"
              >
                <span className="flex items-center gap-1 border-r border-white/10 bg-white/5 px-3 font-mono text-xs font-bold text-white/80">
                  <span>🇱🇾</span>
                  <span>+218</span>
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="91 234 5678"
                  className="h-full w-full bg-transparent px-3 font-mono text-sm font-bold text-white placeholder-white/25 focus:outline-none"
                />
              </div>

              {formattedOtpPhone && (
                <div className="mt-2 flex items-center justify-between text-[11px] text-white/50">
                  <span>الصيغة الدولية الموحدة (12 رقماً):</span>
                  <span dir="ltr" className="font-mono font-bold text-primary">
                    {formattedOtpPhone}
                  </span>
                </div>
              )}
            </div>

            {/* نتيجة التحقق السابقة */}
            {verifiedPhone && (
              <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 p-4 text-xs font-bold text-emerald-300">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                <span>
                  تم التحقق بنجاح من ملكية الرقم ({formatLibyaPhoneDisplay(verifiedPhone)})!
                </span>
              </div>
            )}

            <Button
              type="button"
              size="lg"
              onClick={handleStartVerification}
              className="h-12 w-full rounded-2xl bg-primary text-sm font-bold text-white shadow-primary-glow hover:bg-primary-bright"
            >
              <Send className="h-4 w-4" />
              <span>بدء التحقق الذكي عبر واتساب / SMS</span>
            </Button>
          </div>
        </div>
      </main>

      {/* نافذة التحقق الذكي المنبثقة */}
      <SmartOtpModal
        isOpen={modalOpen}
        phone={phoneInput}
        onClose={() => setModalOpen(false)}
        onVerified={(p) => {
          setVerifiedPhone(p);
        }}
        title="التحقق من رقم الهاتف"
        subtitle="سيتم اختيار أفضل وسيلة إرسال (واتساب أولاً أو رسالة SMS فورية)"
      />
    </div>
  );
}
