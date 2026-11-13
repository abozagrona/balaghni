import { NextRequest, NextResponse } from "next/server";
import {
  activateStickerAtomic,
  listAvailableStickers,
  recordMarketplaceOrder,
} from "@/lib/lifecycle-service";
import { sendWhatsappAlertMessage } from "@/lib/otp-service";
import {
  getAdminWhatsappNumber,
  getPackageConfig,
  normalizePackageType,
} from "@/lib/packages";

function generateOrderNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 6; i += 1) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `ORD-${suffix}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orderNumber = generateOrderNumber();

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

    let assignedStickerCode: string | null = null;
    let orderStatus = "pending_assignment";

    // سحب كود ملصق حقيقي من جدول stickers فقط عند الدفع الأونلاين وتوفر المخزون
    if (paymentMethod === "online") {
      const available = await listAvailableStickers();
      if (available.length > 0) {
        const candidateCode = available[0];
        const actRes = await activateStickerAtomic({
          code: candidateCode,
          packageType: pkgType,
          ownerPhone: phone,
          ownerName: fullName,
          vehicleInfo: vehicleModel || undefined,
          activationSource: "online",
          durationDays: 365,
          skipOrderInsert: true,
        });
        if (actRes.ok) {
          assignedStickerCode = candidateCode;
          orderStatus = "completed";
        }
      }
    }

    await recordMarketplaceOrder({
      orderCode: orderNumber,
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
      `🛒 طلب ملصق جديد (${orderNumber})\nالباقة: ${pkgConfig.name}\nطريقة الدفع: ${paymentLabel}\n${assignedStickerCode ? `كود الملصق المربوط: ${assignedStickerCode}` : "الحالة: بانتظار ربط ملصق"}\nالاسم: ${fullName}\nالهاتف: ${phone}\nالمدينة: ${city} - ${address}\nالكمية: ${quantity}\nالإجمالي: ${totalLyd} د.ل\nتاريخ الانتهاء المبدئي: ${expiresAt.slice(0, 10)}`
    );

    if (assignedStickerCode) {
      await sendWhatsappAlertMessage(
        phone,
        `✅ مرحباً ${fullName}، تم تأكيد طلبك (${orderNumber}) وتفعيل ملصق «بَلِّغْنِي» الخاص بك!\nكود الملصق: ${assignedStickerCode}\nالباقة: ${pkgConfig.name}\nصالح لمدة 365 يوماً حتى: ${expiresAt.slice(0, 10)}\nرابط لوحة التحكم: https://www.balaghni.ly/login`
      );
    }

    return NextResponse.json({
      ok: true,
      orderNumber,
      orderCode: orderNumber,
      stickerCode: assignedStickerCode,
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
