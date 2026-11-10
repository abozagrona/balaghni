import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * تنسيق كود ملصق «بَلِّغْنِي» ليبدأ دائماً بمفتاح ليبيا LY-
 * مثال: "123456" -> "LY-123456" | "ly-24757e" -> "LY-24757E"
 */
export function formatBalaghniTagCode(rawCode: string): string {
  const cleaned = decodeURIComponent(rawCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");

  if (!cleaned) return "LY-000000";
  if (cleaned.startsWith("LY-")) return cleaned;
  if (cleaned.startsWith("LY") && cleaned.length > 2) {
    return `LY-${cleaned.slice(2)}`;
  }
  return `LY-${cleaned.replace(/^[A-Z]+-/, "")}`;
}

/**
 * تطبيع رقم الهاتف الليبي (+218)
 * يدعم شبكات المدار (91, 93) وليبيانا (92, 94)
 * يحذف الصفر الابتدائي تلقائياً: 0912345678 -> 912345678
 */
export function normalizeLibyaPhoneDigits(raw: string): string {
  let digits = raw.replace(/\D/g, "");

  if (digits.startsWith("00218")) {
    digits = digits.slice(5);
  } else if (digits.startsWith("218") && digits.length > 9) {
    digits = digits.slice(3);
  }

  while (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return digits.slice(0, 9);
}

export function formatFullLibyaE164(localDigits: string): string | null {
  const normalized = normalizeLibyaPhoneDigits(localDigits);
  if (!/^9[1-5]\d{7}$/.test(normalized)) {
    return null;
  }
  return `+218${normalized}`;
}

/**
 * تحويل ArrayBuffer (مثل credential.rawId في WebAuthn) إلى Base64URL string
 */
export function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * تحويل Base64URL string إلى Uint8Array لتمريره في allowCredentials بـ WebAuthn
 */
export function base64UrlToUint8Array(
  base64Url: string
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
