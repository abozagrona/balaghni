import { NextRequest, NextResponse, after } from "next/server";
import {
  broadcastReportRealtimeUpdate,
  getVehicleTagByCode,
  sendZeroLeakNotification,
  supabaseAdmin,
  uploadReportPhoto,
  validateScanTargetAndCooldown,
} from "@/lib/supabase/client";
import {
  checkGreenApiMessageStatus,
  sendSmsAlertMessage,
} from "@/lib/otp-service";
import {
  checkReportIpRateLimit,
  getClientIp,
  recordReportIpAttempt,
} from "@/lib/rate-limiter";
import { formatBalaghniTagCode } from "@/lib/utils";

export const maxDuration = 60;

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
      senderPhone = sanitizeUserText(
        String(
          formData.get("reporter_phone") || formData.get("senderPhone") || ""
        ),
        20
      );
      imageEntry = formData.get("image");
    } else {
      const body = await req.json().catch(() => ({}));
      tagCode = String(body.tag_code || body.tagCode || "");
      reason = sanitizeUserText(String(body.reason || "blocking"), 32);
      customNote = sanitizeUserText(
        String(body.custom_note || body.note || ""),
        250
      );
      senderPhone = sanitizeUserText(
        String(body.reporter_phone || body.senderPhone || ""),
        20
      );
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

    const reportId = (result as { reportId?: string }).reportId || null;

    // استجابة آمنة تماماً لا تحتوي على رقم هاتف المالك (Zero-Leak)
    return NextResponse.json({
      ok: true,
      tag_code: normalizedCode,
      report_id: reportId,
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

async function syncReportDeliveryAndFallback(
  reportId: string,
  tagCode: string
): Promise<{
  deliveryStatus: "sent" | "delivered" | "read" | "replied";
  ownerReply: string | null;
  isSmsFallback: boolean;
}> {
  // إذا لم يتوفر معرف بلاغ حقيقي (UUID) خاص بهذه الجلسة، لا نرجع أي بلاغ قديم لنفس الملصق أبداً
  if (!reportId || reportId.startsWith("rep_")) {
    return {
      deliveryStatus: "sent",
      ownerReply: null,
      isSmsFallback: false,
    };
  }

  const { data } = await supabaseAdmin
    .from("reports")
    .select("id,tag_code,reason_badge,message,created_at")
    .eq("id", reportId)
    .maybeSingle();

  const reportRow = (data as Record<string, unknown> | null) || null;
  if (!reportRow) {
    return {
      deliveryStatus: "sent",
      ownerReply: null,
      isSmsFallback: false,
    };
  }

  let badge = String(reportRow.reason_badge || "");
  const message = String(reportRow.message || "");
  const resolvedReportId = String(reportRow.id || reportId);
  const resolvedTagCode = String(
    reportRow.tag_code || tagCode || ""
  ).toUpperCase();

  let ownerReply: string | null = null;
  const replyMarker = "[رد المالك عبر واتساب]:";
  if (message.includes(replyMarker)) {
    const parts = message.split(replyMarker);
    ownerReply = parts[parts.length - 1]?.trim() || null;
  } else if (badge.startsWith("رد المالك:")) {
    ownerReply = badge.replace("رد المالك:", "").trim() || null;
  }

  // التحويل التلقائي البديل إلى SMS بعد 35 ثانية لباقة نَبِّهْنِي فقط إذا لم يصل حدث delivered أو read عبر الـ Webhook
  if (
    !ownerReply &&
    !badge.includes("تمت القراءة") &&
    !badge.includes("تم التسليم") &&
    !badge.includes("SMS") &&
    resolvedReportId
  ) {
    try {
      const createdMs = new Date(
        String(reportRow.created_at || Date.now())
      ).getTime();
      const elapsedMs = Date.now() - createdMs;

      if (elapsedMs >= 35000) {
        const { data: dispatchRows } = await supabaseAdmin
          .from("admin_audit_logs")
          .select("details")
          .eq("action_type", "REPORT_DISPATCH")
          .eq("target_item", resolvedReportId)
          .order("created_at", { ascending: false })
          .limit(1);

        const dispatchRow = Array.isArray(dispatchRows)
          ? dispatchRows[0]
          : null;
        if (dispatchRow?.details) {
          const meta = JSON.parse(String(dispatchRow.details));
          const targetCode = String(
            meta.tagCode || resolvedTagCode || ""
          ).toUpperCase();
          const tagRecord = targetCode
            ? await getVehicleTagByCode(targetCode)
            : null;
          const ownerPhone = tagRecord?.ownerPhone || "";
          const isBasic =
            tagRecord?.planType === "basic" ||
            tagRecord?.packageType === "basic" ||
            tagRecord?.alertChannel === "WHATSAPP";

          if (ownerPhone && Boolean(meta.smsFallbackEnabled) && !isBasic) {
            badge = "تم الإشعار عبر SMS (بديل تلقائي)";
            await supabaseAdmin
              .from("reports")
              .update({ reason_badge: badge })
              .eq("id", resolvedReportId);

            await sendSmsAlertMessage(
              ownerPhone,
              String(meta.var1 || targetCode),
              String(meta.var2 || "تنبيه عاجل"),
              String(meta.var3 || "يرجى مراجعة مركبتك"),
              String(meta.formattedCaller || "غير مرفق")
            );

            await broadcastReportRealtimeUpdate({
              reportId: resolvedReportId,
              tagCode: resolvedTagCode,
              deliveryStatus: "delivered",
              ownerReply: null,
              isSmsFallback: true,
              reasonBadge: badge,
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  let deliveryStatus: "sent" | "delivered" | "read" | "replied" = "sent";
  if (ownerReply) {
    deliveryStatus = "replied";
  } else if (badge.includes("تمت القراءة")) {
    deliveryStatus = "read";
  } else if (badge.includes("تم التسليم") || badge.includes("SMS")) {
    deliveryStatus = "delivered";
  }

  return {
    deliveryStatus,
    ownerReply,
    isSmsFallback: badge.includes("SMS"),
  };
}

export async function GET(req: NextRequest) {
  try {
    const rawTag = req.nextUrl.searchParams.get("tagCode") || "";
    const reportId = req.nextUrl.searchParams.get("reportId") || "";
    const tagCode = formatBalaghniTagCode(rawTag);

    if (!tagCode && !reportId) {
      return NextResponse.json(
        { ok: false, error: "tagCode required" },
        { status: 400 }
      );
    }

    const state = await syncReportDeliveryAndFallback(reportId, tagCode);
    return NextResponse.json({
      ok: true,
      ...state,
    });
  } catch {
    return NextResponse.json(
      { ok: true, deliveryStatus: "sent", ownerReply: null, isSmsFallback: false },
      { status: 200 }
    );
  }
}

