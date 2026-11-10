/**
 * ضغط الصور الملتقطة عبر كاميرا الهاتف على جهاز المستخدم (Client-Side Canvas)
 * لتسريع إرسال التنبيه عبر شبكات الجيل الثالث/الرابع في ليبيا.
 */

const MAX_DIMENSION = 1600;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function compressImageFile(file: File): Promise<File> {
  if (typeof window === "undefined") return file;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size > MAX_FILE_BYTES) {
            resolve(file);
            return;
          }
          const compressedFile = new File(
            [blob],
            file.name.replace(/\.[^.]+$/, ".jpg"),
            { type: "image/jpeg", lastModified: Date.now() }
          );
          resolve(compressedFile);
        },
        "image/jpeg",
        0.82
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("تعذر قراءة ملف الصورة."));
    };

    img.src = objectUrl;
  });
}

/**
 * توليد بصمة خفيفة للمتصفح لمنع الإزعاج المتكرر (Anti-Spam Fingerprint)
 */
export function getBrowserFingerprint(): string {
  if (typeof window === "undefined") return "server";
  const STORAGE_KEY = "balaghni-device-id";
  let deviceId = "";

  try {
    deviceId = window.localStorage.getItem(STORAGE_KEY) || "";
    if (!deviceId) {
      deviceId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `ly-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(STORAGE_KEY, deviceId);
    }
  } catch {
    deviceId = "anon";
  }

  const meta = [
    deviceId,
    navigator.language,
    screen.width,
    screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join("|");

  return meta;
}
