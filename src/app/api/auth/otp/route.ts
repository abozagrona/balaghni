import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  requestSmartOtp,
  verifyOtpCode,
  getOtpSession,
} from "@/lib/otp-service";
import { formatLibyaPhoneForOtp } from "@/lib/utils";
import {
  checkOtpRateLimit,
  recordOtpAttempt,
  getClientIp,
} from "@/lib/rate-limiter";

/**
 * إنشاء عميل Supabase معزول ونظيف خاص بمسار الـ OTP
 * لا يقرأ الكوكيز (cookies) أو ترويسات المتصفح لمنع تمرير أي JWT غير صالح
 */
function getIsolatedOtpSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";

  const isValidJwt =
    serviceRoleKey.startsWith("eyJ") && serviceRoleKey.split(".").length === 3;

  if (!serviceRoleKey || !isValidJwt) {
    console.warn(
      "[OTP Route Warning] المفتاح SUPABASE_SERVICE_ROLE_KEY في Vercel غير مكتمل أو غير مضبوط بصيغة JWT صحيحة (يجب أن يبدأ بـ eyJ ويحتوي على نقطتين .)."
    );
  }

  const keyToUse = isValidJwt ? serviceRoleKey : anonKey;
  if (!supabaseUrl || !keyToUse) return null;

  return createClient(supabaseUrl, keyToUse, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * مسار التحقق الذكي عبر واتساب ورسائل SMS (Smart Multi-level Fallback OTP API)
 */
export async function POST(req: NextRequest) {
  try {
    // تهيئة وفحص عميل Supabase المعزول والتحقق من سلامة المفتاح في سجل الخادم
    getIsolatedOtpSupabaseClient();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "send").trim().toLowerCase();
    const rawPhone = String(body.phone || body.ownerPhone || "").trim();

    if (!rawPhone) {
      return NextResponse.json(
        { ok: false, error: "يرجى إدخال رقم الهاتف." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(req);
    const formattedPhone = formatLibyaPhoneForOtp(rawPhone) || rawPhone;

    // 1. إرسال رمز التحقق (طلب أولي، أو تبديل، أو إعادة إرسال) مع حماية Rate Limiting (3 طلبات كل 10 دقائق)
    if (action === "send" || action === "resend") {
      const rateLimitCheck = checkOtpRateLimit(formattedPhone, clientIp);
      if (!rateLimitCheck.allowed) {
        const minutesLeft =
          Math.ceil(rateLimitCheck.resetMs / (60 * 1000)) || 1;
        return NextResponse.json(
          {
            ok: false,
            error: `تم تجاوز الحد المسموح به لطلبات رمز التحقق (3 محاولات كل 10 دقائق). يرجى الانتظار ${minutesLeft} دقيقة والمحاولة لاحقاً لحماية رصيد الرسائل.`,
            rateLimited: true,
            remainingMinutes: minutesLeft,
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(
                Math.ceil(rateLimitCheck.resetMs / 1000)
              ),
            },
          }
        );
      }

      const preferredChannel = (
        body.channel === "sms"
          ? "sms"
          : body.channel === "whatsapp"
          ? "whatsapp"
          : "auto"
      ) as "auto" | "whatsapp" | "sms";

      const result = await requestSmartOtp(rawPhone, preferredChannel);

      if (!result.ok) {
        const errMsg = result.error || "تعذر إرسال رمز التحقق.";
        return NextResponse.json(
          {
            ok: false,
            error: errMsg.startsWith("[")
              ? errMsg
              : `[requestSmartOtp] ${errMsg}`,
          },
          { status: 400 }
        );
      }

      // تسجيل محاولة الإرسال الناجحة في سجل Rate Limiting
      recordOtpAttempt(formattedPhone, clientIp);

      return NextResponse.json({
        ok: true,
        phone: result.phone,
        channel: result.channel,
        message: result.message,
        countdownSeconds: result.countdownSeconds || 60,
        validityMinutes: result.validityMinutes || 5,
        existsWhatsapp: result.existsWhatsapp,
        fallback: result.fallback,
      });
    }

    // 2. مطابقة والتحقق من رمز التحقق المدخل
    if (action === "verify") {
      const code = String(body.code || body.otp || body.pin || "").trim();
      if (!code) {
        return NextResponse.json(
          { ok: false, error: "يرجى إدخال رمز التحقق المكون من 6 أرقام." },
          { status: 400 }
        );
      }

      const result = await verifyOtpCode(rawPhone, code);

      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error || "رمز التحقق غير صحيح." },
          { status: 400 }
        );
      }

      return NextResponse.json({
        ok: true,
        phone: result.phone,
        message: "تم التحقق من الرمز بنجاح!",
      });
    }

    // 3. الاستعلام عن حالة جلسة الرمز الحالية
    if (action === "status") {
      const formatted = formatLibyaPhoneForOtp(rawPhone);
      if (!formatted) {
        return NextResponse.json({ ok: false, active: false });
      }
      const sess = getOtpSession(formatted);
      if (!sess) {
        return NextResponse.json({ ok: true, active: false });
      }

      const remainingSec = Math.max(
        0,
        Math.ceil((sess.expiresAt - Date.now()) / 1000)
      );

      return NextResponse.json({
        ok: true,
        active: true,
        phone: sess.phone,
        channel: sess.channel,
        secondsRemaining: remainingSec,
        existsWhatsapp: sess.existsWhatsapp,
      });
    }

    return NextResponse.json(
      { ok: false, error: "إجراء غير معروف." },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "حدث خطأ غير متوقع أثناء معالجة الطلب.",
      },
      { status: 500 }
    );
  }
}
