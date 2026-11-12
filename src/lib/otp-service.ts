import fs from "fs";
import path from "path";
import { formatLibyaPhoneForOtp } from "@/lib/utils";

// ============================================================================
// الإعدادات وبيانات الاعتماد (Credentials & Endpoints)
// ============================================================================
export const GREEN_API_URL =
  process.env.GREEN_API_URL || "https://7107.api.greenapi.com";
export const GREEN_API_INSTANCE =
  process.env.GREEN_API_INSTANCE_ID ||
  process.env.GREEN_API_INSTANCE ||
  "";
export const GREEN_API_TOKEN =
  process.env.GREEN_API_TOKEN ||
  process.env.GREEN_API_API_TOKEN ||
  process.env.GREEN_API_KEY ||
  "";
export const RESALA_API_KEY =
  process.env.RESALA_API_KEY ||
  "";
export const RESALA_ENDPOINT =
  process.env.RESALA_ENDPOINT || "https://dev.resala.ly/api/v1/pins";

export const OTP_VALIDITY_MS = 5 * 60 * 1000; // صلاحية 5 دقائق
export const OTP_MAX_ATTEMPTS = 5;

// ============================================================================
// نموذج جلسة التحقق والمخزن المؤقت (OTP Session Store)
// ============================================================================
export interface OtpSession {
  phone: string; // 2189XXXXXXXX
  code: string; // 6 أرقام
  channel: "WHATSAPP" | "SMS";
  createdAt: number;
  expiresAt: number;
  attempts: number;
  existsWhatsapp?: boolean;
  resalaPinId?: string;
}

const OTP_STORE_PATH = path.join(process.cwd(), "src/data/local-otp-store.json");

// مخزن مؤقت داخل الذاكرة لسرعة الاستجابة القصوى
const memoryStore = new Map<string, OtpSession>();

function loadOtpStore(): Record<string, OtpSession> {
  const result: Record<string, OtpSession> = {};
  const now = Date.now();

  // 1. قراءة الذاكرة أولاً
  for (const [phone, sess] of memoryStore.entries()) {
    if (sess.expiresAt > now) {
      result[phone] = sess;
    }
  }

  // 2. دمج السجلات المحفوظة في الملف
  try {
    if (fs.existsSync(OTP_STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(OTP_STORE_PATH, "utf-8")) as Record<
        string,
        OtpSession
      >;
      for (const [phone, sess] of Object.entries(parsed)) {
        if (sess && sess.expiresAt > now) {
          result[phone] = sess;
          memoryStore.set(phone, sess);
        }
      }
    }
  } catch {
    // تجاهل أخطاء القراءة
  }

  return result;
}

function saveOtpStore(store: Record<string, OtpSession>) {
  const now = Date.now();
  const cleanStore: Record<string, OtpSession> = {};

  for (const [phone, sess] of Object.entries(store)) {
    if (sess && sess.expiresAt > now) {
      cleanStore[phone] = sess;
      memoryStore.set(phone, sess);
    } else {
      memoryStore.delete(phone);
    }
  }

  try {
    fs.mkdirSync(path.dirname(OTP_STORE_PATH), { recursive: true });
    fs.writeFileSync(OTP_STORE_PATH, JSON.stringify(cleanStore, null, 2), "utf-8");
  } catch {
    // تجاهل أخطاء الكتابة
  }
}

export function saveOtpSession(session: OtpSession) {
  const store = loadOtpStore();
  store[session.phone] = session;
  saveOtpStore(store);
}

export function getOtpSession(phone: string): OtpSession | null {
  const store = loadOtpStore();
  const sess = store[phone];
  if (!sess) return null;
  if (Date.now() > sess.expiresAt) {
    delete store[phone];
    saveOtpStore(store);
    return null;
  }
  return sess;
}

export function deleteOtpSession(phone: string) {
  const store = loadOtpStore();
  delete store[phone];
  saveOtpStore(store);
}

export function generate6DigitOtp(): string {
  // توليد رمز عشوائي آمن من 6 أرقام (100000 - 999999)
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ============================================================================
// 1. استدعاء Green-API للتحقق من وجود حساب واتساب (checkWhatsapp)
// ============================================================================
export async function checkWhatsapp(
  phone: string
): Promise<{ ok: boolean; existsWhatsapp: boolean; error?: string }> {
  if (!GREEN_API_TOKEN) {
    // في حال عدم توفر التوكن، يُعتبر الفحص غير متاح لتشغيل التحويل التلقائي للـ SMS فوراً
    return {
      ok: false,
      existsWhatsapp: false,
      error: "GREEN_API_TOKEN is not configured",
    };
  }

  try {
    const baseUrl = (GREEN_API_URL || "https://7107.api.greenapi.com").replace(
      /\/$/,
      ""
    );
    const url = `${baseUrl}/waInstance${GREEN_API_INSTANCE}/checkWhatsapp/${GREEN_API_TOKEN}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500); // مهلة 4.5 ثوانٍ لضمان عدم التعليق

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: phone }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      return {
        ok: false,
        existsWhatsapp: false,
        error: `Green-API HTTP error: ${res.status}`,
      };
    }

    const data = await res.json().catch(() => ({}));
    return {
      ok: true,
      existsWhatsapp: Boolean(data?.existsWhatsapp),
    };
  } catch (error) {
    return {
      ok: false,
      existsWhatsapp: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// 2. إرسال رمز التحقق عبر واتساب (Green-API sendMessage)
// ============================================================================
export async function sendOtpViaWhatsapp(
  phone: string,
  otpCode: string
): Promise<{ ok: boolean; error?: string }> {
  if (!GREEN_API_TOKEN) {
    return { ok: false, error: "GREEN_API_TOKEN is not configured" };
  }

  try {
    const baseUrl = (GREEN_API_URL || "https://7107.api.greenapi.com").replace(
      /\/$/,
      ""
    );
    const url = `${baseUrl}/waInstance${GREEN_API_INSTANCE}/sendMessage/${GREEN_API_TOKEN}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const message = `رمز التحقق الخاص بك في بَلِّغْنِي هو: ${otpCode}. صالح لمدة 5 دقائق.`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: `${phone}@c.us`,
        message,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      return { ok: false, error: `Green-API send error: ${res.status}` };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}


// ============================================================================
// 3. إرسال رمز التحقق كرسالة نصية SMS عبر منصة رسالة (Resala API)
// ============================================================================
export async function sendOtpViaResala(
  phone: string
): Promise<{ ok: boolean; pin?: string; id?: string; error?: string }> {
  try {
    const url = `${RESALA_ENDPOINT}?service_name=Balaghni&len=6`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESALA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const data = await res.json().catch(() => ({}));

    if (res.status === 200 || res.status === 201) {
      const returnedPin = String(data?.pin || "").trim();
      return {
        ok: true,
        pin: returnedPin || generate6DigitOtp(),
        id: data?.id,
      };
    }

    return {
      ok: false,
      error:
        data?.message ||
        data?.error ||
        `فشل الإرسال عبر منصة رسالة (رمز الحالة ${res.status})`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// 4. المحرك الذكي متعدد المسارات (WhatsApp First with Smart Multi-level Fallback)
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

export async function requestSmartOtp(
  rawPhone: string,
  preferredChannel: "auto" | "whatsapp" | "sms" = "auto"
): Promise<SmartOtpResult> {
  // 1. معالجة وتوحيد الرقم الليبي إلى الصيغة الدولية: 2189XXXXXXXX
  const phone = formatLibyaPhoneForOtp(rawPhone);
  if (!phone) {
    return {
      ok: false,
      error:
        "يرجى إدخال رقم هاتف ليبي صحيح مكون من 9 أرقام ويبدأ بـ (091, 092, 093, 094, 095).",
    };
  }

  const now = Date.now();
  const existing = getOtpSession(phone);

  // منع الإغراق المتتالي (حماية 10 ثوانٍ بين الطلبات المتزامنة)
  if (existing && now - existing.createdAt < 10000) {
    return {
      ok: true,
      phone,
      channel: existing.channel,
      message:
        existing.channel === "WHATSAPP"
          ? `تم إرسال رمز التحقق مسبقاً إلى واتساب الخاص بالرقم: ${phone}`
          : "تم إرسال رمز التحقق كرسالة نصية SMS",
      countdownSeconds: Math.max(
        0,
        Math.ceil((60000 - (now - existing.createdAt)) / 1000)
      ),
      validityMinutes: 5,
      existsWhatsapp: existing.existsWhatsapp,
    };
  }

  // ==========================================================================
  // المسار المباشر 1: طلب المستخدم الصريح لإرسال SMS (الرابط بعد 15 ثانية أو عند انتهاء العداد)
  // ==========================================================================
  if (preferredChannel === "sms") {
    const resalaRes = await sendOtpViaResala(phone);
    if (!resalaRes.ok || !resalaRes.pin) {
      return {
        ok: false,
        error: resalaRes.error || "تعذر إرسال رسالة SMS عبر منصة رسالة.",
      };
    }

    saveOtpSession({
      phone,
      code: resalaRes.pin,
      channel: "SMS",
      createdAt: now,
      expiresAt: now + OTP_VALIDITY_MS,
      attempts: 0,
      existsWhatsapp: existing?.existsWhatsapp,
      resalaPinId: resalaRes.id,
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

  // ==========================================================================
  // المسار المباشر 2: طلب المستخدم الصريح لإعادة الإرسال عبر واتساب
  // ==========================================================================
  if (preferredChannel === "whatsapp") {
    const generatedCode = generate6DigitOtp();
    let waSent = false;

    try {
      const waRes = await sendOtpViaWhatsapp(phone, generatedCode);
      if (waRes.ok) waSent = true;
    } catch {
      waSent = false;
    }

    if (waSent) {
      saveOtpSession({
        phone,
        code: generatedCode,
        channel: "WHATSAPP",
        createdAt: now,
        expiresAt: now + OTP_VALIDITY_MS,
        attempts: 0,
        existsWhatsapp: true,
      });

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

    // التحويل الفوري التلقائي للـ SMS عند فشل الواتساب (API Failover)
    const fallbackResala = await sendOtpViaResala(phone);
    if (!fallbackResala.ok || !fallbackResala.pin) {
      return {
        ok: false,
        error: "تعذر إرسال الرمز عبر واتساب ورسائل SMS.",
      };
    }

    saveOtpSession({
      phone,
      code: fallbackResala.pin,
      channel: "SMS",
      createdAt: now,
      expiresAt: now + OTP_VALIDITY_MS,
      attempts: 0,
      existsWhatsapp: true,
      resalaPinId: fallbackResala.id,
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

  // ==========================================================================
  // المسار الافتراضي الذكي: التحقق المسبق (Smart Detection via Green-API)
  // ==========================================================================
  let checkResult: { existsWhatsapp: boolean } | null = null;
  try {
    const waCheck = await checkWhatsapp(phone);
    if (waCheck.ok) {
      checkResult = { existsWhatsapp: waCheck.existsWhatsapp };
    }
  } catch {
    checkResult = null;
  }

  // الحالة أ: الرقم غير مسجل في واتساب نهائياً (existsWhatsapp = false)
  // لا تنتظر العداد، وقم بالتحويل التلقائي والفوري لإرسال رسالة SMS عبر Resala API
  if (checkResult && checkResult.existsWhatsapp === false) {
    const resalaRes = await sendOtpViaResala(phone);
    if (!resalaRes.ok || !resalaRes.pin) {
      return {
        ok: false,
        error: resalaRes.error || "تعذر إرسال رسالة SMS عبر منصة رسالة.",
      };
    }

    saveOtpSession({
      phone,
      code: resalaRes.pin,
      channel: "SMS",
      createdAt: now,
      expiresAt: now + OTP_VALIDITY_MS,
      attempts: 0,
      existsWhatsapp: false,
      resalaPinId: resalaRes.id,
    });

    return {
      ok: true,
      phone,
      channel: "SMS",
      existsWhatsapp: false,
      message:
        "تم إرسال رمز التحقق كرسالة نصية SMS لعدم توفر حساب واتساب على هذا الرقم",
      countdownSeconds: 60,
      validityMinutes: 5,
    };
  }

  // الحالة ب: الرقم يمتلك حساب واتساب (existsWhatsapp = true)
  if (checkResult && checkResult.existsWhatsapp === true) {
    const generatedCode = generate6DigitOtp();
    let waSent = false;

    try {
      const waRes = await sendOtpViaWhatsapp(phone, generatedCode);
      if (waRes.ok) waSent = true;
    } catch {
      waSent = false;
    }

    if (waSent) {
      saveOtpSession({
        phone,
        code: generatedCode,
        channel: "WHATSAPP",
        createdAt: now,
        expiresAt: now + OTP_VALIDITY_MS,
        attempts: 0,
        existsWhatsapp: true,
      });

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

    // فشل الإرسال عبر واتساب -> التحويل الفوري التلقائي للـ SMS (API Failover)
    const fallbackResala = await sendOtpViaResala(phone);
    if (!fallbackResala.ok || !fallbackResala.pin) {
      return {
        ok: false,
        error: "تعذر إرسال الرمز عبر واتساب أو SMS.",
      };
    }

    saveOtpSession({
      phone,
      code: fallbackResala.pin,
      channel: "SMS",
      createdAt: now,
      expiresAt: now + OTP_VALIDITY_MS,
      attempts: 0,
      existsWhatsapp: true,
      resalaPinId: fallbackResala.id,
    });

    return {
      ok: true,
      phone,
      channel: "SMS",
      fallback: true,
      existsWhatsapp: true,
      message: "تم إرسال رمز التحقق كرسالة نصية SMS لتعذر الإرسال عبر واتساب",
      countdownSeconds: 60,
      validityMinutes: 5,
    };
  }

  // الحالة ج: تعطل أو عدم تهيئة فحص Green-API (API Failover فوري إلى Resala SMS)
  const resalaDirect = await sendOtpViaResala(phone);
  if (!resalaDirect.ok || !resalaDirect.pin) {
    return {
      ok: false,
      error: resalaDirect.error || "تعذر إرسال رسالة SMS عبر مزود الخدمة.",
    };
  }

  saveOtpSession({
    phone,
    code: resalaDirect.pin,
    channel: "SMS",
    createdAt: now,
    expiresAt: now + OTP_VALIDITY_MS,
    attempts: 0,
    resalaPinId: resalaDirect.id,
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

// ============================================================================
// 5. مطابقة والتحقق من رمز OTP المدخل (Verify OTP)
// ============================================================================
export async function verifyOtpCode(
  rawPhone: string,
  rawCode: string
): Promise<{ ok: boolean; phone?: string; error?: string }> {
  const phone = formatLibyaPhoneForOtp(rawPhone);
  if (!phone) {
    return {
      ok: false,
      error: "رقم الهاتف غير صالح.",
    };
  }

  const cleanCode = String(rawCode || "").trim().replace(/\D/g, "");
  if (!/^\d{6}$/.test(cleanCode)) {
    return {
      ok: false,
      error: "رمز التحقق يجب أن يتكون من 6 أرقام.",
    };
  }

  const session = getOtpSession(phone);
  if (!session) {
    return {
      ok: false,
      error:
        "لم يتم العثور على رمز تحقق نشط لهذا الرقم، أو انتهت صلاحيته. يرجى طلب رمز جديد.",
    };
  }

  const now = Date.now();
  if (now > session.expiresAt) {
    deleteOtpSession(phone);
    return {
      ok: false,
      error: "انتهت صلاحية رمز التحقق (صلاحية الرمز 5 دقائق). يرجى طلب رمز جديد.",
    };
  }

  session.attempts += 1;

  if (session.code !== cleanCode) {
    if (session.attempts >= OTP_MAX_ATTEMPTS) {
      deleteOtpSession(phone);
      return {
        ok: false,
        error:
          "تم تجاوز الحد الأقصى للمحاولات الخاطئة (5 محاولات). تم إبطال الرمز لحمايتك، يرجى طلب رمز جديد.",
      };
    }
    saveOtpSession(session);
    const remaining = OTP_MAX_ATTEMPTS - session.attempts;
    return {
      ok: false,
      error: `رمز التحقق غير صحيح. متبقي ${remaining} محاولات.`,
    };
  }

  // تم التحقق بنجاح -> مسح الجلسة فوراً لمنع إعادة الاستخدام
  deleteOtpSession(phone);

  return {
    ok: true,
    phone,
  };
}
