import crypto from "crypto";

// ============================================================================
// وحدة التشفير واشتقاق المفاتيح المستقلة لـ OTP وتتبع التسليم (HKDF-SHA256 + AES-256-GCM)
//
// 3 إصدارات مفاتيح مستقلة تماماً وسياقات HKDF-SHA256 منفصلة:
//   1. phone_hmac_key_version -> info: "balaghni:phone-hmac:v<n>"
//   2. otp_hmac_key_version   -> info: "balaghni:otp-hmac:v<k>"
//   3. enc_key_version        -> info: "balaghni:otp-payload-aes256gcm:v<m>"
//
// ملاحظات أمنية:
//   - إلزام SESSION_HMAC_SECRET في Production (Fail-Closed، >= 32 بايت، بدون Placeholder).
//   - دعم تدوير المفاتيح عبر SESSION_HMAC_SECRET_PREVIOUS للقراءة والتحقق وفك التشفير فقط.
//   - استخدام crypto.randomInt لتوليد OTP وcrypto.timingSafeEqual مع التحقق من الطول.
//   - عدم طباعة أي سر أو رمز OTP أو رقم هاتف خام في السجلات.
// ============================================================================

export const OTP_VALIDITY_MS = 5 * 60 * 1000; // 5 دقائق بالضبط (متطابق مع SQL CHECK)
export const OTP_MAX_ATTEMPTS = 5; // 5 محاولات بالضبط (متطابق مع SQL CHECK)

const HKDF_SALT = Buffer.from("balaghni-hkdf-salt-v1", "utf8");
const MIN_SECRET_BYTES = 32;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export type KeyPurpose = "phone_hmac" | "otp_hmac" | "enc";

export interface ActiveKeyVersions {
  phoneHmacKeyVersion: number;
  otpHmacKeyVersion: number;
  encKeyVersion: number;
  previousPhoneHmacKeyVersion: number | null;
  previousOtpHmacKeyVersion: number | null;
  previousEncKeyVersion: number | null;
}

export class OtpCryptoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtpCryptoConfigError";
  }
}

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
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

function parsePositiveSmallInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw || "").trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 32767) return fallback;
  return n;
}

function parseOptionalPositiveSmallInt(raw: string | undefined): number | null {
  if (!raw || !raw.trim()) return null;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 32767) return null;
  return n;
}

function readCurrentRootSecret(): string {
  const isProd = isProductionRuntime();
  const raw = isProd
    ? process.env.SESSION_HMAC_SECRET?.trim() || ""
    : process.env.SESSION_HMAC_SECRET?.trim() ||
      process.env.SESSION_SIGNING_SECRET?.trim() ||
      process.env.ADMIN_MASTER_SECRET?.trim() ||
      "";

  if (!raw || isPlaceholderSecret(raw)) {
    throw new OtpCryptoConfigError(
      isProd
        ? "SESSION_HMAC_SECRET is required in production for HKDF key derivation."
        : "OTP root signing secret is not configured or uses a placeholder."
    );
  }

  if (Buffer.byteLength(raw, "utf8") < MIN_SECRET_BYTES) {
    throw new OtpCryptoConfigError(
      "OTP root signing secret does not meet the minimum 32-byte strength requirement."
    );
  }

  return raw;
}

function readPreviousRootSecret(): string | null {
  const raw = process.env.SESSION_HMAC_SECRET_PREVIOUS?.trim() || "";
  if (!raw) return null;
  if (isPlaceholderSecret(raw) || Buffer.byteLength(raw, "utf8") < MIN_SECRET_BYTES) {
    throw new OtpCryptoConfigError(
      "SESSION_HMAC_SECRET_PREVIOUS is set but invalid or weaker than 32 bytes."
    );
  }
  return raw;
}

export function getActiveKeyVersions(): ActiveKeyVersions {
  const defaultCurrent = parsePositiveSmallInt(process.env.SESSION_HMAC_KEY_VERSION, 1);
  const phoneHmacKeyVersion = parsePositiveSmallInt(
    process.env.SESSION_PHONE_HMAC_KEY_VERSION,
    defaultCurrent
  );
  const otpHmacKeyVersion = parsePositiveSmallInt(
    process.env.SESSION_OTP_HMAC_KEY_VERSION,
    defaultCurrent
  );
  const encKeyVersion = parsePositiveSmallInt(
    process.env.SESSION_ENC_KEY_VERSION,
    defaultCurrent
  );

  const hasPrevSecret = Boolean(process.env.SESSION_HMAC_SECRET_PREVIOUS?.trim());
  const defaultPrev = hasPrevSecret
    ? parseOptionalPositiveSmallInt(process.env.SESSION_HMAC_PREVIOUS_KEY_VERSION) ??
      (defaultCurrent > 1 ? defaultCurrent - 1 : null)
    : null;

  const previousPhoneHmacKeyVersion = hasPrevSecret
    ? parseOptionalPositiveSmallInt(process.env.SESSION_PHONE_HMAC_PREVIOUS_KEY_VERSION) ??
      (phoneHmacKeyVersion > 1 ? phoneHmacKeyVersion - 1 : defaultPrev)
    : null;

  const previousOtpHmacKeyVersion = hasPrevSecret
    ? parseOptionalPositiveSmallInt(process.env.SESSION_OTP_HMAC_PREVIOUS_KEY_VERSION) ??
      (otpHmacKeyVersion > 1 ? otpHmacKeyVersion - 1 : defaultPrev)
    : null;

  const previousEncKeyVersion = hasPrevSecret
    ? parseOptionalPositiveSmallInt(process.env.SESSION_ENC_PREVIOUS_KEY_VERSION) ??
      (encKeyVersion > 1 ? encKeyVersion - 1 : defaultPrev)
    : null;

  return {
    phoneHmacKeyVersion,
    otpHmacKeyVersion,
    encKeyVersion,
    previousPhoneHmacKeyVersion,
    previousOtpHmacKeyVersion,
    previousEncKeyVersion,
  };
}

function buildHkdfInfo(purpose: KeyPurpose, version: number): Buffer {
  switch (purpose) {
    case "phone_hmac":
      return Buffer.from(`balaghni:phone-hmac:v${version}`, "utf8");
    case "otp_hmac":
      return Buffer.from(`balaghni:otp-hmac:v${version}`, "utf8");
    case "enc":
      return Buffer.from(`balaghni:otp-payload-aes256gcm:v${version}`, "utf8");
  }
}

function resolveRootSecretForVersion(purpose: KeyPurpose, targetVersion: number): string {
  const versions = getActiveKeyVersions();
  const currentVersion =
    purpose === "phone_hmac"
      ? versions.phoneHmacKeyVersion
      : purpose === "otp_hmac"
      ? versions.otpHmacKeyVersion
      : versions.encKeyVersion;

  if (targetVersion === currentVersion) {
    return readCurrentRootSecret();
  }

  const prevVersion =
    purpose === "phone_hmac"
      ? versions.previousPhoneHmacKeyVersion
      : purpose === "otp_hmac"
      ? versions.previousOtpHmacKeyVersion
      : versions.previousEncKeyVersion;

  const prevSecret = readPreviousRootSecret();
  if (prevSecret && prevVersion !== null && targetVersion === prevVersion) {
    return prevSecret;
  }

  throw new OtpCryptoConfigError(
    `Requested ${purpose} key version v${targetVersion} is not available in active or previous key configuration.`
  );
}

/**
 * اشتقاق مفتاح 32 بايت مستقل عبر HKDF-SHA256 (RFC 5869) لكل غرض وإصدار
 */
export function deriveHkdfKey(purpose: KeyPurpose, version?: number): Buffer {
  const versions = getActiveKeyVersions();
  const resolvedVersion =
    version ??
    (purpose === "phone_hmac"
      ? versions.phoneHmacKeyVersion
      : purpose === "otp_hmac"
      ? versions.otpHmacKeyVersion
      : versions.encKeyVersion);

  if (!Number.isInteger(resolvedVersion) || resolvedVersion < 1) {
    throw new OtpCryptoConfigError(`Invalid key version for ${purpose}`);
  }

  const ikm = Buffer.from(resolveRootSecretForVersion(purpose, resolvedVersion), "utf8");
  const info = buildHkdfInfo(purpose, resolvedVersion);
  const derived = crypto.hkdfSync("sha256", ikm, HKDF_SALT, info, 32);
  return Buffer.from(derived);
}

/**
 * توليد رمز OTP تشفيري آمن من 6 أرقام عبر crypto.randomInt (بدلاً من Math.random)
 */
export function generateSecure6DigitOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function generateOtpSessionSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

function normalizePhoneDigits(phone: string): string {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  if (digits.length < 8) {
    throw new OtpCryptoConfigError("Invalid phone number for cryptographic hashing.");
  }
  return digits;
}

export function computePhoneHmac(
  phone: string,
  phoneHmacKeyVersion?: number
): { phoneHash: string; phoneHmacKeyVersion: number } {
  const versions = getActiveKeyVersions();
  const ver = phoneHmacKeyVersion ?? versions.phoneHmacKeyVersion;
  const key = deriveHkdfKey("phone_hmac", ver);
  const digits = normalizePhoneDigits(phone);
  const phoneHash = crypto.createHmac("sha256", key).update(digits).digest("hex");
  return { phoneHash, phoneHmacKeyVersion: ver };
}

export function computePhoneHmacCandidates(phone: string): {
  currentHash: string;
  currentVersion: number;
  previousHash: string | null;
  previousVersion: number | null;
} {
  const versions = getActiveKeyVersions();
  const cur = computePhoneHmac(phone, versions.phoneHmacKeyVersion);
  if (
    versions.previousPhoneHmacKeyVersion !== null &&
    versions.previousPhoneHmacKeyVersion !== versions.phoneHmacKeyVersion &&
    readPreviousRootSecret()
  ) {
    const prev = computePhoneHmac(phone, versions.previousPhoneHmacKeyVersion);
    return {
      currentHash: cur.phoneHash,
      currentVersion: cur.phoneHmacKeyVersion,
      previousHash: prev.phoneHash,
      previousVersion: prev.phoneHmacKeyVersion,
    };
  }
  return {
    currentHash: cur.phoneHash,
    currentVersion: cur.phoneHmacKeyVersion,
    previousHash: null,
    previousVersion: null,
  };
}

export function computeOtpHmac(
  otpCode: string,
  sessionSalt: string,
  otpHmacKeyVersion?: number
): { otpHash: string; otpHmacKeyVersion: number } {
  const cleanCode = String(otpCode || "").trim();
  const cleanSalt = String(sessionSalt || "").trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    throw new OtpCryptoConfigError("OTP code must be exactly 6 digits.");
  }
  if (cleanSalt.length < 16) {
    throw new OtpCryptoConfigError("Invalid OTP session salt.");
  }
  const versions = getActiveKeyVersions();
  const ver = otpHmacKeyVersion ?? versions.otpHmacKeyVersion;
  const key = deriveHkdfKey("otp_hmac", ver);
  const otpHash = crypto
    .createHmac("sha256", key)
    .update(`${cleanSalt}:${cleanCode}`)
    .digest("hex");
  return { otpHash, otpHmacKeyVersion: ver };
}

/**
 * مقارنة ثابتة الزمن في Node.js عبر crypto.timingSafeEqual مع التحقق الصارم من الطول
 */
export function verifyOtpHmacConstantTime(
  storedHex: string | null | undefined,
  candidateHex: string | null | undefined
): boolean {
  const a = String(storedHex || "").trim().toLowerCase();
  const b = String(candidateHex || "").trim().toLowerCase();
  if (!SHA256_HEX_RE.test(a) || !SHA256_HEX_RE.test(b)) {
    return false;
  }
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== 32 || bufB.length !== 32 || bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface EncryptedOtpPayloadData {
  phone: string;
  otp: string;
}

function buildPayloadAad(
  encKeyVersion: number,
  phoneHash: string,
  sessionSalt: string
): Buffer {
  return Buffer.from(`v${encKeyVersion}:${phoneHash}:${sessionSalt}`, "utf8");
}

/**
 * تشفير { phone, otp } قصير العمر بـ AES-256-GCM لإتاحة إرسال الرمز نفسه عبر Resala عند التحويل
 */
export function encryptOtpPayload(params: {
  phone: string;
  otp: string;
  phoneHash: string;
  sessionSalt: string;
  encKeyVersion?: number;
}): { ciphertext: string; encKeyVersion: number } {
  const digits = normalizePhoneDigits(params.phone);
  const cleanOtp = String(params.otp || "").trim();
  if (!/^\d{6}$/.test(cleanOtp)) {
    throw new OtpCryptoConfigError("OTP payload must contain a valid 6-digit code.");
  }
  const cleanHash = String(params.phoneHash || "").trim().toLowerCase();
  if (!SHA256_HEX_RE.test(cleanHash)) {
    throw new OtpCryptoConfigError("Invalid phoneHash for AES-GCM AAD.");
  }

  const versions = getActiveKeyVersions();
  const ver = params.encKeyVersion ?? versions.encKeyVersion;
  const key = deriveHkdfKey("enc", ver);
  const iv = crypto.randomBytes(12);
  const aad = buildPayloadAad(ver, cleanHash, params.sessionSalt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const plaintext = Buffer.from(JSON.stringify({ phone: digits, otp: cleanOtp }), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const ciphertext = `v${ver}:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
  return { ciphertext, encKeyVersion: ver };
}

export function decryptOtpPayload(params: {
  ciphertext: string;
  phoneHash: string;
  sessionSalt: string;
  encKeyVersion: number;
}): EncryptedOtpPayloadData {
  const raw = String(params.ciphertext || "").trim();
  const parts = raw.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    throw new OtpCryptoConfigError("Malformed encrypted OTP payload format.");
  }

  const embeddedVersion = Number.parseInt(parts[0].slice(1), 10);
  if (!Number.isInteger(embeddedVersion) || embeddedVersion !== params.encKeyVersion) {
    throw new OtpCryptoConfigError("Encrypted OTP payload key version mismatch.");
  }

  const cleanHash = String(params.phoneHash || "").trim().toLowerCase();
  if (!SHA256_HEX_RE.test(cleanHash)) {
    throw new OtpCryptoConfigError("Invalid phoneHash for AES-GCM decryption.");
  }

  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ct = Buffer.from(parts[3], "base64url");
  if (iv.length !== 12 || tag.length !== 16 || ct.length === 0) {
    throw new OtpCryptoConfigError("Invalid AES-GCM IV or auth tag length.");
  }

  const key = deriveHkdfKey("enc", params.encKeyVersion);
  const aad = buildPayloadAad(params.encKeyVersion, cleanHash, params.sessionSalt);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(decrypted) as Partial<EncryptedOtpPayloadData>;

  if (
    typeof parsed.phone !== "string" ||
    typeof parsed.otp !== "string" ||
    !/^\d{6}$/.test(parsed.otp)
  ) {
    throw new OtpCryptoConfigError("Decrypted OTP payload failed schema validation.");
  }

  return { phone: parsed.phone, otp: parsed.otp };
}
