"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Menu,
  X,
  ShoppingBag,
  LogIn,
  User,
  LayoutDashboard,
  LogOut,
  Car,
  ChevronLeft,
  Fingerprint,
  LoaderCircle,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { Button } from "@/components/ui/button";
import { useOwnerSession } from "@/lib/auth-session";
import {
  arrayBufferToBase64Url,
  base64UrlToUint8Array,
} from "@/lib/utils";

export function SiteHeader() {
  const router = useRouter();
  const { session, isLoggedIn, isMounted, logout } = useOwnerSession();

  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const [hasPasskey, setHasPasskey] = React.useState<boolean | null>(null);
  const [passkeyLoading, setPasskeyLoading] = React.useState(false);
  const [passkeyFeedback, setPasskeyFeedback] = React.useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);

  // إغلاق القائمة المنسدلة عند النقر خارجها
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };

    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownOpen]);

  // إغلاق القوائم عند تغيير المسار
  React.useEffect(() => {
    setDropdownOpen(false);
    setMobileOpen(false);
  }, []);

  // التحقق من حالة تفعيل البصمة (Passkey) لحساب المالك النشط
  React.useEffect(() => {
    if (!isMounted || !isLoggedIn || !session?.tagCode) {
      setHasPasskey(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/dashboard?tag=${encodeURIComponent(session.tagCode)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
          }
        );
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.ok && data?.tag) {
          setHasPasskey(Boolean(data.tag.hasPasskey));
        }
      } catch {
        // تجاهل أخطاء الشبكة الصامتة في الشريط العلوي
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isMounted, isLoggedIn, session?.tagCode]);

  // مزامنة حالة البصمة فورياً مع أي تحديث من لوحة التحكم
  React.useEffect(() => {
    const onPasskeyUpdated = (event: Event) => {
      const detail = (
        event as CustomEvent<{ tagCode?: string; hasPasskey?: boolean }>
      )?.detail;
      if (!detail || typeof detail.hasPasskey !== "boolean") return;
      if (!detail.tagCode || detail.tagCode === session?.tagCode) {
        setHasPasskey(detail.hasPasskey);
      }
    };
    window.addEventListener("balaghni:passkey-updated", onPasskeyUpdated);
    return () => {
      window.removeEventListener("balaghni:passkey-updated", onPasskeyUpdated);
    };
  }, [session?.tagCode]);

  // تفعيل الدخول السريع بالبصمة (Passkey) مباشرة من قائمة الحساب
  const handleEnablePasskey = async () => {
    if (!session?.tagCode || passkeyLoading) return;
    setPasskeyFeedback(null);
    setPasskeyLoading(true);

    try {
      if (
        typeof window === "undefined" ||
        !window.PublicKeyCredential ||
        !navigator.credentials?.create
      ) {
        setPasskeyFeedback({
          type: "error",
          text: "متصفحك الحالي لا يدعم المصادقة بالبصمة (WebAuthn).",
        });
        return;
      }

      const configRes = await fetch(
        `/api/auth/passkey?tagCode=${encodeURIComponent(session.tagCode)}`,
        {
          cache: "no-store",
          credentials: "same-origin",
        }
      ).catch(() => null);
      const configData = configRes
        ? await configRes.json().catch(() => ({}))
        : {};
      const rpId =
        String(configData.rpId || "").trim() ||
        window.location.hostname.replace(/^www\./, "");

      const phone = session.tagCode.trim();
      const challenge = configData.challenge
        ? base64UrlToUint8Array(String(configData.challenge))
        : (() => {
            const arr = new Uint8Array(32);
            window.crypto.getRandomValues(arr);
            return arr;
          })();

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "بَلِّغْنِي", id: rpId },
          user: {
            id: new TextEncoder().encode(phone),
            name: phone,
            displayName: session.vehicleInfo || phone,
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "preferred",
            residentKey: "preferred",
          },
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;

      if (!credential || !credential.rawId) {
        setPasskeyFeedback({
          type: "error",
          text: "تم إلغاء عملية تسجيل البصمة أو لم تكتمل.",
        });
        return;
      }

      const base64UrlCredId = arrayBufferToBase64Url(credential.rawId);
      const attestationResp =
        credential.response as AuthenticatorAttestationResponse;
      const clientDataJSON = attestationResp?.clientDataJSON
        ? arrayBufferToBase64Url(attestationResp.clientDataJSON)
        : "";
      const spkiBuffer =
        typeof attestationResp?.getPublicKey === "function"
          ? attestationResp.getPublicKey()
          : null;
      const publicKeySpki = spkiBuffer
        ? arrayBufferToBase64Url(spkiBuffer)
        : "";
      const publicKeyAlgorithm =
        typeof attestationResp?.getPublicKeyAlgorithm === "function"
          ? attestationResp.getPublicKeyAlgorithm()
          : -7;

      const saveRes = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          tagCode: session.tagCode,
          passkeyCredentialId: base64UrlCredId,
          challengeToken: configData.challengeToken,
          clientDataJSON,
          publicKeySpki,
          publicKeyAlgorithm,
        }),
      });

      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok || !saveData.ok) {
        setPasskeyFeedback({
          type: "error",
          text: saveData.error || "تعذر حفظ البصمة في قاعدة البيانات.",
        });
        return;
      }

      setHasPasskey(true);
      setPasskeyFeedback({
        type: "success",
        text: "تم تفعيل الدخول السريع بالبصمة (Passkey) بنجاح ✓",
      });
      window.dispatchEvent(
        new CustomEvent("balaghni:passkey-updated", {
          detail: { tagCode: session.tagCode, hasPasskey: true },
        })
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setPasskeyFeedback({
          type: "error",
          text: "تم إلغاء نافذة البصمة أو لم يتم التحقق منها على الجهاز.",
        });
      } else {
        setPasskeyFeedback({
          type: "error",
          text: "تعذر تفعيل البصمة حالياً. تأكد من تفعيل قفل الشاشة في هاتفك.",
        });
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  // معالجة تسجيل الخروج لإنهاء الجلسة وإعادة المستخدم كزائر عادي
  const handleLogoutClick = () => {
    setDropdownOpen(false);
    setMobileOpen(false);
    logout();

    if (typeof window !== "undefined") {
      if (window.location.pathname.startsWith("/dashboard")) {
        router.push("/");
      }
    }
  };

  const dashboardUrl = session?.tagCode
    ? `/dashboard?tag=${encodeURIComponent(session.tagCode)}`
    : "/dashboard";

  return (
    <header className="site-header sticky top-0 z-50 border-b border-black/5 bg-white/95 py-2.5 shadow-sm backdrop-blur-md">
      <div className="shell">
        <div className="flex items-center justify-between rounded-full bg-white/90 px-2 py-1 sm:px-3">
          <Link href="/" className="ps-2">
            <BalaghniLogo size="md" showTagline />
          </Link>

          {/* روابط سطح المكتب */}
          <nav className="hidden items-center gap-6 text-sm font-bold text-muted-foreground lg:flex">
            <Link href="/#situations" className="transition hover:text-primary">
              مواقف يومية
            </Link>
            <Link href="/#pricing" className="transition hover:text-primary">
              الباقات والأسعار
            </Link>
          </nav>

          {/* أزرار الإجراءات في شاشة سطح المكتب */}
          <div className="hidden items-center gap-2.5 lg:flex">
            {/* في حال كان المالك مسجلاً للدخول: إخفاء زر تسجيل الدخول وإظهار الأفاتار الدائري */}
            {isMounted && isLoggedIn && session ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setDropdownOpen((prev) => !prev)}
                  aria-expanded={dropdownOpen}
                  aria-haspopup="true"
                  aria-label="قائمة حساب المالك"
                  className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-primary/35 bg-gradient-to-tr from-primary/15 via-white to-primary/10 text-primary shadow-sm transition hover:border-primary hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/40 sm:h-11 sm:w-11"
                >
                  <User className="h-5 w-5" />
                  {/* نقطة خضراء تشير إلى نشاط الجلسة */}
                  <span
                    className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white"
                    title="جلسة نشطة"
                  />
                  {/* نقطة تنبيه حمراء/برتقالية نابضة عند عدم تفعيل البصمة (Passkey) */}
                  {hasPasskey === false && (
                    <span
                      className="absolute -top-0.5 -left-0.5 flex h-3.5 w-3.5"
                      title="ينصح بتفعيل الدخول السريع بالبصمة (Passkey)"
                    >
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-500 opacity-75" />
                      <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-red-500 ring-2 ring-white" />
                    </span>
                  )}
                </button>

                {/* القائمة المنسدلة لحساب المالك */}
                {dropdownOpen && (
                  <div
                    role="menu"
                    className="absolute left-0 top-[calc(100%+10px)] z-50 w-72 rounded-3xl border border-black/10 bg-white/95 p-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.15)] backdrop-blur-xl animate-in fade-in zoom-in-95"
                  >
                    {/* بطاقة معلومات المركبة والمالك */}
                    <div className="flex items-center gap-3 rounded-2xl border border-border/50 bg-secondary/60 p-2.5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Car className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-black text-foreground">
                          {session.vehicleInfo || "مركبتي المسجلة"}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-bold text-primary">
                            {session.tagCode}
                          </span>
                          {session.city && (
                            <span className="text-[10px] text-muted-foreground font-medium">
                              {session.city}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="my-2 border-t border-border/60" />

                    {/* خيار 1: لوحة التحكم */}
                    <Link
                      href={dashboardUrl}
                      onClick={() => setDropdownOpen(false)}
                      className="group flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-xs font-bold text-foreground transition hover:bg-secondary"
                      role="menuitem"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-white">
                          <LayoutDashboard className="h-4 w-4" />
                        </div>
                        <div className="text-start">
                          <span className="block font-black">لوحة التحكم</span>
                          <span className="block text-[10px] text-muted-foreground font-normal">
                            إدارة مركبتك وسجل البلاغات
                          </span>
                        </div>
                      </div>
                      <ChevronLeft className="h-4 w-4 text-muted-foreground transition group-hover:text-foreground" />
                    </Link>

                    <div className="my-1 border-t border-border/40" />

                    {/* خيار 2: تفعيل الدخول السريع بالبصمة (Passkey) */}
                    <button
                      type="button"
                      onClick={handleEnablePasskey}
                      disabled={passkeyLoading}
                      className="group flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-xs font-bold text-foreground transition hover:bg-secondary disabled:opacity-60"
                      role="menuitem"
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`relative flex h-8 w-8 items-center justify-center rounded-xl transition ${
                            hasPasskey
                              ? "bg-emerald-500/15 text-emerald-600"
                              : "bg-orange-500/15 text-orange-600 group-hover:bg-orange-500 group-hover:text-white"
                          }`}
                        >
                          {passkeyLoading ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <Fingerprint className="h-4 w-4" />
                          )}
                          {hasPasskey === false && !passkeyLoading && (
                            <span className="absolute -top-0.5 -left-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
                          )}
                        </div>
                        <div className="text-start">
                          <span className="block font-black">
                            {passkeyLoading
                              ? "جاري تفعيل البصمة..."
                              : hasPasskey
                              ? "البصمة (Passkey) مفعّلة ✓"
                              : "تفعيل الدخول السريع بالبصمة (Passkey)"}
                          </span>
                          <span className="block text-[10px] text-muted-foreground font-normal">
                            {hasPasskey
                              ? "اضغط لإعادة ربط بصمة جهاز آخر"
                              : "دخول فوري ببصمة الوجه أو الإصبع"}
                          </span>
                        </div>
                      </div>
                      <ChevronLeft className="h-4 w-4 text-muted-foreground transition group-hover:text-foreground" />
                    </button>

                    {passkeyFeedback && (
                      <div
                        className={`mt-1.5 rounded-xl px-3 py-2 text-[11px] font-bold ${
                          passkeyFeedback.type === "success"
                            ? "bg-emerald-500/10 text-emerald-700"
                            : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        {passkeyFeedback.text}
                      </div>
                    )}

                    <div className="my-1 border-t border-border/40" />

                    {/* خيار 3: تسجيل الخروج */}
                    <button
                      type="button"
                      onClick={handleLogoutClick}
                      className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-xs font-bold text-destructive transition hover:bg-destructive/10"
                      role="menuitem"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                        <LogOut className="h-4 w-4" />
                      </div>
                      <div className="text-start">
                        <span className="block font-black">تسجيل الخروج</span>
                        <span className="block text-[10px] text-destructive/70 font-normal">
                          إنهاء الجلسة والعودة كزائر
                        </span>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* في حال كان الزائر غير مسجل: زر "تسجيل الدخول" الافتراضي */
              <Button
                asChild
                variant="outline"
                size="default"
                className="rounded-full border-primary/25 bg-secondary/60 text-foreground hover:border-primary hover:bg-secondary"
              >
                <Link href="/login">
                  <LogIn className="h-4 w-4 text-primary" />
                  <span>تسجيل الدخول</span>
                </Link>
              </Button>
            )}

            {/* زر اطلب ملصقك */}
            <Button asChild size="default" className="rounded-full">
              <Link href="/order">
                <ShoppingBag className="h-4 w-4" />
                <span>اطلب ملصقك</span>
              </Link>
            </Button>
          </div>

          {/* زر القائمة للموبايل */}
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="فتح القائمة"
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-foreground lg:hidden"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
            {isMounted && isLoggedIn && session && hasPasskey === false && (
              <span
                className="absolute -top-0.5 -left-0.5 flex h-3 w-3"
                title="ينصح بتفعيل الدخول السريع بالبصمة (Passkey)"
              >
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-500 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500 ring-2 ring-white" />
              </span>
            )}
          </button>
        </div>

        {/* قائمة الموبايل المنسدلة */}
        {mobileOpen && (
          <div className="mt-2 rounded-3xl border border-border bg-card p-4 shadow-card-soft lg:hidden">
            <nav className="flex flex-col gap-3 text-sm font-bold text-foreground">
              {/* بطاقة المستخدم المسجل في قائمة الموبايل */}
              {isMounted && isLoggedIn && session && (
                <div className="rounded-2xl border border-primary/20 bg-secondary/50 p-3">
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                      <User className="h-5 w-5" />
                      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                      {hasPasskey === false && (
                        <span className="absolute -top-0.5 -left-0.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-black text-foreground">
                        {session.vehicleInfo || "مركبتي المسجلة"}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-primary">
                          {session.tagCode}
                        </span>
                        {session.city && (
                          <span className="text-[10px] text-muted-foreground">
                            {session.city}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button asChild size="default" className="rounded-xl">
                      <Link
                        href={dashboardUrl}
                        onClick={() => setMobileOpen(false)}
                      >
                        <LayoutDashboard className="h-4 w-4" />
                        <span>لوحة التحكم</span>
                      </Link>
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      onClick={handleLogoutClick}
                      className="rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>خروج</span>
                    </Button>
                  </div>

                  <button
                    type="button"
                    onClick={handleEnablePasskey}
                    disabled={passkeyLoading}
                    className={`mt-2 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition disabled:opacity-60 ${
                      hasPasskey
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                        : "border-orange-500/40 bg-orange-500/10 text-orange-700 hover:bg-orange-500/20"
                    }`}
                  >
                    {passkeyLoading ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        <span>جاري تفعيل البصمة...</span>
                      </>
                    ) : (
                      <>
                        <Fingerprint className="h-4 w-4" />
                        <span>
                          {hasPasskey
                            ? "البصمة (Passkey) مفعّلة ✓"
                            : "تفعيل الدخول السريع بالبصمة (Passkey)"}
                        </span>
                      </>
                    )}
                  </button>

                  {passkeyFeedback && (
                    <p
                      className={`mt-2 rounded-xl px-3 py-1.5 text-[11px] font-bold ${
                        passkeyFeedback.type === "success"
                          ? "bg-emerald-500/10 text-emerald-700"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {passkeyFeedback.text}
                    </p>
                  )}
                </div>
              )}

              <Link
                href="/#situations"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl px-3 py-2 hover:bg-muted"
              >
                مواقف يومية
              </Link>
              <Link
                href="/#pricing"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl px-3 py-2 hover:bg-muted"
              >
                الباقات والأسعار (د.ل)
              </Link>

              {/* أزرار الإجراءات للموبايل */}
              <div className="mt-1 flex flex-col gap-2">
                {(!isMounted || !isLoggedIn) && (
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="w-full rounded-2xl border-primary/25 bg-secondary/60 text-foreground hover:border-primary hover:bg-secondary"
                  >
                    <Link href="/login" onClick={() => setMobileOpen(false)}>
                      <LogIn className="h-4 w-4 text-primary" />
                      <span>تسجيل الدخول</span>
                    </Link>
                  </Button>
                )}

                <Button asChild size="lg" className="w-full rounded-2xl">
                  <Link href="/order" onClick={() => setMobileOpen(false)}>
                    <ShoppingBag className="h-4 w-4" />
                    <span>اطلب ملصقك الآن</span>
                  </Link>
                </Button>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
