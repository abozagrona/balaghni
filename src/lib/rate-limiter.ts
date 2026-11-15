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
 * استخراج عنوان IP الحقيقي للعميل مع منع التزوير عبر الترويسات الخارجية
 */
export function getClientIp(req: NextRequest | Request): string {
  const headers = req.headers;

  const sanitizeIp = (raw: string | null): string | null => {
    if (!raw) return null;
    const candidate = raw.split(",")[0].trim();
    if (!candidate || candidate.length > 64) return null;
    if (!/^[0-9a-fA-F.:]+$/.test(candidate)) return null;
    return candidate;
  };

  // في بيئة Vercel والبروكسيات العكسية الموثوقة، x-real-ip و x-forwarded-for يتم ضبطهما من المنصة
  const xRealIp = sanitizeIp(headers.get("x-real-ip"));
  if (xRealIp) return xRealIp;

  const xForwardedFor = sanitizeIp(headers.get("x-forwarded-for"));
  if (xForwardedFor) return xForwardedFor;

  const cfIp = sanitizeIp(headers.get("cf-connecting-ip"));
  if (cfIp) return cfIp;

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

// ============================================================================
// حماية فحص رمز الخدش السري (PIN) ضد التخمين (Brute-Force Protection)
// أقصى حد: 5 محاولات خاطئة لنفس الملصق خلال 15 دقيقة
// ============================================================================

export const PIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const PIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 دقيقة

const pinFailureStore = new Map<string, RateLimitRecord>();

export function checkPinRateLimit(
  tagCode: string,
  ip: string = "127.0.0.1"
): {
  allowed: boolean;
  remaining: number;
  remainingAttempts: number;
  resetMs: number;
  retryAfterSeconds: number;
  reason?: string;
} {
  const now = Date.now();
  const windowStart = now - PIN_RATE_LIMIT_WINDOW_MS;
  const keys = [`tag:${tagCode.toUpperCase().trim()}`];
  if (ip && ip !== "127.0.0.1") {
    keys.push(`pin_ip:${ip.trim()}:${tagCode.toUpperCase().trim()}`);
  }

  for (const key of keys) {
    const record = pinFailureStore.get(key) || { timestamps: [] };
    record.timestamps = record.timestamps.filter((t) => t > windowStart);
    pinFailureStore.set(key, record);

    if (record.timestamps.length >= PIN_RATE_LIMIT_MAX_ATTEMPTS) {
      const oldest = record.timestamps[0];
      const resetMs = Math.max(0, oldest + PIN_RATE_LIMIT_WINDOW_MS - now);
      const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
      return {
        allowed: false,
        remaining: 0,
        remainingAttempts: 0,
        resetMs,
        retryAfterSeconds,
        reason: `تم تجاوز الحد الأقصى للمحاولات الخاطئة (${PIN_RATE_LIMIT_MAX_ATTEMPTS} محاولات). يرجى الانتظار ${Math.ceil(
          retryAfterSeconds / 60
        )} دقيقة قبل المحاولة مجدداً.`,
      };
    }
  }

  const tagRec = pinFailureStore.get(keys[0]) || { timestamps: [] };
  const remaining = Math.max(
    0,
    PIN_RATE_LIMIT_MAX_ATTEMPTS - tagRec.timestamps.length
  );
  return {
    allowed: true,
    remaining,
    remainingAttempts: remaining,
    resetMs: 0,
    retryAfterSeconds: 0,
  };
}

export function recordPinFailure(
  tagCode: string,
  ip: string = "127.0.0.1"
): { remainingAttempts: number } {
  const now = Date.now();
  const windowStart = now - PIN_RATE_LIMIT_WINDOW_MS;
  const keys = [`tag:${tagCode.toUpperCase().trim()}`];
  if (ip && ip !== "127.0.0.1") {
    keys.push(`pin_ip:${ip.trim()}:${tagCode.toUpperCase().trim()}`);
  }

  for (const key of keys) {
    const record = pinFailureStore.get(key) || { timestamps: [] };
    record.timestamps = record.timestamps.filter((t) => t > windowStart);
    record.timestamps.push(now);
    pinFailureStore.set(key, record);
  }

  const tagRec = pinFailureStore.get(keys[0]) || { timestamps: [] };
  return {
    remainingAttempts: Math.max(
      0,
      PIN_RATE_LIMIT_MAX_ATTEMPTS - tagRec.timestamps.length
    ),
  };
}

export function clearPinFailures(
  tagCode: string,
  ip: string = "127.0.0.1"
): void {
  pinFailureStore.delete(`tag:${tagCode.toUpperCase().trim()}`);
  if (ip && ip !== "127.0.0.1") {
    pinFailureStore.delete(`pin_ip:${ip.trim()}:${tagCode.toUpperCase().trim()}`);
  }
}

// ============================================================================
// حماية مسارات الطلبات وتفعيل الملصقات ضد استنزاف المخزون والرسائل
// أقصى حد: 3 طلبات لكل 30 دقيقة لكل رقم هاتف أو عنوان اتصال (IP)
// ============================================================================

export const ORDER_RATE_LIMIT_MAX = 3;
export const ORDER_RATE_LIMIT_WINDOW_MS = 30 * 60 * 1000; // 30 دقيقة

const orderRateStore = new Map<string, RateLimitRecord>();

export function checkOrderRateLimit(
  phone: string,
  ip: string = "127.0.0.1"
): {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
  reason?: string;
} {
  const now = Date.now();
  const windowStart = now - ORDER_RATE_LIMIT_WINDOW_MS;
  const cleanPhone = phone.replace(/\D/g, "");
  const keys: string[] = [];

  if (cleanPhone) {
    keys.push(`ord_phone:${cleanPhone}`);
  }
  if (ip && ip !== "127.0.0.1") {
    keys.push(`ord_ip:${ip.trim()}`);
  }

  for (const key of keys) {
    const record = orderRateStore.get(key) || { timestamps: [] };
    record.timestamps = record.timestamps.filter((t) => t > windowStart);
    orderRateStore.set(key, record);

    if (record.timestamps.length >= ORDER_RATE_LIMIT_MAX) {
      const oldest = record.timestamps[0];
      const resetMs = Math.max(0, oldest + ORDER_RATE_LIMIT_WINDOW_MS - now);
      const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
      return {
        allowed: false,
        remaining: 0,
        resetMs,
        retryAfterSeconds,
        reason: `تم تجاوز الحد الأقصى للطلبات المتتالية. يرجى الانتظار ${Math.ceil(
          retryAfterSeconds / 60
        )} دقيقة والمحاولة مجدداً.`,
      };
    }
  }

  return {
    allowed: true,
    remaining: ORDER_RATE_LIMIT_MAX,
    resetMs: 0,
    retryAfterSeconds: 0,
  };
}

export function recordOrderAttempt(
  phone: string,
  ip: string = "127.0.0.1"
): void {
  const now = Date.now();
  const windowStart = now - ORDER_RATE_LIMIT_WINDOW_MS;
  const cleanPhone = phone.replace(/\D/g, "");
  const keys: string[] = [];

  if (cleanPhone) {
    keys.push(`ord_phone:${cleanPhone}`);
  }
  if (ip && ip !== "127.0.0.1") {
    keys.push(`ord_ip:${ip.trim()}`);
  }

  for (const key of keys) {
    const record = orderRateStore.get(key) || { timestamps: [] };
    record.timestamps = record.timestamps.filter((t) => t > windowStart);
    record.timestamps.push(now);
    orderRateStore.set(key, record);
  }
}

// ============================================================================
// حماية مسار إرسال البلاغات الكلي لكل عنوان اتصال (IP) لمنع استنزاف رصيد واتساب/SMS
// أقصى حد: 5 بلاغات لكل 15 دقيقة من نفس عنوان الـ IP عبر جميع الملصقات
// ============================================================================

export const REPORT_IP_RATE_LIMIT_MAX = 5;
export const REPORT_IP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 دقيقة

const reportIpRateStore = new Map<string, RateLimitRecord>();

export function checkReportIpRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
  reason?: string;
} {
  const now = Date.now();
  const windowStart = now - REPORT_IP_RATE_LIMIT_WINDOW_MS;
  const key = `rep_ip:${(ip || "127.0.0.1").trim()}`;

  const record = reportIpRateStore.get(key) || { timestamps: [] };
  record.timestamps = record.timestamps.filter((t) => t > windowStart);
  reportIpRateStore.set(key, record);

  if (record.timestamps.length >= REPORT_IP_RATE_LIMIT_MAX) {
    const oldest = record.timestamps[0];
    const resetMs = Math.max(0, oldest + REPORT_IP_RATE_LIMIT_WINDOW_MS - now);
    const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
    return {
      allowed: false,
      remaining: 0,
      resetMs,
      retryAfterSeconds,
      reason: `تم تجاوز الحد الأقصى لإرسال البلاغات المتتالية من جهازك. يرجى الانتظار ${Math.ceil(
        retryAfterSeconds / 60
      )} دقائق قبل إرسال بلاغ جديد.`,
    };
  }

  return {
    allowed: true,
    remaining: REPORT_IP_RATE_LIMIT_MAX - record.timestamps.length,
    resetMs: 0,
    retryAfterSeconds: 0,
  };
}

export function recordReportIpAttempt(ip: string): void {
  const now = Date.now();
  const windowStart = now - REPORT_IP_RATE_LIMIT_WINDOW_MS;
  const key = `rep_ip:${(ip || "127.0.0.1").trim()}`;
  const record = reportIpRateStore.get(key) || { timestamps: [] };
  record.timestamps = record.timestamps.filter((t) => t > windowStart);
  record.timestamps.push(now);
  reportIpRateStore.set(key, record);
}

// ============================================================================
// حماية مسارات مفاتيح المرور الحيوية (WebAuthn Passkeys) ضد الإغراق والتخمين
// أقصى حد: 10 محاولات لكل 10 دقائق لكل عنوان اتصال (IP)
// ============================================================================

export const PASSKEY_RATE_LIMIT_MAX = 10;
export const PASSKEY_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 دقائق

const passkeyRateStore = new Map<string, RateLimitRecord>();

export function checkPasskeyRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
  reason?: string;
} {
  const now = Date.now();
  const windowStart = now - PASSKEY_RATE_LIMIT_WINDOW_MS;
  const key = `pk_ip:${(ip || "127.0.0.1").trim()}`;

  const record = passkeyRateStore.get(key) || { timestamps: [] };
  record.timestamps = record.timestamps.filter((t) => t > windowStart);
  passkeyRateStore.set(key, record);

  if (record.timestamps.length >= PASSKEY_RATE_LIMIT_MAX) {
    const oldest = record.timestamps[0];
    const resetMs = Math.max(0, oldest + PASSKEY_RATE_LIMIT_WINDOW_MS - now);
    const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
    return {
      allowed: false,
      remaining: 0,
      resetMs,
      retryAfterSeconds,
      reason: `تم تجاوز الحد الأقصى لمحاولات التحقق بمفتاح المرور. يرجى الانتظار ${Math.ceil(
        retryAfterSeconds / 60
      )} دقائق أو الدخول عبر رمز التحقق.`,
    };
  }

  return {
    allowed: true,
    remaining: PASSKEY_RATE_LIMIT_MAX - record.timestamps.length,
    resetMs: 0,
    retryAfterSeconds: 0,
  };
}

export function recordPasskeyAttempt(ip: string): void {
  const now = Date.now();
  const windowStart = now - PASSKEY_RATE_LIMIT_WINDOW_MS;
  const key = `pk_ip:${(ip || "127.0.0.1").trim()}`;
  const record = passkeyRateStore.get(key) || { timestamps: [] };
  record.timestamps = record.timestamps.filter((t) => t > windowStart);
  record.timestamps.push(now);
  passkeyRateStore.set(key, record);
}


