import net from "node:net";
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { formatBalaghniTagCode, formatFullLibyaE164 } from "@/lib/utils";

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

function parseValidCanonicalIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let candidate = String(raw).split(",")[0].trim();
  if (!candidate || candidate.length > 64) return null;

  // إزالة الأقواس المربعة في IPv6 مثل [2001:db8::1] أو [::1]:3000
  if (candidate.startsWith("[")) {
    const closeIdx = candidate.indexOf("]");
    if (closeIdx > 1) {
      candidate = candidate.slice(1, closeIdx);
    }
  }

  // إزالة معرف المنطقة إن وجد (%eth0)
  const zoneIdx = candidate.indexOf("%");
  if (zoneIdx > 0) {
    candidate = candidate.slice(0, zoneIdx);
  }

  candidate = candidate.trim().toLowerCase();
  if (!candidate || !/^[0-9a-f.:]+$/.test(candidate)) return null;

  if (candidate.startsWith("::ffff:")) {
    const mappedV4 = candidate.slice("::ffff:".length);
    if (net.isIPv4(mappedV4)) {
      return mappedV4;
    }
  }

  if (net.isIPv4(candidate)) {
    return candidate;
  }

  if (net.isIPv6(candidate)) {
    try {
      const normalizedV6 = new URL(`http://[${candidate}]`).hostname
        .slice(1, -1)
        .toLowerCase();
      // تحويل ::ffff:c000:201 (تمثيل سداسي عشري لـ IPv4-mapped IPv6) إلى صيغة IPv4 النقطية الموحدة
      const mappedHexMatch = normalizedV6.match(
        /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/
      );
      if (mappedHexMatch) {
        const hi = parseInt(mappedHexMatch[1], 16);
        const lo = parseInt(mappedHexMatch[2], 16);
        return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      }
      return normalizedV6;
    } catch {
      return candidate;
    }
  }

  return null;
}

/**
 * استخراج وتطبيع عنوان IP الحقيقي للعميل مع منع التزوير عبر الترويسات القابلة للتلاعب:
 * - على Vercel: يعتمد حصرياً على x-vercel-forwarded-for ثم x-real-ip التي تضبطها حافة Vercel.
 * - في الإنتاج خارج Vercel: لا يثق بـ x-real-ip أو x-forwarded-for إلا عند تفعيل TRUST_PROXY_HEADERS="true" صراحةً.
 * - في التطوير والاختبار المحلي: يقبل x-vercel-forwarded-for ثم x-real-ip ثم x-forwarded-for.
 * - لا يثق أبداً بترويسة cf-connecting-ip أو x-client-ip القابلة للتزوير المباشر.
 * - يطبق canonicalizeRateIp دائماً لتوحيد IPv4 و IPv6 و IPv4-mapped IPv6 في جميع المسارات.
 */
export function getClientIp(req: NextRequest | Request): string {
  const headers = req.headers;
  const isVercel =
    process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
  const isProduction = process.env.NODE_ENV === "production";
  const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS === "true";

  if (isVercel) {
    const vercelIp =
      parseValidCanonicalIp(headers.get("x-vercel-forwarded-for")) ||
      parseValidCanonicalIp(headers.get("x-real-ip"));
    return vercelIp || "127.0.0.1";
  }

  if (isProduction && !trustProxyHeaders) {
    const edgeIp = parseValidCanonicalIp(headers.get("x-vercel-forwarded-for"));
    return edgeIp || "127.0.0.1";
  }

  const proxyIp =
    parseValidCanonicalIp(headers.get("x-vercel-forwarded-for")) ||
    parseValidCanonicalIp(headers.get("x-real-ip")) ||
    parseValidCanonicalIp(headers.get("x-forwarded-for"));

  return proxyIp || "127.0.0.1";
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

// ============================================================================
// الطبقة المركزية الموزّعة لتحديد المعدل (Centralized PostgreSQL / Supabase Store)
// - تطبيع موحّد (Canonical) للهواتف الليبية وأكواد الملصقات وعناوين IP لمنع تجاوز الحد
// - عملية ذرية واحدة (rl_record) لمنع سباق التزامن (TOCTOU) عبر جميع نسخ Vercel
// - سياسة صريحة عند تعطل RPC: fail_closed للمسارات الحساسة، memory_fallback للطوارئ
// ============================================================================

export type RateLimitFallbackPolicy = "fail_closed" | "memory_fallback";

export interface DistributedRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
  source: "postgres" | "memory_fallback" | "fail_closed";
  reason?: string;
}

type RateLimitRpcExecutor = (
  fnName: "rl_check" | "rl_record" | "rl_clear",
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: unknown }>;

let customRpcExecutor: RateLimitRpcExecutor | null = null;

/**
 * حقن منفّذ RPC مخصص للاختبارات الآلية فقط (اختبارات التزامن وتعطل RPC)
 */
export function setRateLimitRpcExecutorForTest(
  executor: RateLimitRpcExecutor | null
): void {
  customRpcExecutor = executor;
}

async function runRateLimitRpc(
  fnName: "rl_check" | "rl_record" | "rl_clear",
  args: Record<string, unknown>
): Promise<{ data: unknown; error: unknown }> {
  if (customRpcExecutor) {
    return customRpcExecutor(fnName, args);
  }
  return supabaseAdmin.rpc(fnName, args);
}

/**
 * تحويل الأرقام العربية/الهندية وتوحيد الرقم الليبي إلى صيغة canonical واحدة (2189XXXXXXXX)
 * يمنع تجاوز الحد بتبديل +21891 / 0021891 / 091 / 91 / الشرطات والمسافات
 */
export function canonicalizeRatePhone(raw: string): string {
  const arabicMapped = String(raw || "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .trim();
  if (!arabicMapped) return "";

  const e164 = formatFullLibyaE164(arabicMapped);
  if (e164) {
    return e164.replace(/\D/g, "");
  }

  let digits = arabicMapped.replace(/\D/g, "");
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("09") && digits.length === 10) {
    digits = `218${digits.slice(1)}`;
  } else if (digits.startsWith("9") && digits.length === 9) {
    digits = `218${digits}`;
  }
  return digits;
}

/**
 * توحيد كود الملصق أو مفتاح الـ PIN (يمنع تجاوز الحد بحالة الأحرف أو المسافات أو الشرطات)
 */
export function canonicalizeRateTagCode(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";

  // دعم المفاتيح المركّبة مثل login_phone:091... أو vendor_phone:+21891...
  if (trimmed.includes(":")) {
    const idx = trimmed.indexOf(":");
    const prefix = trimmed.slice(0, idx).toLowerCase().trim();
    const rest = trimmed.slice(idx + 1).trim();
    if (prefix.includes("phone")) {
      const canonPhone = canonicalizeRatePhone(rest);
      return `${prefix}:${canonPhone || rest.toLowerCase()}`;
    }
    return `${prefix}:${rest.toUpperCase().replace(/\s+/g, "")}`;
  }

  const formatted = formatBalaghniTagCode(trimmed);
  if (formatted) return formatted;
  return trimmed.toUpperCase().replace(/\s+/g, "");
}

/**
 * توحيد عنوان الـ IP (IPv4، IPv6 المضغوط/المفكوك، و IPv4-mapped IPv6 مثل ::ffff:192.0.2.1 أو ::ffff:c000:201)
 */
export function canonicalizeRateIp(raw: string): string {
  const parsed = parseValidCanonicalIp(raw);
  if (parsed) return parsed;
  const fallback = String(raw || "127.0.0.1")
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, "");
  return fallback || "127.0.0.1";
}

/**
 * توحيد معرّف المشرف لحدود المعدل (admin:auth:id):
 * - إذا كان رقم هاتف ليبي بأي صيغة (091 / +21891 / 0021891 / أرقام عربية) يُطبّع إلى 2189XXXXXXXX.
 * - إذا غاب المعرّف في passkey_login يُستخدم credentialId المطبّع لمنع تجاوز الحد بحذف identifier.
 */
export function canonicalizeAdminRateIdentifier(
  rawIdentifier: unknown,
  rawCredentialId?: unknown
): string {
  const trimmedId = String(rawIdentifier || "").trim();
  if (trimmedId) {
    const phoneDigits = canonicalizeRatePhone(trimmedId);
    if (
      phoneDigits.length >= 9 &&
      /^[\d+\s\-().٠-٩۰-۹]+$/.test(trimmedId)
    ) {
      return phoneDigits;
    }
    return trimmedId.toLowerCase();
  }

  const trimmedCred = String(rawCredentialId || "").trim().toLowerCase();
  if (trimmedCred) {
    return `cred:${trimmedCred}`;
  }

  return "";
}

function normalizeRateLimitRpcRow(data: unknown): {
  allowed: boolean;
  remaining: number;
  resetMs: number;
} | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  if (typeof rec.allowed !== "boolean") return null;
  return {
    allowed: rec.allowed,
    remaining: typeof rec.remaining === "number" ? rec.remaining : 0,
    resetMs:
      typeof rec.reset_ms === "number"
        ? rec.reset_ms
        : Number(rec.reset_ms || 0),
  };
}

/**
 * فحص حد مركزي لمفتاح واحد عبر Supabase RPC (rl_check)
 */
export async function checkDistributedKeyLimit(
  rateKey: string,
  maxAttempts: number,
  windowMs: number
): Promise<DistributedRateLimitResult | null> {
  try {
    const { data, error } = await runRateLimitRpc("rl_check", {
      p_key: rateKey,
      p_max_attempts: maxAttempts,
      p_window_ms: windowMs,
    });
    if (error) return null;
    const parsed = normalizeRateLimitRpcRow(data);
    if (!parsed) return null;
    return {
      allowed: parsed.allowed,
      remaining: parsed.remaining,
      resetMs: parsed.resetMs,
      retryAfterSeconds: parsed.allowed
        ? 0
        : Math.max(1, Math.ceil(parsed.resetMs / 1000)),
      source: "postgres",
    };
  } catch {
    return null;
  }
}

/**
 * تسجيل محاولة ذرية في المخزن المركزي عبر Supabase RPC (rl_record)
 */
export async function recordDistributedKeyAttempt(
  rateKey: string,
  maxAttempts: number,
  windowMs: number
): Promise<DistributedRateLimitResult | null> {
  try {
    const { data, error } = await runRateLimitRpc("rl_record", {
      p_key: rateKey,
      p_max_attempts: maxAttempts,
      p_window_ms: windowMs,
    });
    if (error) return null;
    const parsed = normalizeRateLimitRpcRow(data);
    if (!parsed) return null;
    return {
      allowed: parsed.allowed,
      remaining: parsed.remaining,
      resetMs: parsed.resetMs,
      retryAfterSeconds: parsed.allowed
        ? 0
        : Math.max(1, Math.ceil(parsed.resetMs / 1000)),
      source: "postgres",
    };
  } catch {
    return null;
  }
}

/**
 * مسح مفتاح من المخزن المركزي عبر Supabase RPC (rl_clear)
 */
export async function clearDistributedKey(rateKey: string): Promise<void> {
  try {
    await runRateLimitRpc("rl_clear", { p_key: rateKey });
  } catch {
    // ignore fallback
  }
}

const genericMemoryStore = new Map<string, RateLimitRecord>();

/**
 * مسح مخزن الذاكرة المؤقت (للاختبارات فقط)
 */
export function resetMemoryRateLimitStoresForTest(): void {
  genericMemoryStore.clear();
  rateLimitStore.clear();
  pinFailureStore.clear();
  orderRateStore.clear();
  reportIpRateStore.clear();
  passkeyRateStore.clear();
}

/**
 * عملية ذرية واحدة: فحص + تسجيل الطلب في PostgreSQL عبر rl_record
 * وتطبيق سياسة fail_closed للمسارات الحساسة أو memory_fallback للبلاغات الطارئة عند تعطل RPC
 */
export async function consumeDistributedRateLimit(
  scope: string,
  identifier: string,
  maxAttempts: number,
  windowMs: number,
  fallbackPolicy: RateLimitFallbackPolicy = "fail_closed"
): Promise<DistributedRateLimitResult> {
  const safeKey = `${scope}:${identifier.trim().toLowerCase()}`;
  const dbRes = await recordDistributedKeyAttempt(safeKey, maxAttempts, windowMs);
  if (dbRes) return dbRes;

  if (fallbackPolicy === "fail_closed") {
    return {
      allowed: false,
      remaining: 0,
      resetMs: 30_000,
      retryAfterSeconds: 30,
      source: "fail_closed",
      reason:
        "خدمة التحقق الأمني غير متاحة مؤقتاً. يرجى المحاولة مجدداً بعد 30 ثانية.",
    };
  }

  // Fallback محلي مسموح فقط للمسارات الطارئة (مثل بلاغات المركبات /api/notify)
  const now = Date.now();
  const windowStart = now - windowMs;
  const rec = genericMemoryStore.get(safeKey) || { timestamps: [] };
  rec.timestamps = rec.timestamps.filter((t) => t > windowStart);
  rec.timestamps.push(now);
  genericMemoryStore.set(safeKey, rec);

  if (rec.timestamps.length > maxAttempts) {
    const oldest = rec.timestamps[0];
    const resetMs = Math.max(0, oldest + windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      resetMs,
      retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
      source: "memory_fallback",
    };
  }
  return {
    allowed: true,
    remaining: Math.max(0, maxAttempts - rec.timestamps.length),
    resetMs: 0,
    retryAfterSeconds: 0,
    source: "memory_fallback",
  };
}

// --- 1. OTP Atomic Distributed Consumer (Fail-Closed) ---
export async function consumeOtpRateLimitAsync(
  phone: string,
  ip: string
): Promise<{
  allowed: boolean;
  remaining: number;
  resetMs: number;
  limitType?: "phone" | "ip" | "service_unavailable";
  source: "postgres" | "memory_fallback" | "fail_closed";
  reason?: string;
}> {
  const canonPhone = canonicalizeRatePhone(phone);
  const canonIp = canonicalizeRateIp(ip);

  if (canonPhone) {
    const phoneRes = await consumeDistributedRateLimit(
      "otp:phone",
      canonPhone,
      OTP_RATE_LIMIT_MAX_REQUESTS,
      OTP_RATE_LIMIT_WINDOW_MS,
      "fail_closed"
    );
    if (!phoneRes.allowed) {
      return {
        allowed: false,
        remaining: 0,
        resetMs: phoneRes.resetMs,
        limitType:
          phoneRes.source === "fail_closed" ? "service_unavailable" : "phone",
        source: phoneRes.source,
        reason: phoneRes.reason,
      };
    }
  }

  if (canonIp && canonIp !== "127.0.0.1") {
    const ipRes = await consumeDistributedRateLimit(
      "otp:ip",
      canonIp,
      OTP_RATE_LIMIT_MAX_REQUESTS,
      OTP_RATE_LIMIT_WINDOW_MS,
      "fail_closed"
    );
    if (!ipRes.allowed) {
      return {
        allowed: false,
        remaining: 0,
        resetMs: ipRes.resetMs,
        limitType:
          ipRes.source === "fail_closed" ? "service_unavailable" : "ip",
        source: ipRes.source,
        reason: ipRes.reason,
      };
    }
    return {
      allowed: true,
      remaining: ipRes.remaining,
      resetMs: 0,
      source: ipRes.source,
    };
  }

  return {
    allowed: true,
    remaining: OTP_RATE_LIMIT_MAX_REQUESTS,
    resetMs: 0,
    source: "postgres",
  };
}

export async function checkOtpRateLimitAsync(
  phone: string,
  ip: string
): Promise<{
  allowed: boolean;
  remaining: number;
  resetMs: number;
  limitType?: "phone" | "ip" | "service_unavailable";
  reason?: string;
}> {
  return consumeOtpRateLimitAsync(phone, ip);
}

export async function recordOtpAttemptAsync(_phone: string, _ip: string): Promise<void> {
  // تم التسجيل ذرياً داخل consumeOtpRateLimitAsync — تبقى الدالة للتوافق الخلفي دون مضاعفة العداد
}

// --- 2. PIN Brute-Force Distributed Wrappers (Fail-Closed on DB outage) ---
export async function checkPinRateLimitAsync(
  tagCode: string,
  ip: string = "127.0.0.1"
): Promise<{
  allowed: boolean;
  remaining: number;
  remainingAttempts: number;
  resetMs: number;
  retryAfterSeconds: number;
  source?: "postgres" | "fail_closed";
  reason?: string;
}> {
  const normTag = canonicalizeRateTagCode(tagCode);
  const canonIp = canonicalizeRateIp(ip);
  const keys = [`pin:tag:${normTag}`];
  if (canonIp && canonIp !== "127.0.0.1") {
    keys.push(`pin:ip:${canonIp}:${normTag}`);
  }

  let minRemaining = PIN_RATE_LIMIT_MAX_ATTEMPTS;

  for (const key of keys) {
    const dbRes = await checkDistributedKeyLimit(
      key,
      PIN_RATE_LIMIT_MAX_ATTEMPTS,
      PIN_RATE_LIMIT_WINDOW_MS
    );
    if (!dbRes) {
      return {
        allowed: false,
        remaining: 0,
        remainingAttempts: 0,
        resetMs: 30_000,
        retryAfterSeconds: 30,
        source: "fail_closed",
        reason:
          "خدمة التحقق الأمني من رمز المرور غير متاحة مؤقتاً. يرجى المحاولة بعد 30 ثانية.",
      };
    }
    minRemaining = Math.min(minRemaining, dbRes.remaining);
    if (!dbRes.allowed) {
      return {
        allowed: false,
        remaining: 0,
        remainingAttempts: 0,
        resetMs: dbRes.resetMs,
        retryAfterSeconds: dbRes.retryAfterSeconds,
        source: "postgres",
        reason: `تم تجاوز الحد الأقصى للمحاولات الخاطئة (${PIN_RATE_LIMIT_MAX_ATTEMPTS} محاولات). يرجى الانتظار ${Math.ceil(
          dbRes.retryAfterSeconds / 60
        )} دقيقة قبل المحاولة مجدداً.`,
      };
    }
  }

  return {
    allowed: true,
    remaining: minRemaining,
    remainingAttempts: minRemaining,
    resetMs: 0,
    retryAfterSeconds: 0,
    source: "postgres",
  };
}

export async function recordPinFailureAsync(
  tagCode: string,
  ip: string = "127.0.0.1"
): Promise<{ remainingAttempts: number }> {
  const normTag = canonicalizeRateTagCode(tagCode);
  const canonIp = canonicalizeRateIp(ip);
  const local = recordPinFailure(normTag, canonIp);
  const tagDb = await recordDistributedKeyAttempt(
    `pin:tag:${normTag}`,
    PIN_RATE_LIMIT_MAX_ATTEMPTS,
    PIN_RATE_LIMIT_WINDOW_MS
  );
  if (canonIp && canonIp !== "127.0.0.1") {
    await recordDistributedKeyAttempt(
      `pin:ip:${canonIp}:${normTag}`,
      PIN_RATE_LIMIT_MAX_ATTEMPTS,
      PIN_RATE_LIMIT_WINDOW_MS
    );
  }
  return {
    remainingAttempts: tagDb ? tagDb.remaining : local.remainingAttempts,
  };
}

export async function clearPinFailuresAsync(
  tagCode: string,
  ip: string = "127.0.0.1"
): Promise<void> {
  const normTag = canonicalizeRateTagCode(tagCode);
  const canonIp = canonicalizeRateIp(ip);
  clearPinFailures(normTag, canonIp);
  const ops: Promise<unknown>[] = [clearDistributedKey(`pin:tag:${normTag}`)];
  if (canonIp && canonIp !== "127.0.0.1") {
    ops.push(clearDistributedKey(`pin:ip:${canonIp}:${normTag}`));
  }
  await Promise.allSettled(ops);
}

// --- 3. Order Atomic Distributed Consumer (Fail-Closed) ---
export async function consumeOrderRateLimitAsync(
  phone: string,
  ip: string = "127.0.0.1"
): Promise<{
  allowed: boolean;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
  source: "postgres" | "memory_fallback" | "fail_closed";
  reason?: string;
}> {
  const canonPhone = canonicalizeRatePhone(phone);
  const canonIp = canonicalizeRateIp(ip);
  const checks: Array<{ scope: string; id: string }> = [];
  if (canonPhone) checks.push({ scope: "ord:phone", id: canonPhone });
  if (canonIp && canonIp !== "127.0.0.1") checks.push({ scope: "ord:ip", id: canonIp });

  let minRemaining = ORDER_RATE_LIMIT_MAX;
  for (const item of checks) {
    const res = await consumeDistributedRateLimit(
      item.scope,
      item.id,
      ORDER_RATE_LIMIT_MAX,
      ORDER_RATE_LIMIT_WINDOW_MS,
      "fail_closed"
    );
    if (!res.allowed) {
      return {
        allowed: false,
        remaining: 0,
        resetMs: res.resetMs,
        retryAfterSeconds: res.retryAfterSeconds,
        source: res.source,
        reason:
          res.reason ||
          `تم تجاوز الحد الأقصى للطلبات المتتالية. يرجى الانتظار ${Math.ceil(
            res.retryAfterSeconds / 60
          )} دقيقة والمحاولة مجدداً.`,
      };
    }
    minRemaining = Math.min(minRemaining, res.remaining);
  }

  return {
    allowed: true,
    remaining: minRemaining,
    resetMs: 0,
    retryAfterSeconds: 0,
    source: "postgres",
  };
}

export async function checkOrderRateLimitAsync(
  phone: string,
  ip: string = "127.0.0.1"
) {
  return consumeOrderRateLimitAsync(phone, ip);
}

export async function recordOrderAttemptAsync(
  _phone: string,
  _ip: string = "127.0.0.1"
): Promise<void> {
  // تم التسجيل ذرياً داخل consumeOrderRateLimitAsync — بدون مضاعفة العداد
}

// --- 4. Emergency Report IP Atomic Consumer (Memory Fallback / Fail-Soft) ---
export async function consumeReportIpRateLimitAsync(ip: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
  source: "postgres" | "memory_fallback" | "fail_closed";
  reason?: string;
}> {
  const canonIp = canonicalizeRateIp(ip);
  const res = await consumeDistributedRateLimit(
    "rep:ip",
    canonIp,
    REPORT_IP_RATE_LIMIT_MAX,
    REPORT_IP_RATE_LIMIT_WINDOW_MS,
    "memory_fallback"
  );
  if (!res.allowed) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: res.resetMs,
      retryAfterSeconds: res.retryAfterSeconds,
      source: res.source,
      reason: `تم تجاوز الحد الأقصى لإرسال البلاغات المتتالية من جهازك. يرجى الانتظار ${Math.ceil(
        res.retryAfterSeconds / 60
      )} دقائق قبل إرسال بلاغ جديد.`,
    };
  }
  return {
    allowed: true,
    remaining: res.remaining,
    resetMs: 0,
    retryAfterSeconds: 0,
    source: res.source,
  };
}

export async function checkReportIpRateLimitAsync(ip: string) {
  return consumeReportIpRateLimitAsync(ip);
}

export async function recordReportIpAttemptAsync(_ip: string): Promise<void> {
  // تم التسجيل ذرياً داخل consumeReportIpRateLimitAsync — بدون مضاعفة العداد
}

// --- 5. Passkey Atomic Consumer (Fail-Closed) ---
export async function consumePasskeyRateLimitAsync(ip: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
  source: "postgres" | "memory_fallback" | "fail_closed";
  reason?: string;
}> {
  const canonIp = canonicalizeRateIp(ip);
  const res = await consumeDistributedRateLimit(
    "pk:ip",
    canonIp,
    PASSKEY_RATE_LIMIT_MAX,
    PASSKEY_RATE_LIMIT_WINDOW_MS,
    "fail_closed"
  );
  if (!res.allowed) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: res.resetMs,
      retryAfterSeconds: res.retryAfterSeconds,
      source: res.source,
      reason:
        res.reason ||
        `تم تجاوز الحد الأقصى لمحاولات التحقق بمفتاح المرور. يرجى الانتظار ${Math.ceil(
          res.retryAfterSeconds / 60
        )} دقائق أو الدخول عبر رمز التحقق.`,
    };
  }
  return {
    allowed: true,
    remaining: res.remaining,
    resetMs: 0,
    retryAfterSeconds: 0,
    source: res.source,
  };
}

export async function checkPasskeyRateLimitAsync(ip: string) {
  return consumePasskeyRateLimitAsync(ip);
}

export async function recordPasskeyAttemptAsync(_ip: string): Promise<void> {
  // تم التسجيل ذرياً داخل consumePasskeyRateLimitAsync — بدون مضاعفة العداد
}
