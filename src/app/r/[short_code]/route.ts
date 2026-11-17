import { NextRequest, NextResponse } from "next/server";
import {
  supabaseAdmin,
  broadcastReportRealtimeUpdate,
} from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ short_code: string }> }
) {
  const { short_code } = await context.params;
  const shortCode = String(short_code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!shortCode || shortCode.length < 4 || shortCode.length > 12) {
    return new NextResponse(
      `<!DOCTYPE html><html lang="ar" dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0B0D13;color:#fff;"><h2>رابط الاستجابة غير صالح</h2></body></html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  let reportId = "";
  let tagCode = "";

  try {
    const { data: linkRow } = await supabaseAdmin
      .from("admin_audit_logs")
      .select("details")
      .eq("action_type", "REPORT_SHORT_LINK")
      .eq("target_item", shortCode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (linkRow?.details) {
      const parsed = JSON.parse(String(linkRow.details));
      reportId = String(parsed.reportId || "").trim();
      tagCode = String(parsed.tagCode || "").trim().toUpperCase();
    }
  } catch {
    // ignore
  }

  let reportRow: Record<string, unknown> | null = null;
  try {
    if (reportId && !reportId.startsWith("rep_")) {
      const { data } = await supabaseAdmin
        .from("reports")
        .select("id,tag_code,message")
        .eq("id", reportId)
        .maybeSingle();
      if (data) reportRow = data as Record<string, unknown>;
    }

    if (!reportRow) {
      const { data } = await supabaseAdmin
        .from("reports")
        .select("id,tag_code,message")
        .eq("short_code", shortCode)
        .order("created_at", { ascending: false })
        .limit(1);
      if (Array.isArray(data) && data.length > 0) {
        reportRow = data[0] as Record<string, unknown>;
      }
    }

    if (!reportRow && tagCode) {
      const { data } = await supabaseAdmin
        .from("reports")
        .select("id,tag_code,message")
        .eq("tag_code", tagCode)
        .order("created_at", { ascending: false })
        .limit(1);
      if (Array.isArray(data) && data.length > 0) {
        reportRow = data[0] as Record<string, unknown>;
      }
    }
  } catch {
    // ignore
  }

  if (!reportRow && !reportId && !tagCode) {
    return new NextResponse(
      `<!DOCTYPE html><html lang="ar" dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0B0D13;color:#fff;"><h2>الرابط غير موجود أو منتهي الصلاحية</h2></body></html>`,
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const replyText = "أنا قادم الآن";
  const reasonBadge = `رد المالك: ${replyText}`;
  const resolvedReportId = String(reportRow?.id || reportId || "");
  const resolvedTagCode = String(reportRow?.tag_code || tagCode || "").toUpperCase();

  try {
    if (reportRow?.id) {
      const prevMsg = String(reportRow.message || "").trim();
      const marker = `[رد المالك عبر واتساب]: ${replyText}`;
      const nextMsg = prevMsg.includes(marker)
        ? prevMsg
        : `${prevMsg}\n${marker}`.trim();

      await supabaseAdmin
        .from("reports")
        .update({
          reason_badge: reasonBadge,
          message: nextMsg,
        })
        .eq("id", reportRow.id);
    }

    await broadcastReportRealtimeUpdate({
      reportId: resolvedReportId || undefined,
      tagCode: resolvedTagCode || undefined,
      deliveryStatus: "replied",
      ownerReply: replyText,
      isSmsFallback: false,
      reasonBadge,
    });
  } catch {
    // ignore
  }

  return new NextResponse(
    `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>تم إرسال ردك • بَلِّغْنِي</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0B141A;color:#fff;font-family:system-ui,-apple-system,sans-serif;padding:20px;">
  <div style="max-width:440px;width:100%;background:#202C33;border:1px solid rgba(37,211,102,0.35);border-radius:24px;padding:32px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.4);">
    <div style="width:64px;height:64px;border-radius:50%;background:rgba(37,211,102,0.18);color:#25D366;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px;font-weight:bold;">✓</div>
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:900;color:#25D366;">تم إبلاغ الطرف الآخر أنك قادم الآن خلال 5 دقائق</h1>
    <p style="margin:0 0 18px;font-size:14px;color:rgba(255,255,255,0.8);line-height:1.6;">
      تم تحديث حالة البلاغ لدى المُرسِل فوراً وبدء عداد الانتظار لمدة 5 دقائق.
    </p>
    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.55);">
      منصة بَلِّغْنِي • يمكنك إغلاق هذه الصفحة الآن.
    </p>
  </div>
</body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
