import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
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

    if (
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      await supabaseAdmin.from("orders").insert({
        order_code: orderCode,
        tier: pkgType,
        quantity: Number(body.quantity || 1),
        full_name: String(body.fullName || "").trim(),
        phone: String(body.phone || "").trim(),
        city: String(body.city || "طرابلس").trim(),
        address: String(body.address || "").trim(),
        vehicle_model: body.vehicleModel || null,
        total_lyd: Number(body.totalLyd || pkgConfig.priceLyd || 100),
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        subscription_starts_at: startsAt,
        subscription_expires_at: expiresAt,
        created_at: startsAt,
      });
    }

    const adminPhone = getAdminWhatsappNumber();
    const paymentLabel =
      paymentMethod === "online"
        ? "دفع أونلاين (مدفوع)"
        : "دفع عند الاستلام (COD)";
    await sendWhatsappAlertMessage(
      adminPhone,
      `🛒 طلب ملصق جديد (${orderCode})\nالباقة: ${pkgConfig.name}\nطريقة الدفع: ${paymentLabel}\nالاسم: ${body.fullName}\nالهاتف: ${body.phone}\nالمدينة: ${body.city} - ${body.address}\nالكمية: ${body.quantity || 1}\nالإجمالي: ${body.totalLyd} د.ل\nتاريخ الانتهاء المبدئي: ${expiresAt.slice(0, 10)}`
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
