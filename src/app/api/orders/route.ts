import { NextRequest, NextResponse } from "next/server";
import {
  pullAndActivateLockedTag,
  pullAndReserveCodTag,
  recordMarketplaceOrder,
} from "@/lib/lifecycle-service";
import {
  sendWhatsappAlertMessage,
  TWILIO_CONTENT_SIDS,
} from "@/lib/otp-service";
import {
  getAdminWhatsappNumber,
  getPackageConfig,
  normalizePackageType,
} from "@/lib/packages";
import { formatFullLibyaE164 } from "@/lib/utils";
import { verifyAndConsumeOtpProof } from "@/lib/security-tokens";
import {
  checkOrderRateLimitAsync,
  recordOrderAttemptAsync,
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

    // 1. فحص حدود المعدل المركزي (Distributed Rate Limit) لمنع استنزاف مخزون الملصقات
    const ip = getClientIp(req);
    const rateLimit = await checkOrderRateLimitAsync(phone, ip);
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
    const otpProofCheck = await verifyAndConsumeOtpProof(
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

    await recordOrderAttemptAsync(phone, ip);

    const adminPhone = getAdminWhatsappNumber();
    const orderId = `ORD-${Date.now().toString(36).toUpperCase()}`;

    if (paymentMethod === "cod") {
      const reservedCodes: string[] = [];
      let lastReserveError = "";
      for (let i = 0; i < quantity; i++) {
        const reserveRes = await pullAndReserveCodTag({
          planType: pkgType === "basic" ? "basic" : "nabbihni",
          packageType: pkgType,
          buyerName: fullName,
          buyerPhone: phone,
          deliveryCity: city,
          deliveryAddress: address,
          orderId,
          excludeCodes: reservedCodes,
        });
        if (!reserveRes.ok || !reserveRes.stickerCode) {
          lastReserveError = reserveRes.error || "";
          break;
        }
        reservedCodes.push(reserveRes.stickerCode);
      }

      if (reservedCodes.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error:
              lastReserveError ||
              "لا توجد ملصقات متاحة (LOCKED) في المخزن حالياً. يرجى استيراد دفعة جديدة من لوحة الأدمن.",
          },
          { status: 409 }
        );
      }

      const primaryCode = reservedCodes[0];
      const joinedCodes = reservedCodes.join(", ");

      const codOrderRes = await recordMarketplaceOrder({
        orderCode: primaryCode,
        packageType: pkgType,
        quantity: reservedCodes.length,
        customerName: fullName,
        customerPhone: phone,
        city,
        address,
        vehicleModel: null,
        totalLyd,
        paymentMethod: "cod",
        paymentStatus: "pending_cod",
        assignedTagCode: joinedCodes,
        status: "pending_delivery",
        subscriptionStartsAt: null,
        subscriptionExpiresAt: null,
      });

      if (!codOrderRes.supabaseSaved) {
        return NextResponse.json(
          {
            ok: false,
            error:
              (codOrderRes as { error?: string }).error ||
              "تعذر حفظ طلب الدفع عند الاستلام في قاعدة البيانات، يرجى المحاولة مرة أخرى.",
          },
          { status: 500 }
        );
      }

      await sendWhatsappAlertMessage(
        adminPhone,
        `تنبيه إداري - منصة بلّغني:\nتم استلام طلب جديد (دفع كاش عند الاستلام)\nالأكواد: ${joinedCodes}\nالباقة: ${pkgConfig.name}\nالمستلم: ${fullName} (${phone})\nالمدينة والعنوان: ${city} - ${address}\nالإجمالي: ${totalLyd} د.ل — يرجى المتابعة من لوحة الإدارة`,
        null,
        {
          twilioContentSid: TWILIO_CONTENT_SIDS.ADMIN_ALERT,
          twilioContentVariables: {
            "1": "دفع كاش عند الاستلام",
            "2": joinedCodes,
            "3": pkgConfig.name,
            "4": fullName,
            "5": phone,
            "6": `${city} - ${address}`,
            "7": String(totalLyd),
          },
        }
      );

      await sendWhatsappAlertMessage(
        phone,
        `مرحبا ${fullName}، تم استلام طلبك لملصق بلّغني بنجاح\nكود الملصق المحجوز: ${joinedCodes}\nالباقة: ${pkgConfig.name}\nطريقة الدفع: كاش عند الاستلام (${totalLyd} د.ل)\nحالة الطلب: بانتظار التوصيل والدفع\nسيتم التواصل معك قريباً لتنسيق التوصيل، وبعد الاستلام يمكنك ربط الملصق بسيارتك`,
        null,
        {
          twilioContentSid: TWILIO_CONTENT_SIDS.ORDER_COD,
          twilioContentVariables: {
            "1": fullName,
            "2": joinedCodes,
            "3": pkgConfig.name,
            "4": String(totalLyd),
          },
        }
      );

      return NextResponse.json({
        ok: true,
        stickerCode: primaryCode,
        stickerCodes: reservedCodes,
        packageType: pkgType,
        packageName: pkgConfig.name,
        paymentMethod: "cod",
        paymentStatus: "pending_cod",
        status: "pending_delivery",
        subscriptionStartsAt: null,
        subscriptionExpiresAt: null,
      });
    }

    // مسار الدفع الإلكتروني الأونلاين الناجح: تفعيل فوري للملصقات لتكون جاهزة للربط دون ربطها بمالك بعد
    const startsAt = new Date().toISOString();
    const exp = new Date(startsAt);
    exp.setUTCDate(exp.getUTCDate() + 365);
    const expiresAt = exp.toISOString();

    const activatedCodes: string[] = [];
    let lastActivateError = "";
    for (let i = 0; i < quantity; i++) {
      const pullRes = await pullAndActivateLockedTag({
        planType: pkgType === "basic" ? "basic" : "nabbihni",
        packageType: pkgType,
        buyerName: fullName,
        buyerPhone: phone,
        deliveryCity: city,
        deliveryAddress: address,
        orderId,
        excludeCodes: activatedCodes,
        paymentMethod: "online",
        startsAt,
        expiresAt,
      });
      if (!pullRes.ok || !pullRes.stickerCode) {
        lastActivateError = pullRes.error || "";
        break;
      }
      activatedCodes.push(pullRes.stickerCode);
    }

    if (activatedCodes.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            lastActivateError ||
            "لا توجد ملصقات متاحة (LOCKED) في المخزن حالياً. يرجى استيراد دفعة جديدة من لوحة الأدمن.",
        },
        { status: 409 }
      );
    }

    const primaryAssignedCode = activatedCodes[0];
    const joinedAssignedCodes = activatedCodes.join(", ");

    const onlineOrderRes = await recordMarketplaceOrder({
      orderCode: primaryAssignedCode,
      packageType: pkgType,
      quantity: activatedCodes.length,
      customerName: fullName,
      customerPhone: phone,
      city,
      address,
      vehicleModel: null,
      totalLyd,
      paymentMethod: "online",
      paymentStatus,
      assignedTagCode: joinedAssignedCodes,
      status: "completed",
      subscriptionStartsAt: startsAt,
      subscriptionExpiresAt: expiresAt,
    });

    if (!onlineOrderRes.supabaseSaved) {
      return NextResponse.json(
        {
          ok: false,
          error:
            (onlineOrderRes as { error?: string }).error ||
            "تعذر حفظ الطلب في قاعدة البيانات، يرجى المحاولة مرة أخرى.",
        },
        { status: 500 }
      );
    }

    await sendWhatsappAlertMessage(
      adminPhone,
      `تنبيه إداري - منصة بلّغني:\nتم استلام طلب جديد (دفع أونلاين مدفوع)\nالأكواد: ${joinedAssignedCodes}\nالباقة: ${pkgConfig.name}\nالمستلم: ${fullName} (${phone})\nالمدينة والعنوان: ${city} - ${address}\nالإجمالي: ${totalLyd} د.ل — يرجى المتابعة من لوحة الإدارة`,
      null,
      {
        twilioContentSid: TWILIO_CONTENT_SIDS.ADMIN_ALERT,
        twilioContentVariables: {
          "1": "دفع أونلاين مدفوع",
          "2": joinedAssignedCodes,
          "3": pkgConfig.name,
          "4": fullName,
          "5": phone,
          "6": `${city} - ${address}`,
          "7": String(totalLyd),
        },
      }
    );

    await sendWhatsappAlertMessage(
      phone,
      `مرحبا ${fullName}، تم تأكيد طلبك وتفعيل ملصق بلّغني الخاص بك بنجاح\nكود الملصق: ${joinedAssignedCodes}\nالباقة: ${pkgConfig.name}\nصالح لمدة 365 يوماً حتى: ${expiresAt.slice(0, 10)}\nيمكنك الآن ربط الملصق بالسيارة عبر مسح رمز QR أو الدخول لصفحة التفعيل على المنصة`,
      null,
      {
        twilioContentSid: TWILIO_CONTENT_SIDS.ORDER_ACTIVATED,
        twilioContentVariables: {
          "1": fullName,
          "2": joinedAssignedCodes,
          "3": pkgConfig.name,
          "4": expiresAt.slice(0, 10),
        },
      }
    );

    return NextResponse.json({
      ok: true,
      stickerCode: primaryAssignedCode,
      stickerCodes: activatedCodes,
      packageType: pkgType,
      packageName: pkgConfig.name,
      paymentMethod: "online",
      paymentStatus,
      status: "completed",
      subscriptionStartsAt: startsAt,
      subscriptionExpiresAt: expiresAt,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر تسجيل الطلب حالياً." },
      { status: 500 }
    );
  }
}

