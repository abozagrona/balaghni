import { NextRequest, NextResponse } from "next/server";
import {
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
      report_id: (result as { reportId?: string }).reportId || null,
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

export async function GET(req: NextRequest) {
  try {
    const rawTag = req.nextUrl.searchParams.get("tagCode") || "";
    const reportId = req.nextUrl.searchParams.get("reportId") || "";
    const tagCode = formatBalaghniTagCode(rawTag);

    if (!tagCode && !reportId) {
      return NextResponse.json({ ok: false, error: "tagCode required" }, { status: 400 });
    }

    let reportRow: Record<string, unknown> | null = null;
    if (reportId && !reportId.startsWith("rep_")) {
      const { data } = await supabaseAdmin
        .from("reports")
        .select("id,tag_code,reason_badge,message,created_at")
        .eq("id", reportId)
        .maybeSingle();
      if (data) reportRow = data as Record<string, unknown>;
    }

    if (!reportRow && tagCode) {
      const { data } = await supabaseAdmin
        .from("reports")
        .select("id,tag_code,reason_badge,message,created_at")
        .eq("tag_code", tagCode)
        .order("created_at", { ascending: false })
        .limit(1);
      if (Array.isArray(data) && data.length > 0) {
        reportRow = data[0] as Record<string, unknown>;
      }
    }

    let badge = String(reportRow?.reason_badge || "");
    const message = String(reportRow?.message || "");
    const resolvedReportId = String(reportRow?.id || reportId || "");

    let ownerReply: string | null = null;
    const replyMarker = "[رد المالك عبر واتساب]:";
    if (message.includes(replyMarker)) {
      const parts = message.split(replyMarker);
      ownerReply = parts[parts.length - 1]?.trim() || null;
    } else if (badge.startsWith("رد المالك:")) {
      ownerReply = badge.replace("رد المالك:", "").trim() || null;
    }

    // إذا كانت الحالة ما زالت "تم الإرسال" ولم تُسلَّم أو تُقرأ بعد، نفحص Green-API ونجري التحويل البديل لـ SMS بعد 35 ثانية (لباقة نَبِّهْنِي فقط)
    if (
      !ownerReply &&
      !badge.includes("تمت القراءة") &&
      !badge.includes("تم التسليم") &&
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
          const targetCode = String(meta.tagCode || tagCode || "").toUpperCase();
          const tagRecord = targetCode ? await getVehicleTagByCode(targetCode) : null;
          const ownerPhone = tagRecord?.ownerPhone || "";

          if (ownerPhone && meta.waMessageId) {
            const waState = await checkGreenApiMessageStatus(
              ownerPhone,
              String(meta.waMessageId)
            );
            if (waState === "read") {
              badge = "واتساب: تمت القراءة";
              await supabaseAdmin
                .from("reports")
                .update({ reason_badge: badge })
                .eq("id", resolvedReportId);
            } else if (waState === "delivered") {
              badge = "واتساب: تم التسليم";
              await supabaseAdmin
                .from("reports")
                .update({ reason_badge: badge })
                .eq("id", resolvedReportId);
            } else {
              const createdMs = new Date(
                String(meta.createdAt || reportRow?.created_at || Date.now())
              ).getTime();
              const elapsedMs = Date.now() - createdMs;
              const isBasic =
                tagRecord?.planType === "basic" ||
                tagRecord?.packageType === "basic" ||
                tagRecord?.alertChannel === "WHATSAPP";

              if (
                elapsedMs >= 35000 &&
                Boolean(meta.smsFallbackEnabled) &&
                !isBasic
              ) {
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
              }
            }
          }
        }
      } catch {
        // ignore transient check failure
      }
    }

    let deliveryStatus: "sent" | "delivered" | "read" | "replied" = "sent";
    if (ownerReply) {
      deliveryStatus = "replied";
    } else if (badge.includes("تمت القراءة")) {
      deliveryStatus = "read";
    } else if (badge.includes("تم التسليم") || badge.includes("SMS")) {
      deliveryStatus = "delivered";
    } else if (badge.includes("تم الإرسال")) {
      deliveryStatus = "sent";
    }

    return NextResponse.json({
      ok: true,
      deliveryStatus,
      ownerReply,
      isSmsFallback: badge.includes("SMS"),
    });
  } catch {
    return NextResponse.json(
      { ok: true, deliveryStatus: "delivered", ownerReply: null, isSmsFallback: false },
      { status: 200 }
    );
  }
}

