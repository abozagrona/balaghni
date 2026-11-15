import { NextRequest, NextResponse } from "next/server";
import {
  sendZeroLeakNotification,
  uploadReportPhoto,
  validateScanTargetAndCooldown,
} from "@/lib/supabase/client";
import {
  checkReportIpRateLimit,
  getClientIp,
  recordReportIpAttempt,
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

/**
 * مسار إرسال البلاغات الآمن والمعزول (Zero-Leak & Anti-Spam Cooldown API)
 * المتصفح يرسل فقط: tag_code, reason, custom_note, senderPhone, image
 * السيرفر يستعلم داخلياً عن هاتف المالك ونوع باقته (SMS / WHATSAPP / BOTH) دون كشف الرقم نهائياً للواجهة الأمامية
 * حماية التبريد: منع إرسال أكثر من بلاغ لنفس الملصق إلا بعد مرور 5 دقائق، مع حد أقصى كلي للبلاغات لكل عنوان IP
 */
export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    const ipLimit = checkReportIpRateLimit(clientIp);
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
    recordReportIpAttempt(clientIp);

    let tagCode = "";
    let reason = "blocking";
    let customNote = "";
    let senderPhone = "";
    let imageEntry: FormDataEntryValue | null = null;

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      tagCode = String(
        formData.get("tag_code") || formData.get("tagCode") || ""
      );
      reason = sanitizeUserText(String(formData.get("reason") || "blocking"), 32);
      customNote = sanitizeUserText(
        String(formData.get("custom_note") || formData.get("note") || ""),
        250
      );
      senderPhone = sanitizeUserText(String(formData.get("senderPhone") || ""), 20);
      imageEntry = formData.get("image");
    } else {
      const body = await req.json().catch(() => ({}));
      tagCode = String(body.tag_code || body.tagCode || "");
      reason = sanitizeUserText(String(body.reason || "blocking"), 32);
      customNote = sanitizeUserText(
        String(body.custom_note || body.note || ""),
        250
      );
      senderPhone = sanitizeUserText(String(body.senderPhone || ""), 20);
    }

    if (!tagCode.trim()) {
      return NextResponse.json(
        { ok: false, error: "كود الملصق مطلوب." },
        { status: 400 }
      );
    }

    const normalizedCode = formatBalaghniTagCode(tagCode);

    // 1. فحص صلاحية الملصق وانتهاء فترة التبريد (5 دقائق) في قاعدة البيانات قبل رفع أي صورة للمخزن
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

    // 2. رفع الصورة فقط بعد التأكد من صحة الملصق وانتهاء فترة التبريد (مع التحقق من Magic Bytes والحجم)
    const { url: photoUrl, error: uploadError } = await uploadReportPhoto(
      normalizedCode,
      imageEntry
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

    // استجابة آمنة تماماً لا تحتوي على رقم هاتف المالك (Zero-Leak)
    return NextResponse.json({
      ok: true,
      tag_code: normalizedCode,
      delivered_channel: result.deliveredChannels || "BOTH",
      photo_attached: Boolean(photoUrl),
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "حدث خطأ غير متوقع أثناء معالجة البلاغ." },
      { status: 500 }
    );
  }
}

