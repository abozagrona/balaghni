import { NextRequest, NextResponse } from "next/server";
import {
  sendZeroLeakNotification,
  uploadReportPhoto,
  validateScanTargetAndCooldown,
} from "@/lib/supabase/client";
import {
  checkReportIpRateLimitAsync,
  getClientIp,
  recordReportIpAttemptAsync,
} from "@/lib/rate-limiter";
import { formatBalaghniTagCode } from "@/lib/utils";

export const maxDuration = 30;

function sanitizeUserText(raw: string, maxLen = 250): string {
  return raw
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLen);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tagCode: string }> }
) {
  try {
    const clientIp = getClientIp(req);
    const ipLimit = await checkReportIpRateLimitAsync(clientIp);
    if (!ipLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          cooldownActive: true,
          waitSeconds: ipLimit.retryAfterSeconds,
          error: ipLimit.reason,
        },
        { status: 429 }
      );
    }
    await recordReportIpAttemptAsync(clientIp);

    const { tagCode } = await context.params;
    const normalizedCode = formatBalaghniTagCode(tagCode);
    const formData = await req.formData();

    const reason = sanitizeUserText(
      String(formData.get("reason") || "blocking"),
      32
    );
    const rawNote = formData.get("note")
      ? String(formData.get("note"))
      : formData.get("custom_note")
      ? String(formData.get("custom_note"))
      : "";
    const customNote = sanitizeUserText(rawNote, 250);
    const senderPhone = formData.get("senderPhone")
      ? sanitizeUserText(String(formData.get("senderPhone")), 20)
      : "";

    // 1. فحص صلاحية الملصق وانتهاء فترة التبريد (5 دقائق) قبل رفع أي صورة
    const preCheck = await validateScanTargetAndCooldown(normalizedCode);
    if (!preCheck.ok) {
      return NextResponse.json(
        {
          ok: false,
          cooldownActive: Boolean(preCheck.cooldownActive),
          waitSeconds: preCheck.waitSeconds || 0,
          error:
            preCheck.error ||
            "تم إرسال بلاغ لصاحب السيارة بالفعل، يرجى الانتظار بضع دقائق",
        },
        { status: preCheck.cooldownActive ? 429 : 400 }
      );
    }

    // 2. رفع الصورة بعد التحقق من فترة التبريد وسلامة الملف
    const { url: photoUrl, error: uploadError } = await uploadReportPhoto(
      normalizedCode,
      formData.get("image")
    );
    if (uploadError) {
      return NextResponse.json(
        { ok: false, error: uploadError },
        { status: 400 }
      );
    }

    const result = await sendZeroLeakNotification({
      tagCode: normalizedCode,
      reason,
      customNote,
      senderPhone,
      photoUrl,
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
      photoAttached: Boolean(photoUrl),
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "حدث خطأ غير متوقع أثناء إرسال الإشعار." },
      { status: 500 }
    );
  }
}

