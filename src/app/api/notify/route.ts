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
  checkTwilioMessageStatus,
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
  if (!reportId) {
    return {
      deliveryStatus: "sent",
      ownerReply: null,
      isSmsFallback: false,
    };
  }

  let reportRow: Record<string, unknown> | null = null;
  if (!reportId.startsWith("rep_")) {
    const { data } = await supabaseAdmin
      .from("reports")
      .select("id,tag_code,reason_badge,message,created_at")
      .eq("id", reportId)
      .maybeSingle();
    if (data) reportRow = data as Record<string, unknown>;
  }

  let badge = String(reportRow?.reason_badge || "");
  const message = String(reportRow?.message || "");
  const resolvedReportId = String(reportRow?.id || reportId);
  const resolvedTagCode = String(
    reportRow?.tag_code || tagCode || ""
  ).toUpperCase();

  // فحص سجلات REPORT_STATUS_UPDATE الواردة من الـ Webhook لهذا البلاغ تحديداً
  try {
    const { data: statusLogs } = await supabaseAdmin
      .from("admin_audit_logs")
      .select("details")
      .eq("action_type", "REPORT_STATUS_UPDATE")
      .eq("target_item", resolvedReportId)
      .order("created_at", { ascending: false })
      .limit(1);
    const latestLog = Array.isArray(statusLogs) ? statusLogs[0] : null;
    if (latestLog?.details) {
      const parsedLog = JSON.parse(String(latestLog.details));
      const logBadge = String(parsedLog.reasonBadge || "");
      if (
        logBadge.includes("تمت القراءة") ||
        (logBadge.includes("تم التسليم") && !badge.includes("تمت القراءة"))
      ) {
        badge = logBadge;
      }
    }
  } catch {
    // ignore
  }

  let ownerReply: string | null = null;
  const replyMarker = "[رد المالك عبر واتساب]:";
  if (message.includes(replyMarker)) {
    const parts = message.split(replyMarker);
    ownerReply = parts[parts.length - 1]?.trim() || null;
  } else if (badge.startsWith("رد المالك:")) {
    ownerReply = badge.replace("رد المالك:", "").trim() || null;
  }

  const prevBadge = badge;

  // فحص حالة الرسالة الحقيقية (Twilio / Green API) والتحويل البديل لـ SMS بعد 35 ثانية (لباقة نَبِّهْنِي فقط)
  if (
    !ownerReply &&
    !badge.includes("تمت القراءة") &&
    !badge.includes("SMS") &&
    resolvedReportId
  ) {
    try {
      const { data: dispatchRows } = await supabaseAdmin
        .from("admin_audit_logs")
        .select("details,created_at")
        .eq("action_type", "REPORT_DISPATCH")
        .eq("target_item", resolvedReportId)
        .order("created_at", { ascending: false })
        .limit(1);

      const dispatchRow = Array.isArray(dispatchRows) ? dispatchRows[0] : null;
      if (dispatchRow?.details) {
        const meta = JSON.parse(String(dispatchRow.details));
        const targetCode = String(
          meta.tagCode || resolvedTagCode || ""
        ).toUpperCase();
        const tagRecord = targetCode
          ? await getVehicleTagByCode(targetCode)
          : null;
        const ownerPhone = tagRecord?.ownerPhone || "";
        const msgId = String(
          meta.twilioMessageSid || meta.waMessageId || ""
        ).trim();

        let providerState: "sent" | "delivered" | "read" | "failed" | "unknown" =
          "unknown";
        if (msgId && (msgId.startsWith("SM") || msgId.startsWith("MM"))) {
          providerState = await checkTwilioMessageStatus(msgId);
        } else if (ownerPhone && msgId) {
          providerState = await checkGreenApiMessageStatus(ownerPhone, msgId);
        }

        if (providerState === "read") {
          badge = "واتساب: تمت القراءة";
          if (!resolvedReportId.startsWith("rep_")) {
            await supabaseAdmin
              .from("reports")
              .update({ reason_badge: badge })
              .eq("id", resolvedReportId);
          }
        } else if (
          providerState === "delivered" &&
          !badge.includes("تم التسليم")
        ) {
          badge = "واتساب: تم التسليم";
          if (!resolvedReportId.startsWith("rep_")) {
            await supabaseAdmin
              .from("reports")
              .update({ reason_badge: badge })
              .eq("id", resolvedReportId);
          }
        } else if (!badge.includes("تم التسليم")) {
          const createdMs = new Date(
            String(
              meta.createdAt ||
                dispatchRow.created_at ||
                reportRow?.created_at ||
                Date.now()
            )
          ).getTime();
          const elapsedMs = Date.now() - createdMs;
          const isBasic =
            tagRecord?.planType === "basic" ||
            tagRecord?.packageType === "basic" ||
            tagRecord?.alertChannel === "WHATSAPP";

          if (
            elapsedMs >= 35000 &&
            Boolean(meta.smsFallbackEnabled) &&
            !isBasic &&
            ownerPhone
          ) {
            badge = "تم الإشعار عبر SMS (بديل تلقائي)";
            if (!resolvedReportId.startsWith("rep_")) {
              await supabaseAdmin
                .from("reports")
                .update({ reason_badge: badge })
                .eq("id", resolvedReportId);
            }

            await sendSmsAlertMessage(
              ownerPhone,
              String(meta.var1 || targetCode),
              String(meta.var2 || "تنبيه عاجل"),
              String(meta.var3 || "يرجى مراجعة مركبتك"),
              String(meta.formattedCaller || "غير مرفق")
            );
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

  if (badge !== prevBadge) {
    await broadcastReportRealtimeUpdate({
      reportId: resolvedReportId,
      tagCode: resolvedTagCode,
      deliveryStatus,
      ownerReply,
      isSmsFallback: badge.includes("SMS"),
      reasonBadge: badge,
    });
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

