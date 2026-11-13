import { NextResponse } from "next/server";
import { activateVehicleTag } from "@/lib/supabase/client";
import { formatBalaghniTagCode, formatFullLibyaE164 } from "@/lib/utils";

interface RouteParams {
  params: Promise<{ tagCode: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { tagCode } = await params;
    const formattedCode = formatBalaghniTagCode(tagCode);
    const body = await request.json();

    const pin = String(body.pin || "000000").trim() || "000000";
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

    const result = await activateVehicleTag({
      tagCode: formattedCode,
      pin,
      ownerPhone: fullPhone,
      vehicleInfo,
      city,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 403 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "تم تفعيل الملصق وربطه برقم هاتفك بنجاح!",
      tag: result.record,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "حدث خطأ غير متوقع أثناء تفعيل الملصق." },
      { status: 500 }
    );
  }
}
