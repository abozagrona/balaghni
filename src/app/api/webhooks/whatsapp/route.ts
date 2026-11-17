import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  supabaseAdmin,
  broadcastReportRealtimeUpdate,
} from "@/lib/supabase/client";
import { sendSmsAlertMessage } from "@/lib/otp-service";

export const dynamic = "force-dynamic";

function normalizeLibyanPhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00218")) return `218${digits.slice(5)}`;
  if (digits.startsWith("218")) return digits;
  if (digits.startsWith("09") && digits.length === 10) {
    return `218${digits.slice(1)}`;
  }
  if (digits.startsWith("9") && digits.length === 9) {
    return `218${digits}`;
  }
  return digits;
}

function getServiceSupabase() {
  return supabaseAdmin;
}

function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  const appSecret = (
    process.env.WHATSAPP_APP_SECRET ||
    process.env.META_APP_SECRET ||
    ""
  ).trim();

  // إذا كان سر تطبيق Meta مضبوطاً في البيئة، نفرض التحقق التشفيري الصارم من التوقيع
  if (!appSecret) {
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const expectedSig = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex")}`;

  const a = Buffer.from(signatureHeader, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function buildPhoneCandidates(rawPhone: string): string[] {
  const normalized = normalizeLibyanPhone(rawPhone);
  const digits = String(rawPhone || "").replace(/\D/g, "");
  const withoutCountry = normalized.startsWith("218")
    ? `0${normalized.slice(3)}`
    : normalized;
  return Array.from(
    new Set(
      [
        normalized,
        `+${normalized}`,
        withoutCountry,
        digits,
        rawPhone?.trim(),
      ].filter(Boolean)
    )
  );
}

// ============================================================================
// 1. معالج التحقق من Meta WhatsApp Cloud API (GET)
// المسار: /api/webhooks/whatsapp
// ============================================================================
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken = (
    process.env.WHATSAPP_VERIFY_TOKEN || "balaghni_wa_2026_clean"
  ).trim();

  if (mode === "subscribe" && token?.trim() === expectedToken) {
    console.info(
      "[WhatsApp Webhook] تم التحقق من المسار بنجاح من قبل Meta Cloud API."
    );
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  console.warn("[WhatsApp Webhook] فشل التحقق من Meta Webhook:", {
    mode,
    tokenReceived: Boolean(token),
  });

  return new Response("Forbidden: Invalid Verify Token", {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

// ============================================================================
// 2. معالج تحديثات حالات التسليم والردود الواردة من المالك (POST)
// ============================================================================
interface ParsedStatusEvent {
  messageId: string;
  status: string;
  recipientPhone: string;
  timestamp: string;
  errorDetail?: string;
}

interface ParsedIncomingMessage {
  messageId: string;
  fromPhone: string;
  text: string;
  timestamp: string;
  contextMessageId?: string;
}

function extractEventsFromPayload(body: Record<string, any>): {
  statuses: ParsedStatusEvent[];
  messages: ParsedIncomingMessage[];
} {
  const statuses: ParsedStatusEvent[] = [];
  const messages: ParsedIncomingMessage[] = [];

  // Meta WhatsApp Cloud API standard payload
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};

      if (Array.isArray(value?.statuses)) {
        for (const st of value.statuses) {
          const errObj = Array.isArray(st?.errors) ? st.errors[0] : undefined;
          statuses.push({
            messageId: String(st?.id || ""),
            status: String(st?.status || "").toLowerCase(),
            recipientPhone: String(st?.recipient_id || ""),
            timestamp: st?.timestamp
              ? new Date(Number(st.timestamp) * 1000).toISOString()
              : new Date().toISOString(),
            errorDetail: errObj
              ? `${errObj.code || ""} ${errObj.title || errObj.message || ""}`.trim()
              : undefined,
          });
        }
      }

      if (Array.isArray(value?.messages)) {
        for (const msg of value.messages) {
          const textBody =
            msg?.text?.body ||
            msg?.button?.text ||
            msg?.interactive?.button_reply?.title ||
            msg?.interactive?.list_reply?.title ||
            "";
          if (textBody || msg?.from) {
            messages.push({
              messageId: String(msg?.id || ""),
              fromPhone: String(msg?.from || ""),
              text: String(textBody || "").trim(),
              timestamp: msg?.timestamp
                ? new Date(Number(msg.timestamp) * 1000).toISOString()
                : new Date().toISOString(),
              contextMessageId: msg?.context?.id
                ? String(msg.context.id)
                : undefined,
            });
          }
        }
      }
    }
  }

  // Direct / Custom webhook format fallback
  if (statuses.length === 0 && typeof body?.status === "string") {
    statuses.push({
      messageId: String(body?.messageId || body?.idMessage || body?.id || ""),
      status: body.status.toLowerCase(),
      recipientPhone: String(
        body?.recipient_id ||
          body?.phone ||
          String(body?.chatId || "").replace("@c.us", "")
      ),
      timestamp: new Date().toISOString(),
      errorDetail: body?.error ? String(body.error) : undefined,
    });
  }

  if (
    messages.length === 0 &&
    (body?.typeWebhook === "incomingMessageReceived" || body?.text || body?.reply)
  ) {
    const rawFrom =
      body?.from ||
      body?.phone ||
      String(body?.senderData?.chatId || "").replace("@c.us", "");
    const rawText =
      body?.text ||
      body?.reply ||
      body?.messageData?.textMessageData?.textMessage ||
      body?.messageData?.extendedTextMessageData?.text ||
      "";
    if (rawFrom && rawText) {
      messages.push({
        messageId: String(body?.idMessage || body?.messageId || ""),
        fromPhone: String(rawFrom),
        text: String(rawText).trim(),
        timestamp: new Date().toISOString(),
      });
    }
  }

  return { statuses, messages };
}

async function findLatestReportForPhone(
  supabase: ReturnType<typeof getServiceSupabase>,
  rawPhone: string
): Promise<{
  report: Record<string, any> | null;
  tagCode: string | null;
  vehicleLabel: string;
}> {
  const candidates = buildPhoneCandidates(rawPhone);
  let tagCode: string | null = null;
  let vehicleLabel = "";

  if (candidates.length > 0) {
    const { data: tagRows } = await supabase
      .from("tags")
      .select("code, tag_code, plate_number, vehicle_make, vehicle_model, owner_phone")
      .in("owner_phone", candidates)
      .limit(5);

    if (Array.isArray(tagRows) && tagRows.length > 0) {
      const matchedTag = tagRows[0];
      tagCode = String(matchedTag.code || matchedTag.tag_code || "")
        .toUpperCase()
        .trim();
      vehicleLabel =
        [matchedTag.vehicle_make, matchedTag.vehicle_model, matchedTag.plate_number]
          .filter(Boolean)
          .join(" ")
          .trim() || tagCode;
    }
  }

  if (tagCode) {
    const { data: repRows } = await supabase
      .from("reports")
      .select("*")
      .eq("tag_code", tagCode)
      .order("created_at", { ascending: false })
      .limit(1);

    if (Array.isArray(repRows) && repRows.length > 0) {
      return {
        report: repRows[0],
        tagCode,
        vehicleLabel: vehicleLabel || tagCode,
      };
    }
  }

  return { report: null, tagCode, vehicleLabel: vehicleLabel || tagCode || "مركبتك" };
}

async function findReportByMessageId(
  supabase: ReturnType<typeof getServiceSupabase>,
  messageId: string
): Promise<{
  report: Record<string, any> | null;
  tagCode: string | null;
  vehicleLabel: string;
}> {
  if (!messageId) {
    return { report: null, tagCode: null, vehicleLabel: "مركبتك" };
  }

  try {
    const { data: directRows } = await supabase
      .from("reports")
      .select("*")
      .eq("whatsapp_message_id", messageId)
      .limit(1);
    if (Array.isArray(directRows) && directRows.length > 0) {
      const r = directRows[0];
      const tc = String(r.tag_code || "").toUpperCase();
      return { report: r, tagCode: tc || null, vehicleLabel: tc || "مركبتك" };
    }
  } catch {
    // column whatsapp_message_id may not be migrated yet; fallback to audit logs
  }

  try {
    const { data: logs } = await supabase
      .from("admin_audit_logs")
      .select("target_item, details")
      .eq("action_type", "REPORT_DISPATCH")
      .ilike("details", `%${messageId}%`)
      .order("created_at", { ascending: false })
      .limit(1);

    const logRow = Array.isArray(logs) ? logs[0] : null;
    if (logRow?.details) {
      const parsed = JSON.parse(String(logRow.details));
      const reportId = String(parsed.reportId || logRow.target_item || "").trim();
      const tc = String(parsed.tagCode || "").toUpperCase();
      if (reportId && !reportId.startsWith("rep_")) {
        const { data: rep } = await supabase
          .from("reports")
          .select("*")
          .eq("id", reportId)
          .maybeSingle();
        if (rep) {
          return {
            report: rep,
            tagCode: tc || String(rep.tag_code || "").toUpperCase() || null,
            vehicleLabel: String(parsed.var1 || tc || "مركبتك"),
          };
        }
      }
    }
  } catch {
    // ignore
  }

  return { report: null, tagCode: null, vehicleLabel: "مركبتك" };
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text().catch(() => "");
    const signatureHeader = req.headers.get("x-hub-signature-256");

    if (!verifyMetaWebhookSignature(rawBody, signatureHeader)) {
      console.warn("[WhatsApp Webhook] تم رفض الطلب بسبب فشل توقيع X-Hub-Signature-256");
      return NextResponse.json(
        { ok: false, error: "Invalid webhook signature" },
        { status: 401 }
      );
    }

    const body = rawBody ? JSON.parse(rawBody) : {};
    const { statuses, messages } = extractEventsFromPayload(body);
    const supabase = getServiceSupabase();

    // 1) معالجة حالات تسليم الرسائل (sent, delivered, read, failed)
    for (const st of statuses) {
      console.info("[WhatsApp Webhook] تحديث حالة الرسالة:", st);

      let matched = st.messageId
        ? await findReportByMessageId(supabase, st.messageId)
        : { report: null, tagCode: null, vehicleLabel: "مركبتك" };

      if (!matched.report && st.recipientPhone) {
        matched = await findLatestReportForPhone(supabase, st.recipientPhone);
      }
      const { report, tagCode, vehicleLabel } = matched;

      const statusBadgeMap: Record<string, string> = {
        sent: "واتساب: تم الإرسال",
        delivered: "واتساب: تم التسليم",
        read: "واتساب: تمت القراءة",
        failed: "واتساب: فشل التسليم - تم التحويل لـ SMS",
      };

      if (report?.id) {
        const badgeLabel = statusBadgeMap[st.status] || `واتساب: ${st.status}`;
        await supabase
          .from("reports")
          .update({
            reason_badge: badgeLabel,
          })
          .eq("id", report.id);

        if (st.status === "read" || st.status === "delivered") {
          await broadcastReportRealtimeUpdate({
            reportId: String(report.id),
            tagCode,
            deliveryStatus: st.status === "read" ? "read" : "delivered",
            ownerReply: null,
            isSmsFallback: false,
            reasonBadge: badgeLabel,
          });
        }
      }

      // في حال فشل تسليم إشعار الواتساب (failed): التحويل التلقائي إلى SMS كخطة بديلة
      // شرط أمني: لا يتم إرسال SMS بديل إلا إذا كان هناك بلاغ حقيقي حديث (خلال آخر 24 ساعة) لم يُرسل له SMS مسبقاً
      if (st.status === "failed" && st.recipientPhone && report?.id) {
        const reportCreatedMs = report.created_at
          ? new Date(String(report.created_at)).getTime()
          : 0;
        const isRecentReport =
          reportCreatedMs > 0 && Date.now() - reportCreatedMs <= 24 * 60 * 60 * 1000;
        const alreadySentSms = String(report.reason_badge || "").includes("SMS");

        if (isRecentReport && !alreadySentSms) {
          const reasonTitle = String(
            report?.reason_title || "تنبيه عاجل بخصوص مركبتك"
          );
          const messageDesc = String(
            report?.message ||
              "يرجى التوجه لمركبتك ومراجعة البلاغ الوارد عبر منصة بَلِّغْنِي."
          );

          console.warn(
            `[WhatsApp Webhook] فشل تسليم رسالة واتساب (${st.messageId}) إلى ${st.recipientPhone}. جاري التوجيه التلقائي عبر SMS (Resala)...`
          );

          const smsFallback = await sendSmsAlertMessage(
            st.recipientPhone,
            vehicleLabel || tagCode || "مركبتك",
            reasonTitle,
            messageDesc
          );

          if (smsFallback.ok) {
            const smsBadge = "تم الإشعار عبر SMS (بديل تلقائي)";
            await supabase
              .from("reports")
              .update({
                reason_badge: smsBadge,
              })
              .eq("id", report.id);

            await broadcastReportRealtimeUpdate({
              reportId: String(report.id),
              tagCode,
              deliveryStatus: "delivered",
              ownerReply: null,
              isSmsFallback: true,
              reasonBadge: smsBadge,
            });
          }
        }
      }
    }

    // 2) معالجة الردود الواردة من مالك المركبة وحفظها في سجل البلاغ بـ Supabase
    for (const msg of messages) {
      if (!msg.fromPhone || !msg.text) continue;

      console.info("[WhatsApp Webhook] رد وارد من المالك:", {
        from: msg.fromPhone,
        text: msg.text,
      });

      const { report, tagCode } = await findLatestReportForPhone(
        supabase,
        msg.fromPhone
      );

      if (report?.id) {
        const previousMessage = String(report.message || "").trim();
        const replyLine = `\n[رد المالك عبر واتساب]: ${msg.text}`;
        const updatedMessage = previousMessage.includes(msg.text)
          ? previousMessage
          : `${previousMessage}${replyLine}`.trim();
        const replyBadge = `رد المالك: ${msg.text.slice(0, 40)}`;

        await supabase
          .from("reports")
          .update({
            reason_badge: replyBadge,
            message: updatedMessage,
          })
          .eq("id", report.id);

        await broadcastReportRealtimeUpdate({
          reportId: String(report.id),
          tagCode,
          deliveryStatus: "replied",
          ownerReply: msg.text,
          isSmsFallback: false,
          reasonBadge: replyBadge,
        });
      } else if (tagCode) {
        await supabase.from("reports").insert({
          tag_code: tagCode,
          reason_title: "رد المالك عبر واتساب",
          reason_badge: "رد المالك",
          message: msg.text,
          location: "",
          icon_type: "blocking",
        });
      }
    }

    return NextResponse.json(
      { ok: true, status: "EVENT_RECEIVED" },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error("[WhatsApp Webhook Error]:", err);
    // دائماً إرجاع 200 OK لمنصة Meta لمنع إعادة المحاولات المتكررة أو تعطيل الـ Webhook
    return NextResponse.json(
      { ok: true, status: "EVENT_HANDLED" },
      { status: 200 }
    );
  }
}
