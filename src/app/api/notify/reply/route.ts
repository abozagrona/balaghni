import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { verifyReportReplySignature } from "@/lib/security-tokens";
import { formatBalaghniTagCode } from "@/lib/utils";

export const dynamic = "force-dynamic";

const REPLY_OPTIONS: Record<string, string> = {
  "2min": "أنا قادم خلال دقيقتين",
  "5min": "أنا قادم خلال 5 دقائق",
  sorry: "أعتذر، سأتحرك فوراً",
};

export async function GET(req: NextRequest) {
  const reportId = String(req.nextUrl.searchParams.get("reportId") || "").trim();
  const rawTag = String(req.nextUrl.searchParams.get("tagCode") || "").trim();
  const sig = String(req.nextUrl.searchParams.get("sig") || "").trim();
  const replyKey = String(req.nextUrl.searchParams.get("reply") || "2min").trim();

  const tagCode = formatBalaghniTagCode(rawTag);
  const replyText = REPLY_OPTIONS[replyKey] || REPLY_OPTIONS["2min"];

  if (!reportId || !tagCode || !verifyReportReplySignature(reportId, tagCode, sig)) {
    return new NextResponse(
      `<!DOCTYPE html><html lang="ar" dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0B0D13;color:#fff;"><h2>رابط الاستجابة غير صالح أو منتهي الصلاحية</h2></body></html>`,
      { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  try {
    let reportRow: Record<string, unknown> | null = null;
    if (!reportId.startsWith("rep_")) {
      const { data } = await supabaseAdmin
        .from("reports")
        .select("id,message")
        .eq("id", reportId)
        .maybeSingle();
      if (data) reportRow = data as Record<string, unknown>;
    }
    if (!reportRow) {
      const { data } = await supabaseAdmin
        .from("reports")
        .select("id,message")
        .eq("tag_code", tagCode)
        .order("created_at", { ascending: false })
        .limit(1);
      if (Array.isArray(data) && data.length > 0) {
        reportRow = data[0] as Record<string, unknown>;
      }
    }

    if (reportRow?.id) {
      const prevMsg = String(reportRow.message || "").trim();
      const marker = `[رد المالك عبر واتساب]: ${replyText}`;
      const nextMsg = prevMsg.includes(marker)
        ? prevMsg
        : `${prevMsg}\n${marker}`.trim();

      await supabaseAdmin
        .from("reports")
        .update({
          reason_badge: `رد المالك: ${replyText}`,
          message: nextMsg,
        })
        .eq("id", reportRow.id);
    }
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
  <div style="max-width:420px;width:100%;background:#202C33;border:1px solid rgba(37,211,102,0.35);border-radius:24px;padding:32px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.4);">
    <div style="width:64px;height:64px;border-radius:50%;background:rgba(37,211,102,0.18);color:#25D366;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:32px;font-weight:bold;">✓</div>
    <h1 style="margin:0 0 8px;font-size:20px;font-weight:900;">تم إرسال استجابتك فوراً!</h1>
    <p style="margin:0 0 18px;font-size:14px;color:rgba(255,255,255,0.8);line-height:1.6;">
      تم إبلاغ المُرسِل بردّك:<br/>
      <strong style="color:#25D366;font-size:16px;">«${replyText}»</strong>
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
