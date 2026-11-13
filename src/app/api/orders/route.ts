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
    const phone = String(body.customerPhone || body.phone || "").trim();
    const city = String(body.city || "طرابلس").trim();
    const address = String(body.address || "").trim();
    const vehicleModel = body.vehicleModel ? String(body.vehicleModel).trim() : null;
    const quantity = Number(body.quantity || 1);
    const totalLyd = Number(body.totalLyd || pkgConfig.priceLyd || 100);

    if (!fullName || !phone || !address) {
      return NextResponse.json(
        { ok: false, error: "يرجى تعبئة الاسم الكامل ورقم الهاتف والعنوان." },
        { status: 400 }
      );
    }

    const pullRes = await pullAndActivateLockedTag({
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

    return NextResponse.json({
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
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر تسجيل الطلب حالياً." },
      { status: 500 }
    );
  }
}
