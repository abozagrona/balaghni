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
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { Button } from "@/components/ui/button";
import { useOwnerSession } from "@/lib/auth-session";

export function SiteHeader() {
  const router = useRouter();
  const { session, isLoggedIn, isMounted, logout } = useOwnerSession();

  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

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

                    {/* خيار 2: تسجيل الخروج */}
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
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-foreground lg:hidden"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
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
