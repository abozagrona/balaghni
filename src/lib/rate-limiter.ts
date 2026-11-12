import { NextRequest } from "next/server";

// ============================================================================
// حماية مسارات إرسال الرموز ضد الإغراق والاستنزاف (Rate Limiting)
// أقصى حد: 3 محاولات لكل 10 دقائق لنفس رقم الهاتف ونفس عنوان الـ IP
// ============================================================================

export const OTP_RATE_LIMIT_MAX_REQUESTS = 3;
export const OTP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 دقائق

interface RateLimitRecord {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitRecord>();

/**
 * استخراج عنوان IP الحقيقي للعميل مع دعم Vercel و Cloudflare والبروكسيات
 */
export function getClientIp(req: NextRequest | Request): string {
  const headers = req.headers;

  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp && cfIp.trim()) return cfIp.trim();

  const xRealIp = headers.get("x-real-ip");
  if (xRealIp && xRealIp.trim()) return xRealIp.trim();

  const xForwardedFor = headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const first = xForwardedFor.split(",")[0].trim();
    if (first) return first;
  }

  return "127.0.0.1";
}

/**
 * فحص ما إذا كان المفتاح (رقم هاتف أو عنوان IP) قد تجاوز حد الطلبات المسموح
 */
function checkKeyLimit(key: string): {
  allowed: boolean;
  remaining: number;
  resetMs: number;
} {
  const now = Date.now();
  const windowStart = now - OTP_RATE_LIMIT_WINDOW_MS;

  const record = rateLimitStore.get(key) || { timestamps: [] };

  // تنظيف السجلات الأقدم من 10 دقائق
  record.timestamps = record.timestamps.filter((t) => t > windowStart);

  if (record.timestamps.length >= OTP_RATE_LIMIT_MAX_REQUESTS) {
    const oldest = record.timestamps[0];
    const resetMs = Math.max(0, oldest + OTP_RATE_LIMIT_WINDOW_MS - now);
    return {
      allowed: false,
      remaining: 0,
      resetMs,
    };
  }

  return {
    allowed: true,
    remaining: OTP_RATE_LIMIT_MAX_REQUESTS - record.timestamps.length,
    resetMs: 0,
  };
}

/**
 * تسجيل محاولة طلب رمز التحقق للمفتاح
 */
function recordKeyAttempt(key: string): void {
  const now = Date.now();
  const windowStart = now - OTP_RATE_LIMIT_WINDOW_MS;

  const record = rateLimitStore.get(key) || { timestamps: [] };
  record.timestamps = record.timestamps.filter((t) => t > windowStart);
  record.timestamps.push(now);
  rateLimitStore.set(key, record);
}

/**
 * التحقق المزدوج من معدل الطلبات برقم الهاتف وعنوان IP
 */
export function checkOtpRateLimit(
  phone: string,
  ip: string
): {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  limitType?: "phone" | "ip";
} {
  const cleanPhone = phone.replace(/\D/g, "");
  const phoneKey = `phone:${cleanPhone}`;
  const ipKey = `ip:${ip.trim()}`;

  // 1. فحص حد رقم الهاتف
  if (cleanPhone) {
    const phoneCheck = checkKeyLimit(phoneKey);
    if (!phoneCheck.allowed) {
      return {
        ...phoneCheck,
        limitType: "phone",
      };
    }
  }

  // 2. فحص حد عنوان IP
  if (ip && ip !== "127.0.0.1") {
    const ipCheck = checkKeyLimit(ipKey);
    if (!ipCheck.allowed) {
      return {
        ...ipCheck,
        limitType: "ip",
      };
    }
  }

  return {
    allowed: true,
    remaining: OTP_RATE_LIMIT_MAX_REQUESTS,
    resetMs: 0,
  };
}

/**
 * تسجيل استهلاك محاولة إرسال رمز التحقق لرقم الهاتف والـ IP
 */
export function recordOtpAttempt(phone: string, ip: string): void {
  const cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone) {
    recordKeyAttempt(`phone:${cleanPhone}`);
  }
  if (ip && ip !== "127.0.0.1") {
    recordKeyAttempt(`ip:${ip.trim()}`);
  }
}
