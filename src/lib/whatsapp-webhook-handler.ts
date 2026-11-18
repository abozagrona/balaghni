import {
  supabaseAdmin,
  broadcastReportRealtimeUpdate,
} from "@/lib/supabase/client";
import { sendSmsAlertMessage } from "@/lib/otp-service";

export interface ParsedStatusEvent {
  provider: "green_api" | "twilio" | "meta" | "custom";
  messageId: string;
  status: string;
  recipientPhone: string;
  timestamp: string;
  errorDetail?: string;
}

export interface ParsedIncomingMessage {
  messageId: string;
  fromPhone: string;
  text: string;
  timestamp: string;
  contextMessageId?: string;
  buttonPayload?: string;
}

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

export function parseWebhookBody(
  rawBody: string,
  contentType: string
): Record<string, any> {
  if (!rawBody) return {};
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);
    const obj: Record<string, string> = {};
    params.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
  try {
    return JSON.parse(rawBody);
  } catch {
    // Fallback: try URLSearchParams if it looks like form-encoded
    if (rawBody.includes("=") && !rawBody.trim().startsWith("{")) {
      const params = new URLSearchParams(rawBody);
      const obj: Record<string, string> = {};
      params.forEach((value, key) => {
        obj[key] = value;
      });
      return obj;
    }
    return {};
  }
}

export function extractWebhookEvents(body: Record<string, any>): {
  statuses: ParsedStatusEvent[];
  messages: ParsedIncomingMessage[];
} {
  const statuses: ParsedStatusEvent[] = [];
  const messages: ParsedIncomingMessage[] = [];

  // 1. Green API format: typeWebhook === "outgoingMessageStatus"
  if (body?.typeWebhook === "outgoingMessageStatus") {
    const rawStatus = String(body?.status || "").trim().toLowerCase();
    const rawChat = String(body?.chatId || "").replace(/@.*/, "");
    statuses.push({
      provider: "green_api",
      messageId: String(body?.idMessage || "").trim(),
      status: rawStatus,
      recipientPhone: rawChat,
      timestamp: body?.timestamp
        ? new Date(Number(body.timestamp) * 1000).toISOString()
        : new Date().toISOString(),
      errorDetail: body?.description ? String(body.description) : undefined,
    });
  }

  // 2. Twilio WhatsApp status callback format: MessageSid + MessageStatus
  const twilioSid = String(body?.MessageSid || body?.SmsSid || "").trim();
  const twilioStatus = String(body?.MessageStatus || body?.SmsStatus || "")
    .trim()
    .toLowerCase();
  if (twilioSid && twilioStatus) {
    const rawTo = String(body?.To || "")
      .replace(/^whatsapp:/i, "")
      .trim();
    statuses.push({
      provider: "twilio",
      messageId: twilioSid,
      status: twilioStatus,
      recipientPhone: rawTo,
      timestamp: new Date().toISOString(),
      errorDetail: body?.ErrorMessage
        ? String(body.ErrorMessage)
        : body?.ErrorCode
        ? `Error ${body.ErrorCode}`
        : undefined,
    });
  }

  // 3. Meta WhatsApp Cloud API standard payload
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};

      if (Array.isArray(value?.statuses)) {
        for (const st of value.statuses) {
          const errObj = Array.isArray(st?.errors) ? st.errors[0] : undefined;
          statuses.push({
            provider: "meta",
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
          const btnPayload =
            msg?.button?.payload ||
            msg?.interactive?.button_reply?.id ||
            msg?.interactive?.list_reply?.id ||
            undefined;
          if (textBody || btnPayload || msg?.from) {
            messages.push({
              messageId: String(msg?.id || ""),
              fromPhone: String(msg?.from || ""),
              text: String(textBody || btnPayload || "").trim(),
              timestamp: msg?.timestamp
                ? new Date(Number(msg.timestamp) * 1000).toISOString()
                : new Date().toISOString(),
              contextMessageId: msg?.context?.id
                ? String(msg.context.id)
                : undefined,
              buttonPayload: btnPayload ? String(btnPayload).trim() : undefined,
            });
          }
        }
      }
    }
  }

  // 4. Generic / Direct webhook fallback
  if (statuses.length === 0 && typeof body?.status === "string") {
    statuses.push({
      provider: "custom",
      messageId: String(body?.messageId || body?.idMessage || body?.id || ""),
      status: body.status.toLowerCase(),
      recipientPhone: String(
        body?.recipient_id ||
          body?.phone ||
          String(body?.chatId || "").replace(/@.*/, "")
      ),
      timestamp: new Date().toISOString(),
      errorDetail: body?.error ? String(body.error) : undefined,
    });
  }

  // Incoming messages (Green API incomingMessageReceived or Twilio Body/ButtonPayload/ButtonText)
  if (
    messages.length === 0 &&
    (body?.typeWebhook === "incomingMessageReceived" ||
      body?.text ||
      body?.reply ||
      body?.ButtonPayload ||
      body?.ButtonText ||
      (body?.From && (body?.Body || body?.ButtonPayload || body?.ButtonText)))
  ) {
    const rawFrom =
      body?.from ||
      body?.phone ||
      String(body?.From || "").replace(/^whatsapp:/i, "") ||
      String(body?.senderData?.chatId || "").replace(/@.*/, "");
    const rawButtonPayload = String(body?.ButtonPayload || "").trim();
    const rawButtonText = String(body?.ButtonText || "").trim();
    const rawText =
      rawButtonText ||
      body?.text ||
      body?.reply ||
      body?.Body ||
      rawButtonPayload ||
      body?.messageData?.textMessageData?.textMessage ||
      body?.messageData?.extendedTextMessageData?.text ||
      "";
    const originalRepliedSid = String(
      body?.OriginalRepliedMessageSid || ""
    ).trim();
    if (rawFrom && (rawText || rawButtonPayload)) {
      messages.push({
        messageId: String(
          body?.idMessage || body?.messageId || body?.MessageSid || ""
        ),
        fromPhone: String(rawFrom),
        text: String(rawText).trim(),
        timestamp: new Date().toISOString(),
        contextMessageId: originalRepliedSid || undefined,
        buttonPayload: rawButtonPayload || undefined,
      });
    }
  }

  return { statuses, messages };
}

async function findLatestReportForPhone(phone: string): Promise<{
  report: Record<string, any> | null;
  tagCode: string | null;
  vehicleLabel: string;
}> {
  const candidates = buildPhoneCandidates(phone);
  if (candidates.length === 0) {
    return { report: null, tagCode: null, vehicleLabel: "مركبتك" };
  }

  let tagCode: string | null = null;
  let vehicleLabel = "";

  const { data: stickerRows } = await supabaseAdmin
    .from("stickers")
    .select("code, car_brand, car_model, car_plate, owner_phone")
    .in("owner_phone", candidates)
    .limit(5);

  if (Array.isArray(stickerRows) && stickerRows.length > 0) {
    const matchedSticker = stickerRows[0];
    tagCode = String(matchedSticker.code || "").toUpperCase().trim();
    vehicleLabel =
      [
        matchedSticker.car_brand,
        matchedSticker.car_model,
        matchedSticker.car_plate,
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || tagCode;
  }

  if (!tagCode) {
    const { data: tagRows } = await supabaseAdmin
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
    const { data: repRows } = await supabaseAdmin
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

async function findReportByMessageId(messageId: string): Promise<{
  report: Record<string, any> | null;
  reportId: string | null;
  tagCode: string | null;
  vehicleLabel: string;
}> {
  if (!messageId) {
    return { report: null, reportId: null, tagCode: null, vehicleLabel: "مركبتك" };
  }

  try {
    const { data: twilioRows } = await supabaseAdmin
      .from("reports")
      .select("*")
      .eq("twilio_message_sid", messageId)
      .limit(1);
    if (Array.isArray(twilioRows) && twilioRows.length > 0) {
      const r = twilioRows[0];
      const tc = String(r.tag_code || "").toUpperCase();
      return {
        report: r,
        reportId: String(r.id),
        tagCode: tc || null,
        vehicleLabel: tc || "مركبتك",
      };
    }
  } catch {
    // column twilio_message_sid may not be migrated yet
  }

  try {
    const { data: directRows } = await supabaseAdmin
      .from("reports")
      .select("*")
      .eq("whatsapp_message_id", messageId)
      .limit(1);
    if (Array.isArray(directRows) && directRows.length > 0) {
      const r = directRows[0];
      const tc = String(r.tag_code || "").toUpperCase();
      return {
        report: r,
        reportId: String(r.id),
        tagCode: tc || null,
        vehicleLabel: tc || "مركبتك",
      };
    }
  } catch {
    // column whatsapp_message_id may not be migrated yet; fallback to audit logs
  }

  try {
    const { data: logs } = await supabaseAdmin
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
      const vLabel = String(parsed.var1 || tc || "مركبتك");

      if (reportId && !reportId.startsWith("rep_")) {
        const { data: rep } = await supabaseAdmin
          .from("reports")
          .select("*")
          .eq("id", reportId)
          .maybeSingle();
        if (rep) {
          return {
            report: rep,
            reportId: String(rep.id),
            tagCode: tc || String(rep.tag_code || "").toUpperCase() || null,
            vehicleLabel: vLabel,
          };
        }
      }

      if (tc) {
        const { data: repRows } = await supabaseAdmin
          .from("reports")
          .select("*")
          .eq("tag_code", tc)
          .order("created_at", { ascending: false })
          .limit(1);
        const latestRep = Array.isArray(repRows) ? repRows[0] : null;
        return {
          report: latestRep || { id: reportId, tag_code: tc, reason_badge: "واتساب: تم الإرسال" },
          reportId: reportId || (latestRep?.id ? String(latestRep.id) : null),
          tagCode: tc,
          vehicleLabel: vLabel,
        };
      }
    }
  } catch {
    // ignore
  }

  return { report: null, reportId: null, tagCode: null, vehicleLabel: "مركبتك" };
}

function normalizeStatusRank(badge: string): number {
  if (badge.startsWith("رد المالك:")) return 4;
  if (badge.includes("تمت القراءة")) return 3;
  if (badge.includes("تم التسليم") || badge.includes("SMS")) return 2;
  if (badge.includes("تم الإرسال")) return 1;
  return 0;
}

export async function processWhatsappWebhookPayload(
  body: Record<string, any>
): Promise<{ processedStatuses: number; processedMessages: number }> {
  console.log("[WhatsApp Webhook Incoming]:", JSON.stringify(body));
  const { statuses, messages } = extractWebhookEvents(body);

  for (const st of statuses) {
    console.log(
      `[WhatsApp Status Webhook] MessageSid/idMessage: ${st.messageId} | MessageStatus: ${st.status} | Provider: ${st.provider}`
    );

    let matched = st.messageId
      ? await findReportByMessageId(st.messageId)
      : { report: null, reportId: null, tagCode: null, vehicleLabel: "مركبتك" };

    // معالجة حالة التزامن (Race Condition): انتظار 800ms وإعادة البحث عن idMessage إذا وصل الـ Webhook قبل إتمام الحفظ
    if (!matched.report && st.messageId) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      matched = await findReportByMessageId(st.messageId);
    }

    if (!matched.report && st.recipientPhone) {
      const byPhone = await findLatestReportForPhone(st.recipientPhone);
      matched = {
        ...byPhone,
        reportId: byPhone.report?.id ? String(byPhone.report.id) : null,
      };
    }
    const { report, reportId, tagCode, vehicleLabel } = matched;
    const resolvedReportId = String(reportId || report?.id || "").trim();

    const normalizedStatus = st.status.toLowerCase();
    const statusBadgeMap: Record<string, string> = {
      sent: "واتساب: تم الإرسال",
      delivered: "واتساب: تم التسليم",
      read: "واتساب: تمت القراءة",
      failed: "واتساب: فشل التسليم",
      undelivered: "واتساب: فشل التسليم",
      noaccount: "واتساب: فشل التسليم",
    };

    const incomingRankMap: Record<string, number> = {
      sent: 1,
      delivered: 2,
      read: 3,
    };

    const badgeLabel =
      statusBadgeMap[normalizedStatus] || `واتساب: ${normalizedStatus}`;

    if (resolvedReportId || report?.id) {
      const currentBadge = String(report?.reason_badge || "");
      const currentRank = normalizeStatusRank(currentBadge);
      const nextRank = incomingRankMap[normalizedStatus] ?? 0;

      // عدم التراجع في الحالة (مثلاً: لا نرجع من read أو رد المالك إلى delivered أو sent)
      if (nextRank === 0 || nextRank > currentRank) {
        if (report?.id && !String(report.id).startsWith("rep_")) {
          const { error: updErr } = await supabaseAdmin
            .from("reports")
            .update({
              reason_badge: badgeLabel,
              whatsapp_status: normalizedStatus,
            })
            .eq("id", report.id);
          if (updErr) {
            await supabaseAdmin
              .from("reports")
              .update({ reason_badge: badgeLabel })
              .eq("id", report.id);
          }
        }

        // حفظ تحديث الحالة في admin_audit_logs لضمان قراءته عبر الـ Polling حتى لو لم تكتمل هجرة الأعمدة الجديدة
        try {
          await supabaseAdmin.from("admin_audit_logs").insert({
            admin_name: "Webhook Status",
            action_type: "REPORT_STATUS_UPDATE",
            target_item: resolvedReportId || tagCode || st.messageId,
            details: JSON.stringify({
              reportId: resolvedReportId,
              tagCode,
              messageId: st.messageId,
              status: normalizedStatus,
              reasonBadge: badgeLabel,
              updatedAt: new Date().toISOString(),
            }),
            created_at: new Date().toISOString(),
          });
        } catch {
          // ignore
        }

        if (
          normalizedStatus === "read" ||
          normalizedStatus === "delivered" ||
          normalizedStatus === "sent"
        ) {
          await broadcastReportRealtimeUpdate({
            reportId: resolvedReportId || String(report?.id || ""),
            tagCode,
            deliveryStatus:
              normalizedStatus === "read"
                ? "read"
                : normalizedStatus === "delivered"
                ? "delivered"
                : "sent",
            ownerReply: null,
            isSmsFallback: false,
            reasonBadge: badgeLabel,
          });
        }
      }
    }

    // في حال فشل تسليم إشعار الواتساب: التحويل إلى SMS فقط لباقة نَبِّهْنِي (وليس الأساسية أبداً)
    const isFailed =
      normalizedStatus === "failed" ||
      normalizedStatus === "undelivered" ||
      normalizedStatus === "noaccount";

    if (isFailed && st.recipientPhone && report?.id) {
      const reportCreatedMs = report.created_at
        ? new Date(String(report.created_at)).getTime()
        : 0;
      const isRecentReport =
        reportCreatedMs > 0 && Date.now() - reportCreatedMs <= 24 * 60 * 60 * 1000;
      const alreadySentSms = String(report.reason_badge || "").includes("SMS");

      let isBasicPlan = false;
      if (tagCode) {
        const { data: tagRow } = await supabaseAdmin
          .from("stickers")
          .select("plan_type, package_type")
          .eq("code", tagCode)
          .maybeSingle();
        if (
          tagRow?.plan_type === "basic" ||
          tagRow?.package_type === "basic"
        ) {
          isBasicPlan = true;
        }
      }

      if (isRecentReport && !alreadySentSms && !isBasicPlan) {
        const reasonTitle = String(
          report?.reason_title || "تنبيه عاجل بخصوص مركبتك"
        );
        const messageDesc = String(
          report?.message ||
            "يرجى التوجه لمركبتك ومراجعة البلاغ الوارد عبر منصة بَلِّغْنِي."
        );

        const smsFallback = await sendSmsAlertMessage(
          st.recipientPhone,
          vehicleLabel || tagCode || "مركبتك",
          reasonTitle,
          messageDesc
        );

        if (smsFallback.ok) {
          const smsBadge = "تم الإشعار عبر SMS (بديل تلقائي)";
          await supabaseAdmin
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

  for (const msg of messages) {
    if (!msg.fromPhone || (!msg.text && !msg.buttonPayload)) continue;

    console.log(
      `[WhatsApp Incoming Reply] From: ${msg.fromPhone} | Text: ${msg.text} | ButtonPayload: ${msg.buttonPayload || "-"} | ContextSid: ${msg.contextMessageId || "-"}`
    );

    let report: Record<string, any> | null = null;
    let tagCode: string | null = null;
    let resolvedReportId: string | null = null;

    // 1. مطابقة زر الرد السريع التفاعلي (COMING_NOW:<reportId أو shortCode أو tagCode>)
    const payloadStr = String(msg.buttonPayload || "").trim();
    if (payloadStr) {
      const targetToken = payloadStr.replace(/^COMING_NOW:/i, "").trim();
      if (targetToken && !targetToken.startsWith("rep_")) {
        // أ) البحث المباشر بمعرف البلاغ (report.id) أو الرمز القصير (short_code) أو رمز الملصق (tag_code)
        try {
          const { data: repById } = await supabaseAdmin
            .from("reports")
            .select("*")
            .eq("id", targetToken)
            .maybeSingle();
          if (repById?.id) {
            report = repById;
            resolvedReportId = String(repById.id);
            tagCode = String(repById.tag_code || "").toUpperCase() || null;
          }
        } catch {
          // ignore if not UUID
        }

        if (!report) {
          try {
            const { data: repByShort } = await supabaseAdmin
              .from("reports")
              .select("*")
              .eq("short_code", targetToken)
              .order("created_at", { ascending: false })
              .limit(1);
            if (Array.isArray(repByShort) && repByShort.length > 0 && repByShort[0]) {
              const found = repByShort[0];
              report = found;
              resolvedReportId = String(found.id);
              tagCode = String(found.tag_code || "").toUpperCase() || null;
            }
          } catch {
            // ignore
          }
        }

        if (!report) {
          try {
            const { data: shortLog } = await supabaseAdmin
              .from("admin_audit_logs")
              .select("details")
              .eq("action_type", "REPORT_SHORT_LINK")
              .eq("target_item", targetToken)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (shortLog?.details) {
              const parsed = JSON.parse(String(shortLog.details));
              resolvedReportId = String(parsed.reportId || "").trim() || null;
              tagCode = String(parsed.tagCode || "").toUpperCase() || null;
              if (resolvedReportId && !resolvedReportId.startsWith("rep_")) {
                const { data: repRow } = await supabaseAdmin
                  .from("reports")
                  .select("*")
                  .eq("id", resolvedReportId)
                  .maybeSingle();
                if (repRow) report = repRow;
              }
            }
          } catch {
            // ignore
          }
        }

        if (!report) {
          const { data: repByTag } = await supabaseAdmin
            .from("reports")
            .select("*")
            .eq("tag_code", targetToken.toUpperCase())
            .order("created_at", { ascending: false })
            .limit(1);
          if (Array.isArray(repByTag) && repByTag.length > 0 && repByTag[0]) {
            const found = repByTag[0];
            report = found;
            resolvedReportId = String(found.id);
            tagCode = String(found.tag_code || "").toUpperCase() || null;
          }
        }
      }
    }

    // 2. مطابقة عبر معرف الرسالة الأصلية المُرد عليها (OriginalRepliedMessageSid / context.id)
    if (!report && msg.contextMessageId) {
      const byMsgId = await findReportByMessageId(msg.contextMessageId);
      if (byMsgId.report) {
        report = byMsgId.report;
        resolvedReportId = byMsgId.reportId;
        tagCode = byMsgId.tagCode;
      }
    }

    // 3. مطابقة عبر رقم هاتف مالك المركبة
    if (!report) {
      const byPhone = await findLatestReportForPhone(msg.fromPhone);
      report = byPhone.report;
      tagCode = tagCode || byPhone.tagCode;
      if (report?.id) {
        resolvedReportId = String(report.id);
      }
    }

    const isQuickReplyButton =
      payloadStr.toUpperCase().startsWith("COMING_NOW") ||
      msg.text.includes("أنا قادم الآن");
    const effectiveReplyText = isQuickReplyButton
      ? "أنا قادم الآن"
      : msg.text.trim();

    if (report?.id || resolvedReportId) {
      const targetId = String(report?.id || resolvedReportId || "");
      const previousMessage = String(report?.message || "").trim();
      const replyLine = `\n[رد المالك عبر واتساب]: ${effectiveReplyText}`;
      const updatedMessage = previousMessage.includes(effectiveReplyText)
        ? previousMessage
        : `${previousMessage}${replyLine}`.trim();
      const replyBadge = `رد المالك: ${effectiveReplyText.slice(0, 40)}`;

      if (targetId && !targetId.startsWith("rep_")) {
        await supabaseAdmin
          .from("reports")
          .update({
            reason_badge: replyBadge,
            message: updatedMessage,
            whatsapp_status: "read",
          })
          .eq("id", targetId);
      }

      // حفظ في admin_audit_logs لضمان التقاط الرد فوراً من قِبل الـ Polling أيضاً
      try {
        await supabaseAdmin.from("admin_audit_logs").insert({
          admin_name: "Webhook Quick Reply",
          action_type: "REPORT_STATUS_UPDATE",
          target_item: targetId || tagCode || msg.fromPhone,
          details: JSON.stringify({
            reportId: targetId,
            tagCode,
            status: "replied",
            ownerReply: effectiveReplyText,
            reasonBadge: replyBadge,
            buttonPayload: payloadStr || null,
            updatedAt: new Date().toISOString(),
          }),
          created_at: new Date().toISOString(),
        });
      } catch {
        // ignore
      }

      await broadcastReportRealtimeUpdate({
        reportId: targetId,
        tagCode,
        deliveryStatus: "replied",
        ownerReply: effectiveReplyText,
        isSmsFallback: false,
        reasonBadge: replyBadge,
      });
    } else if (tagCode) {
      await supabaseAdmin.from("reports").insert({
        tag_code: tagCode,
        reason_title: "رد المالك عبر واتساب",
        reason_badge: `رد المالك: ${effectiveReplyText.slice(0, 40)}`,
        message: effectiveReplyText,
        location: "",
        icon_type: "blocking",
      });
    }
  }

  return {
    processedStatuses: statuses.length,
    processedMessages: messages.length,
  };
}
