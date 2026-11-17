import { NextRequest, NextResponse } from "next/server";
import {
  getVehicleTagByCode,
  supabaseAdmin,
} from "@/lib/supabase/client";
import {
  sendSmsAlertMessage,
  sendWhatsappAlertMessage,
} from "@/lib/otp-service";
import { formatBalaghniTagCode } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawTag = String(body?.tagCode || "").trim();
    const reportId = String(body?.reportId || "").trim();
    const tagCode = formatBalaghniTagCode(rawTag);

    if (!tagCode) {
      return NextResponse.json(
        { ok: false, error: "رمز الملصق مطلوب." },
        { status: 400 }
      );
    }

    const targetKey = reportId && !reportId.startsWith("rep_") ? reportId : tagCode;

    // التحقق من عدم إرسال أكثر من تنبيه تذكيري واحد لنفس البلاغ (قفل التنبيه الثالث نهائياً)
    const { data: existingReminders } = await supabaseAdmin
      .from("admin_audit_logs")
      .select("id")
      .eq("action_type", "REPORT_REMINDER_SENT")
      .eq("target_item", targetKey)
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

    const reminderText = `(منصة بَلِّغْنِي) تنبيه تذكيري أخير (تمديد 5 دقائق): الطرف الآخر ما زال بانتظارك عند سيارتك (${vehicleLabel}). يرجى التوجه للمركبة فوراً.`;

    const waResult = await sendWhatsappAlertMessage(
      tag.ownerPhone,
      reminderText,
      null,
      { verifyDelivery: false }
    );

    const isBasicPlan =
      tag.planType === "basic" ||
      tag.packageType === "basic" ||
      tag.alertChannel === "WHATSAPP";

    if (!waResult.ok && !isBasicPlan) {
      await sendSmsAlertMessage(
        tag.ownerPhone,
        vehicleLabel,
        "تنبيه تذكيري أخير",
        "الطرف الآخر بانتظارك (تمديد 5 دقائق)",
        "منصة بَلِّغْنِي"
      );
    }

    await supabaseAdmin.from("admin_audit_logs").insert({
      admin_name: "منظومة التذكير",
      action_type: "REPORT_REMINDER_SENT",
      target_item: targetKey,
      details: JSON.stringify({
        reportId: reportId || null,
        tagCode,
        waOk: waResult.ok,
        createdAt: new Date().toISOString(),
      }),
      created_at: new Date().toISOString(),
    });

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
