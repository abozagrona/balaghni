import { NextRequest, NextResponse } from "next/server";
import { verifyTagScratchPin } from "@/lib/supabase/client";
import { formatBalaghniTagCode } from "@/lib/utils";
import {
  checkPinRateLimit,
  recordPinFailure,
  clearPinFailures,
  getClientIp,
} from "@/lib/rate-limiter";

interface RouteParams {
  params: Promise<{ tagCode: string }>;
}

/**
 * التحقق المسبق من رمز الخدش السري (PIN) للملصق قبل إرسال أي رمز OTP
 * مع حماية ضد التخمين (5 محاولات خاطئة كحد أقصى كل 15 دقيقة)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { tagCode } = await params;
    const formattedCode = formatBalaghniTagCode(tagCode);
    const body = await request.json().catch(() => ({}));
    const pin = String(body.pin || "").trim();

    if (!/^\d{6}$/.test(pin)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "رمز الخدش السري (PIN) غير صحيح. يرجى التأكد من الأرقام الستة تحت طبقة الخدش.",
        },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const rateLimit = checkPinRateLimit(formattedCode, clientIp);
    if (!rateLimit.allowed) {
      const minutesLeft = Math.ceil(rateLimit.resetMs / (60 * 1000)) || 1;
      return NextResponse.json(
        {
          ok: false,
          rateLimited: true,
          remainingMinutes: minutesLeft,
          error: `تم تجاوز الحد المسموح به لمحاولات إدخال رمز الخدش السري (5 محاولات خاطئة خلال 15 دقيقة). يرجى الانتظار ${minutesLeft} دقيقة والمحاولة لاحقاً.`,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rateLimit.resetMs / 1000)),
          },
        }
      );
    }

    const result = await verifyTagScratchPin({
      tagCode: formattedCode,
      pin,
    });

    if (!result.ok) {
      recordPinFailure(formattedCode, clientIp);
      return NextResponse.json(
        {
          ok: false,
          error:
            result.error ||
            "رمز الخدش السري (PIN) غير صحيح. يرجى التأكد من الأرقام الستة تحت طبقة الخدش.",
        },
        { status: 403 }
      );
    }

    clearPinFailures(formattedCode, clientIp);
    return NextResponse.json({
      ok: true,
      message: "تم التحقق من رمز الخدش السري بنجاح.",
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "حدث خطأ غير متوقع أثناء فحص رمز الخدش السري." },
      { status: 500 }
    );
  }
}
