import { NextRequest, NextResponse } from "next/server";
import { sendZeroLeakNotification } from "@/lib/supabase/client";
import { formatBalaghniTagCode } from "@/lib/utils";

/**
 * مسار إرسال البلاغات الآمن والمعزول (Zero-Leak & Anti-Spam Cooldown API)
 * المتصفح يرسل فقط: tag_code, reason, custom_note
 * السيرفر يستعلم داخلياً عن هاتف المالك ونوع باقته (SMS / WHATSAPP / BOTH) دون كشف الرقم نهائياً للواجهة الأمامية
 * حماية التبريد: منع إرسال أكثر من بلاغ لنفس الملصق إلا بعد مرور 5 دقائق
 */
export async function POST(req: NextRequest) {
  try {
    let tagCode = "";
    let reason = "blocking";
    let customNote = "";
    let location = "";

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      tagCode = String(
        formData.get("tag_code") || formData.get("tagCode") || ""
      );
      reason = String(formData.get("reason") || "blocking");
      customNote = String(
        formData.get("custom_note") || formData.get("note") || ""
      );
      const lat = formData.get("locationLatitude");
      const lng = formData.get("locationLongitude");
      if (lat && lng) {
        location = `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
      }
    } else {
      const body = await req.json().catch(() => ({}));
      tagCode = String(body.tag_code || body.tagCode || "");
      reason = String(body.reason || "blocking");
      customNote = String(body.custom_note || body.note || "");
      location = String(body.location || "");
    }

    if (!tagCode.trim()) {
      return NextResponse.json(
        { ok: false, error: "كود الملصق مطلوب." },
        { status: 400 }
      );
    }

    const normalizedCode = formatBalaghniTagCode(tagCode);
    const result = await sendZeroLeakNotification({
      tagCode: normalizedCode,
      reason,
      customNote,
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

    // استجابة آمنة تماماً لا تحتوي على رقم هاتف المالك (Zero-Leak)
    return NextResponse.json({
      ok: true,
      tag_code: normalizedCode,
      delivered_channel: result.deliveredChannels || "BOTH",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "حدث خطأ غير متوقع أثناء معالجة البلاغ." },
      { status: 500 }
    );
  }
}
