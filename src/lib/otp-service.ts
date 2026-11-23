import net from "net";
import { formatLibyaPhoneForOtp } from "@/lib/utils";
import {
  OTP_VALIDITY_MS,
  OTP_MAX_ATTEMPTS,
  generateSecure6DigitOtp,
  generateOtpSessionSalt,
  computePhoneHmacCandidates,
  computeOtpHmac,
  verifyOtpHmacConstantTime,
  encryptOtpPayload,
  decryptOtpPayload,
} from "@/lib/otp-crypto";
import {
  RESALA_HTTP_TIMEOUT_MS,
  SMS_FALLBACK_TIMEOUT_MS,
  classifyResalaDispatchOutcome,
  createOtpSessionPending,
  activateOtpWhatsappSession,
  activateOtpSmsSession,
  cancelPendingOtpSession,
  getOpenOtpSessionForVerify,
  commitOtpVerificationAttempt,
  dispatchSmsFallbackWithAtomicClaim,
  type SmsProviderDispatchResponse,
} from "@/lib/delivery-fallback";

export { OTP_VALIDITY_MS, OTP_MAX_ATTEMPTS };

// ============================================================================
// الإعدادات وبيانات الاعتماد (Credentials & Endpoints)
// ============================================================================
export const RESALA_API_KEY =
  process.env.RESALA_API_KEY?.trim() ||
  "";

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
}

export type ValidateResalaEndpointResult =
  | { ok: true; endpoint: string; hostname: string }
  | { ok: false; error: string };

/**
 * فحص أمني دقيق ومستقل لعنوان Resala Endpoint (PART A):
 * - استخدام new URL للتحقق البنيوي الكامل بدلاً من Regex وحده.
 * - اشتراط بروتوكول https: حصراً.
 * - رفض وجود أي بيانات اعتماد (username أو password).
 * - رفض localhost والـ loopback والنطاقات المنتهية بـ .localhost أو .local.
 * - رفض عناوين IP المباشرة (IPv4 / IPv6 / Private / Link-Local / Loopback).
 * - رفض الرموز الخادعة مثل trailing-dot أو الفراغات.
 * - حظر dev.resala.ly وجميع نطاقاته الفرعية في Production قطيعاً.
 * - التحقق من النطاق بمطابقة دقيقة دون الاعتماد على مجرد اللاحقة لمنع هجمات resala.ly.attacker.example.
 * - إذا لم يتم ضبط قائمة النطاقات المعتمدة صراحةً في الإنتاج، يفشل الفحص Fail-Closed.
 */
export function validateResalaEndpointUrl(
  rawUrl: string,
  options: {
    isProduction: boolean;
    allowedHostnames?: string[];
  }
): ValidateResalaEndpointResult {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    return { ok: false, error: "Endpoint URL is empty (fail-closed)." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL structure (fail-closed)." };
  }

  // 1. بروتوكول HTTPS حصراً
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      error: `Protocol "${parsed.protocol}" is not permitted. Only "https:" is allowed (fail-closed).`,
    };
  }

  // 2. رفض بيانات الاعتماد داخل الرابط (userinfo / credentials)
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      error: "URL credentials (userinfo) are strictly prohibited (fail-closed).",
    };
  }

  // 3. رفض trailing-dot لمنع التلاعب بتفسير أسماء النطاقات (DNS trailing-dot bypass)
  if (parsed.hostname.endsWith(".")) {
    return {
      ok: false,
      error: "Trailing dot in hostname is not permitted (fail-closed).",
    };
  }

  // تطبيع اسم النطاق بأحرف صغيرة
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { ok: false, error: "Hostname is missing (fail-closed)." };
  }

  // 4. رفض localhost و loopback
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "local" ||
    hostname.endsWith(".local")
  ) {
    return {
      ok: false,
      error: "Localhost and local domains are prohibited (fail-closed).",
    };
  }

  // 5. رفض عناوين IP المباشرة (IPv4 / IPv6 / loopback / private / link-local)
  const cleanIpHost = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(cleanIpHost) !== 0) {
    return {
      ok: false,
      error: "Direct IP addresses are strictly prohibited (fail-closed).",
    };
  }

  // فحص أرقام IP المباشرة العشرية بدون نقاط
  if (/^\d+$/.test(hostname)) {
    return {
      ok: false,
      error: "Numeric IP addresses are strictly prohibited (fail-closed).",
    };
  }

  // 6. منع dev.resala.ly وجميع نطاقاته الفرعية في الإنتاج قطيعاً حتى لو وُضعت في RESALA_ENDPOINT
  const isDevResala =
    hostname === "dev.resala.ly" || hostname.endsWith(".dev.resala.ly");

  if (options.isProduction && isDevResala) {
    return {
      ok: false,
      error:
        "dev.resala.ly and its subdomains are strictly prohibited in production (fail-closed).",
    };
  }

  // 7. التحقق من النطاق المعتمد (Domain Allowlist):
  // لا يعتبر HTTPS وحده دليلاً، ولا نقبل أي نطاق عشوائي.
  // في الإنتاج: إذا لم تتوفر قائمة نطاقات معتمدة صراحة، يفشل الفحص فوراً Fail-Closed.
  const resolvedAllowed =
    options.allowedHostnames ??
    (process.env.RESALA_APPROVED_HOSTNAMES
      ? process.env.RESALA_APPROVED_HOSTNAMES.split(",")
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean)
      : options.isProduction
      ? [] // في الإنتاج: القائمة فارغة افتراضياً لعدم وجود نطاق إنتاج مؤكد رسمي في المستودع
      : ["dev.resala.ly"]); // في غير الإنتاج: dev.resala.ly معتمد للتطوير افتراضياً

  if (resolvedAllowed.length === 0) {
    return {
      ok: false,
      error:
        "No approved Resala production domain is configured. Production sending remains blocked (fail-closed).",
    };
  }

  // مطابقة تامة للنطاق (Exact match) لمنع الالتفاف باللواحق مثل resala.ly.attacker.example
  const isMatch = resolvedAllowed.some((allowed) => {
    const cleanAllowed = allowed.toLowerCase().trim();
    if (cleanAllowed.startsWith("*.")) {
      const parent = cleanAllowed.slice(2);
      return hostname.endsWith(`.${parent}`) && hostname !== parent;
    }
    return hostname === cleanAllowed;
  });

  if (!isMatch) {
    return {
      ok: false,
      error: `Hostname "${hostname}" is not in the approved Resala domain allowlist (fail-closed).`,
    };
  }

  // إعادة الرابط المقبول
  return {
    ok: true,
    endpoint: trimmed,
    hostname,
  };
}

/**
 * تحديد عنوان Resala الأساسي بشكل آمن (MED-01 + Security Hardening):
 * - في الإنتاج: RESALA_ENDPOINT إلزامي (HTTPS فقط، نطاق معتمد، Fail-Closed، لا يقرأ dev إطلاقاً).
 * - في التطوير غير الإنتاجي: يقبل RESALA_ENDPOINT أو RESALA_DEV_ENDPOINT الصريح فقط.
 */
export function resolveResalaEndpoint(options?: {
  allowedHostnames?: string[];
}): ValidateResalaEndpointResult {
  const isProd = isProductionRuntime();
  const prodEndpoint = process.env.RESALA_ENDPOINT?.trim() || "";

  if (isProd) {
    if (!prodEndpoint) {
      return {
        ok: false,
        error: "RESALA_ENDPOINT is required in production (fail-closed).",
      };
    }
    // في الإنتاج: RESALA_DEV_ENDPOINT محظور ولا يُقرأ مطلقاً
    return validateResalaEndpointUrl(prodEndpoint, {
      isProduction: true,
      allowedHostnames: options?.allowedHostnames,
    });
  }

  // في غير الإنتاج:
  const devEndpoint = process.env.RESALA_DEV_ENDPOINT?.trim() || "";
  const endpointToUse = prodEndpoint || devEndpoint;

  if (!endpointToUse) {
    return {
      ok: false,
      error: "RESALA_ENDPOINT is not configured (fail-closed).",
    };
  }

  return validateResalaEndpointUrl(endpointToUse, {
    isProduction: false,
    allowedHostnames: options?.allowedHostnames,
  });
}

function resolveEnvTemplateId(
  envKeys: string[],
  nonProdFallback = ""
): string {
  for (const key of envKeys) {
    const val = process.env[key]?.trim();
    if (val) return val;
  }
  return isProductionRuntime() ? "" : nonProdFallback;
}

function resolveTwilioStatusCallbackUrl(): string {
  const explicit = (process.env.TWILIO_WHATSAPP_STATUS_WEBHOOK_URL || "").trim();
  if (explicit && /^https:\/\//i.test(explicit)) {
    return explicit;
  }
  const base = (process.env.TWILIO_WEBHOOK_BASE_URL || "").trim().replace(/\/+$/, "");
  if (base && /^https:\/\//i.test(base)) {
    return `${base}/api/webhooks/whatsapp-status`;
  }
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://balaghni.ly")
    .trim()
    .replace(/\/+$/, "");
  return `${site}/api/webhooks/whatsapp-status`;
}

// ============================================================================
// نموذج حالة جلسة التحقق الموزّعة (Distributed OTP Session — بدون memoryStore)
// ============================================================================
export interface OtpSessionStatusView {
  phone: string; // 2189XXXXXXXX
  channel: "WHATSAPP" | "SMS";
  expiresAt: number;
  attempts: number;
  existsWhatsapp?: boolean;
  twilioMessageSid?: string;
}

/**
 * استعلام موزّع عن حالة جلسة OTP المفتوحة عبر PostgreSQL (Migration 012)
 * لا يعيد رمز OTP أو أي بيانات مشفرة مطلقاً
 */
export async function getOtpSessionAsync(
  rawPhone: string
): Promise<OtpSessionStatusView | null> {
  const phone = formatLibyaPhoneForOtp(rawPhone);
  if (!phone) return null;
  try {
    const candidates = computePhoneHmacCandidates(phone);
    const res = await getOpenOtpSessionForVerify({
      phoneHashCurrent: candidates.currentHash,
      phoneHashPrevious: candidates.previousHash,
    });
    if (!res.ok || !res.session) return null;
    const expMs = new Date(res.session.expiresAt).getTime();
    if (!Number.isFinite(expMs) || expMs <= Date.now()) return null;
    return {
      phone,
      channel: res.session.channel,
      expiresAt: expMs,
      attempts: res.session.attempts,
      existsWhatsapp: res.session.channel === "WHATSAPP",
      twilioMessageSid: res.session.twilioMessageSid || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * دالة توافقية قديمة للاختبارات — لم يعد يوجد مخزن محلي memoryStore في الإنتاج
 */
export function deleteOtpSession(_phone: string): void {
  // no-op: OTP sessions are managed atomically in PostgreSQL (public.otp_sessions)
}

export function generate6DigitOtp(): string {
  return generateSecure6DigitOtp();
}

// ============================================================================
// إرسال رمز التحقق عبر واتساب حصراً عبر Twilio WhatsApp API
// ============================================================================
export async function sendOtpViaWhatsapp(
  phone: string,
  otpCode: string
): Promise<{ ok: boolean; idMessage?: string; error?: string }> {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const twilioToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const twilioFrom = (
    process.env.TWILIO_WHATSAPP_FROM ||
    process.env.TWILIO_WHATSAPP_NUMBER ||
    ""
  ).trim();
  const messagingServiceSid = (
    process.env.TWILIO_MESSAGING_SERVICE_SID || ""
  ).trim();

  if (!twilioSid || !twilioToken || !twilioFrom || !TWILIO_CONTENT_SIDS.OTP) {
    return {
      ok: false,
      error: "Twilio WhatsApp credentials or OTP template are not configured",
    };
  }

  try {
    const authHeader = `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64")}`;
    const isOtpApproved = await isTwilioTemplateApproved(
      TWILIO_CONTENT_SIDS.OTP,
      authHeader
    );
    if (!isOtpApproved) {
      return {
        ok: false,
        error: "Twilio OTP template is not approved",
      };
    }

    const cleanPhone = phone.replace(/[^\d]/g, "");
    const fromFormatted = twilioFrom.startsWith("whatsapp:")
      ? twilioFrom
      : `whatsapp:${twilioFrom}`;
    const tplForm = new URLSearchParams();
    tplForm.set("From", fromFormatted);
    tplForm.set("To", `whatsapp:+${cleanPhone}`);
    if (messagingServiceSid) {
      tplForm.set("MessagingServiceSid", messagingServiceSid);
    }
    tplForm.set("ContentSid", TWILIO_CONTENT_SIDS.OTP);
    tplForm.set("ContentVariables", JSON.stringify({ "1": String(otpCode).trim() }));
    tplForm.set("StatusCallback", resolveTwilioStatusCallbackUrl());

    const tplRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: tplForm.toString(),
      }
    );
    const tplData = (await tplRes.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
      error_code?: number | null;
      message?: string;
    };
    if (
      tplRes.ok &&
      tplData.sid &&
      tplData.status !== "failed" &&
      tplData.status !== "undelivered" &&
      !tplData.error_code
    ) {
      return { ok: true, idMessage: tplData.sid };
    }

    return {
      ok: false,
      error:
        tplData.message ||
        `Twilio OTP send failed (status=${tplData.status || tplRes.status})`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkTwilioMessageStatus(
  messageSid: string
): Promise<"sent" | "delivered" | "read" | "failed" | "unknown"> {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const twilioToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const sid = String(messageSid || "").trim();
  if (!twilioSid || !twilioToken || !sid) return "unknown";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages/${sid}.json`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64")}`,
        },
        signal: controller.signal,
      }
    ).finally(() => clearTimeout(timeout));

    if (!res.ok) return "unknown";
    const data = (await res.json().catch(() => ({}))) as { status?: string };
    const st = String(data?.status || "").trim().toLowerCase();
    if (st === "read") return "read";
    if (st === "delivered") return "delivered";
    if (st === "sent" || st === "queued" || st === "sending") return "sent";
    if (st === "failed" || st === "undelivered") return "failed";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function formatWhatsappCaption(raw: string, maxLen = 1024): string {
  const cleaned = String(raw || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 3).trim()}...`;
}

export const TWILIO_CONTENT_SIDS = {
  get ALERT() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_ALERT"], "HXf7739f104e5c27326afef82ac2aca284");
  },
  get MEDIA_ALERT() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_MEDIA_ALERT"], "HX6edeea3060c4724a597e6e1e04c6ed55");
  },
  get VOICE_CALL() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_VOICE_CALL"], "HXf797f5d7ef9ac340c463c8ab1d1a4b48");
  },
  get REMIND() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_REMIND"], "HXb83e34284546e1ea02956643506baaa9");
  },
  get OTP() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_OTP"], "HXf5c8957fcfe89e5df2cb6ce3bca5360a");
  },
  get SUBSCRIPTION() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_SUBSCRIPTION"], "HX30f7b6cdd9149d92744c8958e1291ed7");
  },
  get DOC_REMINDER() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_DOC_REMINDER"], "HXbcd098099c61a110214d83dbbd764efa");
  },
  get WEEKLY_OVERDUE() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_WEEKLY_OVERDUE"], "HXfa7f67591e5a3fb9c18edc3c0fc828de");
  },
  get ORDER_COD() {
    return resolveEnvTemplateId(
      ["TWILIO_CONTENT_SID_ORDER_COD", "TWILIO_CONTENT_SID_ORDER"],
      "HX35243cfcff2f04a7aa7686882151788d"
    );
  },
  get ORDER() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_ORDER"], "HX35243cfcff2f04a7aa7686882151788d");
  },
  get ORDER_ACTIVATED() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_ORDER_ACTIVATED"], "HX12f9bd8e8bf04cddd41ef4ac473df2dc");
  },
  get STICKER_LINKED() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_STICKER_LINKED"], "HXb0a8ac56e004a613b6526f264ac55eb4");
  },
  get GIFT_ACTIVATED() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_GIFT_ACTIVATED"], "HXde2025741e0226f9f1835e3656480e2e");
  },
  get ADMIN_ALERT() {
    return resolveEnvTemplateId(["TWILIO_CONTENT_SID_ADMIN_ALERT"], "HX856fa5af28c8794e21a11283e2f2b719");
  },
} as const;

function sanitizeTwilioContentVariables(
  vars?: Record<string, string>
): Record<string, string> {
  if (!vars || typeof vars !== "object") return {};
  const cleaned: Record<string, string> = {};
  for (const [key, rawVal] of Object.entries(vars)) {
    const k = String(key || "").trim();
    if (!k) continue;
    const normalizedVal = String(rawVal ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    cleaned[k] = normalizedVal || "-";
  }
  return cleaned;
}

const templateApprovalMemoryCache = new Map<
  string,
  { status: string; checkedAt: number }
>();

async function isTwilioTemplateApproved(
  contentSid: string,
  authHeader: string
): Promise<boolean> {
  const sid = String(contentSid || "").trim();
  if (!sid) return false;
  const cached = templateApprovalMemoryCache.get(sid);
  const now = Date.now();
  // الكاش صالح لمدة 60 ثانية حتى يتم تفعيل القالب تلقائياً فور موافقة Meta
  if (cached && now - cached.checkedAt < 60000) {
    return cached.status === "approved";
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(
      `https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`,
      {
        headers: { Authorization: authHeader },
        signal: controller.signal,
      }
    ).finally(() => clearTimeout(timeout));
    if (!res.ok) return false;
    const data = (await res.json().catch(() => ({}))) as {
      whatsapp?: { status?: string };
    };
    const st = String(data?.whatsapp?.status || "unsubmitted")
      .trim()
      .toLowerCase();
    templateApprovalMemoryCache.set(sid, { status: st, checkedAt: now });
    return st === "approved";
  } catch {
    return false;
  }
}

export type MetaOutboundGateResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * فحص أمني صارم لعزل مزود Meta WhatsApp Cloud API:
 * - معطل افتراضياً (Disabled by default).
 * - مجرد وجود مفاتيح Meta (مثل WHATSAPP_ACCESS_TOKEN أو WHATSAPP_PHONE_NUMBER_ID) لا يكفي إطلاقاً للإرسال.
 * - ممنوع الإرسال عبر Meta في بيئة الإنتاج (Production) حالياً منعاً باتاً (Fail-Closed مبكراً قبل إنشاء Payload أو fetch).
 * - يتطلب تفعيله مستقبلاً تعيين المزود صراحة (WHATSAPP_ACTIVE_PROVIDER === "meta")،
 *   وتفعيل الميزة (ENABLE_META_WHATSAPP_PROVIDER === "true")،
 *   وموافقة المراجعة الأمنية المستقلة (META_SECURITY_REVIEW_APPROVED === "true").
 * - لا يوجد أي انتقال تلقائي (Fallback) من Twilio إلى Meta إطلاقاً.
 */
export function isMetaOutboundAllowed(): MetaOutboundGateResult {
  const activeProvider = (
    process.env.WHATSAPP_ACTIVE_PROVIDER || "twilio"
  )
    .trim()
    .toLowerCase();
  const enableMeta = (
    process.env.ENABLE_META_WHATSAPP_PROVIDER || "false"
  )
    .trim()
    .toLowerCase();
  const securityReviewApproved = (
    process.env.META_SECURITY_REVIEW_APPROVED || "false"
  )
    .trim()
    .toLowerCase();

  // 1. في بيئة الإنتاج: Meta معطل تماماً وممنوع من الإرسال (Fail-Closed)
  if (isProductionRuntime()) {
    return {
      allowed: false,
      reason:
        "Meta WhatsApp outbound provider is strictly disabled in production (fail-closed by architecture policy).",
    };
  }

  // 2. في غير الإنتاج: يجب أن تكون الإعدادات صريحة ومتعددة الطبقات وليست بمجرد وجود المفاتيح
  if (activeProvider !== "meta") {
    return {
      allowed: false,
      reason: `Meta WhatsApp outbound provider is inactive (active provider is '${activeProvider}').`,
    };
  }

  if (enableMeta !== "true") {
    return {
      allowed: false,
      reason:
        "Meta WhatsApp outbound provider is disabled by default (ENABLE_META_WHATSAPP_PROVIDER != true).",
    };
  }

  if (securityReviewApproved !== "true") {
    return {
      allowed: false,
      reason:
        "Meta WhatsApp outbound provider requires explicit independent security review approval (META_SECURITY_REVIEW_APPROVED != true).",
    };
  }

  return { allowed: true };
}

export async function sendWhatsappAlertMessage(
  phone: string,
  message: string,
  photoUrl?: string | null,
  options?: {
    verifyDelivery?: boolean;
    twilioContentSid?: string;
    twilioContentVariables?: Record<string, string>;
  }
): Promise<{
  ok: boolean;
  idMessage?: string;
  deliveryStatus?: string;
  error?: string;
}> {
  const safeCaption = formatWhatsappCaption(message, 1024);
  const trimmedPhoto = String(photoUrl || "").trim();
  const hasPhoto = /^https?:\/\//i.test(trimmedPhoto);

  const activeProvider = (
    process.env.WHATSAPP_ACTIVE_PROVIDER || "twilio"
  )
    .trim()
    .toLowerCase();

  // 1. مزود Twilio الأساسي والمعتمد (افتراضي، ولا انتقال تلقائي إلى Meta)
  if (activeProvider === "twilio") {
    const twilioSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const twilioToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    const twilioFrom = (
      process.env.TWILIO_WHATSAPP_FROM ||
      process.env.TWILIO_WHATSAPP_NUMBER ||
      ""
    ).trim();
    const messagingServiceSid = (
      process.env.TWILIO_MESSAGING_SERVICE_SID || ""
    ).trim();

    if (!twilioSid || !twilioToken || !twilioFrom) {
      return {
        ok: false,
        error: "Twilio WhatsApp credentials are not configured",
      };
    }

    try {
      const cleanPhone = phone.replace(/[^\d]/g, "");
      const fromFormatted = twilioFrom.startsWith("whatsapp:")
        ? twilioFrom
        : `whatsapp:${twilioFrom}`;
      const toFormatted = `whatsapp:+${cleanPhone}`;
      const authHeader = `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64")}`;

      // 1. محاولة الإرسال عبر القالب التفاعلي ذي الأزرار (ContentSid + ContentVariables المنظّفة بدون Body) داخل try/catch
      if (options?.twilioContentSid) {
        try {
          const isApproved = await isTwilioTemplateApproved(
            options.twilioContentSid,
            authHeader
          );
          if (!isApproved) {
            throw new Error(
              `Template ${options.twilioContentSid} is still pending Meta approval (preventing Error 63016)`
            );
          }

          const cleanVars = sanitizeTwilioContentVariables(
            options.twilioContentVariables
          );
          const tplForm = new URLSearchParams();
          tplForm.set("From", fromFormatted);
          tplForm.set("To", toFormatted);
          if (messagingServiceSid) {
            tplForm.set("MessagingServiceSid", messagingServiceSid);
          }
          tplForm.set("ContentSid", options.twilioContentSid);
          if (Object.keys(cleanVars).length > 0) {
            tplForm.set("ContentVariables", JSON.stringify(cleanVars));
          }
          tplForm.set("StatusCallback", resolveTwilioStatusCallbackUrl());

          const tplRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
            {
              method: "POST",
              headers: {
                Authorization: authHeader,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: tplForm.toString(),
            }
          );
          const tplData = (await tplRes.json().catch(() => ({}))) as {
            sid?: string;
            status?: string;
            error_code?: number | null;
            message?: string;
          };
          if (
            !tplRes.ok ||
            !tplData.sid ||
            tplData.status === "failed" ||
            tplData.status === "undelivered" ||
            tplData.error_code
          ) {
            throw new Error(
              `Twilio ContentSid errorCode=${tplData.error_code || tplRes.status} message=${tplData.message || tplData.status}`
            );
          }

          // التحقق بعد 1.8 ثانية من عدم تحول الرسالة إلى undelivered / failed (مثل خطأ 63016)
          await new Promise((r) => setTimeout(r, 1800));
          const verifyRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages/${tplData.sid}.json`,
            { headers: { Authorization: authHeader } }
          );
          const verifyJson = (await verifyRes.json().catch(() => ({}))) as {
            status?: string;
            error_code?: number | null;
            error_message?: string | null;
          };
          if (
            verifyJson.status === "failed" ||
            verifyJson.status === "undelivered" ||
            verifyJson.error_code
          ) {
            templateApprovalMemoryCache.set(options.twilioContentSid, {
              status: "pending",
              checkedAt: Date.now(),
            });
            throw new Error(
              `Twilio message ${tplData.sid} undelivered (errorCode=${verifyJson.error_code}, status=${verifyJson.status})`
            );
          }

          return { ok: true, idMessage: tplData.sid };
        } catch (tplErr) {
          const errMsg = tplErr instanceof Error ? tplErr.message : String(tplErr);
          // في الإنتاج: منع تام لإرسال Body كنص حر كبديل للقالب (Fail-Closed)
          if (isProductionRuntime()) {
            console.warn(
              `[Twilio Interactive Template Failed in Production] ${errMsg} -> Fail-Closed (no text fallback).`
            );
            return {
              ok: false,
              error: errMsg,
            };
          }
          console.warn(
            `[Twilio Interactive Template Fallback] ${errMsg} -> Switching to non-production fallback delivery.`
          );
        }
      } else if (isProductionRuntime()) {
        // في الإنتاج: غياب ContentSid يفرض Fail-Closed الفوري دون إرسال Body
        return {
          ok: false,
          error: "Twilio ContentSid is required in production (fail-closed).",
        };
      }

      // 2. إرسال النص الاحتياطي عبر Twilio (Body) عند تعذر القالب التفاعلي (في غير الإنتاج فقط)
      const form = new URLSearchParams();
      form.set("From", fromFormatted);
      form.set("To", toFormatted);
      form.set("Body", safeCaption);
      form.set("StatusCallback", resolveTwilioStatusCallbackUrl());
      if (hasPhoto) {
        form.set("MediaUrl", trimmedPhoto);
      }
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        sid?: string;
        error_code?: number | null;
        message?: string;
      };
      if (!res.ok) {
        console.error(
          `[Twilio Fallback Body Error] code=${data.error_code || res.status} msg=${data.message}`
        );
        return {
          ok: false,
          error: data.message || `Twilio error: ${res.status}`,
        };
      }
      return { ok: true, idMessage: data.sid };
    } catch (err) {
      console.error(
        `[Twilio Send Exception] ${err instanceof Error ? err.message : String(err)}`
      );
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Twilio send error",
      };
    }
  }

  // 2. تكامل اختياري مستقبلي لـ Meta WhatsApp Cloud API (معزول ومعطل افتراضياً وممنوع في الإنتاج)
  if (activeProvider === "meta") {
    // الفحص الأمني الصارم لعزل Meta: فشل مبكر (Fail-Closed) قبل قراءة المفاتيح أو بناء Payload أو استدعاء fetch
    const gate = isMetaOutboundAllowed();
    if (!gate.allowed) {
      return {
        ok: false,
        error: gate.reason,
      };
    }

    const metaToken = (
      process.env.WHATSAPP_ACCESS_TOKEN ||
      process.env.META_WHATSAPP_TOKEN ||
      ""
    ).trim();
    const metaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();

    if (!metaToken || !metaPhoneId) {
      return {
        ok: false,
        error: "Meta WhatsApp credentials are not configured",
      };
    }

    // منع قطعي إضافي لأي إرسال في الإنتاج قبل إنشاء Payload أو استدعاء fetch
    if (isProductionRuntime()) {
      return {
        ok: false,
        error:
          "Meta WhatsApp outbound provider is strictly disabled in production (fail-closed).",
      };
    }

    try {
      const cleanPhone = phone.replace(/[^\d]/g, "");
      const payload = hasPhoto
        ? {
            messaging_product: "whatsapp",
            to: cleanPhone,
            type: "image",
            image: { link: trimmedPhoto, caption: safeCaption },
          }
        : {
            messaging_product: "whatsapp",
            to: cleanPhone,
            type: "text",
            text: { body: safeCaption },
          };
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${metaPhoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${metaToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          error: data.error?.message || `Meta error: ${res.status}`,
        };
      }
      return { ok: true, idMessage: data.messages?.[0]?.id };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Meta send error",
      };
    }
  }

  return {
    ok: false,
    error: `Unsupported WhatsApp provider: ${activeProvider}`,
  };
}

function normalizeLibyanPhoneForResala(phone: string): string | null {
  let digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("00218")) digits = digits.slice(2);
  if (digits.startsWith("09") && digits.length === 10) {
    digits = `218${digits.slice(1)}`;
  } else if (digits.startsWith("9") && digits.length === 9) {
    digits = `218${digits}`;
  }
  return /^2189[1-4]\d{7}$/.test(digits) ? digits : null;
}

async function sendResalaTemplateMessage(params: {
  phone: string;
  templateId: string;
  variables: Record<string, string>;
  logLabel: string;
}): Promise<{
  ok: boolean;
  status?: number;
  id?: string;
  response?: unknown;
  error?: string;
  timedOut?: boolean;
  networkErrorCode?: string;
}> {
  const smsKey =
    process.env.RESALA_SMS_API_KEY?.trim() ||
    process.env.RESALA_API_KEY?.trim() ||
    RESALA_API_KEY;
  if (!smsKey) {
    return { ok: false, status: 400, error: "RESALA_API_KEY is not configured" };
  }

  const digits = normalizeLibyanPhoneForResala(params.phone);
  if (!digits) {
    return {
      ok: false,
      status: 400,
      error: "Invalid Libyan phone format for Resala",
    };
  }

  const resolvedEndpoint = resolveResalaEndpoint();
  if (!resolvedEndpoint.ok) {
    return { ok: false, status: 400, error: resolvedEndpoint.error };
  }

  try {
    const baseUrl = resolvedEndpoint.endpoint.replace(/\/pins.*$/, "").replace(/\/$/, "");
    const url = `${baseUrl}/messages/send-template?sms_template_id=${encodeURIComponent(
      params.templateId
    )}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RESALA_HTTP_TIMEOUT_MS);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${smsKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        records: [
          {
            phone: digits,
            ...params.variables,
          },
        ],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.ok) {
      const providerId =
        typeof data?.id === "string"
          ? data.id
          : typeof data?.message_id === "string"
          ? data.message_id
          : undefined;
      return { ok: true, status: res.status, id: providerId, response: data };
    }

    const errMsg = String(data?.message || data?.error || `HTTP ${res.status}`);
    console.warn(`[${params.logLabel}] Resala template send failed (status=${res.status})`);
    return {
      ok: false,
      status: res.status,
      response: data,
      error: errMsg,
    };
  } catch (error) {
    const errObj = error as { name?: string; code?: string; message?: string };
    const timedOut = errObj?.name === "AbortError";
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[${params.logLabel}] Resala template exception (timedOut=${timedOut})`
    );
    return {
      ok: false,
      timedOut,
      networkErrorCode: errObj?.code,
      error: msg,
    };
  }
}

export async function sendSmsAlertMessage(
  phone: string,
  vehicleOrTag: string,
  reportTitle: string,
  reportDescription: string,
  callerPhone?: string
): Promise<{
  ok: boolean;
  status?: number;
  id?: string;
  response?: unknown;
  error?: string;
  timedOut?: boolean;
  networkErrorCode?: string;
}> {
  const templateId = resolveEnvTemplateId(
    ["RESALA_SMS_TEMPLATE_ID"],
    "9f578af8-10d1-43ef-a7c8-70b323363eb7"
  );
  if (!templateId) {
    return {
      ok: false,
      status: 400,
      error: "RESALA_SMS_TEMPLATE_ID is not configured (fail-closed).",
    };
  }

  return sendResalaTemplateMessage({
    phone,
    templateId,
    variables: {
      $1: String(vehicleOrTag || "").trim().slice(0, 25),
      $2: String(reportTitle || "").trim().slice(0, 25),
      $3: String(reportDescription || "").trim().slice(0, 35),
      $4: String(callerPhone || "غير مرفق").trim().slice(0, 15),
    },
    logLabel: "Resala Report SMS",
  });
}

export async function sendNabehniReminderSms(
  phone: string,
  phaseLabel: string,
  reminderType: string,
  vehicleOrTag: string,
  dueDate: string
): Promise<{ ok: boolean; status?: number; response?: unknown; error?: string }> {
  const templateId = resolveEnvTemplateId(
    ["RESALA_REMINDER_TEMPLATE_ID"],
    "77552d78-11e4-41b4-a996-07feea175912"
  );
  if (!templateId) {
    return {
      ok: false,
      status: 400,
      error: "RESALA_REMINDER_TEMPLATE_ID is not configured (fail-closed).",
    };
  }

  return sendResalaTemplateMessage({
    phone,
    templateId,
    variables: {
      $1: String(phaseLabel || "").trim().slice(0, 25),
      $2: String(reminderType || "").trim().slice(0, 25),
      $3: String(vehicleOrTag || "").trim().slice(0, 25),
      $4: String(dueDate || "").trim().slice(0, 15),
    },
    logLabel: "Resala Nabehni Reminder SMS",
  });
}

export async function sendSubscriptionExpirySms(
  phone: string,
  statusLabel: string,
  expiryDetail: string
): Promise<{ ok: boolean; status?: number; response?: unknown; error?: string }> {
  const templateId = resolveEnvTemplateId(
    ["RESALA_SUBSCRIPTION_TEMPLATE_ID"],
    "d10d86ca-4be1-4807-89d4-497cfdc0c145"
  );
  if (!templateId) {
    return {
      ok: false,
      status: 400,
      error: "RESALA_SUBSCRIPTION_TEMPLATE_ID is not configured (fail-closed).",
    };
  }

  return sendResalaTemplateMessage({
    phone,
    templateId,
    variables: {
      $1: String(statusLabel || "").trim().slice(0, 25),
      $2: String(expiryDetail || "").trim().slice(0, 30),
    },
    logLabel: "Resala Subscription Expiry SMS",
  });
}


// ============================================================================
// 3. إرسال رمز OTP الواحد عبر قالب Resala (send-template + RESALA_OTP_TEMPLATE_ID)
//    لا يستخدم /api/v1/pins لمسار OTP الموحّد (لأن /api/v1/pins يولّد رمزاً مختلفاً)
// ============================================================================
export async function sendOtpViaResalaTemplate(
  phone: string,
  otpCode: string
): Promise<SmsProviderDispatchResponse> {
  const cleanCode = String(otpCode || "").trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    return { ok: false, httpStatus: 400, error: "Invalid 6-digit OTP code" };
  }

  const templateId = process.env.RESALA_OTP_TEMPLATE_ID?.trim() || "";
  if (!templateId) {
    return {
      ok: false,
      httpStatus: 400,
      error: "RESALA_OTP_TEMPLATE_ID is not configured (SMS OTP fallback disabled fail-closed)",
    };
  }

  const res = await sendResalaTemplateMessage({
    phone,
    templateId,
    variables: {
      $1: cleanCode,
    },
    logLabel: "Resala OTP Template",
  });

  return {
    ok: res.ok,
    id: res.id,
    httpStatus: res.status,
    timedOut: res.timedOut,
    networkErrorCode: res.networkErrorCode,
    error: res.error,
  };
}

// (INFO-01): أُزيلت الدالة القديمة sendOtpViaResala (/api/v1/pins) لعدم وجود أي اعتماد عليها،
// ويُستخدم sendOtpViaResalaTemplate حصراً لإرسال رمز OTP الواحد الذي أنشأه التطبيق.

// ============================================================================
// 4. المحرك الموزّع لـ OTP (رمز واحد للجلسة، Twilio أولاً، Resala send-template احتياطياً)
// ============================================================================
export interface SmartOtpResult {
  ok: boolean;
  phone?: string;
  channel?: "WHATSAPP" | "SMS";
  message?: string;
  countdownSeconds?: number;
  validityMinutes?: number;
  existsWhatsapp?: boolean;
  fallback?: boolean;
  error?: string;
}

async function activateWhatsappWithBoundedRetry(params: {
  sessionId: string;
  twilioMessageSid: string;
  recipientPhoneHash: string;
  phoneHmacKeyVersion: number;
  fallbackAfterAtIso: string;
}): Promise<{ ok: boolean; activated: boolean; trackingRegistered: boolean }> {
  const backoffs = [0, 150, 400];
  for (let i = 0; i < backoffs.length; i++) {
    if (backoffs[i] > 0) {
      await new Promise((r) => setTimeout(r, backoffs[i]));
    }
    const res = await activateOtpWhatsappSession(params);
    if (res.ok && res.activated) {
      return res;
    }
  }
  return { ok: false, activated: false, trackingRegistered: false };
}

export async function requestSmartOtp(
  rawPhone: string,
  preferredChannel: "auto" | "whatsapp" | "sms" = "auto"
): Promise<SmartOtpResult> {
  const phone = formatLibyaPhoneForOtp(rawPhone);
  if (!phone) {
    return {
      ok: false,
      error:
        "يرجى إدخال رقم هاتف ليبي صحيح مكون من 9 أرقام ويبدأ بـ (091, 092, 093, 094, 095).",
    };
  }

  let phoneCandidates: ReturnType<typeof computePhoneHmacCandidates>;
  try {
    phoneCandidates = computePhoneHmacCandidates(phone);
  } catch {
    return {
      ok: false,
      error: "إعدادات التشفير الخادمية غير مكتملة؛ تم رفض الطلب بأمان.",
    };
  }

  const now = Date.now();

  // ==========================================================================
  // المسار 1: طلب المستخدم الصريح لإرسال SMS يدوياً
  // - إن وُجدت جلسة مفتوحة بحمولة مشفّرة، يُرسل الرمز نفسه دون توليد رمز جديد
  // - وإن كان هناك twilioMessageSid مرتبط، يمر عبر الحجز الذري لمنع التكرار مع Worker
  // ==========================================================================
  if (preferredChannel === "sms") {
    const existingRes = await getOpenOtpSessionForVerify({
      phoneHashCurrent: phoneCandidates.currentHash,
      phoneHashPrevious: phoneCandidates.previousHash,
      nowIso: new Date(now).toISOString(),
    });

    if (!existingRes.ok) {
      return {
        ok: false,
        error: "تعذر الوصول إلى خدمة جلسات التحقق حالياً. يرجى المحاولة لاحقاً.",
      };
    }

    const openSess = existingRes.session;
    if (
      openSess &&
      new Date(openSess.expiresAt).getTime() > now &&
      openSess.otpPayloadEnc
    ) {
      try {
        const decrypted = decryptOtpPayload({
          ciphertext: openSess.otpPayloadEnc,
          phoneHash:
            openSess.phoneHmacKeyVersion === phoneCandidates.currentVersion
              ? phoneCandidates.currentHash
              : phoneCandidates.previousHash || phoneCandidates.currentHash,
          sessionSalt: openSess.sessionSalt,
          encKeyVersion: openSess.encKeyVersion,
        });

        if (openSess.twilioMessageSid) {
          const dispatchRes = await dispatchSmsFallbackWithAtomicClaim({
            messageSid: openSess.twilioMessageSid,
            nowMs: now,
            reason: "user_requested_sms",
            sendSms: () => sendOtpViaResalaTemplate(decrypted.phone, decrypted.otp),
          });
          if (!dispatchRes.claimed && dispatchRes.reason === "already_claimed_or_finalized") {
            return {
              ok: true,
              phone,
              channel: "SMS",
              message: "تم إرسال رمز التحقق كرسالة نصية SMS مسبقاً.",
              countdownSeconds: 60,
              validityMinutes: 5,
            };
          }
          if (!dispatchRes.smsOk) {
            return {
              ok: false,
              error: dispatchRes.error || "تعذر إرسال رسالة SMS عبر منصة رسالة.",
            };
          }
          return {
            ok: true,
            phone,
            channel: "SMS",
            fallback: true,
            message: "تم إرسال رمز التحقق كرسالة نصية SMS",
            countdownSeconds: 60,
            validityMinutes: 5,
          };
        }

        // جلسة pending بدون twilioMessageSid (مثلاً بعد فشل حفظ MessageSid) -> إرسال نفس الرمز
        const smsRes = await sendOtpViaResalaTemplate(decrypted.phone, decrypted.otp);
        const outcome = classifyResalaDispatchOutcome(smsRes);
        if (outcome === "sent") {
          await activateOtpSmsSession({
            sessionId: openSess.sessionId,
            resalaPinId: smsRes.id || null,
          });
          return {
            ok: true,
            phone,
            channel: "SMS",
            fallback: true,
            message: "تم إرسال رمز التحقق كرسالة نصية SMS",
            countdownSeconds: 60,
            validityMinutes: 5,
          };
        }
        return {
          ok: false,
          error: smsRes.error || "تعذر إرسال رسالة SMS عبر منصة رسالة.",
        };
      } catch {
        return {
          ok: false,
          error: "تعذر فك تشفير جلسة التحقق الحالية؛ يرجى طلب رمز جديد.",
        };
      }
    }

    // لا توجد جلسة مفتوحة قابلة لإعادة الإرسال -> إنشاء جلسة pending جديدة وإرسال عبر Resala send-template
    const otpCode = generateSecure6DigitOtp();
    const sessionSalt = generateOtpSessionSalt();
    const otpHmac = computeOtpHmac(otpCode, sessionSalt);
    const enc = encryptOtpPayload({
      phone,
      otp: otpCode,
      phoneHash: phoneCandidates.currentHash,
      sessionSalt,
    });
    const expiresAtIso = new Date(now + OTP_VALIDITY_MS).toISOString();

    const pending = await createOtpSessionPending({
      phoneHashCurrent: phoneCandidates.currentHash,
      phoneHashPrevious: phoneCandidates.previousHash,
      phoneHmacKeyVersion: phoneCandidates.currentVersion,
      otpHmacKeyVersion: otpHmac.otpHmacKeyVersion,
      encKeyVersion: enc.encKeyVersion,
      otpPayloadEnc: enc.ciphertext,
      sessionSalt,
      otpHash: otpHmac.otpHash,
      expiresAtIso,
    });

    if (!pending.ok || !pending.sessionId) {
      return {
        ok: false,
        error: "تعذر تهيئة جلسة التحقق حالياً. يرجى المحاولة لاحقاً.",
      };
    }

    const smsRes = await sendOtpViaResalaTemplate(phone, otpCode);
    const outcome = classifyResalaDispatchOutcome(smsRes);
    if (outcome === "sent") {
      await activateOtpSmsSession({
        sessionId: pending.sessionId,
        resalaPinId: smsRes.id || null,
      });
      return {
        ok: true,
        phone,
        channel: "SMS",
        message: "تم إرسال رمز التحقق كرسالة نصية SMS",
        countdownSeconds: 60,
        validityMinutes: 5,
      };
    }
    if (outcome === "failed") {
      await cancelPendingOtpSession(pending.sessionId);
    }
    return {
      ok: false,
      error: smsRes.error || "تعذر إرسال رسالة SMS عبر منصة رسالة.",
    };
  }

  // ==========================================================================
  // المسار 2 (auto / whatsapp): Two-Phase Pending -> Twilio -> Activate
  // وعند فشل Twilio المباشر: تحويل فوري لنفس الرمز عبر Resala send-template
  // ==========================================================================
  const otpCode = generateSecure6DigitOtp();
  const sessionSalt = generateOtpSessionSalt();
  const otpHmac = computeOtpHmac(otpCode, sessionSalt);
  const enc = encryptOtpPayload({
    phone,
    otp: otpCode,
    phoneHash: phoneCandidates.currentHash,
    sessionSalt,
  });
  const expiresAtIso = new Date(now + OTP_VALIDITY_MS).toISOString();

  // المرحلة 1: حفظ الجلسة بحالة pending قبل أي اتصال خارجي (Fail-Closed)
  const pending = await createOtpSessionPending({
    phoneHashCurrent: phoneCandidates.currentHash,
    phoneHashPrevious: phoneCandidates.previousHash,
    phoneHmacKeyVersion: phoneCandidates.currentVersion,
    otpHmacKeyVersion: otpHmac.otpHmacKeyVersion,
    encKeyVersion: enc.encKeyVersion,
    otpPayloadEnc: enc.ciphertext,
    sessionSalt,
    otpHash: otpHmac.otpHash,
    expiresAtIso,
  });

  if (!pending.ok || !pending.sessionId) {
    return {
      ok: false,
      error: "تعذر تهيئة جلسة التحقق حالياً. يرجى المحاولة لاحقاً.",
    };
  }

  // المرحلة 2: إرسال WhatsApp عبر Twilio (المزود الأساسي)
  let waRes: { ok: boolean; idMessage?: string; error?: string };
  try {
    waRes = await sendOtpViaWhatsapp(phone, otpCode);
  } catch (err) {
    waRes = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (waRes.ok && waRes.idMessage) {
    // المرحلة 3أ: تفعيل الجلسة وربط MessageSid وتسجيل تتبع 60s في معاملة واحدة (مع إعادة محدودة)
    const activationRes = await activateWhatsappWithBoundedRetry({
      sessionId: pending.sessionId,
      twilioMessageSid: waRes.idMessage,
      recipientPhoneHash: phoneCandidates.currentHash,
      phoneHmacKeyVersion: phoneCandidates.currentVersion,
      fallbackAfterAtIso: new Date(now + SMS_FALLBACK_TIMEOUT_MS).toISOString(),
    });

    if (!activationRes.ok || !activationRes.activated) {
      const sidSuffix = waRes.idMessage.slice(-6);
      console.warn(
        `[OTP Activation Warning] Failed to bind Twilio MessageSid to pending OTP session after bounded retries (sessionId=${pending.sessionId}, sidSuffix=${sidSuffix}, trackingRegistered=${activationRes.trackingRegistered}). Session remains pending and verifiable within 5m without regenerating OTP.`
      );
    }

    return {
      ok: true,
      phone,
      channel: "WHATSAPP",
      existsWhatsapp: true,
      message: `تم إرسال رمز التحقق إلى واتساب الخاص بالرقم: ${phone}`,
      countdownSeconds: 60,
      validityMinutes: 5,
    };
  }

  // المرحلة 3ب: فشل Twilio المباشر -> إرسال الرمز نفسه عبر Resala send-template
  const smsRes = await sendOtpViaResalaTemplate(phone, otpCode);
  const outcome = classifyResalaDispatchOutcome(smsRes);
  if (outcome === "sent") {
    await activateOtpSmsSession({
      sessionId: pending.sessionId,
      resalaPinId: smsRes.id || null,
    });
    return {
      ok: true,
      phone,
      channel: "SMS",
      fallback: true,
      message: "تم إرسال رمز التحقق كرسالة نصية SMS لتعذر الإرسال عبر واتساب",
      countdownSeconds: 60,
      validityMinutes: 5,
    };
  }

  // عند الرفض الصريح من Resala فقط نلغي pending؛ عند abandoned_unknown نبقي pending قابلة للتحقق
  if (outcome === "failed") {
    await cancelPendingOtpSession(pending.sessionId);
  }

  return {
    ok: false,
    error: smsRes.error || waRes.error || "تعذر إرسال الرمز عبر واتساب أو SMS.",
  };
}

// ============================================================================
// 5. التحقق الموزّع الذري من OTP (crypto.timingSafeEqual في Node.js + Atomic CAS في PostgreSQL)
// ============================================================================
export async function verifyOtpCode(
  rawPhone: string,
  rawCode: string
): Promise<{ ok: boolean; phone?: string; error?: string }> {
  const phone = formatLibyaPhoneForOtp(rawPhone);
  if (!phone) {
    return { ok: false, error: "رقم الهاتف غير صالح." };
  }

  const cleanCode = String(rawCode || "").trim().replace(/\D/g, "");
  if (!/^\d{6}$/.test(cleanCode)) {
    return { ok: false, error: "رمز التحقق يجب أن يتكون من 6 أرقام." };
  }

  let phoneCandidates: ReturnType<typeof computePhoneHmacCandidates>;
  try {
    phoneCandidates = computePhoneHmacCandidates(phone);
  } catch {
    return { ok: false, error: "خدمة التحقق غير مهيأة حالياً." };
  }

  // محاولة واحدة إضافية فقط عند conflict_retry الناتج عن تزامن محاولتين
  for (let attemptIdx = 0; attemptIdx < 2; attemptIdx++) {
    const nowIso = new Date().toISOString();
    const lookup = await getOpenOtpSessionForVerify({
      phoneHashCurrent: phoneCandidates.currentHash,
      phoneHashPrevious: phoneCandidates.previousHash,
      nowIso,
    });

    if (!lookup.ok) {
      return {
        ok: false,
        error: "تعذر التحقق من الرمز حالياً. يرجى المحاولة لاحقاً.",
      };
    }

    const session = lookup.session;
    if (!session || !session.otpHash) {
      return {
        ok: false,
        error:
          "لم يتم العثور على رمز تحقق نشط لهذا الرقم، أو انتهت صلاحيته. يرجى طلب رمز جديد.",
      };
    }

    let matched = false;
    try {
      const candidate = computeOtpHmac(
        cleanCode,
        session.sessionSalt,
        session.otpHmacKeyVersion
      );
      matched = verifyOtpHmacConstantTime(session.otpHash, candidate.otpHash);
    } catch {
      return {
        ok: false,
        error: "تعذر التحقق من الرمز (إصدار مفتاح غير متاح). يرجى طلب رمز جديد.",
      };
    }

    const committed = await commitOtpVerificationAttempt({
      sessionId: session.sessionId,
      expectedAttempts: session.attempts,
      matched,
      nowIso,
    });

    if (!committed.ok || committed.outcome === "rpc_error") {
      return {
        ok: false,
        error: "تعذر تثبيت محاولة التحقق حالياً. يرجى المحاولة لاحقاً.",
      };
    }

    if (committed.outcome === "conflict_retry") {
      continue;
    }

    if (matched && committed.outcome === "verified") {
      return { ok: true, phone };
    }

    if (committed.outcome === "already_verified") {
      return {
        ok: false,
        error: "تم استخدام رمز التحقق مسبقاً. يرجى طلب رمز جديد.",
      };
    }

    if (committed.outcome === "expired") {
      return {
        ok: false,
        error: "انتهت صلاحية رمز التحقق (صلاحية الرمز 5 دقائق). يرجى طلب رمز جديد.",
      };
    }

    if (committed.outcome === "locked") {
      return {
        ok: false,
        error:
          "تم تجاوز الحد الأقصى للمحاولات الخاطئة (5 محاولات). تم إبطال الرمز لحمايتك، يرجى طلب رمز جديد.",
      };
    }

    if (committed.outcome === "invalid") {
      return {
        ok: false,
        error: `رمز التحقق غير صحيح. متبقي ${committed.attemptsRemaining} محاولات.`,
      };
    }

    return {
      ok: false,
      error: "لم يعد رمز التحقق صالحاً. يرجى طلب رمز جديد.",
    };
  }

  return {
    ok: false,
    error: "تعارض متزامن أثناء التحقق؛ يرجى إعادة المحاولة.",
  };
}
