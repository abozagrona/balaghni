import crypto from "crypto";
import { NextResponse } from "next/server";
import { formatBalaghniTagCode, formatFullLibyaE164 } from "@/lib/utils";

export type TokenPurpose =
  | "owner_session"
  | "admin_session"
  | "vendor_session"
  | "otp_proof"
  | "webauthn_challenge";

export interface BaseTokenPayload {
  purpose: TokenPurpose;
  iat: number;
  exp: number;
  jti?: string;
}

export interface OwnerSessionTokenPayload extends BaseTokenPayload {
  purpose: "owner_session";
  tagCode: string;
  ownerPhone: string;
}

export interface AdminSessionTokenPayload extends BaseTokenPayload {
  purpose: "admin_session";
  id: string;
  username: string;
  phone: string;
  roleTitle?: string;
  isSuperAdmin?: boolean;
  sessionCreatedAt: number;
  lastActivityAt: number;
}

export interface VendorSessionTokenPayload extends BaseTokenPayload {
  purpose: "vendor_session";
  vendorId: string;
  vendorPhone?: string;
}

export interface OtpProofTokenPayload extends BaseTokenPayload {
  purpose: "otp_proof";
  phone: string;
  jti: string;
}

export interface WebAuthnChallengeTokenPayload extends BaseTokenPayload {
  purpose: "webauthn_challenge";
  challenge: string;
  rpId: string;
  scope: "owner" | "admin";
  jti: string;
}

export const OWNER_COOKIE_NAME = "balaghni_owner_token";
export const LEGACY_OWNER_COOKIE_NAME = "balaghni_session";
export const ADMIN_COOKIE_NAME = "balaghni_admin_session";
export const VENDOR_COOKIE_NAME = "balaghni_vendor_id";
export const OTP_PROOF_COOKIE_NAME = "balaghni_otp_proof";
export const WEBAUTHN_CHALLENGE_COOKIE_NAME = "balaghni_webauthn_challenge";

const OWNER_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const VENDOR_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const OTP_PROOF_TTL_MS = 10 * 60 * 1000; // 10 minutes
const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// سجل الرموز المستهلكة لمرة واحدة (OTP Proof & WebAuthn Challenges)
const consumedNonces = new Map<string, number>();

function cleanupConsumedNonces(): void {
  const now = Date.now();
  if (consumedNonces.size < 500) return;
  for (const [jti, exp] of consumedNonces.entries()) {
    if (exp <= now) {
      consumedNonces.delete(jti);
    }
  }
}

function getSigningSecretKey(): Buffer {
  const rawSecret =
    process.env.SESSION_HMAC_SECRET?.trim() ||
    process.env.SESSION_SIGNING_SECRET?.trim() ||
    process.env.ADMIN_MASTER_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "balaghni_hmac_sha256_internal_signing_key_2026_v2";
  return crypto.createHash("sha256").update(`balaghni_sig_v2:${rawSecret}`).digest();
}

export function signSecurityToken<T extends BaseTokenPayload>(payload: T): string {
  const jsonStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(jsonStr, "utf-8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSigningSecretKey())
    .update(`v1.${payloadB64}`)
    .digest("base64url");
  return `v1.${payloadB64}.${sig}`;
}

export function verifySecurityToken<T extends BaseTokenPayload>(
  token: string | null | undefined,
  expectedPurpose: TokenPurpose
): { valid: boolean; expired?: boolean; payload?: T; reason?: string } {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "missing_token" };
  }

  let clean = token.trim().replace(/^Bearer\s+/i, "").trim();
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // ignore
  }

  const parts = clean.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return { valid: false, reason: "invalid_format" };
  }

  const [, payloadB64, providedSig] = parts;
  if (!payloadB64 || !providedSig) {
    return { valid: false, reason: "malformed_token" };
  }

  const expectedSig = crypto
    .createHmac("sha256", getSigningSecretKey())
    .update(`v1.${payloadB64}`)
    .digest("base64url");

  const a = Buffer.from(providedSig, "utf-8");
  const b = Buffer.from(expectedSig, "utf-8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: "invalid_signature" };
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8")
    ) as T;
    if (!decoded || decoded.purpose !== expectedPurpose) {
      return { valid: false, reason: "purpose_mismatch" };
    }
    const now = Date.now();
    if (typeof decoded.exp !== "number" || now > decoded.exp) {
      return { valid: false, expired: true, reason: "expired" };
    }
    return { valid: true, payload: decoded };
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }
}

export function readCookieFromRequest(
  request: Request | undefined | null,
  cookieName: string
): string | null {
  if (!request) return null;
  const cookieHeader = request.headers.get("cookie") || "";
  if (!cookieHeader) return null;

  const regex = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`, "i");
  const match = cookieHeader.match(regex);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim();
  }
}

function isProductionSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

// ============================================================================
// 1. جلسات المالكين (Owner Sessions)
// ============================================================================

export function createOwnerSessionToken(input: {
  tagCode: string;
  ownerPhone: string;
}): string {
  const now = Date.now();
  const payload: OwnerSessionTokenPayload = {
    purpose: "owner_session",
    tagCode: formatBalaghniTagCode(input.tagCode),
    ownerPhone: formatFullLibyaE164(input.ownerPhone) || input.ownerPhone.trim(),
    iat: now,
    exp: now + OWNER_SESSION_TTL_MS,
  };
  return signSecurityToken(payload);
}

export function attachOwnerSessionCookie(
  response: NextResponse,
  token: string,
  _tagCode?: string
): void {
  const maxAge = Math.floor(OWNER_SESSION_TTL_MS / 1000);
  response.cookies.set(OWNER_COOKIE_NAME, token, {
    path: "/",
    maxAge,
    httpOnly: true,
    secure: isProductionSecure(),
    sameSite: "lax",
  });
}

export function clearOwnerSessionCookie(response: NextResponse): void {
  response.cookies.set(OWNER_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    secure: isProductionSecure(),
    sameSite: "lax",
  });
  response.cookies.set(LEGACY_OWNER_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    secure: isProductionSecure(),
    sameSite: "lax",
  });
}

export function verifyOwnerSessionFromRequest(
  request: Request,
  bodyToken?: string | null
): {
  valid: boolean;
  ok: boolean;
  expired?: boolean;
  payload?: OwnerSessionTokenPayload;
  reason?: string;
} {
  const headerToken =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.headers.get("x-owner-session") ||
    null;
  const cookieToken = readCookieFromRequest(request, OWNER_COOKIE_NAME);
  const legacyCookieToken = readCookieFromRequest(
    request,
    LEGACY_OWNER_COOKIE_NAME
  );

  const candidates = [cookieToken, headerToken, bodyToken, legacyCookieToken].filter(
    Boolean
  ) as string[];

  let sawExpired = false;
  for (const candidate of candidates) {
    const res = verifySecurityToken<OwnerSessionTokenPayload>(
      candidate,
      "owner_session"
    );
    if (res.valid && res.payload) {
      return { valid: true, ok: true, payload: res.payload };
    }
    if (res.expired) sawExpired = true;
  }

  return {
    valid: false,
    ok: false,
    expired: sawExpired,
    reason: sawExpired ? "expired" : "no_valid_owner_session",
  };
}

// ============================================================================
// 2. جلسات المشرفين (Admin Sessions)
// ============================================================================

export function createAdminSessionToken(input: {
  id: string;
  username: string;
  phone: string;
  roleTitle?: string;
  isSuperAdmin?: boolean;
}): string {
  const now = Date.now();
  const payload: AdminSessionTokenPayload = {
    purpose: "admin_session",
    id: input.id,
    username: input.username,
    phone: input.phone,
    roleTitle: input.roleTitle,
    isSuperAdmin: Boolean(input.isSuperAdmin),
    sessionCreatedAt: now,
    lastActivityAt: now,
    iat: now,
    exp: now + ADMIN_SESSION_TTL_MS,
  };
  return signSecurityToken(payload);
}

export function verifyAdminSessionToken(token: string | null | undefined): {
  valid: boolean;
  payload?: AdminSessionTokenPayload;
  reason?: string;
} {
  return verifySecurityToken<AdminSessionTokenPayload>(token, "admin_session");
}

export function verifyAdminSessionFromRequest(
  request: Request,
  bodyToken?: string | null
): {
  valid: boolean;
  payload?: AdminSessionTokenPayload;
  reason?: string;
} {
  const authHeader =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.headers.get("x-admin-session") ||
    null;
  const cookieToken = readCookieFromRequest(request, ADMIN_COOKIE_NAME);

  const candidates = [cookieToken, authHeader, bodyToken].filter(
    Boolean
  ) as string[];

  for (const candidate of candidates) {
    const verified = verifyAdminSessionToken(candidate);
    if (verified.valid && verified.payload) {
      return verified;
    }
  }

  return { valid: false, reason: "no_valid_admin_session" };
}

export function attachAdminSessionCookie(
  response: NextResponse,
  token: string
): void {
  const maxAge = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
  response.cookies.set(ADMIN_COOKIE_NAME, token, {
    path: "/",
    maxAge,
    httpOnly: true,
    secure: isProductionSecure(),
    sameSite: "lax",
  });
}

export function clearAdminSessionCookie(response: NextResponse): void {
  response.cookies.set(ADMIN_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    secure: isProductionSecure(),
    sameSite: "lax",
  });
}

// ============================================================================
// 3. جلسات التجار (Vendor Sessions)
// ============================================================================

export function createVendorSessionToken(
  input: string | { vendorId: string; vendorPhone?: string }
): string {
  const now = Date.now();
  const vendorId =
    typeof input === "string" ? input.trim() : input.vendorId.trim();
  const vendorPhone =
    typeof input === "string" ? undefined : input.vendorPhone?.trim();
  const payload: VendorSessionTokenPayload = {
    purpose: "vendor_session",
    vendorId,
    vendorPhone,
    iat: now,
    exp: now + VENDOR_SESSION_TTL_MS,
  };
  return signSecurityToken(payload);
}

export function verifyVendorSessionFromRequest(request: Request): {
  valid: boolean;
  ok: boolean;
  expired?: boolean;
  vendorId?: string;
  payload?: VendorSessionTokenPayload;
} {
  const cookieToken = readCookieFromRequest(request, VENDOR_COOKIE_NAME);
  const res = verifySecurityToken<VendorSessionTokenPayload>(
    cookieToken,
    "vendor_session"
  );
  if (!res.valid || !res.payload?.vendorId) {
    return { valid: false, ok: false, expired: res.expired };
  }
  return {
    valid: true,
    ok: true,
    vendorId: res.payload.vendorId,
    payload: res.payload,
  };
}

export function attachVendorSessionCookie(
  response: NextResponse,
  token: string
): void {
  const maxAge = Math.floor(VENDOR_SESSION_TTL_MS / 1000);
  response.cookies.set(VENDOR_COOKIE_NAME, token, {
    path: "/",
    maxAge,
    httpOnly: true,
    secure: isProductionSecure(),
    sameSite: "lax",
  });
}

export function clearVendorSessionCookie(response: NextResponse): void {
  response.cookies.set(VENDOR_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    secure: isProductionSecure(),
    sameSite: "lax",
  });
}

// ============================================================================
// 4. رموز إثبات التحقق من الهاتف لمرة واحدة (Single-Use Signed OTP Proof)
// ============================================================================

export function createOtpProofToken(rawPhone: string): string {
  const normalizedPhone = formatFullLibyaE164(rawPhone) || rawPhone.trim();
  const now = Date.now();
  const payload: OtpProofTokenPayload = {
    purpose: "otp_proof",
    phone: normalizedPhone,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + OTP_PROOF_TTL_MS,
  };
  return signSecurityToken(payload);
}

export function attachOtpProofCookie(
  response: NextResponse,
  token: string
): void {
  const maxAge = Math.floor(OTP_PROOF_TTL_MS / 1000);
  response.cookies.set(OTP_PROOF_COOKIE_NAME, token, {
    path: "/",
    maxAge,
    httpOnly: true,
    secure: isProductionSecure(),
    sameSite: "lax",
  });
}

export function clearOtpProofCookie(response: NextResponse): void {
  response.cookies.set(OTP_PROOF_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    secure: isProductionSecure(),
    sameSite: "lax",
  });
}

export function verifyAndConsumeOtpProof(
  request: Request,
  bodyToken: string | null | undefined,
  expectedPhone: string
): { valid: boolean; error?: string } {
  cleanupConsumedNonces();
  const normalizedExpected =
    formatFullLibyaE164(expectedPhone) || expectedPhone.trim();
  const cookieToken = readCookieFromRequest(request, OTP_PROOF_COOKIE_NAME);
  const headerToken = request.headers.get("x-otp-proof");

  const candidates = [bodyToken, cookieToken, headerToken].filter(
    Boolean
  ) as string[];

  if (candidates.length === 0) {
    return {
      valid: false,
      error: "يرجى إتمام التحقق من رقم الهاتف عبر رمز التحقق (OTP) أولاً.",
    };
  }

  for (const token of candidates) {
    const res = verifySecurityToken<OtpProofTokenPayload>(token, "otp_proof");
    if (!res.valid || !res.payload) continue;

    const tokenPhone =
      formatFullLibyaE164(res.payload.phone) || res.payload.phone.trim();
    if (tokenPhone !== normalizedExpected) {
      continue;
    }

    if (consumedNonces.has(res.payload.jti)) {
      return {
        valid: false,
        error: "انتهت صلاحية رمز إثبات التحقق (تم استخدامه مسبقاً). يرجى طلب رمز جديد.",
      };
    }

    consumedNonces.set(res.payload.jti, res.payload.exp);
    return { valid: true };
  }

  return {
    valid: false,
    error: "رمز إثبات التحقق من الهاتف غير صالح أو منتهي الصلاحية.",
  };
}

// ============================================================================
// 5. التحقق التشفيري الحقيقي لمفاتيح المرور (WebAuthn Passkeys Server Verification)
// ============================================================================

export function createWebAuthnChallenge(
  rpId: string,
  scope: "owner" | "admin",
  _tagCode?: string
): { challenge: string; challengeToken: string } {
  const challengeBytes = crypto.randomBytes(32);
  const challenge = challengeBytes.toString("base64url");
  const now = Date.now();
  const payload: WebAuthnChallengeTokenPayload = {
    purpose: "webauthn_challenge",
    challenge,
    rpId: rpId.trim().toLowerCase().replace(/^www\./, ""),
    scope,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + WEBAUTHN_CHALLENGE_TTL_MS,
  };
  const challengeToken = signSecurityToken(payload);
  return { challenge, challengeToken };
}

export function attachWebAuthnChallengeCookie(
  response: NextResponse,
  challengeToken: string
): void {
  const maxAge = Math.floor(WEBAUTHN_CHALLENGE_TTL_MS / 1000);
  response.cookies.set(WEBAUTHN_CHALLENGE_COOKIE_NAME, challengeToken, {
    path: "/",
    maxAge,
    httpOnly: true,
    secure: isProductionSecure(),
    sameSite: "lax",
  });
}

/**
 * تنسيق سجل البصمة المشفر في قاعدة البيانات:
 * v2:<credentialId>:<alg>:<publicKeySpkiBase64Url>
 */
export function encodePasskeyCredentialRecord(input: {
  credentialId: string;
  alg: number;
  publicKeySpki: string;
}): string {
  return `v2:${input.credentialId.trim()}:${input.alg}:${input.publicKeySpki.trim()}`;
}

export function parsePasskeyCredentialRecord(raw: string | null | undefined): {
  credentialId: string;
  alg: number;
  publicKeySpki: string | null;
} | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("v2:")) {
    const parts = trimmed.split(":");
    if (parts.length >= 4) {
      const credentialId = parts[1];
      const alg = Number(parts[2]) || -7;
      const publicKeySpki = parts.slice(3).join(":");
      return { credentialId, alg, publicKeySpki };
    }
  }

  return {
    credentialId: trimmed,
    alg: -7,
    publicKeySpki: null,
  };
}

export function extractRawCredentialId(
  raw: string | null | undefined
): string {
  const parsed = parsePasskeyCredentialRecord(raw);
  return parsed ? parsed.credentialId : "";
}

function consumeWebAuthnChallenge(
  request: Request,
  bodyChallengeToken: string | null | undefined,
  expectedScope: "owner" | "admin"
): {
  valid: boolean;
  payload?: WebAuthnChallengeTokenPayload;
  error?: string;
} {
  cleanupConsumedNonces();
  const cookieToken = readCookieFromRequest(
    request,
    WEBAUTHN_CHALLENGE_COOKIE_NAME
  );
  const candidates = [bodyChallengeToken, cookieToken].filter(
    Boolean
  ) as string[];

  for (const token of candidates) {
    const res = verifySecurityToken<WebAuthnChallengeTokenPayload>(
      token,
      "webauthn_challenge"
    );
    if (!res.valid || !res.payload) continue;
    if (res.payload.scope !== expectedScope) continue;
    if (consumedNonces.has(res.payload.jti)) {
      return {
        valid: false,
        error: "انتهت صلاحية تحدي البصمة (تم استخدامه مسبقاً). حاول مجدداً.",
      };
    }
    consumedNonces.set(res.payload.jti, res.payload.exp);
    return { valid: true, payload: res.payload };
  }

  return {
    valid: false,
    error: "تحدي المصادقة بالبصمة (WebAuthn Challenge) مفقود أو منتهي الصلاحية.",
  };
}

function verifyClientDataJson(
  clientDataJSONB64: string,
  expectedType: "webauthn.create" | "webauthn.get",
  expectedChallenge: string,
  expectedRpId: string
): { valid: boolean; clientDataBuf?: Buffer; error?: string } {
  try {
    const clientDataBuf = Buffer.from(clientDataJSONB64, "base64url");
    const parsed = JSON.parse(clientDataBuf.toString("utf-8")) as {
      type?: string;
      challenge?: string;
      origin?: string;
    };

    if (parsed.type !== expectedType) {
      return { valid: false, error: "نوع عملية WebAuthn غير مطابق." };
    }

    if (parsed.challenge !== expectedChallenge) {
      return {
        valid: false,
        error: "توقيع التحدي (Challenge) غير مطابق للتحدي الصادر من الخادم.",
      };
    }

    if (parsed.origin) {
      const originHost = new URL(parsed.origin).hostname
        .toLowerCase()
        .replace(/^www\./, "");
      const cleanRp = expectedRpId.toLowerCase().replace(/^www\./, "");
      if (
        originHost !== cleanRp &&
        !originHost.endsWith(`.${cleanRp}`) &&
        originHost !== "localhost"
      ) {
        return {
          valid: false,
          error: "نطاق مصدر البصمة (Origin) غير مطابق لنطاق المنصة.",
        };
      }
    }

    return { valid: true, clientDataBuf };
  } catch {
    return { valid: false, error: "بيانات استجابة المتصفح (clientDataJSON) تالفة." };
  }
}

/**
 * تحويل توقيع ECDSA الخام (IEEE P1363 64-byte) أو DER إلى صيغة DER القياسية للتحقق في Node crypto
 */
function ensureDerEcdsaSignature(sigBuf: Buffer): Buffer {
  // إذا كان يبدأ بـ 0x30 فهو بصيغة ASN.1 DER بالفعل
  if (sigBuf.length > 8 && sigBuf[0] === 0x30) {
    return sigBuf;
  }
  if (sigBuf.length === 64) {
    const encodeInt = (buf: Buffer) => {
      let i = 0;
      while (i < buf.length - 1 && buf[i] === 0) i++;
      const slice = buf.subarray(i);
      if (slice[0] & 0x80) {
        return Buffer.concat([Buffer.from([0x02, slice.length + 1, 0x00]), slice]);
      }
      return Buffer.concat([Buffer.from([0x02, slice.length]), slice]);
    };
    const r = encodeInt(sigBuf.subarray(0, 32));
    const s = encodeInt(sigBuf.subarray(32, 64));
    const totalLen = r.length + s.length;
    return Buffer.concat([Buffer.from([0x30, totalLen]), r, s]);
  }
  return sigBuf;
}

export function verifyWebAuthnRegistration(input: {
  request?: Request;
  req?: Request;
  scope?: "owner" | "admin";
  expectedScope?: "owner" | "admin";
  challengeToken?: string | null;
  challengeTokenFromBody?: string | null;
  credentialId: string;
  clientDataJSON?: string | null;
  clientDataJSONBase64?: string | null;
  publicKeySpki?: string | null;
  publicKeySpkiBase64?: string | null;
  publicKeyAlgorithm?: number | null;
}): {
  valid: boolean;
  ok: boolean;
  encodedRecord?: string;
  rawCredentialId?: string;
  error?: string;
} {
  const reqObj = input.request || input.req;
  const scopeVal = input.scope || input.expectedScope || "owner";
  const challengeTok = input.challengeToken ?? input.challengeTokenFromBody;
  const clientDataB64 = input.clientDataJSON ?? input.clientDataJSONBase64;
  const spkiB64 = input.publicKeySpki ?? input.publicKeySpkiBase64;

  if (!reqObj) {
    return { valid: false, ok: false, error: "طلب التحقق غير صالح." };
  }

  const challengeRes = consumeWebAuthnChallenge(
    reqObj,
    challengeTok,
    scopeVal
  );
  if (!challengeRes.valid || !challengeRes.payload) {
    return { valid: false, ok: false, error: challengeRes.error };
  }

  if (!clientDataB64 || !spkiB64) {
    return {
      valid: false,
      ok: false,
      error: "بيانات المفتاح العام أو استجابة التحدي للبصمة غير مكتملة.",
    };
  }

  const clientCheck = verifyClientDataJson(
    clientDataB64,
    "webauthn.create",
    challengeRes.payload.challenge,
    challengeRes.payload.rpId
  );
  if (!clientCheck.valid) {
    return { valid: false, ok: false, error: clientCheck.error };
  }

  // التحقق من صلاحية المفتاح العام SPKI عبر Node crypto
  try {
    const spkiBuf = Buffer.from(spkiB64, "base64url");
    crypto.createPublicKey({
      key: spkiBuf,
      format: "der",
      type: "spki",
    });
  } catch {
    return {
      valid: false,
      ok: false,
      error: "المفتاح العام للبصمة الحيوية غير صالح تشفيرياً.",
    };
  }

  const alg =
    typeof input.publicKeyAlgorithm === "number" ? input.publicKeyAlgorithm : -7;
  const rawCredentialId = extractRawCredentialId(input.credentialId);
  const encodedRecord = encodePasskeyCredentialRecord({
    credentialId: rawCredentialId,
    alg,
    publicKeySpki: spkiB64,
  });

  return {
    valid: true,
    ok: true,
    encodedRecord,
    rawCredentialId,
  };
}

export function verifyWebAuthnAssertion(input: {
  request?: Request;
  req?: Request;
  scope?: "owner" | "admin";
  expectedScope?: "owner" | "admin";
  challengeToken?: string | null;
  challengeTokenFromBody?: string | null;
  credentialId: string;
  clientDataJSON?: string | null;
  clientDataJSONBase64?: string | null;
  authenticatorData?: string | null;
  authenticatorDataBase64?: string | null;
  signature?: string | null;
  signatureBase64?: string | null;
  storedCredentialRecord: string;
}): {
  valid: boolean;
  ok: boolean;
  error?: string;
} {
  const reqObj = input.request || input.req;
  const scopeVal = input.scope || input.expectedScope || "owner";
  const challengeTok = input.challengeToken ?? input.challengeTokenFromBody;
  const clientDataB64 = input.clientDataJSON ?? input.clientDataJSONBase64;
  const authDataB64 = input.authenticatorData ?? input.authenticatorDataBase64;
  const sigB64 = input.signature ?? input.signatureBase64;

  if (!reqObj) {
    return { valid: false, ok: false, error: "طلب التحقق غير صالح." };
  }

  const challengeRes = consumeWebAuthnChallenge(
    reqObj,
    challengeTok,
    scopeVal
  );
  if (!challengeRes.valid || !challengeRes.payload) {
    return { valid: false, ok: false, error: challengeRes.error };
  }

  if (!clientDataB64 || !authDataB64 || !sigB64) {
    return {
      valid: false,
      ok: false,
      error: "بيانات التوقيع التشفيري للبصمة غير مكتملة.",
    };
  }

  const clientCheck = verifyClientDataJson(
    clientDataB64,
    "webauthn.get",
    challengeRes.payload.challenge,
    challengeRes.payload.rpId
  );
  if (!clientCheck.valid || !clientCheck.clientDataBuf) {
    return { valid: false, ok: false, error: clientCheck.error };
  }

  const authDataBuf = Buffer.from(authDataB64, "base64url");
  if (authDataBuf.length < 37) {
    return { valid: false, ok: false, error: "بيانات المصادق الحيوي (authenticatorData) قصيرة جداً." };
  }

  // فحص علم حضور المستخدم (User Present bit 0)
  const flags = authDataBuf[32];
  if ((flags & 0x01) === 0) {
    return { valid: false, ok: false, error: "لم يتم تأكيد حضور المستخدم من حساس البصمة." };
  }

  const parsedRecord = parsePasskeyCredentialRecord(input.storedCredentialRecord);
  const cleanCredId = extractRawCredentialId(input.credentialId);
  if (!parsedRecord || parsedRecord.credentialId !== cleanCredId) {
    return { valid: false, ok: false, error: "معرف البصمة غير مطابق للحساب المسجل." };
  }

  if (!parsedRecord.publicKeySpki) {
    return {
      valid: false,
      ok: false,
      error:
        "هذه البصمة مسجلة بنظام قديم بدون مفتاح عام. يرجى الدخول برقم الهاتف وإعادة تفعيل البصمة من لوحة التحكم.",
    };
  }

  try {
    const publicKeyObj = crypto.createPublicKey({
      key: Buffer.from(parsedRecord.publicKeySpki, "base64url"),
      format: "der",
      type: "spki",
    });

    const clientDataHash = crypto
      .createHash("sha256")
      .update(clientDataBufFromCheck(clientCheck.clientDataBuf))
      .digest();
    const signedData = Buffer.concat([authDataBuf, clientDataHash]);
    const rawSigBuf = Buffer.from(sigB64, "base64url");

    const sigToVerify =
      parsedRecord.alg === -257
        ? rawSigBuf
        : ensureDerEcdsaSignature(rawSigBuf);

    const isVerified = crypto.verify(
      "sha256",
      signedData,
      publicKeyObj,
      sigToVerify
    );

    if (!isVerified) {
      return {
        valid: false,
        ok: false,
        error: "فشل التحقق من التوقيع التشفيري للبصمة الحيوية.",
      };
    }

    return { valid: true, ok: true };
  } catch {
    return {
      valid: false,
      ok: false,
      error: "تعذر التحقق التشفيري من توقيع مفتاح المرور.",
    };
  }
}

function clientDataBufFromCheck(buf: Buffer): Buffer {
  return buf;
}

export function createReportReplySignature(
  reportId: string,
  tagCode: string
): string {
  const secret = getSigningSecretKey();
  return crypto
    .createHmac("sha256", secret)
    .update(`report_reply:${reportId}:${tagCode.toUpperCase().trim()}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}

export function verifyReportReplySignature(
  reportId: string,
  tagCode: string,
  sig: string
): boolean {
  if (!reportId || !tagCode || !sig) return false;
  const expected = createReportReplySignature(reportId, tagCode);
  const a = Buffer.from(sig.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
