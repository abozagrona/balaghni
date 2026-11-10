"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X, QrCode, ShoppingBag, UserCheck } from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <header className="site-header sticky top-0 z-50 border-b border-black/5 bg-white/95 py-2.5 shadow-sm backdrop-blur-md">
      <div className="shell">
        <div className="flex items-center justify-between rounded-full bg-white/90 px-2 py-1 sm:px-3">
          <Link href="/" className="ps-2">
            <BalaghniLogo size="md" showTagline />
          </Link>

          {/* روابط سطح المكتب */}
          <nav className="hidden items-center gap-6 text-sm font-bold text-muted-foreground lg:flex">
            <Link href="/#how-it-works" className="transition hover:text-primary">
              كيف يعمل؟
            </Link>
            <Link href="/#situations" className="transition hover:text-primary">
              مواقف يومية
            </Link>
            <Link href="/#pricing" className="transition hover:text-primary">
              الباقات والأسعار
            </Link>
            <Link
              href="/s/LY-123456"
              className="inline-flex items-center gap-1.5 text-primary transition hover:opacity-80"
            >
              <QrCode className="h-4 w-4" />
              <span>تجربة صفحة المسح</span>
            </Link>
          </nav>

          {/* أزرار الإجراءات: دخول المالك + اطلب ملصقك */}
          <div className="hidden items-center gap-2.5 lg:flex">
            <Button
              asChild
              variant="outline"
              size="default"
              className="rounded-full border-primary/25 bg-secondary/60 text-foreground hover:border-primary hover:bg-secondary"
            >
              <Link href="/login">
                <UserCheck className="h-4 w-4 text-primary" />
                <span>دخول المالك</span>
              </Link>
            </Button>

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
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* قائمة الموبايل المنسدلة */}
        {mobileOpen && (
          <div className="mt-2 rounded-3xl border border-border bg-card p-4 shadow-card-soft lg:hidden">
            <nav className="flex flex-col gap-3 text-sm font-bold text-foreground">
              <Link
                href="/#how-it-works"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl px-3 py-2 hover:bg-muted"
              >
                كيف يعمل؟
              </Link>
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
              <Link
                href="/s/LY-123456"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl bg-secondary px-3 py-2 text-primary"
              >
                تجربة صفحة المسح الفورية (LY-123456)
              </Link>

              <div className="mt-1 grid grid-cols-2 gap-2.5">
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="w-full rounded-2xl"
                >
                  <Link href="/login" onClick={() => setMobileOpen(false)}>
                    <UserCheck className="h-4 w-4 text-primary" />
                    <span>دخول المالك</span>
                  </Link>
                </Button>

                <Button asChild size="lg" className="w-full rounded-2xl">
                  <Link href="/order" onClick={() => setMobileOpen(false)}>
                    اطلب ملصقك الآن
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
