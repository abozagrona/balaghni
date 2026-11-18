import twilio from "twilio";

const DEFAULT_WEBHOOK_URL = "https://www.balaghni.ly/api/webhooks/whatsapp-status";

export interface TwilioTemplateSpec {
  friendlyName: string;
  language: string;
  category: "UTILITY" | "AUTHENTICATION";
  variables: Record<string, string>;
  types: Record<string, unknown>;
}

export interface TwilioTemplateResult {
  friendlyName: string;
  contentSid: string;
  category: string;
  approvalStatus: string;
  rejectionReason?: string | null;
  error?: string;
}

export function getTwilioCredentials() {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const whatsappNumber = (
    process.env.TWILIO_WHATSAPP_NUMBER || "+19789919899"
  ).trim();
  const messagingServiceSid = (
    process.env.TWILIO_MESSAGING_SERVICE_SID || ""
  ).trim();

  if (!accountSid || !authToken) {
    throw new Error(
      "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be configured."
    );
  }

  return {
    accountSid,
    authToken,
    whatsappNumber,
    whatsappFrom: whatsappNumber.startsWith("whatsapp:")
      ? whatsappNumber
      : `whatsapp:${whatsappNumber}`,
    messagingServiceSid,
    authHeader: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString(
      "base64"
    )}`,
  };
}

export function getTwilioClient() {
  const { accountSid, authToken } = getTwilioCredentials();
  return twilio(accountSid, authToken);
}

export const BALAGHNI_TWILIO_TEMPLATES: TwilioTemplateSpec[] = [
  {
    friendlyName: "balaghni_vehicle_alert",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "هونداي سوناتا",
      "2": "مْسَكِّر عليا بسيارتك — لو سمحت تجي تحول سيارتك بسرعة",
      "3": "REP_A7K9M2",
    },
    types: {
      "twilio/quick-reply": {
        body: "🚨 (منصة بَلِّغْنِي) تنبيه لسيارتك ({{1}}):\n• {{2}}\nاضغط على الزر أدناه لتأكيد قدومك — منصة بَلِّغْنِي.",
        actions: [
          {
            title: "أنا قادم الآن",
            id: "COMING_NOW:{{3}}",
          },
        ],
      },
    },
  },
  {
    friendlyName: "balaghni_nabbihni_media_alert",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "تويوتا كامري",
      "2": "ضي سيارتك والع — ناسي ضي سيارتك والع بتاريتك حتفضى",
      "3": "0912345678",
      "4": "https://balaghni.ly/r/B8M3P4",
      "5": "https://www.balaghni.ly/balaghni-logo.jpg",
    },
    types: {
      "twilio/media": {
        body: "🚨 (منصة بَلِّغْنِي) تنبيه نَبِّهْنِي لسيارتك ({{1}}):\n• {{2}}\n📞 رقم المُبلِّغ للتواصل المباشر: {{3}}\n✅ للرد السريع (أنا قادم الآن): {{4}}\nاضغط على الرابط أعلاه لتأكيد قدومك — منصة بَلِّغْنِي.",
        media: ["{{5}}"],
      },
    },
  },
  {
    friendlyName: "balaghni_otp_code",
    language: "ar",
    category: "AUTHENTICATION",
    variables: {
      "1": "482910",
    },
    types: {
      "whatsapp/authentication": {
        add_security_recommendation: true,
        code_expiration_minutes: 5,
        actions: [
          {
            type: "COPY_CODE",
            copy_code_text: "نسخ الرمز",
          },
        ],
      },
    },
  },
  {
    friendlyName: "balaghni_remind_extension",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "هونداي سوناتا",
      "2": "https://balaghni.ly/r/A7K9M2",
    },
    types: {
      "twilio/text": {
        body: "تنبيه من منصة بَلِّغْنِي: لقد انتهت مهلة ال5 دقائق الأولى لبلاغ سيارتك ({{1}}). هل أنت في طريقك الآن؟ يرجى الضغط على رابط الرد السريع للتأكيد: {{2}} — منصة بَلِّغْنِي.",
      },
    },
  },
  {
    friendlyName: "balaghni_subscription_expiry",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "LY-2026-8841",
      "2": "2026-12-01",
    },
    types: {
      "twilio/text": {
        body: "تنبيه من منصة بَلِّغْنِي: اشتراك ملصق سيارتك ({{1}}) على وشك الانتهاء بتاريخ {{2}}. لتجديد الاشتراك واستمرار الحماية، يرجى زيارة المنصة.",
      },
    },
  },
  {
    friendlyName: "balaghni_document_reminder",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "تويوتا كامري",
      "2": "تأمين السيارة ينتهي قريباً",
    },
    types: {
      "twilio/text": {
        body: "تذكير من منصة بَلِّغْنِي: حان موعد تجديد مستند سيارتك ({{1}}) - {{2}}. حافظ على سلامتك وتجنب المخالفات.",
      },
    },
  },
  {
    friendlyName: "balaghni_order_update",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "ORD-2026-1042",
    },
    types: {
      "twilio/text": {
        body: "مرحباً بك في منصة بَلِّغْنِي! تم استلام طلبك رقم ({{1}}) بنجاح لشراء ملصق السيارة. سنقوم بالتواصل معك لتأكيد التسليم والتفعيل قريباً.",
      },
    },
  },
  {
    friendlyName: "balaghni_admin_alert",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "ORD-2026-1042",
      "2": "100",
      "3": "LY-2026-8841",
    },
    types: {
      "twilio/text": {
        body: "تنبيه إداري - بَلِّغْنِي: تم استلام طلب كاش جديد برقم ({{1}}) بقيمة ({{2}} د.ل) لملصق السيارة ({{3}}). يرجى المراجعة وتأكيد التحصيل.",
      },
    },
  },
  {
    friendlyName: "balaghni_voice_call_invite",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "C7M4K9",
      "2": "هونداي سوناتا",
    },
    types: {
      "twilio/call-to-action": {
        body: "📞 (منصة بَلِّغْنِي) اتصال صوتي عاجل بخصوص سيارتك ({{2}})! المُبلِّغ ينتظر عند المركبة ويتصل بك صوتياً الآن عبر المتصفح (مكالمة مشفرة دون كشف رقمك أو رقمه). اضغط على الزر أدناه للرد والتحدث فوراً — منصة بَلِّغْنِي.",
        actions: [
          {
            type: "URL",
            title: "رد على المكالمة الآن",
            url: "https://balaghni.ly/call/{{1}}",
          },
        ],
      },
    },
  },
];

export async function listTwilioContentTemplates(): Promise<
  Array<{ sid: string; friendly_name: string; language: string }>
> {
  const { authHeader } = getTwilioCredentials();
  const res = await fetch("https://content.twilio.com/v1/Content?PageSize=50", {
    headers: { Authorization: authHeader },
  });
  const data = (await res.json().catch(() => ({}))) as {
    contents?: Array<{ sid: string; friendly_name: string; language: string }>;
  };
  return Array.isArray(data.contents) ? data.contents : [];
}

export async function getTwilioTemplateApprovalStatus(contentSid: string): Promise<{
  status: string;
  category?: string;
  rejectionReason?: string | null;
}> {
  const { authHeader } = getTwilioCredentials();
  const res = await fetch(
    `https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests`,
    { headers: { Authorization: authHeader } }
  );
  const data = (await res.json().catch(() => ({}))) as {
    whatsapp?: {
      status?: string;
      category?: string;
      rejection_reason?: string | null;
    };
  };
  return {
    status: data.whatsapp?.status || "unsubmitted",
    category: data.whatsapp?.category,
    rejectionReason: data.whatsapp?.rejection_reason ?? null,
  };
}

export async function createAndSubmitBalaghniTemplates(): Promise<
  TwilioTemplateResult[]
> {
  const { authHeader } = getTwilioCredentials();
  const existing = await listTwilioContentTemplates();
  const results: TwilioTemplateResult[] = [];

  for (const spec of BALAGHNI_TWILIO_TEMPLATES) {
    try {
      const matched = existing.find(
        (c) => c.friendly_name === spec.friendlyName
      );
      let contentSid = matched?.sid || "";

      if (!contentSid) {
        const createRes = await fetch("https://content.twilio.com/v1/Content", {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            friendly_name: spec.friendlyName,
            language: spec.language,
            variables: spec.variables,
            types: spec.types,
          }),
        });
        const created = (await createRes.json().catch(() => ({}))) as {
          sid?: string;
          message?: string;
        };
        if (!createRes.ok || !created.sid) {
          results.push({
            friendlyName: spec.friendlyName,
            contentSid: "",
            category: spec.category,
            approvalStatus: "error",
            error: created.message || `HTTP ${createRes.status}`,
          });
          continue;
        }
        contentSid = created.sid;
      }

      const currentApproval = await getTwilioTemplateApprovalStatus(contentSid);
      if (
        currentApproval.status === "unsubmitted" ||
        currentApproval.status === "rejected"
      ) {
        const approvalRes = await fetch(
          `https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests/whatsapp`,
          {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: spec.friendlyName,
              category: spec.category,
            }),
          }
        );
        const approvalJson = (await approvalRes.json().catch(() => ({}))) as {
          status?: string;
          rejection_reason?: string | null;
          message?: string;
        };
        results.push({
          friendlyName: spec.friendlyName,
          contentSid,
          category: spec.category,
          approvalStatus:
            approvalJson.status ||
            (approvalRes.ok ? "received" : `http_${approvalRes.status}`),
          rejectionReason: approvalJson.rejection_reason ?? null,
          error: !approvalRes.ok ? approvalJson.message : undefined,
        });
      } else {
        results.push({
          friendlyName: spec.friendlyName,
          contentSid,
          category: currentApproval.category || spec.category,
          approvalStatus: currentApproval.status,
          rejectionReason: currentApproval.rejectionReason,
        });
      }
    } catch (err) {
      results.push({
        friendlyName: spec.friendlyName,
        contentSid: "",
        category: spec.category,
        approvalStatus: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

export async function configureTwilioWebhooks(
  webhookUrl = DEFAULT_WEBHOOK_URL
): Promise<{
  phoneNumberSid: string | null;
  messagingServiceSid: string | null;
  whatsappSendersUpdated: number;
}> {
  const client = getTwilioClient();
  const { whatsappNumber, authHeader } = getTwilioCredentials();

  // 1. تحديث إعدادات الرقم في IncomingPhoneNumbers
  const numbers = await client.incomingPhoneNumbers.list({
    phoneNumber: whatsappNumber,
    limit: 5,
  });
  let phoneNumberSid: string | null = null;
  if (numbers.length > 0) {
    phoneNumberSid = numbers[0].sid;
    await client.incomingPhoneNumbers(phoneNumberSid).update({
      smsUrl: webhookUrl,
      smsMethod: "POST",
      statusCallback: webhookUrl,
      statusCallbackMethod: "POST",
    });
  }

  // 2. إنشاء أو تحديث Messaging Service وربط الرقم به
  const services = await client.messaging.v1.services.list({ limit: 20 });
  let service = services.find((s) =>
    s.friendlyName.toLowerCase().includes("balaghni")
  );
  if (!service) {
    service = await client.messaging.v1.services.create({
      friendlyName: "Balaghni Messaging Service",
      inboundRequestUrl: webhookUrl,
      inboundMethod: "POST",
      statusCallback: webhookUrl,
    });
  } else {
    service = await client.messaging.v1.services(service.sid).update({
      inboundRequestUrl: webhookUrl,
      inboundMethod: "POST",
      statusCallback: webhookUrl,
    });
  }

  if (phoneNumberSid && service.sid) {
    const attached = await client.messaging.v1
      .services(service.sid)
      .phoneNumbers.list({ limit: 20 });
    if (!attached.some((p) => p.sid === phoneNumberSid)) {
      await client.messaging.v1
        .services(service.sid)
        .phoneNumbers.create({ phoneNumberSid });
    }
  }

  // 3. تحديث WhatsApp Senders إن وُجدت في Channels API v2
  let whatsappSendersUpdated = 0;
  try {
    const sendersRes = await fetch(
      "https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp",
      { headers: { Authorization: authHeader } }
    );
    const sendersJson = (await sendersRes.json().catch(() => ({}))) as {
      senders?: Array<{ sid?: string; sender_id?: string }>;
    };
    for (const sender of sendersJson.senders || []) {
      if (!sender.sid) continue;
      const patchRes = await fetch(
        `https://messaging.twilio.com/v2/Channels/Senders/${sender.sid}`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            webhook: {
              callback_url: webhookUrl,
              callback_method: "POST",
              status_callback_url: webhookUrl,
              status_callback_method: "POST",
            },
          }),
        }
      );
      if (patchRes.ok) whatsappSendersUpdated += 1;
    }
  } catch {
    // ignore if no WhatsApp senders registered yet
  }

  return {
    phoneNumberSid,
    messagingServiceSid: service.sid,
    whatsappSendersUpdated,
  };
}

export async function sendTwilioContentMessage(params: {
  to: string;
  contentSid: string;
  contentVariables: Record<string, string>;
  statusCallback?: string;
}): Promise<{ ok: boolean; sid?: string; error?: string }> {
  try {
    const client = getTwilioClient();
    const { whatsappFrom, messagingServiceSid } = getTwilioCredentials();
    const cleanDigits = params.to.replace(/[^\d]/g, "");
    const toWhatsapp = `whatsapp:+${cleanDigits}`;

    const message = await client.messages.create({
      to: toWhatsapp,
      ...(messagingServiceSid
        ? { messagingServiceSid }
        : { from: whatsappFrom }),
      contentSid: params.contentSid,
      contentVariables: JSON.stringify(params.contentVariables),
      statusCallback: params.statusCallback || DEFAULT_WEBHOOK_URL,
    });

    return { ok: true, sid: message.sid };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchTwilioRecentMessages(limit = 20) {
  const client = getTwilioClient();
  const messages = await client.messages.list({ limit });
  return messages.map((m) => ({
    sid: m.sid,
    direction: m.direction,
    from: m.from,
    to: m.to,
    status: m.status,
    body: m.body,
    errorCode: m.errorCode,
    errorMessage: m.errorMessage,
    dateCreated: m.dateCreated?.toISOString() || null,
  }));
}
