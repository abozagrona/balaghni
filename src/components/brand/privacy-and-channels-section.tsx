"use client";

import * as React from "react";
import {
  LockKeyhole,
  ShieldCheck,
  MessageSquareText,
  MessageCircle,
  WifiOff,
  Wifi,
} from "lucide-react";

export function PrivacyAndChannelsSection() {
  return (
    <section id="privacy-channels" className="py-16 sm:py-20">
      <div className="shell space-y-10">
        {/* 1. البطاقة الداكنة الفخمة: رقم هاتفك مش حيظهر أبداً */}
        <div className="relative overflow-hidden rounded-[36px] border border-white/10 bg-[#0B0D13] p-7 text-white shadow-[0_28px_70px_rgba(11,13,19,0.22)] sm:p-10 lg:p-12">
          {/* إضاءات خلفية فخمة */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/25 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-primary/15 blur-3xl"
          />

          <div className="relative z-10 grid items-center gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            {/* النص التوضيحي */}
            <div className="space-y-4 text-right">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-3.5 py-1 text-xs font-bold text-primary">
                <ShieldCheck className="h-4 w-4" />
                حماية رقم الطرفين 100%
              </span>

              <h2 className="text-2xl font-black tracking-tight text-white sm:text-4xl">
                رقم هاتفك مش حيظهر أبداً
              </h2>

              <p className="max-w-xl text-sm leading-relaxed text-white/75 sm:text-base">
                سواء كنت صاحب السيارة أو الشخص اللي يبلّغ، النظام يعمل كوسيط آمن
                ومشفر بالكامل؛ يوصل التنبيه في ثواني بدون ما ينكشف رقم أي طرف
                للثاني نهائياً.
              </p>
            </div>

            {/* عرض الرقم الليبي المشفر بالنجوم مع أيقونة قفل الأمان */}
            <div className="mx-auto w-full max-w-md rounded-3xl border border-white/12 bg-white/[0.04] p-5 backdrop-blur-md sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-[0_12px_28px_rgba(229,9,20,0.4)]">
                  <LockKeyhole className="h-7 w-7" />
                </div>

                <div className="flex-1 text-left" dir="ltr">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-white/50">
                    ENCRYPTED LIBYAN NUMBER
                  </span>
                  <div className="mt-1 flex items-center justify-end gap-2 font-mono text-2xl font-black tracking-widest text-white sm:text-3xl">
                    <span className="text-primary">091</span>
                    <span className="text-white/90">•••</span>
                    <span className="text-white/90">••••</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-white/70">
                <span className="inline-flex items-center gap-1.5 font-bold text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  تشفير كامل لهوية الطرفين
                </span>
                <span className="font-mono text-white/50">
                  091 / 092 / 094
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 2. قسم "نوصلك بأكثر من طريقة" - بطاقتان متجاورتان (SMS + WhatsApp) */}
        <div className="space-y-6 pt-2">
          <div className="mx-auto max-w-2xl text-center">
            <span className="rounded-full bg-secondary px-3.5 py-1 text-xs font-bold text-primary">
              تغطية مزدوجة في كل الظروف
            </span>
            <h3 className="mt-3 text-2xl font-black text-foreground sm:text-3xl">
              نوصلك بأكثر من طريقة
            </h3>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* البطاقة الأولى: SMS (مدار أو ليبيانا) */}
            <div className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-card-soft transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <span className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <MessageSquareText className="h-6 w-6" />
                  </span>
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-bold text-primary">
                      <WifiOff className="h-3 w-3" />
                      بدون إنترنت • SMS
                    </span>
                    <h4 className="mt-1 text-lg font-black text-foreground sm:text-xl">
                      رسالة نصية قصيرة (SMS)
                    </h4>
                  </div>
                </div>
                <span className="rounded-xl border border-border bg-muted/60 px-2.5 py-1 text-xs font-bold text-muted-foreground">
                  المدار / ليبيانا
                </span>
              </div>

              <p className="mt-5 rounded-2xl bg-muted/70 p-4 text-sm font-bold leading-relaxed text-foreground sm:text-base">
                لو ما عندكش إنترنت — يوصلك البلاغ في رسالة نصية فورية على مدار أو
                ليبيانا
              </p>
            </div>

            {/* البطاقة الثانية: WhatsApp */}
            <div className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-card-soft transition-all duration-300 hover:-translate-y-0.5 hover:border-[#25D366]/50 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <span className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-[#25D366]/15 text-[#1DA851]">
                    <MessageCircle className="h-6 w-6 fill-current" />
                  </span>
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366]/15 px-2.5 py-0.5 text-[11px] font-bold text-[#15803D]">
                      <Wifi className="h-3 w-3" />
                      متصل بالإنترنت • WhatsApp
                    </span>
                    <h4 className="mt-1 text-lg font-black text-foreground sm:text-xl">
                      إشعار واتساب فوري (WhatsApp)
                    </h4>
                  </div>
                </div>
                <span className="rounded-xl border border-[#25D366]/30 bg-[#25D366]/10 px-2.5 py-1 text-xs font-bold text-[#15803D]">
                  تفاصيل + صورة
                </span>
              </div>

              <p className="mt-5 rounded-2xl bg-muted/70 p-4 text-sm font-bold leading-relaxed text-foreground sm:text-base">
                لو عندك إنترنت — يوصلك تنبيه فوري مع تفاصيل وصورة الموقف على
                واتساب
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
