"use client";

import * as React from "react";
import {
  MessageCircle,
  MessageSquare,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  RotateCcw,
  X,
  Send,
  Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatLibyaPhoneDisplay } from "@/lib/utils";

interface SmartOtpModalProps {
  isOpen: boolean;
  phone: string; // أي صيغة للرقم الليبي
  onClose: () => void;
  onVerified: (verifiedPhone: string) => void | Promise<void>;
  title?: string;
  subtitle?: string;
  autoSendOnOpen?: boolean;
}

export function SmartOtpModal({
  isOpen,
  phone,
  onClose,
  onVerified,
  title = "التحقق من رقم الهاتف",
  subtitle = "لتأمين حسابك والتحقق من ملكية رقم الهاتف",
  autoSendOnOpen = true,
}: SmartOtpModalProps) {
  // حالة الرمز المدخل (6 أرقام)
  const [digits, setDigits] = React.useState<string[]>(["", "", "", "", "", ""]);
  const inputRefs = React.useRef<(HTMLInputElement | null)[]>([]);

  // حالة الإرسال والقناة
  const [channel, setChannel] = React.useState<"WHATSAPP" | "SMS">("WHATSAPP");
  const [sending, setSending] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  // مؤقت العد التنازلي (60 ثانية)
  const [countdown, setCountdown] = React.useState<number>(60);
  const [initialSent, setInitialSent] = React.useState(false);

  // إعادة ضبط الحالة عند فتح النافذة
  React.useEffect(() => {
    if (isOpen) {
      setDigits(["", "", "", "", "", ""]);
      setError(null);
      setSuccess(false);
      setCountdown(60);

      if (autoSendOnOpen && phone) {
        handleSendOtp("auto");
      }
    } else {
      setInitialSent(false);
    }
  }, [isOpen, phone]);

  // عداد الـ 60 ثانية
  React.useEffect(() => {
    if (!isOpen || countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, countdown]);

  // إرسال أو إعادة إرسال الرمز
  const handleSendOtp = async (preferredChannel: "auto" | "whatsapp" | "sms" = "auto") => {
    if (sending) return;
    setSending(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          phone,
          channel: preferredChannel,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setError(data.error || "تعذر إرسال رمز التحقق. يرجى المحاولة مجدداً.");
        setSending(false);
        return;
      }

      setChannel(data.channel || "WHATSAPP");
      setStatusMessage(data.message || "تم إرسال رمز التحقق بنجاح");
      setCountdown(data.countdownSeconds || 60);
      setInitialSent(true);

      // تفريغ الحقول والتركيز على أول خانة
      setDigits(["", "", "", "", "", ""]);
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 100);
    } catch {
      setError("حدث خطأ في الاتصال بالشبكة أثناء إرسال الرمز.");
    } finally {
      setSending(false);
    }
  };

  // معالجة إدخال خانات الـ OTP مع الانتقال التلقائي والدعم للنسخ واللصق
  const handleDigitChange = (index: number, val: string) => {
    const clean = val.replace(/\D/g, "");

    // في حال قام المستخدم بلصق الرمز كاملاً (مثال 6 أرقام معاً)
    if (clean.length > 1) {
      const pasted = clean.slice(0, 6).split("");
      const newDigits = [...digits];
      for (let i = 0; i < 6; i++) {
        newDigits[i] = pasted[i] || "";
      }
      setDigits(newDigits);
      const nextIndex = Math.min(5, clean.length);
      inputRefs.current[nextIndex]?.focus();

      if (clean.length >= 6) {
        triggerVerification(clean.slice(0, 6));
      }
      return;
    }

    const newDigits = [...digits];
    newDigits[index] = clean;
    setDigits(newDigits);

    if (clean && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // إذا اكتملت الخانات الـ 6، نطلق التحقق فوراً
    const fullCode = newDigits.join("");
    if (fullCode.length === 6) {
      triggerVerification(fullCode);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  // التحقق من صحة الرمز
  const triggerVerification = async (codeToVerify?: string) => {
    const code = codeToVerify || digits.join("");
    if (code.length !== 6 || verifying) return;

    setVerifying(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          phone,
          code,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setError(data.error || "رمز التحقق غير صحيح، يرجى إعادة المحاولة.");
        setVerifying(false);
        return;
      }

      setSuccess(true);
      setTimeout(async () => {
        await onVerified(data.phone || phone);
        onClose();
      }, 700);
    } catch {
      setError("حدث خطأ في الاتصال أثناء مطابقة رمز التحقق.");
      setVerifying(false);
    }
  };

  if (!isOpen) return null;

  const fullEnteredCode = digits.join("");
  // هل مضى 15 ثانية على الأقل من المؤقت؟ (60 - 15 = 45)
  const isAfter15Seconds = countdown <= 45;
  const isCountdownFinished = countdown === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md rounded-3xl border border-white/15 bg-[#0F121C] p-6 text-white shadow-2xl sm:p-7">
        {/* زر الإغلاق */}
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="absolute top-5 left-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        {/* أيقونة القناة النشطة */}
        <div className="flex items-center gap-3">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
              channel === "WHATSAPP"
                ? "bg-[#25D366]/20 text-[#25D366] shadow-[0_0_20px_rgba(37,211,102,0.25)]"
                : "bg-primary/20 text-primary shadow-primary-glow"
            }`}
          >
            {channel === "WHATSAPP" ? (
              <MessageCircle className="h-6 w-6 fill-current" />
            ) : (
              <MessageSquare className="h-6 w-6" />
            )}
          </span>
          <div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                channel === "WHATSAPP"
                  ? "bg-[#25D366]/15 text-[#25D366]"
                  : "bg-primary/15 text-primary"
              }`}
            >
              <ShieldCheck className="h-3 w-3" />
              {channel === "WHATSAPP"
                ? "واتساب (WhatsApp First)"
                : "رسالة نصية قصيرة (SMS)"}
            </span>
            <h2 className="mt-1 text-lg font-black text-white">{title}</h2>
          </div>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-white/65">{subtitle}</p>

        {/* بطاقة رقم الهاتف */}
        <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2">
          <div className="flex items-center gap-2 text-xs text-white/70">
            <Phone className="h-3.5 w-3.5 text-primary" />
            <span>رقم المستلم:</span>
          </div>
          <span dir="ltr" className="font-mono text-xs font-bold text-white">
            {formatLibyaPhoneDisplay(phone)}
          </span>
        </div>

        {/* رسالة الحالة التلقائية (من الواتساب أو الـ SMS) */}
        {statusMessage && !error && (
          <div
            className={`mt-3 flex items-start gap-2.5 rounded-2xl border p-3 text-xs leading-relaxed ${
              channel === "WHATSAPP"
                ? "border-[#25D366]/30 bg-[#25D366]/10 text-[#25D366]"
                : "border-primary/30 bg-primary/10 text-primary-bright"
            }`}
          >
            {channel === "WHATSAPP" ? (
              <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 fill-current" />
            ) : (
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{statusMessage}</span>
          </div>
        )}

        {/* تنبيه الخطأ إن وُجد */}
        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* نجاح التحقق */}
        {success ? (
          <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 p-6 text-center animate-in zoom-in-95">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
            <h3 className="mt-2 text-base font-bold text-white">تم التحقق بنجاح!</h3>
            <p className="mt-1 text-xs text-emerald-200">
              تم تأكيد رقم هاتفك، جاري المتابعة فوراً...
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {/* خانات إدخال الرمز المكون من 6 أرقام */}
            <div>
              <label className="mb-2 block text-center text-xs font-bold text-white/80">
                أدخل رمز التحقق (6 أرقام)
              </label>
              <div dir="ltr" className="flex justify-center gap-2 sm:gap-2.5">
                {digits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      inputRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={idx === 0 ? 6 : 1}
                    value={digit}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    disabled={verifying || sending}
                    className="h-12 w-11 rounded-xl border border-white/15 bg-[#07090E] text-center font-mono text-lg font-black text-white shadow-inner transition focus:border-primary focus:bg-primary/10 focus:outline-none sm:h-13 sm:w-12 sm:text-xl"
                  />
                ))}
              </div>
            </div>

            {/* زر تأكيد الرمز */}
            <Button
              type="button"
              onClick={() => triggerVerification()}
              disabled={verifying || sending || fullEnteredCode.length !== 6}
              className="h-11 w-full rounded-xl bg-primary text-xs font-bold text-white shadow-primary-glow hover:bg-primary-bright disabled:opacity-40"
            >
              {verifying ? (
                <span className="flex items-center gap-2">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  <span>جاري مطابقة الرمز...</span>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  <span>تأكيد ومتابعة</span>
                </span>
              )}
            </Button>

            {/* حالة المؤقت والخيارات الذكية */}
            <div className="space-y-3 pt-1 text-center">
              {/* المؤقت التنازلي الحي */}
              {!isCountdownFinished && (
                <div className="flex items-center justify-center gap-1.5 text-xs text-white/55">
                  <RotateCcw className="h-3 w-3 animate-spin text-white/30" />
                  <span>
                    إعادة الإرسال متاحة بعد:{" "}
                    <strong className="font-mono text-white/90">
                      00:{countdown.toString().padStart(2, "0")}
                    </strong>
                  </span>
                </div>
              )}

              {/* الشرط 3: بعد مرور 15 ثانية من المؤقت (إذا كانت القناة واتساب):
                  إظهار الرابط الخفيف "الواتساب غير متوفر معك حالياً؟ أرسل الرمز كرسالة SMS" */}
              {channel === "WHATSAPP" && isAfter15Seconds && !isCountdownFinished && (
                <div className="pt-1 animate-in fade-in duration-300">
                  <button
                    type="button"
                    onClick={() => handleSendOtp("sms")}
                    disabled={sending}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-primary underline underline-offset-4 transition hover:text-primary-bright"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>الواتساب غير متوفر معك حالياً؟ أرسل الرمز كرسالة SMS</span>
                  </button>
                </div>
              )}

              {/* الشرط 3: بعد انتهاء الـ 60 ثانية بالكامل -> إظهار خيارين واضحين:
                  1) إعادة إرسال عبر واتساب
                  2) إرسال كرسالة نصية قصيرة (SMS) */}
              {isCountdownFinished && (
                <div className="space-y-2 pt-2 animate-in fade-in duration-300">
                  <span className="block text-[11px] font-bold text-white/50">
                    لم يصلك الرمز؟ اختر طريقة الإرسال المفضلة:
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSendOtp("whatsapp")}
                      disabled={sending}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-[#25D366]/30 bg-[#25D366]/10 px-3 py-2 text-xs font-bold text-[#25D366] transition hover:bg-[#25D366]/20"
                    >
                      <MessageCircle className="h-3.5 w-3.5 fill-current" />
                      <span>إعادة عبر واتساب</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSendOtp("sms")}
                      disabled={sending}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-primary/20"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>إرسال كرسالة SMS</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
