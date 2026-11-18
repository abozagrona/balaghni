import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  broadcastReportRealtimeUpdate,
  getVehicleTagByCode,
  supabaseAdmin,
} from "@/lib/supabase/client";
import {
  sendWhatsappAlertMessage,
  TWILIO_CONTENT_SIDS,
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

    const tag = await getVehicleTagByCode(tagCode);
    if (!tag || tag.status !== "ACTIVE" || !tag.ownerPhone) {
      return NextResponse.json(
        { ok: false, error: "تعذر العثور على بيانات الملصق النشط." },
        { status: 404 }
      );
    }

    // توليد رمز مكالمة فريد من 6 أحرف/أرقام
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.randomBytes(6);
    const callCode = Array.from(bytes)
      .map((b) => alphabet[b % alphabet.length])
      .join("");

    const vehicleLabel = (tag.vehicleInfo || tag.vehicleBrand || tagCode)
      .trim()
      .slice(0, 25);

    const baseAppUrl = (
      process.env.NEXT_PUBLIC_SITE_URL || "https://balaghni.ly"
    )
      .replace(/\/+$/, "")
      .replace("://www.balaghni.ly", "://balaghni.ly");

    const callUrl = `${baseAppUrl}/call/${callCode}`;
    const nowIso = new Date().toISOString();

    await supabaseAdmin.from("admin_audit_logs").insert({
      admin_name: "منظومة المكالمات المشفرة",
      action_type: "REPORT_CALL_SESSION",
      target_item: callCode,
      details: JSON.stringify({
        callCode,
        reportId: reportId || null,
        tagCode,
        vehicleLabel,
        createdAt: nowIso,
      }),
      created_at: nowIso,
    });

    const whatsappText = [
      `📞 (منصة بَلِّغْنِي) اتصال صوتي عاجل بخصوص سيارتك (${vehicleLabel})!`,
      `المُبلِّغ ينتظر عند المركبة ويتصل بك صوتياً الآن عبر المتصفح (مكالمة مشفرة دون كشف رقمك أو رقمه).`,
      `👉 اضغط هنا للرد والتحدث فوراً: ${callUrl}`,
    ].join("\n");

    await sendWhatsappAlertMessage(tag.ownerPhone, whatsappText, null, {
      verifyDelivery: false,
      twilioContentSid: TWILIO_CONTENT_SIDS.VOICE_CALL,
      twilioContentVariables: {
        "1": callCode,
        "2": vehicleLabel,
      },
    });

    return NextResponse.json({
      ok: true,
      callCode,
      tagCode,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر بدء المكالمة الصوتية المشفرة حالياً." },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const callCode = String(req.nextUrl.searchParams.get("callCode") || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    if (!callCode) {
      return NextResponse.json(
        { ok: false, error: "رمز المكالمة غير صالح." },
        { status: 400 }
      );
    }

    const { data: row } = await supabaseAdmin
      .from("admin_audit_logs")
      .select("details")
      .eq("action_type", "REPORT_CALL_SESSION")
      .eq("target_item", callCode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row?.details) {
      return NextResponse.json(
        { ok: false, error: "المكالمة غير موجودة أو انتهت صلاحيتها." },
        { status: 404 }
      );
    }

    const meta = JSON.parse(String(row.details));
    return NextResponse.json({
      ok: true,
      callCode,
      tagCode: String(meta.tagCode || ""),
      reportId: meta.reportId ? String(meta.reportId) : null,
      vehicleLabel: String(meta.vehicleLabel || meta.tagCode || "مركبتك"),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر جلب بيانات المكالمة." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const callCode = String(body?.callCode || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    const { data: row } = await supabaseAdmin
      .from("admin_audit_logs")
      .select("details")
      .eq("action_type", "REPORT_CALL_SESSION")
      .eq("target_item", callCode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (row?.details) {
      const meta = JSON.parse(String(row.details));
      const reportId = String(meta.reportId || "").trim();
      const tagCode = String(meta.tagCode || "").trim().toUpperCase();
      const replyText = "أنا قادم الآن";
      const reasonBadge = `رد المالك: ${replyText}`;

      if (reportId && !reportId.startsWith("rep_")) {
        const { data: rep } = await supabaseAdmin
          .from("reports")
          .select("id,message")
          .eq("id", reportId)
          .maybeSingle();
        if (rep?.id) {
          const prevMsg = String(rep.message || "").trim();
          const marker = `[رد المالك عبر واتساب]: ${replyText}`;
          const nextMsg = prevMsg.includes(marker)
            ? prevMsg
            : `${prevMsg}\n${marker}`.trim();
          await supabaseAdmin
            .from("reports")
            .update({ reason_badge: reasonBadge, message: nextMsg })
            .eq("id", rep.id);
        }
      }

      await broadcastReportRealtimeUpdate({
        reportId: reportId || undefined,
        tagCode: tagCode || undefined,
        deliveryStatus: "replied",
        ownerReply: replyText,
        isSmsFallback: false,
        reasonBadge,
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
