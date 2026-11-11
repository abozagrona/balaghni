import { NextResponse } from "next/server";
import {
  resetOwnerPinByRecoveryKey,
  resetOwnerPinByOtp,
} from "@/lib/supabase/client";
import { verifyOtpCode } from "@/lib/otp-service";
import { formatFullLibyaE164 } from "@/lib/utils";

export async function POST(request: Request) {
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

    // 1. المسار الأول: إعادة التعيين عبر رمز التحقق OTP (واتساب أو SMS)
    if (otpCode || body.otpVerified) {
      if (otpCode && !body.otpVerified) {
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

      return NextResponse.json({
        ok: true,
        message: "تم تحديث رمز المرور بنجاح عبر رمز التحقق!",
        tag: result.record,
      });
    }

    // 2. المسار الثاني: استرداد الحساب عبر كود بطاقة الأمان المشفرة (BK-XXXX-XXXX)
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

    const result = await resetOwnerPinByRecoveryKey({
      ownerPhone: fullPhone,
      recoveryKey,
      newPin,
    });

    if (!result.ok || !result.record) {
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

    return NextResponse.json({
      ok: true,
      tag: result.record,
    });
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

