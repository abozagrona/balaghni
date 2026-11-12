import * as React from "react";
import Link from "next/link";
import {
  QrCode,
  UserCheck,
  Smartphone,
  LayoutDashboard,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-[#0B0D13] text-white">
      <div className="shell py-12 sm:py-14">
        {/* الشبكة الرئيسية: الشعار في أقصى اليمين + 3 أعمدة روابط */}
        <div className="grid items-start gap-10 sm:grid-cols-2 lg:grid-cols-[1.25fr_1fr_1.15fr_1fr] lg:gap-8">
          {/* 1. أقصى اليمين: شعار «بَلِّغْنِي» الرسمي بحجم ثابت ومعتدل مع النبذة القصيرة */}
          <div className="flex flex-col items-start space-y-3.5">
            <Link href="/" className="inline-flex items-center">
              <BalaghniLogo variant="dark" size="md" />
            </Link>
            <p className="max-w-xs text-sm font-medium leading-relaxed text-white/75">
              الستيكر الذكي لحماية خصوصية سيارتك في ليبيا
            </p>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-bold text-white/80">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>حماية رقم الهاتف 100% • ليبيا</span>
            </div>
          </div>

          {/* 2. العمود الأول: روابط المنتج */}
          <div>
            <h3 className="text-sm font-black tracking-wide text-white">
              روابط المنتج
            </h3>
            <ul className="mt-4 space-y-3 text-sm text-white/70">
              <li>
                <Link
                  href="/#how-it-works"
                  className="transition-colors hover:text-primary"
                >
                  كيف يعمل؟
                </Link>
              </li>
              <li>
                <Link
                  href="/#pricing"
                  className="transition-colors hover:text-primary"
                >
                  الباقات والأسعار
                </Link>
              </li>
              <li>
                <Link
                  href="/order"
                  className="transition-colors hover:text-primary"
                >
                  اطلب ملصقك
                </Link>
              </li>
              <li>
                <Link
                  href="/#faq"
                  className="transition-colors hover:text-primary"
                >
                  الأسئلة الشائعة
                </Link>
              </li>
            </ul>
          </div>

          {/* 3. العمود الثاني: حساب صاحب السيارة (مهم للربط) */}
          <div>
            <h3 className="flex items-center gap-2 text-sm font-black tracking-wide text-white">
              <span>حساب صاحب السيارة</span>
              <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                ربط الملصقات
              </span>
            </h3>
            <ul className="mt-4 space-y-3 text-sm text-white/70">
              <li>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 transition-colors hover:text-primary"
                >
                  <UserCheck className="h-4 w-4 text-primary/80" />
                  <span>تسجيل دخول العملاء</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/activate"
                  className="inline-flex items-center gap-2 font-bold text-white transition-colors hover:text-primary"
                >
                  <QrCode className="h-4 w-4 text-primary" />
                  <span>ربط ملصق جديد برقم الهاتف</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 transition-colors hover:text-primary"
                >
                  <LayoutDashboard className="h-4 w-4 text-primary/80" />
                  <span>لوحة التحكم</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* 4. العمود الثالث: القانوني والدعم */}
          <div>
            <h3 className="text-sm font-black tracking-wide text-white">
              القانوني والدعم
            </h3>
            <ul className="mt-4 space-y-3 text-sm text-white/70">
              <li>
                <Link
                  href="/privacy"
                  className="transition-colors hover:text-primary"
                >
                  سياسة الخصوصية
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="transition-colors hover:text-primary"
                >
                  الأحكام والشروط
                </Link>
              </li>
              <li>
                <a
                  href="https://wa.me/218910000000"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 font-bold text-[#25D366] transition-opacity hover:opacity-85"
                >
                  <MessageCircle className="h-4 w-4 fill-current" />
                  <span>تواصل معنا (واتساب)</span>
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* 3. الشريط السفلي للـ Footer */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-white/60 sm:flex-row">
          <p className="font-medium text-white/70">
            © 2026 Balaghni. جميع الحقوق محفوظة.
          </p>
          <div className="flex items-center gap-2 text-white/50">
            <Smartphone className="h-3.5 w-3.5 text-primary" />
            <span>بوابة التنبيهات الذكية للمركبات في ليبيا</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
