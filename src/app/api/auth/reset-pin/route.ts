import { NextRequest, NextResponse } from "next/server";
import {
  resetOwnerPinByRecoveryKey,
  resetOwnerPinByOtp,
} from "@/lib/supabase/client";
import { verifyOtpCode } from "@/lib/otp-service";
import { formatFullLibyaE164 } from "@/lib/utils";
import {
  verifyAndConsumeOtpProof,
  createOwnerSessionToken,
  attachOwnerSessionCookie,
} from "@/lib/security-tokens";
import {
  checkPinRateLimitAsync,
  recordPinFailureAsync,
  clearPinFailuresAsync,
  getClientIp,
} from "@/lib/rate-limiter";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawPhone = String(body.ownerPhone || body.phone || "").trim();
    const recoveryKey = String(body.recoveryKey || "").trim().toUpperCase();
    const otpCode = String(body.otpCode || body.otp || "").trim();
    const newPin = String(body.newPin || "").trim();

    const fullPhone = formatFullLibyaE164(rawPhone);
    if (!fullPhone) {
      return NextResponse.json(
        {
          ok: false,
          error: "يرجى إدخال رقم الهاتف الليبي المسجل بشكل صحيح.",
        },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(newPin)) {
      return NextResponse.json(
        {
          ok: false,
          error: "يرجى اختيار رمز مرور جديد مكون من 6 أرقام.",
        },
        { status: 400 }
      );
    }

    // 1. المسار الأول: إعادة التعيين عبر رمز التحقق OTP (يرفض الثقة براية المتصفح وحدها دون شهادة تحقق الخادم)
    if (otpCode || body.otpVerified || body.otpProofToken) {
      if (otpCode) {
        const otpVerify = await verifyOtpCode(rawPhone, otpCode);
        if (!otpVerify.ok) {
          return NextResponse.json(
            {
              ok: false,
              error: otpVerify.error || "رمز التحقق OTP غير صحيح أو انتهت صلاحيته.",
            },
            { status: 400 }
          );
        }
      } else {
        const proofCheck = await verifyAndConsumeOtpProof(
          request,
          body.otpProofToken,
          fullPhone
        );
        if (!proofCheck.valid) {
          return NextResponse.json(
            {
              ok: false,
              error:
                proofCheck.error ||
                "يرجى إتمام التحقق من رقم الهاتف عبر رمز التحقق أولاً.",
            },
            { status: 401 }
          );
        }
      }

      const result = await resetOwnerPinByOtp({
        ownerPhone: fullPhone,
        newPin,
      });

      if (!result.ok || !result.record) {
        return NextResponse.json(
          {
            ok: false,
            error: result.error || "لم يتم العثور على سيارة مسجلة بهذا الرقم.",
          },
          { status: 404 }
        );
      }

      const ownerToken = createOwnerSessionToken({
        tagCode: result.record.tagCode,
        ownerPhone: result.record.ownerPhone || fullPhone,
      });
      const response = NextResponse.json({
        ok: true,
        message: "تم تحديث رمز المرور بنجاح عبر رمز التحقق!",
        tag: result.record,
      });
      attachOwnerSessionCookie(response, ownerToken, result.record.tagCode);
      return response;
    }

    // 2. المسار الثاني: استرداد الحساب عبر كود بطاقة الأمان المشفرة (BK-XXXX-XXXX) مع حماية القفل
    if (!/^BK-[A-Z0-9]{4}-[A-Z0-9]{4}(-[A-Z0-9]{4})?$/.test(recoveryKey)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "يرجى إدخال رمز التحقق OTP أو إدخال كود بطاقة الأمان بصيغة صحيحة (BK-XXXX-XXXX).",
        },
        { status: 400 }
      );
    }

    const ip = getClientIp(request);
    const rateKey = `recovery_key:${fullPhone}:${ip}`;
    const rateLimit = await checkPinRateLimitAsync(rateKey);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: rateLimit.reason,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    const result = await resetOwnerPinByRecoveryKey({
      ownerPhone: fullPhone,
      recoveryKey,
      newPin,
    });

    if (!result.ok || !result.record) {
      await recordPinFailureAsync(rateKey);
      return NextResponse.json(
        {
          ok: false,
          error:
            result.error ||
            "رقم الهاتف أو كود بطاقة الأمان غير مطابق للسجلات المشفرة.",
        },
        { status: 403 }
      );
    }

    await clearPinFailuresAsync(rateKey);
    const ownerToken = createOwnerSessionToken({
      tagCode: result.record.tagCode,
      ownerPhone: result.record.ownerPhone || fullPhone,
    });
    const response = NextResponse.json({
      ok: true,
      tag: result.record,
    });
    attachOwnerSessionCookie(response, ownerToken, result.record.tagCode);
    return response;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "حدث خطأ أثناء إعادة تعيين رمز الدخول في قاعدة البيانات.",
      },
      { status: 500 }
    );
  }
}


