import { NextRequest, NextResponse } from "next/server";
import {
  activateStickerAtomic,
  linkPrepaidSticker,
  redeemGiftSticker,
} from "@/lib/lifecycle-service";
import { normalizePackageType } from "@/lib/packages";
import { formatBalaghniTagCode, formatFullLibyaE164 } from "@/lib/utils";
import {
  verifyAndConsumeOtpProof,
  createOwnerSessionToken,
  attachOwnerSessionCookie,
} from "@/lib/security-tokens";
import {
  checkOrderRateLimit,
  recordOrderAttempt,
  getClientIp,
} from "@/lib/rate-limiter";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await context.params;
    const normalizedCode = formatBalaghniTagCode(code);
    const body = await req.json();

    const mode = String(body.mode || "online");
    const rawPhone = String(body.phone || "").trim();
    const formattedPhone = formatFullLibyaE164(rawPhone);

    if (!formattedPhone) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "يرجى إدخال رقم هاتف ليبي صحيح مكون من 9 أرقام ويبدأ بـ 91 أو 92 أو 93 أو 94.",
        },
        { status: 400 }
      );
    }

    // 1. فحص حدود المعدل (Rate Limit) لمنع استنزاف التفعيلات
    const ip = getClientIp(req);
    const rateLimit = checkOrderRateLimit(formattedPhone, ip);
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
    const otpProofCheck = verifyAndConsumeOtpProof(
      req,
      body.otpProofToken,
      formattedPhone
    );
    if (!otpProofCheck.valid) {
      return NextResponse.json(
        {
          ok: false,
          requiresOtp: true,
          error:
            otpProofCheck.error ||
            "يرجى تأكيد رقم هاتفك عبر رمز التحقق قبل تفعيل أو تجديد الملصق.",
        },
        { status: 401 }
      );
    }

    recordOrderAttempt(formattedPhone, ip);

    const ownerName = String(body.ownerName || "").trim();
    const vehicleInfo = String(body.vehicleInfo || "").trim();

    if (mode === "link_prepaid") {
      const linkRes = await linkPrepaidSticker({
        code: normalizedCode,
        phone: formattedPhone,
        ownerName,
        vehicleInfo,
      });

      if (!linkRes.ok) {
        return NextResponse.json(
          {
            ok: false,
            alreadyRedeemed: Boolean(linkRes.alreadyLinked),
            error: linkRes.error,
          },
          { status: linkRes.alreadyLinked ? 409 : 400 }
        );
      }

      const ownerToken = createOwnerSessionToken({
        tagCode: normalizedCode,
        ownerPhone: formattedPhone,
      });
      const response = NextResponse.json({
        ok: true,
        sticker: linkRes.sticker,
      });
      attachOwnerSessionCookie(response, ownerToken, normalizedCode);
      return response;
    }

    if (mode === "gift") {
      const giftRes = await redeemGiftSticker({
        code: normalizedCode,
        phone: formattedPhone,
        ownerName,
        vehicleInfo,
      });

      if (!giftRes.ok) {
        return NextResponse.json(
          {
            ok: false,
            alreadyRedeemed: Boolean(giftRes.alreadyRedeemed),
            error: giftRes.error,
          },
          { status: giftRes.alreadyRedeemed ? 409 : 400 }
        );
      }

      const ownerToken = createOwnerSessionToken({
        tagCode: normalizedCode,
        ownerPhone: formattedPhone,
      });
      const response = NextResponse.json({
        ok: true,
        sticker: giftRes.sticker,
      });
      attachOwnerSessionCookie(response, ownerToken, normalizedCode);
      return response;
    }

    const packageType = normalizePackageType(body.packageType);
    if (packageType !== "basic" && packageType !== "nabbihni") {
      return NextResponse.json(
        { ok: false, error: "يرجى اختيار الباقة الأساسية أو باقة نَبِّهْنِي." },
        { status: 400 }
      );
    }

    const allowExpiredRenewal = Boolean(body.allowExpiredRenewal);
    const res = await activateStickerAtomic({
      code: normalizedCode,
      packageType,
      ownerPhone: formattedPhone,
      ownerName,
      vehicleInfo,
      activationSource: "online",
      durationDays: 365,
      allowExpiredRenewal,
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          unassignedPaid: Boolean(res.unassignedPaid),
          orderId: res.orderId,
          error: res.error,
        },
        { status: res.unassignedPaid ? 409 : 400 }
      );
    }

    const ownerToken = createOwnerSessionToken({
      tagCode: normalizedCode,
      ownerPhone: formattedPhone,
    });
    const response = NextResponse.json({
      ok: true,
      sticker: res.sticker,
    });
    attachOwnerSessionCookie(response, ownerToken, normalizedCode);
    return response;
  } catch {
    return NextResponse.json(
      { ok: false, error: "حدث خطأ غير متوقع أثناء تفعيل الملصق." },
      { status: 500 }
    );
  }
}

