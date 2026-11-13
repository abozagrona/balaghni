"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fingerprint,
  ShieldCheck,
  MessageCircle,
  ArrowRight,
  LoaderCircle,
  AlertCircle,
  QrCode,
  Send,
  Sparkles,
  Clock,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { Button } from "@/components/ui/button";
import { SmartOtpModal } from "@/components/auth/smart-otp-modal";
import {
  arrayBufferToBase64Url,
  base64UrlToUint8Array,
  formatFullLibyaE164,
  normalizeLibyaPhoneDigits,
} from "@/lib/utils";
import { saveOwnerSession } from "@/lib/auth-session";

export default function OwnerLoginPage() {
  const router = useRouter();

  const [phoneDigits, setPhoneDigits] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [passkeyLoading, setPasskeyLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sessionExpiredNotice, setSessionExpiredNotice] = React.useState(false);

  // حالة نافذة التحقق الذكية (Smart OTP Modal)
  const [otpModalOpen, setOtpModalOpen] = React.useState(false);
  const [phoneForOtp, setPhoneForOtp] = React.useState("");

  // فحص ما إذا كان التوجيه لصفحة الدخول بسبب انتهاء صلاحية الجلسة تلقائياً
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("expired") === "1" || params.get("reason") === "timeout") {
        setSessionExpiredNotice(true);
      }
    }
  }, []);

  // التحويل التلقائي من 127.0.0.1 إلى localhost (إلزامي لعمل WebAuthn وحساس البصمة)
  React.useEffect(() => {
    if (typeof window !== "undefined" && window.location.hostname === "127.0.0.1") {
      window.location.href = window.location.href.replace("127.0.0.1", "localhost");
    }
  }, []);

  // 1. إرسال رمز الدخول السريع (Passwordless OTP Login)
  const handleSendOtpLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || passkeyLoading) return;
    setError(null);

    const fullPhone = formatFullLibyaE164(phoneDigits);
    if (!fullPhone) {
      setError("يرجى إدخال رقم هاتف ليبي صحيح (+218) يبدأ بـ 091, 092, 093, 094, 095.");
      return;
    }

    setLoading(true);
    try {
      // التحقق المسبق من وجود حساب مسجل بهذا الرقم في النظام
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPhone: fullPhone,
          checkOnly: true,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.exists) {
        setError(
          data.error ||
            "رقم الهاتف هذا غير مرتبط بأي ملصق في النظام. هل قمت بتفعيل ملصقك الجديد؟"
        );
        setLoading(false);
        return;
      }

      setLoading(false);
      setPhoneForOtp(fullPhone);
      setOtpModalOpen(true);
    } catch {
      setError("حدث خطأ أثناء الاتصال بالخادم، يرجى المحاولة لاحقاً.");
      setLoading(false);
    }
  };

  // 2. إتمام الدخول فور التحقق من رمز الـ OTP
  const handleOtpVerified = async (verifiedPhone: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPhone: verifiedPhone,
          otpVerified: true,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.tag) {
        setError(data.error || "تعذر إتمام الدخول، يرجى المحاولة لاحقاً.");
        setOtpModalOpen(false);
        return;
      }

      // حفظ بيانات الجلسة النشطة وتحويل الزبون إلى لوحة التحكم فوراً
      saveOwnerSession({
        tagCode: data.tag.tagCode,
        vehicleInfo:
          data.tag.vehicleInfo ||
          `${data.tag.vehicleBrand || ""} ${data.tag.vehicleModel || ""}`.trim(),
        city: data.tag.city || "طرابلس",
        ownerPhone: verifiedPhone,
        activatedAt: data.tag.activatedAt,
      });

      setOtpModalOpen(false);
      router.push(`/dashboard?tag=${encodeURIComponent(data.tag.tagCode)}`);
    } catch {
      setError("حدث خطأ أثناء الاتصال بقاعدة البيانات.");
      setOtpModalOpen(false);
    }
  };

  // 3. الدخول الفوري بالبصمة الحيوية دون اشتراط رقم الهاتف (Zero-Typing Customer Passkey)
  const handlePasskeyLogin = async () => {
    if (passkeyLoading || loading) return;
    setError(null);

    setPasskeyLoading(true);
    try {
      const lookupRes = await fetch("/api/auth/passkey");
      const lookupData = await lookupRes.json().catch(() => ({}));

      const credIds: string[] =
        Array.isArray(lookupData.passkeyCredentialIds)
          ? lookupData.passkeyCredentialIds
          : Array.isArray(lookupData.credentialIds)
          ? lookupData.credentialIds
          : lookupData.passkeyCredentialId
          ? [lookupData.passkeyCredentialId]
          : [];

      if (
        typeof window === "undefined" ||
        !window.PublicKeyCredential ||
        !navigator.credentials?.get
      ) {
        setError("المتصفح الحالي لا يدعم المصادقة بالبصمة الحيوية (WebAuthn).");
        setPasskeyLoading(false);
        return;
      }

      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      const allowCredentials =
        credIds.length > 0
          ? credIds.map((cid: string) => ({
              id: base64UrlToUint8Array(cid),
              type: "public-key" as const,
            }))
          : [];

      let assertion: PublicKeyCredential | null = null;
      try {
        assertion = (await navigator.credentials.get({
          publicKey: {
            challenge,
            rpId:
              lookupData.rpId ||
              window.location.hostname.replace(/^www\./, ""),
            allowCredentials,
            userVerification: "preferred",
            timeout: 60000,
          },
        })) as PublicKeyCredential | null;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[Customer WebAuthn get error]:", msg);
        if (err instanceof Error && err.name === "NotAllowedError") {
          setError("تم إلغاء نافذة البصمة من قِبل المستخدم أو لم يتم التعرف عليها.");
        } else {
          setError(`تعذر التحقق من البصمة: ${msg}`);
        }
        setPasskeyLoading(false);
        return;
      }

      if (!assertion || !assertion.rawId) {
        setError("تم إلغاء قراءة البصمة أو لم تكتمل العملية.");
        setPasskeyLoading(false);
        return;
      }

      const verifiedCredId = arrayBufferToBase64Url(assertion.rawId);

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passkeyCredentialId: verifiedCredId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.tag) {
        setError(
          data.error ||
            "لم يتم العثور على سيارة مرتبطة بهذه البصمة، يرجى الدخول برقم هاتفك."
        );
        setPasskeyLoading(false);
        return;
      }

      saveOwnerSession({
        tagCode: data.tag.tagCode,
        vehicleInfo:
          data.tag.vehicleInfo ||
          `${data.tag.vehicleBrand || ""} ${data.tag.vehicleModel || ""}`.trim(),
        city: data.tag.city || "طرابلس",
        ownerPhone: data.tag.ownerPhone || "",
        activatedAt: data.tag.activatedAt,
      });

      router.push(`/dashboard?tag=${encodeURIComponent(data.tag.tagCode)}`);
    } catch {
      setError("حدث خطأ غير متوقع أثناء المصادقة بالبصمة الحيوية.");
      setPasskeyLoading(false);
    }
  };

  const supportWhatsappUrl = `https://wa.me/218910000000?text=${encodeURIComponent(
    "السلام عليكم فريق دعم بَلِّغْنِي، أحتاج مساعدة بخصوص الدخول إلى لوحة تحكم سيارتي."
  )}`;

  return (
    <div className="min-h-dvh bg-[#0B0D13] text-white flex flex-col justify-between relative overflow-hidden">
      {/* توهجات خلفية متناسقة مع هوية بَلِّغْنِي */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-primary/15 blur-3xl"
      />

      {/* الشريط العلوي */}
      <header className="relative z-10 border-b border-white/10 bg-[#0B0D13]/85 backdrop-blur-md">
        <div className="shell flex items-center justify-between py-3.5">
          <Link href="/">
            <BalaghniLogo variant="dark" size="md" showTagline />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-bold text-white/80 transition hover:border-primary/50 hover:text-white"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            <span>العودة للرئيسية</span>
          </Link>
        </div>
      </header>

      {/* بطاقة تسجيل الدخول السريع */}
      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className="rounded-[32px] border border-white/12 bg-[#141721]/95 p-6 shadow-[0_28px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-8">
          <div className="text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-primary/15 px-3.5 py-1 text-xs font-bold text-primary">
              <ShieldCheck className="h-4 w-4" />
              دخول سريع وآمن بدون كلمات مرور • OTP
            </span>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">
              تسجيل دخول المالك
            </h1>
            <p className="mt-1.5 text-xs leading-relaxed text-white/65 sm:text-sm">
              أدخل رقم هاتفك المسجل لتلقي رمز التحقق السريع عبر واتساب أو رسالة SMS
            </p>
          </div>

          <div className="mt-6 space-y-5">
            {/* تنبيه انتهاء الجلسة التلقائي للأمان */}
            {sessionExpiredNotice && (
              <div className="flex items-start gap-2.5 rounded-2xl border-2 border-amber-500/40 bg-amber-500/15 p-3.5 text-xs font-bold text-amber-200">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span className="leading-relaxed">
                  انتهت صلاحية جلستك تلقائياً لأمان حسابك، يرجى تسجيل الدخول مجدداً.
                </span>
              </div>
            )}

            {/* نموذج تسجيل الدخول برقم الهاتف ورمز OTP السريع */}
            <form onSubmit={handleSendOtpLogin} className="space-y-4">
              {/* حقل إدخال رقم الهاتف الليبي المسجل */}
              <div>
                <label
                  htmlFor="login-phone"
                  className="mb-2 block text-xs font-bold text-white/85 sm:text-sm"
                >
                  رقم الهاتف الليبي المسجل
                </label>
                <div
                  dir="ltr"
                  className="flex h-12 w-full items-center overflow-hidden rounded-2xl border border-white/15 bg-[#0B0D13] transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/35"
                >
                  <span className="flex h-full select-none items-center gap-1.5 border-r border-white/10 bg-white/5 px-3.5 font-mono text-xs font-bold text-white/90">
                    <span>🇱🇾</span>
                    <span>+218</span>
                  </span>
                  <input
                    id="login-phone"
                    type="tel"
                    inputMode="numeric"
                    disabled={loading || passkeyLoading}
                    value={phoneDigits}
                    onChange={(e) => {
                      setPhoneDigits(normalizeLibyaPhoneDigits(e.target.value));
                      if (error) setError(null);
                      if (sessionExpiredNotice) setSessionExpiredNotice(false);
                    }}
                    placeholder="91 234 5678"
                    className="h-full w-full bg-transparent px-3.5 font-mono text-base font-bold tracking-wider text-white placeholder:text-white/30 focus:outline-none"
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-white/50">
                  مثال: 0912345678 أو 912345678 (المدار، ليبيانا، هاتف ليبيا)
                </p>
              </div>

              {/* رسائل الخطأ */}
              {error && (
                <div className="flex items-start gap-2.5 rounded-2xl border-2 border-[#E51926] bg-[#E51926]/20 p-3.5 text-xs font-bold text-[#FF6B72]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#E51926]" />
                  <span>{error}</span>
                </div>
              )}

              {/* الزر الرئيسي: إرسال رمز الدخول السريع */}
              <Button
                type="submit"
                size="xl"
                disabled={loading || passkeyLoading || !phoneDigits}
                className="w-full rounded-2xl font-black shadow-primary-glow"
              >
                {loading ? (
                  <>
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                    <span>جاري التحقق من الرقم...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-5 w-5" />
                    <span>إرسال رمز الدخول السريع</span>
                  </>
                )}
              </Button>
            </form>

            {/* فاصل نصي: أو الدخول ببصمة الجهاز */}
            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-white/10" />
              <span className="mx-3 shrink-0 text-[11px] font-bold text-white/45">
                أو الدخول ببصمة الجهاز
              </span>
              <div className="flex-grow border-t border-white/10" />
            </div>

            {/* زر البصمة الحيوية (Passkey) */}
            <button
              type="button"
              onClick={handlePasskeyLogin}
              disabled={passkeyLoading || loading}
              className="flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl border border-primary/40 bg-gradient-to-r from-primary/10 via-primary/20 to-primary/10 px-4 text-xs font-black text-white shadow-lg transition hover:border-primary hover:bg-primary/25 disabled:opacity-50"
            >
              {passkeyLoading ? (
                <>
                  <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
                  <span>جاري قراءة وتوثيق البصمة...</span>
                </>
              ) : (
                <>
                  <Fingerprint className="h-5 w-5 text-primary" />
                  <span>دخول ببصمة الوجه / الإصبع (Passkey)</span>
                </>
              )}
            </button>

            {/* رابط تفعيل وربط ملصق جديد */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 text-center text-xs text-white/70">
              <span>هل اشتريت ملصقاً جديداً؟ </span>
              <Link
                href="/activate"
                className="inline-flex items-center gap-1 font-bold text-primary hover:underline"
              >
                <QrCode className="h-3.5 w-3.5" />
                <span>تفعيل وربط ملصق جديد</span>
              </Link>
            </div>
          </div>
        </div>

        {/* أسفل الصفحة: رابط تواصل مع الدعم الفني عبر واتساب */}
        <div className="mt-6 text-center">
          <a
            href={supportWhatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/35 bg-[#25D366]/12 px-5 py-2.5 text-xs font-bold text-[#25D366] transition hover:bg-[#25D366]/20 sm:text-sm"
          >
            <MessageCircle className="h-4 w-4 fill-current" />
            <span>تواصل مع الدعم الفني (واتساب)</span>
          </a>
        </div>
      </main>

      {/* نافذة التحقق الذكي عبر واتساب ورسائل SMS */}
      <SmartOtpModal
        isOpen={otpModalOpen}
        phone={phoneForOtp}
        onClose={() => setOtpModalOpen(false)}
        onVerified={handleOtpVerified}
        title="تأكيد الدخول السريع"
        subtitle="سنرسل رمز التحقق أولاً إلى واتساب، مع التحويل لرسالة SMS فوراً إن تعذر ذلك"
      />
    </div>
  );
}
