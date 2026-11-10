"use client";

import * as React from "react";
import { cn, normalizeLibyaPhoneDigits } from "@/lib/utils";

export interface LibyaPhoneInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type"
  > {
  value: string;
  onValueChange: (digits: string) => void;
  containerClassName?: string;
}

/**
 * حقل إدخال رقم الهاتف الليبي المخصص (+218)
 * - يعرض شارة ثابتة "🇱🇾 +218" بـ اتجاه LTR
 * - يحذف الصفر الابتدائي تلقائياً (مثال: 0912345678 -> 912345678)
 * - يدعم اللصق الذكي للأرقام الدولية أو المحلية
 */
export function LibyaPhoneInput({
  value,
  onValueChange,
  className,
  containerClassName,
  disabled,
  placeholder = "91 234 5678",
  ...props
}: LibyaPhoneInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizeLibyaPhoneDigits(e.target.value);
    onValueChange(normalized);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData("text");
    if (pastedText) {
      e.preventDefault();
      onValueChange(normalizeLibyaPhoneDigits(pastedText));
    }
  };

  return (
    <div
      dir="ltr"
      className={cn(
        "flex h-12 w-full items-center overflow-hidden rounded-2xl border border-input bg-card transition-shadow focus-within:border-primary focus-within:ring-2 focus-within:ring-ring",
        disabled && "opacity-60 pointer-events-none",
        containerClassName
      )}
    >
      <span
        className="inline-flex h-full shrink-0 select-none items-center gap-1.5 border-r border-border bg-muted px-3.5 font-mono text-sm font-semibold text-foreground"
        aria-hidden="true"
      >
        <span className="text-base leading-none">🇱🇾</span>
        <span>+218</span>
      </span>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        dir="ltr"
        disabled={disabled}
        value={value}
        onChange={handleChange}
        onPaste={handlePaste}
        placeholder={placeholder}
        maxLength={9}
        className={cn(
          "h-full w-full flex-1 bg-transparent px-3.5 font-mono text-base font-medium tracking-wider text-foreground placeholder:font-sans placeholder:tracking-normal placeholder:text-[var(--placeholder)] focus:outline-none",
          className
        )}
        {...props}
      />
    </div>
  );
}
