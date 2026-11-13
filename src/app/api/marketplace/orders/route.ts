import { NextRequest, NextResponse } from "next/server";
import { recordMarketplaceOrder } from "@/lib/lifecycle-service";
import { sendWhatsappAlertMessage } from "@/lib/otp-service";
import {
  getAdminWhatsappNumber,
  getPackageConfig,
  normalizePackageType,
} from "@/lib/packages";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orderCode = `LY-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;

    const pkgType = normalizePackageType(body.tier);
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

    const fullName = String(body.fullName || "").trim();
    const phone = String(body.phone || "").trim();
    const city = String(body.city || "طرابلس").trim();
    const address = String(body.address || "").trim();
    const quantity = Number(body.quantity || 1);
    const totalLyd = Number(body.totalLyd || pkgConfig.priceLyd || 100);

    await recordMarketplaceOrder({
      orderCode,
      packageType: pkgType,
      quantity,
      customerName: fullName,
      customerPhone: phone,
      city,
      address,
      vehicleModel: body.vehicleModel || null,
      totalLyd,
      paymentMethod,
      paymentStatus,
      assignedTagCode: null,
      status: "pending_assignment",
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
      `🛒 طلب ملصق جديد (${orderCode})\nالباقة: ${pkgConfig.name}\nطريقة الدفع: ${paymentLabel}\nالاسم: ${fullName}\nالهاتف: ${phone}\nالمدينة: ${city} - ${address}\nالكمية: ${quantity}\nالإجمالي: ${totalLyd} د.ل\nتاريخ الانتهاء المبدئي: ${expiresAt.slice(0, 10)}`
    );

    return NextResponse.json({
      ok: true,
      orderCode,
      paymentMethod,
      paymentStatus,
      subscriptionStartsAt: startsAt,
      subscriptionExpiresAt: expiresAt,
    });
  } catch {
    return NextResponse.json(
      { error: "تعذر تسجيل الطلب حالياً." },
      { status: 500 }
    );
  }
}
