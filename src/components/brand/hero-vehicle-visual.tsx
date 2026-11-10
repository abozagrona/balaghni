"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, AlertTriangle, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";

export interface HeroVehicleVisualProps {
  tagCode?: string;
  className?: string;
  size?: "md" | "lg";
  interactiveLink?: boolean;
}

export default function HeroVehicleVisual({
  tagCode = "LY-123456",
  className,
}: HeroVehicleVisualProps) {
  // للتحكم في محتوى شاشة الهاتف الداخلية فقط: كاميرا المسح -> استلام البلاغ النهائي
  const [screenState, setScreenState] = useState<"scan" | "received">("scan");
  const [scanSelected, setScanSelected] = useState(false);

  useEffect(() => {
    // عند 1.25s: إظهار حالة "تم اختيار البلاغ" بعد مسح الكود
    const selectTimer = setTimeout(() => {
      setScanSelected(true);
    }, 1250);

    // عند 1.85s (0.65s ظهور الهاتف + 1.2s مسح): التحول الناعم والنهائي إلى شاشة وصول البلاغ
    const receiveTimer = setTimeout(() => {
      setScreenState("received");
    }, 1850);

    return () => {
      clearTimeout(selectTimer);
      clearTimeout(receiveTimer);
    };
  }, []);

  return (
    <div
      dir="rtl"
      className={cn(
        "relative mx-auto flex w-full max-w-[560px] select-none items-center justify-center",
        className
      )}
    >
      {/* الغلاف النسبي المطابق لأبعاد الصورة الصافية لضمان ثبات المواقع وعدم تقاطع الهاتف مع الملصق أبداً */}
      <div className="relative w-full">
        {/* 1. بطاقة الصورة الأساسية الصافية (0.0s إلى 0.45s) */}
        <motion.div
          initial={{ opacity: 0, y: 45 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full overflow-hidden rounded-3xl bg-white"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/balaghni-person-car-clean.jpg"
            alt="فحص ملصق بَلِّغْنِي على السيارة"
            className="block h-auto w-full object-contain"
          />
        </motion.div>

        {/* 2. خطوط وشعاع الانبثاق من الملصق الصغير على الزجاج (38.8%, 43.2%) إلى الملصق المكبّر */}
        <motion.svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.38, duration: 0.35 }}
          className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        >
          <defs>
            <linearGradient id="zoomBeamGrad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.18" />
            </linearGradient>
          </defs>
          {/* مخروط الإضاءة الواصل بين الملصق على الزجاج والملصق المكبّر */}
          <polygon
            points="38.8,43.2 46.2,6.5 46.2,36.5"
            fill="url(#zoomBeamGrad)"
          />
          {/* خطا التوجيه العلوي والسفلي من الملصق على الزجاج */}
          <line
            x1="38.8"
            y1="43.2"
            x2="46.2"
            y2="6.5"
            stroke="#FFFFFF"
            strokeWidth="0.45"
            strokeDasharray="1.2 0.8"
          />
          <line
            x1="38.8"
            y1="43.2"
            x2="46.2"
            y2="36.5"
            stroke="#FFFFFF"
            strokeWidth="0.45"
            strokeDasharray="1.2 0.8"
          />
          {/* نقطة الارتكاز فوق الملصق الصغير على زجاج السيارة */}
          <circle
            cx="38.8"
            cy="43.2"
            r="1.1"
            fill="#E51926"
            stroke="#FFFFFF"
            strokeWidth="0.4"
          />
        </motion.svg>

        {/* 3. الملصق المكبّر بخلفية الزجاج الداكنة الأصلية (/balaghni-sticker-zoomed.jpg): ينبثق من مكان الملصق على الزجاج */}
        <motion.div
          initial={{ scale: 0.08, opacity: 0, x: -75, y: 65 }}
          animate={{ scale: 1, opacity: 1, x: 0, y: 0 }}
          transition={{
            delay: 0.4,
            type: "spring",
            stiffness: 240,
            damping: 18,
          }}
          style={{
            left: "45.5%",
            top: "4%",
            width: "28.5%",
            transformOrigin: "bottom left",
          }}
          className="absolute z-20 overflow-hidden rounded-[20px] shadow-[0_18px_40px_rgba(11,13,19,0.28)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/balaghni-sticker-zoomed.jpg"
            alt={`ملصق بَلِّغْنِي ${tagCode}`}
            className="block h-auto w-full object-contain"
          />
        </motion.div>

        {/* 4. الهاتف الذكي المصغّر (0.65s): في الزاوية السفلية اليمنى أسفل الملصق وبعيداً عنه تماماً */}
        <motion.div
          initial={{ opacity: 0, y: 35, rotate: 10 }}
          animate={{ opacity: 1, y: 0, rotate: 10 }}
          transition={{ delay: 0.65, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="absolute -bottom-3 right-1 z-30 h-[215px] w-[112px] rounded-[24px] border-[2.5px] border-[#3A3835] bg-[#1F1E1C] p-1.5 shadow-[0_22px_50px_rgba(11,13,19,0.35)] sm:-bottom-4 sm:right-2 sm:h-[245px] sm:w-[126px] sm:rounded-[28px]"
        >
          {/* شاشة الهاتف الداخلية الثابتة */}
          <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[19px] bg-[#F3ECE6] sm:rounded-[22px]">
            {/* شريط الحالة والـ Dynamic Island */}
            <div className="relative z-40 flex items-center justify-between px-2 pt-1 pb-0.5 text-[6px] font-bold text-neutral-700">
              <span>9:41</span>
              <div className="h-2.5 w-9 rounded-full bg-black" />
              <span className="tracking-tighter">5G</span>
            </div>

            <AnimatePresence mode="wait">
              {screenState === "scan" ? (
                /* المرحلة أ (لمدة 1.2 ثانية): شاشة الكاميرا والمسح الضوئي واختيار البلاغ */
                <motion.div
                  key="scan-screen"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.25 }}
                  className="relative flex h-full w-full flex-1 flex-col items-center justify-between bg-neutral-950 p-1.5 text-center text-white"
                >
                  <span className="mt-0.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[6.5px] font-bold text-white/90">
                    كاميرا المسح
                  </span>

                  {/* إطار تحديد الباركود وخط الليزر */}
                  <div className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-dashed border-red-500/80 bg-white/95 p-1 sm:h-[74px] sm:w-[74px]">
                    <span className="absolute right-0.5 top-0.5 h-2 w-2 border-r-2 border-t-2 border-[#E51926]" />
                    <span className="absolute left-0.5 top-0.5 h-2 w-2 border-l-2 border-t-2 border-[#E51926]" />
                    <span className="absolute bottom-0.5 right-0.5 h-2 w-2 border-b-2 border-r-2 border-[#E51926]" />
                    <span className="absolute bottom-0.5 left-0.5 h-2 w-2 border-b-2 border-l-2 border-[#E51926]" />

                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/balaghni-sticker-zoomed.jpg"
                      alt="QR"
                      className="h-full w-full rounded object-cover"
                    />

                    <motion.div
                      animate={{ y: [-24, 24, -24] }}
                      transition={{
                        repeat: Infinity,
                        duration: 0.75,
                        ease: "easeInOut",
                      }}
                      className="absolute inset-x-0.5 h-[1.5px] bg-[#E51926] shadow-[0_0_8px_#E51926]"
                    />
                  </div>

                  <div className="mb-0.5 w-full">
                    {scanSelected ? (
                      <motion.div
                        initial={{ opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center justify-center gap-0.5 rounded-md bg-[#E51926] px-1 py-0.5 text-[6.5px] font-black text-white shadow"
                      >
                        <Check className="h-2 w-2 stroke-[3]" />
                        <span>تم اختيار البلاغ</span>
                      </motion.div>
                    ) : (
                      <div className="flex items-center justify-center gap-0.5 rounded-md bg-white/10 px-1 py-0.5 text-[6px] font-medium text-neutral-300">
                        <QrCode className="h-2 w-2 text-[#E51926]" />
                        <span>جاري مسح {tagCode}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : (
                /* المرحلة ب (التثبيت النهائي): شاشة وصول البلاغ مع شعار بَلِّغْنِي ومربع التنبيه العاجل */
                <motion.div
                  key="received-screen"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="flex h-full w-full flex-1 flex-col justify-between bg-[#F3ECE6] px-1.5 pt-1 pb-1.5 text-center"
                >
                  {/* شعار بَلِّغْنِي في الأعلى */}
                  <div className="mt-0.5 flex flex-col items-center">
                    <div className="h-6 w-6 overflow-hidden rounded-full bg-[#E51926] p-0.5 shadow-sm sm:h-7 sm:w-7">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/balaghni-logo.jpg"
                        alt="شعار بَلِّغْنِي"
                        className="h-full w-full rounded-full object-cover"
                      />
                    </div>
                    <span className="mt-0.5 text-[8.5px] font-black text-[#0B0D13] sm:text-[9.5px]">
                      بَلِّغْنِي
                    </span>
                  </div>

                  {/* مربع التنبيه العاجل */}
                  <div className="my-auto rounded-xl border border-[#F5D0C5] bg-white/95 p-1.5 shadow-sm sm:p-2">
                    <p className="text-[7.5px] font-black leading-snug text-[#0B0D13] sm:text-[8.5px]">
                      <span className="inline-flex items-center gap-0.5 text-[#E51926]">
                        <AlertTriangle className="inline h-2.5 w-2.5 fill-amber-400 text-amber-600" />
                        <span>تنبيه عاجل:</span>
                      </span>{" "}
                      سيارتك تعيق حركة السير، يرجى تحريكها
                    </p>
                  </div>

                  {/* شريط الرسائل السفلي */}
                  <div className="flex items-center justify-between rounded-full border border-black/10 bg-white/90 px-1.5 py-0.5 text-[6px] text-neutral-400">
                    <span>Message...</span>
                    <span className="font-bold text-[#E51926]">✓</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
