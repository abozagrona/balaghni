import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    "https://bcmpbfwrtdoxoqebixai.supabase.co";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjbXBiZndydGRveG9xZWJpeGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDA4MjQsImV4cCI6MjA5MTAxNjgyNH0.s1c3sD3t2-F8w8wB2a-x-0C_4f7e-4j-5k6l7m8n9o0";

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { statuses, messages } = extractEventsFromPayload(body);
    const supabase = getServiceSupabase();

    // 1) معالجة حالات تسليم الرسائل (sent, delivered, read, failed)
    for (const st of statuses) {
      console.info("[WhatsApp Webhook] تحديث حالة الرسالة:", st);

      const { report, tagCode, vehicleLabel } = st.recipientPhone
        ? await findLatestReportForPhone(supabase, st.recipientPhone)
        : { report: null, tagCode: null, vehicleLabel: "مركبتك" };

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
      }

      // في حال فشل تسليم إشعار الواتساب (failed): التحويل التلقائي إلى SMS كخطة بديلة
      if (st.status === "failed" && st.recipientPhone) {
        const reasonTitle = String(
          report?.reason_title || "تنبيه عاجل بخصوص مركبتك"
        );
        const messageDesc = String(
          report?.message || "يرجى التوجه لمركبتك ومراجعة البلاغ الوارد عبر منصة بَلِّغْنِي."
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

        if (report?.id && smsFallback.ok) {
          await supabase
            .from("reports")
            .update({
              reason_badge: "تم الإشعار عبر SMS (بديل تلقائي)",
            })
            .eq("id", report.id);
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

        await supabase
          .from("reports")
          .update({
            reason_badge: `رد المالك: ${msg.text.slice(0, 40)}`,
            message: updatedMessage,
          })
          .eq("id", report.id);
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
