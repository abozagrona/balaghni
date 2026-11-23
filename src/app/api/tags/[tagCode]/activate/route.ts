import { NextRequest, NextResponse } from "next/server";
import { activateVehicleTag } from "@/lib/supabase/client";
import { formatBalaghniTagCode, formatFullLibyaE164 } from "@/lib/utils";
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

interface RouteParams {
  params: Promise<{ tagCode: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { tagCode } = await params;
    const formattedCode = formatBalaghniTagCode(tagCode);
    const body = await request.json();

    const pin = String(body.pin || "000000").trim() || "000000";
    const skipScratchPin = pin === "000000" || Boolean(body.skipScratchPin);
    const rawPhone = String(body.ownerPhone || "").trim();
    const vehicleInfo = String(body.vehicleInfo || "").trim();
    const city = String(body.city || "طرابلس").trim();

    const fullPhone = formatFullLibyaE164(rawPhone);
    if (!fullPhone) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "يرجى إدخال رقم هاتف ليبي صحيح (+218) يبدأ بـ 91 أو 92 أو 93 أو 94.",
        },
        { status: 400 }
      );
    }

    if (!vehicleInfo || vehicleInfo.length < 2) {
      return NextResponse.json(
        {
          ok: false,
          error: "يرجى إدخال نوع وموديل السيارة (مثال: Toyota Corolla - أبيض).",
        },
        { status: 400 }
      );
    }

    // 1. فحص القفل ضد محاولات التخمين المتكررة
    const ip = getClientIp(request);
    const rateKey = `activate_tag:${formattedCode}:${ip}`;
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

    // 2. إلزام التحقق الفعلي من رقم الهاتف عبر رمز التحقق (OTP Proof Token) الموقّع من الخادم
    const otpProofCheck = await verifyAndConsumeOtpProof(
      request,
      body.otpProofToken,
      fullPhone
    );
    if (!otpProofCheck.valid) {
      return NextResponse.json(
        {
          ok: false,
          requiresOtp: true,
          error:
            otpProofCheck.error ||
            "يرجى تأكيد رقم هاتفك عبر رمز التحقق قبل تفعيل الملصق.",
        },
        { status: 401 }
      );
    }

    const result = await activateVehicleTag({
      tagCode: formattedCode,
      pin,
      ownerPhone: fullPhone,
      vehicleInfo,
      city,
      skipScratchPin,
    });

    if (!result.ok) {
      await recordPinFailureAsync(rateKey);
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 403 }
      );
    }

    await clearPinFailuresAsync(rateKey);
    const ownerToken = createOwnerSessionToken({
      tagCode: formattedCode,
      ownerPhone: fullPhone,
    });
    const response = NextResponse.json({
      ok: true,
      message: "تم تفعيل الملصق وربطه برقم هاتفك بنجاح!",
      tag: result.record,
    });
    attachOwnerSessionCookie(response, ownerToken, formattedCode);
    return response;
  } catch {
    return NextResponse.json(
      { ok: false, error: "حدث خطأ غير متوقع أثناء تفعيل الملصق." },
      { status: 500 }
    );
  }
}

