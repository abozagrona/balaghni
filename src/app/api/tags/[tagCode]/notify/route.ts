import { NextRequest, NextResponse } from "next/server";
import { sendZeroLeakNotification } from "@/lib/supabase/client";
import { formatBalaghniTagCode } from "@/lib/utils";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tagCode: string }> }
) {
  try {
    const { tagCode } = await context.params;
    const normalizedCode = formatBalaghniTagCode(tagCode);
    const formData = await req.formData();

    const reason = String(formData.get("reason") || "blocking");
    const customNote = formData.get("note")
      ? String(formData.get("note"))
      : formData.get("custom_note")
      ? String(formData.get("custom_note"))
      : "";
    const senderPhone = formData.get("senderPhone")
      ? String(formData.get("senderPhone")).trim()
      : "";
    const latitude = formData.get("locationLatitude")
      ? Number(formData.get("locationLatitude"))
      : null;
    const longitude = formData.get("locationLongitude")
      ? Number(formData.get("locationLongitude"))
      : null;

    const location =
      latitude && longitude
        ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
        : "";

    const result = await sendZeroLeakNotification({
      tagCode: normalizedCode,
      reason,
      customNote,
      senderPhone,
      location,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          cooldownActive: Boolean(result.cooldownActive),
          waitSeconds: result.waitSeconds || 0,
          error:
            result.error ||
            "تم إرسال بلاغ لصاحب السيارة بالفعل، يرجى الانتظار بضع دقائق",
        },
        { status: result.cooldownActive ? 429 : 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      tagCode: normalizedCode,
      deliveredVia: result.deliveredChannels || "BOTH",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "حدث خطأ غير متوقع أثناء إرسال الإشعار." },
      { status: 500 }
    );
  }
}
