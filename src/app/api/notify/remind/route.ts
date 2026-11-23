import { NextRequest, NextResponse } from "next/server";
import {
  getVehicleTagByCode,
  supabaseAdmin,
} from "@/lib/supabase/client";
import {
  sendSmsAlertMessage,
  sendWhatsappAlertMessage,
  TWILIO_CONTENT_SIDS,
} from "@/lib/otp-service";
import {
  checkDistributedKeyLimit,
  consumeDistributedRateLimit,
  getClientIp,
} from "@/lib/rate-limiter";
import { verifyReportAccessTokenDistributed } from "@/lib/report-token-revocation";
import { formatBalaghniTagCode } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawTag = String(body?.tagCode || "").trim();
    const reportId = String(body?.reportId || "").trim();
    const tagCode = formatBalaghniTagCode(rawTag);
    const accessToken = String(req.headers.get("x-report-token") || "").trim();

    if (!tagCode || !reportId || reportId.startsWith("rep_")) {
      return NextResponse.json(
        { ok: false, error: "رمز الملصق ومعرّف البلاغ الصالح مطلوبان." },
        { status: 400 }
      );
    }

    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: "غير مصرح بإرسال تذكير دون رمز وصول صالح للبلاغ." },
        { status: 401 }
      );
    }

    // 1. التحقق الموزّع من صلاحية وتوقيع وعدم إلغاء رمز الوصول للبلاغ
    const tokenCheck = await verifyReportAccessTokenDistributed(
      accessToken,
      reportId,
      tagCode
    );
    if (!tokenCheck.valid) {
      return NextResponse.json(
        {
          ok: false,
          error: "رمز الوصول للبلاغ غير صالح أو منتهي الصلاحية أو ملغى.",
          reason: tokenCheck.reason || "unauthorized",
        },
        { status: 401 }
      );
    }

    // 2. التحقق من وجود البلاغ الحقيقي وربطه بـ tagCode (منع تمرير reportId عشوائي)
    const { data: reportRow } = await supabaseAdmin
      .from("reports")
      .select("id, tag_code")
      .eq("id", reportId)
      .eq("tag_code", tagCode)
      .maybeSingle();

    if (!reportRow?.id) {
      return NextResponse.json(
        { ok: false, error: "تعذر العثور على بلاغ مطابق لهذا الملصق." },
        { status: 404 }
      );
    }

    // 3. التحقق المسبق من سجل التذكير الدائم للبلاغ
    const { data: existingReminders } = await supabaseAdmin
      .from("admin_audit_logs")
      .select("id")
      .eq("action_type", "REPORT_REMINDER_SENT")
      .eq("target_item", reportId)
      .limit(1);

    if (Array.isArray(existingReminders) && existingReminders.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          locked: true,
          error:
            "انتهت مهلة الانتظار ولا يمكن إرسال تنبيهات إضافية. يرجى التواصل مع خدمة العملاء.",
        },
        { status: 429 }
      );
    }

    // 4. فحص قرائي مسبق لقفل البلاغ (rl_check دون استهلاك) لمنع النقرات المكررة على نفس البلاغ
    // من استنزاف حصة المركبة اليومية (rem:tag) أو الـ IP، ودون حرق قفل البلاغ إذا رُفض الطلب لاحقاً
    const preReportCheck = await checkDistributedKeyLimit(
      `rem:report:${reportId.trim().toLowerCase()}`,
      1,
      24 * 60 * 60 * 1000
    );
    if (!preReportCheck) {
      return NextResponse.json(
        {
          ok: false,
          locked: false,
          error:
            "خدمة التحقق الأمني غير متاحة مؤقتاً. يرجى المحاولة مجدداً بعد 30 ثانية.",
          retryAfterSeconds: 30,
        },
        { status: 503 }
      );
    }
    if (!preReportCheck.allowed) {
      return NextResponse.json(
        {
          ok: false,
          locked: true,
          error:
            "انتهت مهلة الانتظار ولا يمكن إرسال تنبيهات إضافية. يرجى التواصل مع خدمة العملاء.",
          retryAfterSeconds: preReportCheck.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    // 5. قفل وحدود معدل موزّعة ذرية (fail_closed) قبل الإرسال لمنع TOCTOU واستنزاف Twilio
    const clientIp = getClientIp(req);
    const ipLimit = await consumeDistributedRateLimit(
      "rem:ip",
      clientIp,
      5,
      60 * 60 * 1000,
      "fail_closed"
    );
    if (!ipLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            ipLimit.reason ||
            "تم تجاوز الحد المسموح لطلبات التذكير. يرجى المحاولة لاحقاً.",
          retryAfterSeconds: ipLimit.retryAfterSeconds,
        },
        { status: ipLimit.source === "fail_closed" ? 503 : 429 }
      );
    }

    const tagLimit = await consumeDistributedRateLimit(
      "rem:tag",
      tagCode,
      3,
      24 * 60 * 60 * 1000,
      "fail_closed"
    );
    if (!tagLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          locked: tagLimit.source !== "fail_closed",
          error:
            tagLimit.reason ||
            "تم الوصول للحد اليومي للتذكيرات لهذه المركبة.",
          retryAfterSeconds: tagLimit.retryAfterSeconds,
        },
        { status: tagLimit.source === "fail_closed" ? 503 : 429 }
      );
    }

    // قفل ذري على مستوى البلاغ الواحد (1 تذكير لكل بلاغ خلال 24 ساعة) يمنع التزامن وإعادة المحاولة غير المحدودة
    const reportLock = await consumeDistributedRateLimit(
      "rem:report",
      reportId,
      1,
      24 * 60 * 60 * 1000,
      "fail_closed"
    );
    if (!reportLock.allowed) {
      return NextResponse.json(
        {
          ok: false,
          locked: reportLock.source !== "fail_closed",
          error:
            reportLock.source === "fail_closed"
              ? reportLock.reason || "خدمة التحقق غير متاحة مؤقتاً."
              : "انتهت مهلة الانتظار ولا يمكن إرسال تنبيهات إضافية. يرجى التواصل مع خدمة العملاء.",
        },
        { status: reportLock.source === "fail_closed" ? 503 : 429 }
      );
    }

    const tag = await getVehicleTagByCode(tagCode);
    if (!tag || tag.status !== "ACTIVE" || !tag.ownerPhone) {
      return NextResponse.json(
        { ok: false, error: "تعذر العثور على بيانات الملصق النشط." },
        { status: 404 }
      );
    }

    const vehicleLabel = (tag.vehicleInfo || tag.vehicleBrand || tagCode)
      .trim()
      .slice(0, 25);

    const reminderText = `(منصة بلّغني) تنبيه تذكيري أخير (تمديد 5 دقائق): الطرف الآخر ما زال بانتظارك عند سيارتك (${vehicleLabel}). يرجى التوجه للمركبة فوراً.`;

    const waResult = await sendWhatsappAlertMessage(
      tag.ownerPhone,
      reminderText,
      null,
      {
        verifyDelivery: false,
        twilioContentSid: TWILIO_CONTENT_SIDS.REMIND,
        twilioContentVariables: {
          "1": vehicleLabel,
        },
      }
    );

    const isBasicPlan =
      tag.planType === "basic" ||
      tag.packageType === "basic" ||
      tag.alertChannel === "WHATSAPP";

    let smsOk = false;
    if (!waResult.ok && !isBasicPlan) {
      const smsRes = await sendSmsAlertMessage(
        tag.ownerPhone,
        vehicleLabel,
        "تنبيه تذكيري أخير",
        "الطرف الآخر بانتظارك (تمديد 5 دقائق)",
        "منصة بَلِّغْنِي"
      );
      smsOk = Boolean(smsRes?.ok);
    }

    const delivered = Boolean(waResult.ok || smsOk);
    const nowIso = new Date().toISOString();

    // تسجيل العملية في سجل التدقيق فقط بعد المصادقة والقفل الذري (منع إغراق السجل)
    await supabaseAdmin.from("admin_audit_logs").insert({
      admin_name: "منظومة التذكير",
      action_type: delivered ? "REPORT_REMINDER_SENT" : "REPORT_REMINDER_FAILED",
      target_item: reportId,
      details: JSON.stringify({
        reportId,
        tagCode,
        waOk: Boolean(waResult.ok),
        smsOk,
        createdAt: nowIso,
      }),
      created_at: nowIso,
    });

    if (!delivered) {
      return NextResponse.json(
        {
          ok: false,
          locked: true,
          error:
            "تعذر تسليم التنبيه التذكيري عبر مزود الرسائل حالياً. تم قفل المحاولة لمنع التكرار.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      reminderCount: 1,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر إرسال التنبيه التذكيري حالياً." },
      { status: 500 }
    );
  }
}
