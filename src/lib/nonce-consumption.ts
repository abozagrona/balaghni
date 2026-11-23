import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase/client";

// ============================================================================
// استهلاك الرموز أحادية الاستخدام (Nonces) بشكل ذري وموزّع عبر PostgreSQL
// Multi-Instance Safe & Fail-Closed — لا يستخدم أي Map محلية بديلة في الإنتاج
// ============================================================================

export type NoncePurpose = "otp_proof" | "webauthn_challenge";

export interface ConsumeSecurityNonceRpcArgs {
  p_jti: string;
  p_purpose: NoncePurpose;
  p_subject_hash: string;
  p_expires_at: string;
}

export type NonceConsumptionRpcExecutor = (
  fnName: "consume_security_nonce",
  args: ConsumeSecurityNonceRpcArgs
) => Promise<{ data: unknown; error: unknown }>;

let customNonceRpcExecutor: NonceConsumptionRpcExecutor | null = null;

/**
 * حقن منفّذ RPC للاختبارات المحلية فقط (محاكاة تعدد النسخ وفشل الشبكة)
 */
export function setNonceConsumptionRpcExecutorForTest(
  executor: NonceConsumptionRpcExecutor | null
): void {
  customNonceRpcExecutor = executor;
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const MIN_SIGNING_SECRET_BYTES = 32;
const MAX_TTL_MS_BY_PURPOSE: Record<NoncePurpose, number> = {
  otp_proof: 12 * 60 * 1000, // 10 دقائق + دقيقتان هامش انحراف ساعة
  webauthn_challenge: 7 * 60 * 1000, // 5 دقائق + دقيقتان هامش انحراف ساعة
};

class NonceSubjectSecretConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonceSubjectSecretConfigError";
  }
}

function isPlaceholderSecret(val: string): boolean {
  const lower = val.trim().toLowerCase();
  if (!lower) return true;
  return (
    lower === "balaghni_hmac_sha256_internal_signing_key_2026_v2" ||
    lower.startsWith("your_") ||
    lower.endsWith("_here") ||
    lower.includes("changeme") ||
    lower.includes("replace_me") ||
    lower.includes("placeholder") ||
    lower.includes("example_secret")
  );
}

/**
 * اشتقاق مفتاح HMAC مستقل ومفصول الغرض (Domain-Separated) لحماية subject_hash
 * من مصدر سري خادمي فقط، مع سياسة Fail-Closed عند غياب السر أو ضعفه.
 */
function isProductionNonceRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
}

function getNonceSubjectHmacKey(): Buffer {
  const isProd = isProductionNonceRuntime();
  const rawSecret = isProd
    ? process.env.SESSION_HMAC_SECRET?.trim() || ""
    : process.env.SESSION_HMAC_SECRET?.trim() ||
      process.env.SESSION_SIGNING_SECRET?.trim() ||
      process.env.ADMIN_MASTER_SECRET?.trim() ||
      "";

  if (!rawSecret || isPlaceholderSecret(rawSecret)) {
    throw new NonceSubjectSecretConfigError(
      isProd
        ? "SESSION_HMAC_SECRET is required in production for nonce subject HMAC and cannot fall back to other service secrets."
        : "Nonce subject HMAC secret is not configured or uses an invalid placeholder."
    );
  }

  if (Buffer.byteLength(rawSecret, "utf8") < MIN_SIGNING_SECRET_BYTES) {
    throw new NonceSubjectSecretConfigError(
      "Nonce subject HMAC secret does not meet the minimum 32-byte strength requirement."
    );
  }

  return crypto
    .createHash("sha256")
    .update(`balaghni_nonce_subject_hmac_v1:${rawSecret}`, "utf8")
    .digest();
}

/**
 * حساب subject_hash موحّد لرمز OTP عبر HMAC-SHA256 من رقم الهاتف المطبّع
 * (يمنع تخمين الأرقام عبر جداول Rainbow حتى عند تسرب محتوى الجدول)
 */
export function computeOtpNonceSubjectHash(normalizedPhone: string): string {
  const canonical = String(normalizedPhone || "").trim();
  if (!canonical) {
    throw new Error("Invalid empty phone for OTP nonce subject hash.");
  }
  const hmacKey = getNonceSubjectHmacKey();
  return crypto
    .createHmac("sha256", hmacKey)
    .update(`otp_proof:${canonical}`, "utf8")
    .digest("hex");
}

/**
 * حساب subject_hash موحّد لتحدي WebAuthn عبر HMAC-SHA256 من النطاق (scope) و rpId المطبّع
 */
export function computeWebAuthnNonceSubjectHash(
  scope: "owner" | "admin",
  rpId: string
): string {
  const normalizedRpId = String(rpId || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!normalizedRpId || (scope !== "owner" && scope !== "admin")) {
    throw new Error("Invalid scope or rpId for WebAuthn nonce subject hash.");
  }
  const hmacKey = getNonceSubjectHmacKey();
  return crypto
    .createHmac("sha256", hmacKey)
    .update(`webauthn_challenge:${scope}:${normalizedRpId}`, "utf8")
    .digest("hex");
}

async function runConsumeNonceRpc(
  args: ConsumeSecurityNonceRpcArgs
): Promise<{ data: unknown; error: unknown }> {
  if (customNonceRpcExecutor) {
    return customNonceRpcExecutor("consume_security_nonce", args);
  }
  return supabaseAdmin.rpc("consume_security_nonce", args);
}

export type NonceConsumeResult =
  | { consumed: true }
  | {
      consumed: false;
      reason:
        | "invalid_input"
        | "expired"
        | "already_consumed"
        | "nonce_store_unavailable";
    };

/**
 * استهلاك jti ذرياً عبر PostgreSQL RPC (INSERT ... ON CONFLICT DO NOTHING RETURNING).
 * سياسة Fail-Closed: عند أي خطأ أو تعذر اتصال يُرفض الاستهلاك ولا يُرجع إلى Map محلية.
 */
export async function consumeSecurityNonceDistributed(params: {
  jti: string;
  purpose: NoncePurpose;
  subjectHash: string;
  expiresAtMs: number;
}): Promise<NonceConsumeResult> {
  const jti = String(params.jti || "").trim();
  const purpose = params.purpose;
  const subjectHash = String(params.subjectHash || "").trim().toLowerCase();
  const expiresAtMs = Number(params.expiresAtMs);

  if (jti.length < 8 || jti.length > 128) {
    return { consumed: false, reason: "invalid_input" };
  }

  if (purpose !== "otp_proof" && purpose !== "webauthn_challenge") {
    return { consumed: false, reason: "invalid_input" };
  }

  if (!SHA256_HEX_RE.test(subjectHash)) {
    return { consumed: false, reason: "invalid_input" };
  }

  const now = Date.now();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
    return { consumed: false, reason: "expired" };
  }

  if (expiresAtMs > now + MAX_TTL_MS_BY_PURPOSE[purpose]) {
    return { consumed: false, reason: "invalid_input" };
  }

  try {
    const { data, error } = await runConsumeNonceRpc({
      p_jti: jti,
      p_purpose: purpose,
      p_subject_hash: subjectHash,
      p_expires_at: new Date(expiresAtMs).toISOString(),
    });

    if (error) {
      return { consumed: false, reason: "nonce_store_unavailable" };
    }

    if (data === true) {
      return { consumed: true };
    }

    if (data === false) {
      return { consumed: false, reason: "already_consumed" };
    }

    return { consumed: false, reason: "nonce_store_unavailable" };
  } catch {
    return { consumed: false, reason: "nonce_store_unavailable" };
  }
}
