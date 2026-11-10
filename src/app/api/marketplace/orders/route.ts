import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orderCode = `LY-${Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()}`;

    if (
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      await supabase.from("orders").insert({
        order_code: orderCode,
        tier: body.tier,
        quantity: body.quantity,
        full_name: body.fullName,
        phone: body.phone,
        city: body.city,
        address: body.address,
        vehicle_model: body.vehicleModel || null,
        total_lyd: body.totalLyd,
        created_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      ok: true,
      orderCode,
    });
  } catch {
    return NextResponse.json(
      { error: "تعذر تسجيل الطلب حالياً." },
      { status: 500 }
    );
  }
}
