import { NextRequest, NextResponse } from "next/server";
import {
  pullAndActivateLockedTag,
  recordMarketplaceOrder,
} from "@/lib/lifecycle-service";
import { sendWhatsappAlertMessage } from "@/lib/otp-service";
import {
  getAdminWhatsappNumber,
  getPackageConfig,
  normalizePackageType,
} from "@/lib/packages";
import { formatFullLibyaE164 } from "@/lib/utils";
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const pkgType = normalizePackageType(body.packageType || body.tier);
    const pkgConfig = getPackageConfig(pkgType);
    const paymentMethod =
      String(body.paymentMethod || "cod").toLowerCase() === "online"
        ? "online"
        : "cod";
    const paymentStatus = paymentMethod === "online" ? "paid" : "pending_cod";

    const startsAt = new Date().toISOString();
    const exp = new Date(startsAt);
    exp.setUTCDate(exp.getUTCDate() + 365);
    const expiresAt = exp.toISOString();

    const fullName = String(body.customerName || body.fullName || "").trim();
    const rawPhone = String(body.customerPhone || body.phone || "").trim();
    const phone = formatFullLibyaE164(rawPhone);
    const city = String(body.city || "طرابلس").trim();
    const address = String(body.address || "").trim();
    const vehicleModel = body.vehicleModel ? String(body.vehicleModel).trim() : null;
    const quantity = Math.min(5, Math.max(1, Number(body.quantity || 1)));
    const totalLyd = Number(pkgConfig.priceLyd || 100) * quantity;

    if (!fullName || !phone || !address) {
      return NextResponse.json(
        { ok: false, error: "يرجى تعبئة الاسم الكامل ورقم الهاتف الليبي الصحيح والعنوان." },
        { status: 400 }
      );
    }

    // 1. فحص حدود المعدل (Rate Limit) لمنع استنزاف مخزون الملصقات
    const ip = getClientIp(req);
    const rateLimit = checkOrderRateLimit(phone, ip);
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

    // 2. التحقق الإلزامي من ملكية رقم الهاتف عبر رمز التحقق (OTP Proof Token) الموقّع من الخادم
    const otpProofCheck = verifyAndConsumeOtpProof(
      req,
      body.otpProofToken,
      phone
    );
    if (!otpProofCheck.valid) {
      return NextResponse.json(
        {
          ok: false,
          requiresOtp: true,
          error:
            otpProofCheck.error ||
            "يرجى تأكيد رقم هاتفك عبر رمز التحقق قبل إتمام الطلب وسحب الملصق.",
        },
        { status: 401 }
      );
    }

    recordOrderAttempt(phone, ip);

    const pullRes = await pullAndActivateLockedTag({
      planType: pkgType === "basic" ? "basic" : "nabbihni",
      packageType: pkgType,
      ownerPhone: phone,
      ownerName: fullName,
      vehicleInfo: vehicleModel,
      city,
      paymentMethod,
      startsAt,
      expiresAt,
    });

    if (!pullRes.ok || !pullRes.stickerCode) {
      return NextResponse.json(
        {
          ok: false,
          error:
            pullRes.error ||
            "لا توجد ملصقات متاحة (LOCKED) في المخزن حالياً. يرجى استيراد دفعة جديدة من لوحة الأدمن.",
        },
        { status: 409 }
      );
    }

    const assignedStickerCode = pullRes.stickerCode;
    const orderStatus = "completed";

    await recordMarketplaceOrder({
      orderCode: assignedStickerCode,
      packageType: pkgType,
      quantity,
      customerName: fullName,
      customerPhone: phone,
      city,
      address,
      vehicleModel,
      totalLyd,
      paymentMethod,
      paymentStatus,
      assignedTagCode: assignedStickerCode,
      status: orderStatus,
      subscriptionStartsAt: startsAt,
      subscriptionExpiresAt: expiresAt,
    });

    const adminPhone = getAdminWhatsappNumber();
    const paymentLabel =
      paymentMethod === "online"
        ? "دفع أونلاين ✅ (مدفوع)"
        : "دفع عند الاستلام 💵 (COD)";

    await sendWhatsappAlertMessage(
      adminPhone,
      `🛒 طلب وتفعيل ملصق جديد (${assignedStickerCode})\nالباقة: ${pkgConfig.name}\nطريقة الدفع: ${paymentLabel}\nالاسم: ${fullName}\nالهاتف: ${phone}\nالمدينة: ${city} - ${address}\nالكمية: ${quantity}\nالإجمالي: ${totalLyd} د.ل\nتاريخ الانتهاء: ${expiresAt.slice(0, 10)}`
    );

    await sendWhatsappAlertMessage(
      phone,
      `✅ مرحباً ${fullName}، تم تأكيد طلبك وتفعيل ملصق «بَلِّغْنِي» الخاص بك!\nكود الملصق: ${assignedStickerCode}\nالباقة: ${pkgConfig.name}\nصالح لمدة 365 يوماً حتى: ${expiresAt.slice(0, 10)}\nرابط لوحة التحكم: https://www.balaghni.ly/login`
    );

    const ownerToken = createOwnerSessionToken({
      tagCode: assignedStickerCode,
      ownerPhone: phone,
    });
    const response = NextResponse.json({
      ok: true,
      stickerCode: assignedStickerCode,
      packageType: pkgType,
      packageName: pkgConfig.name,
      paymentMethod,
      paymentStatus,
      status: orderStatus,
      subscriptionStartsAt: startsAt,
      subscriptionExpiresAt: expiresAt,
    });
    attachOwnerSessionCookie(response, ownerToken, assignedStickerCode);
    return response;
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر تسجيل الطلب حالياً." },
      { status: 500 }
    );
  }
}

