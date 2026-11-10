import * as React from "react";
import { cn } from "@/lib/utils";

interface BalaghniLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "light" | "dark" | "on-red";
  showTagline?: boolean;
}

/**
 * أيقونة الجرس الشعاعية المطابقة تماماً للشعار الرسمي المرفق (الدائرة الحمراء مع قوس الجرس الأبيض ولسان الجرس السفلي)
 */
export function BalaghniMarkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r="48" fill="#E51926" />
      {/* قوس الجرس الأبيض المنحني للخارج من الأسفل */}
      <path
        d="M26 63C33 63 36 56 37 44C38 30 43 24 50 24C57 24 62 30 63 44C64 56 67 63 74 63"
        stroke="#FFFFFF"
        strokeWidth="9.5"
        strokeLinecap="butt"
        strokeLinejoin="round"
      />
      {/* لسان الجرس السفلي (نصف دائرة بيضاء) */}
      <path
        d="M40.5 68.5H59.5C59.5 74.2 55.2 78.5 50 78.5C44.8 78.5 40.5 74.2 40.5 68.5Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/**
 * شعار «بَلِّغْنِي | •• BALAGHNI» الرسمي المطابق للصورة المرفقة
 */
export function BalaghniLogo({
  className,
  size = "md",
  variant = "light",
  showTagline = false,
}: BalaghniLogoProps) {
  const iconSizes = {
    sm: "h-9 w-9",
    md: "h-11 w-11",
    lg: "h-12 w-12",
  };

  const iconPxSizes = {
    sm: 36,
    md: 44,
    lg: 48,
  };

  const titleSizes = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl",
  };

  const isOnRed = variant === "on-red";
  const isDark = variant === "dark";
  const pxSize = iconPxSizes[size];

  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      {/* الأيقونة الدائرية الحمراء الرسمية بحجم ثابت ومحدد */}
      <div
        style={{ width: pxSize, height: pxSize, minWidth: pxSize, maxWidth: pxSize }}
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full p-0.5 shadow-sm",
          isOnRed ? "bg-white" : "bg-white shadow-primary-glow",
          iconSizes[size]
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/balaghni-logo.jpg"
          alt="شعار بَلِّغْنِي"
          width={pxSize}
          height={pxSize}
          className="h-full w-full rounded-full object-cover"
        />
      </div>

      {/* الكلمة العربية بَلِّغْنِي وتحتها •• BALAGHNI كما في الملصق الرسمي */}
      <div className="flex flex-col leading-none">
        <span
          className={cn(
            "font-bold tracking-tight",
            titleSizes[size],
            isOnRed || isDark ? "text-white" : "text-balaghni-obsidian dark:text-white"
          )}
        >
          بَلِّغْنِي
        </span>

        <div
          dir="ltr"
          className="mt-0.5 inline-flex items-center gap-1 self-start"
        >
          <span className="inline-flex items-center gap-0.5">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isOnRed ? "bg-white" : "bg-primary"
              )}
            />
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isOnRed ? "bg-white" : "bg-primary"
              )}
            />
          </span>
          <span
            className={cn(
              "font-mono text-[10px] font-extrabold tracking-wider uppercase",
              isOnRed
                ? "text-white/95"
                : isDark
                ? "text-white/90"
                : "text-balaghni-obsidian dark:text-white"
            )}
          >
            BALAGHNI
          </span>
        </div>

        {showTagline && (
          <span
            className={cn(
              "mt-1 text-[11px] font-semibold",
              isOnRed
                ? "text-white/90"
                : isDark
                ? "text-white/70"
                : "text-muted-foreground"
            )}
          >
            امسح للتواصل مع صاحب السيارة
          </span>
        )}
      </div>
    </div>
  );
}
