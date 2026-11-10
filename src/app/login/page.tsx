"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fingerprint,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  MessageCircle,
  ArrowRight,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  X,
  QrCode,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { Button } from "@/components/ui/button";
import {
  arrayBufferToBase64Url,
  base64UrlToUint8Array,
  formatFullLibyaE164,
  normalizeLibyaPhoneDigits,
} from "@/lib/utils";

export default function OwnerLoginPage() {
  const router = useRouter();

  const [phoneDigits, setPhoneDigits] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [passkeyLoading, setPasskeyLoading] = React.useState(false);
  const [pinLoading, setPinLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // حالة النافذة المنبثقة لاسترداد الحساب عبر كود بطاقة الأمان الرقمي
  const [resetModalOpen, setResetModalOpen] = React.useState(false);
  const [resetPhone, setResetPhone] = React.useState("");
  const [recoveryKeyInput, setRecoveryKeyInput] = React.useState("");
  const [newPin, setNewPin] = React.useState("");
  const [resetLoading, setResetLoading] = React.useState(false);
  const [resetError, setResetError] = React.useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = React.useState(false);

  // التحويل التلقائي من 127.0.0.1 إلى localhost (إلزامي لعمل WebAuthn وحساس البصمة)
  React.useEffect(() => {
    if (typeof window !== "undefined" && window.location.hostname === "127.0.0.1") {
      window.location.href = window.location.href.replace("127.0.0.1", "localhost");
    }
  }, []);

  // تفعيل الدخول الفوري بالبصمة الحيوية دون اشتراط إدخال رقم الهاتف (Zero-Typing Customer Passkey)
  const handlePasskeyLogin = async () => {
    if (passkeyLoading || pinLoading) return;
    setError(null);

    setPasskeyLoading(true);
    try {
      // 1. استعلام معرّفات البصمة المسجلة في جدول tags (بدون إرسال رقم هاتف)
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

      // 2. التحقق من دعم المتصفح واستدعاء navigator.credentials.get
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
            rpId: window.location.hostname,
            allowCredentials,
            userVerification: "required",
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

      // 3. التعرف التلقائي على حساب الزبون وملصق سيارته عبر معرف البصمة فقط
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
            "لم يتم العثور على سيارة مرتبطة بهذه البصمة، يرجى الدخول برمز الـ PIN."
        );
        setPasskeyLoading(false);
        return;
      }

      // حفظ بيانات الجلسة النشطة وتحويل الزبون إلى لوحة التحكم فوراً
      try {
        window.localStorage.setItem(
          "balaghni_owner_active_tag",
          JSON.stringify({
            tagCode: data.tag.tagCode,
            vehicleInfo:
              data.tag.vehicleInfo ||
              `${data.tag.vehicleBrand} ${data.tag.vehicleModel}`.trim(),
            city: data.tag.city || "طرابلس",
            ownerPhone: data.tag.ownerPhone || "",
            activatedAt: data.tag.activatedAt,
          })
        );
      } catch {
        // ignore storage errors
      }

      router.push(`/dashboard?tag=${encodeURIComponent(data.tag.tagCode)}`);
    } catch {
      setError("حدث خطأ غير متوقع أثناء المصادقة بالبصمة الحيوية.");
      setPasskeyLoading(false);
    }
  };

  const handlePinLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pinLoading || passkeyLoading) return;
    setError(null);

    const fullPhone = formatFullLibyaE164(phoneDigits);
    if (!fullPhone) {
      setError("يرجى إدخال رقم الهاتف الليبي (+218) المسجل.");
      return;
    }
    if (pin.length !== 6) {
      setError("يرجى إدخال رمز المرور المكون من 6 أرقام.");
      return;
    }

    setPinLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPhone: fullPhone,
          pin,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.tag) {
        setError(
          data.error || "رقم الهاتف غير مسجل أو رمز المرور غير صحيح"
        );
        setPinLoading(false);
        return;
      }

      // فتح الجلسة وتحويل المالك للوحة التحكم
      try {
        window.localStorage.setItem(
          "balaghni_owner_active_tag",
          JSON.stringify({
            tagCode: data.tag.tagCode,
            vehicleInfo:
              data.tag.vehicleInfo ||
              `${data.tag.vehicleBrand} ${data.tag.vehicleModel}`.trim(),
            city: data.tag.city || "طرابلس",
            ownerPhone: fullPhone,
            activatedAt: data.tag.activatedAt,
          })
        );
      } catch {
        // ignore storage errors
      }

      router.push(`/dashboard?tag=${encodeURIComponent(data.tag.tagCode)}`);
    } catch {
      setError("حدث خطأ أثناء الاتصال بقاعدة البيانات.");
      setPinLoading(false);
    }
  };

  const handleResetPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetLoading) return;
    setResetError(null);

    const fullPhone = formatFullLibyaE164(resetPhone);
    if (!fullPhone) {
      setResetError("يرجى إدخال رقم الهاتف الليبي المسجل بشكل صحيح.");
      return;
    }

    const cleanedKey = recoveryKeyInput.trim().toUpperCase();
    if (!/^BK-[A-Z0-9]{4}-[A-Z0-9]{4}(-[A-Z0-9]{4})?$/.test(cleanedKey)) {
      setResetError(
        "صيغة كود بطاقة الأمان غير صحيحة (مثال: BK-8492-X7M1)."
      );
      return;
    }

    if (newPin.length !== 6) {
      setResetError("يرجى اختيار رمز مرور جديد مكون من 6 أرقام.");
      return;
    }

    setResetLoading(true);
    try {
      const res = await fetch("/api/auth/reset-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerPhone: fullPhone,
          recoveryKey: cleanedKey,
          newPin,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setResetError(
          data.error ||
            "رقم الهاتف أو كود بطاقة الأمان غير مطابق للسجلات المشفرة."
        );
        setResetLoading(false);
        return;
      }

      setResetLoading(false);
      setResetSuccess(true);
      setPhoneDigits(resetPhone);
      setPin(newPin);

      setTimeout(() => {
        setResetModalOpen(false);
        setResetSuccess(false);
      }, 1500);
    } catch {
      setResetError("تعذر الاتصال بقاعدة البيانات.");
      setResetLoading(false);
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

      {/* بطاقة تسجيل الدخول الرئيسية */}
      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className="rounded-[32px] border border-white/12 bg-[#141721]/95 p-6 shadow-[0_28px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-8">
          <div className="text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-primary/15 px-3.5 py-1 text-xs font-bold text-primary">
              <ShieldCheck className="h-4 w-4" />
              بوابة أصحاب المركبات • تحقق مباشر من قاعدة البيانات
            </span>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">
              تسجيل دخول المالك
            </h1>
            <p className="mt-1.5 text-xs leading-relaxed text-white/65 sm:text-sm">
              ادخل برقم هاتفك المسجل ورمز المرور للوصول إلى لوحة تحكم سيارتك
              وخدمة «نبّهني»
            </p>
          </div>

          <div className="mt-6 space-y-5">
            {/* نموذج تسجيل الدخول برقم الهاتف ورمز المرور */}
            <form onSubmit={handlePinLogin} className="space-y-4">
              {/* أ) الحقل الأول: «رقم الهاتف الليبي المسجل» (مع مفتاح +218 والنص التلميحي 91 234 5678) */}
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
                    disabled={pinLoading || passkeyLoading}
                    value={phoneDigits}
                    onChange={(e) => {
                      setPhoneDigits(normalizeLibyaPhoneDigits(e.target.value));
                      if (error) setError(null);
                    }}
                    placeholder="91 234 5678"
                    className="h-full w-full bg-transparent px-3.5 font-mono text-base font-bold tracking-wider text-white placeholder:text-white/30 focus:outline-none"
                  />
                </div>
              </div>

              {/* ب) الحقل الثاني (تحت رقم الهاتف مباشرة بدون أي أزرار فاصلة بينهما): «رمز المرور (PIN من 6 أرقام)» مع رابط «نسيت رمز الدخول؟» */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label
                    htmlFor="login-pin"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-white/85 sm:text-sm"
                  >
                    <KeyRound className="h-4 w-4 text-primary" />
                    <span>رمز المرور (PIN من 6 أرقام)</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      setResetPhone(phoneDigits);
                      setResetError(null);
                      setResetModalOpen(true);
                    }}
                    className="text-xs font-bold text-primary underline-offset-4 hover:underline"
                  >
                    نسيت رمز الدخول؟
                  </button>
                </div>

                <input
                  id="login-pin"
                  type="password"
                  inputMode="numeric"
                  dir="ltr"
                  maxLength={6}
                  disabled={pinLoading || passkeyLoading}
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
                    if (error) setError(null);
                  }}
                  placeholder="••••••"
                  className="h-12 w-full rounded-2xl border border-white/15 bg-[#0B0D13] px-4 text-center font-mono text-xl font-black tracking-[0.4em] text-white placeholder:tracking-normal placeholder:text-white/25 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/35"
                />
              </div>

              {/* رسائل الخطأ */}
              {error && (
                <div className="flex items-start gap-2.5 rounded-2xl border-2 border-[#E51926] bg-[#E51926]/20 p-3.5 text-xs font-bold text-[#FF6B72]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#E51926]" />
                  <span>{error}</span>
                </div>
              )}

              {/* ج) الزر الرئيسي (باللون الأحمر البارز): «تسجيل الدخول» (للتحقق من رقم الهاتف + رمز الـ PIN) */}
              <Button
                type="submit"
                size="xl"
                disabled={pinLoading || passkeyLoading}
                className="w-full rounded-2xl font-black shadow-primary-glow"
              >
                {pinLoading ? (
                  <>
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                    <span>جاري التحقق من بيانات الدخول...</span>
                  </>
                ) : (
                  <>
                    <LockKeyhole className="h-5 w-5" />
                    <span>تسجيل الدخول</span>
                  </>
                )}
              </Button>
            </form>

            {/* د) فاصل نصي أنيق في المنتصف مكتوب عليه: «تسجيل دخول سريع» */}
            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-white/10" />
              <span className="mx-3 shrink-0 text-[11px] font-bold text-white/45">
                تسجيل دخول سريع
              </span>
              <div className="flex-grow border-t border-white/10" />
            </div>

            {/* هـ) زر البصمة الحيوية (تحت الفاصل مباشرة): «دخول ببصمة الوجه / الإصبع (Passkey)» مزود بأيقونة البصمة */}
            <button
              type="button"
              onClick={handlePasskeyLogin}
              disabled={passkeyLoading || pinLoading}
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

            {/* و) في الأسفل تماماً: رابط «هل اشتريت ملصقاً جديداً؟ تفعيل وربط ملصق جديد» */}
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

        {/* 5. أسفل الصفحة: رابط تواصل مع الدعم الفني عبر واتساب */}
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

      {/* 4. النافذة المنبثقة: نسيت رمز الدخول؟ (استرجاع الحساب عبر مطابقة الـ Hash في قاعدة البيانات) */}
      {resetModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-3xl border border-white/15 bg-[#141721] p-6 text-white shadow-2xl sm:p-7">
            <button
              type="button"
              onClick={() => setResetModalOpen(false)}
              aria-label="إغلاق"
              className="absolute top-5 left-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>

            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-[11px] font-bold text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              استرداد مشفر عبر قاعدة البيانات
            </span>

            <h2 className="mt-2.5 text-xl font-black text-white">
              إعادة تعيين رمز الدخول
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-white/65">
              أدخل رقم هاتفك الليبي وكود بطاقة الأمان الرقمي (
              <span dir="ltr" className="font-mono text-white/90">
                BK-XXXX-XXXX
              </span>
              ) لمطابقة التجزئة المشفرة وتعيين رمز جديد:
            </p>

            {resetSuccess ? (
              <div className="mt-5 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 p-5 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
                <p className="mt-2 text-sm font-bold text-white">
                  تمت مطابقة كود الطوارئ وتحديث رمز المرور في قاعدة البيانات
                  بنجاح!
                </p>
              </div>
            ) : (
              <form onSubmit={handleResetPinSubmit} className="mt-5 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-white/85">
                    رقم الهاتف الليبي (+218)
                  </label>
                  <div
                    dir="ltr"
                    className="flex h-11 w-full items-center overflow-hidden rounded-xl border border-white/15 bg-[#0B0D13]"
                  >
                    <span className="border-r border-white/10 bg-white/5 px-3 font-mono text-xs font-bold text-white/80">
                      +218
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={resetPhone}
                      onChange={(e) =>
                        setResetPhone(normalizeLibyaPhoneDigits(e.target.value))
                      }
                      placeholder="91 234 5678"
                      className="h-full w-full bg-transparent px-3 font-mono text-sm font-bold text-white focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-white/85">
                    كود بطاقة الأمان الرقمي (Recovery Key)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    value={recoveryKeyInput}
                    onChange={(e) =>
                      setRecoveryKeyInput(e.target.value.toUpperCase())
                    }
                    placeholder="BK-8492-X7M1"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#0B0D13] px-3 text-center font-mono text-sm font-black tracking-wider text-white focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-white/85">
                    رمز المرور الجديد (6 أرقام)
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    dir="ltr"
                    maxLength={6}
                    required
                    value={newPin}
                    onChange={(e) =>
                      setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="••••••"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#0B0D13] px-3 text-center font-mono text-lg font-black tracking-[0.35em] text-white focus:border-primary focus:outline-none"
                  />
                </div>

                {resetError && (
                  <p className="rounded-xl border border-[#E51926] bg-[#E51926]/20 p-2.5 text-xs font-bold text-[#FF6B72]">
                    {resetError}
                  </p>
                )}

                <Button
                  type="submit"
                  size="lg"
                  disabled={resetLoading}
                  className="w-full rounded-xl"
                >
                  {resetLoading ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      <span>جاري المطابقة والتحديث...</span>
                    </>
                  ) : (
                    <span>تحديث رمز الدخول الآن</span>
                  )}
                </Button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
