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
    process.env.TWILIO_WHATSAPP_NUMBER ||
    process.env.TWILIO_WHATSAPP_FROM ||
    ""
  ).trim();
  const messagingServiceSid = (
    process.env.TWILIO_MESSAGING_SERVICE_SID || ""
  ).trim();

  if (!accountSid || !authToken || !whatsappNumber) {
    throw new Error(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER (or TWILIO_WHATSAPP_FROM) must be configured."
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
    },
    types: {
      "twilio/quick-reply": {
        body: "(منصة بلّغني) تنبيه لسيارتك ({{1}}):\n{{2}}\nاضغط على الزر أدناه لتأكيد قدومك — منصة بلّغني",
        actions: [
          {
            title: "أنا قادم الآن",
            id: "COMING_NOW",
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
      "3": "الضي الأمامي شغال",
      "4": "0912345678",
    },
    types: {
      "twilio/card": {
        title:
          "(منصة بلّغني) تنبيه لسيارتك ({{1}}):\n{{2}}\nملاحظة إضافية: {{3}}\nرقم المُبلّغ للتواصل المباشر: {{4}}\nاضغط على الرابط أو الزر لتأكيد قدومك — منصة بلّغني",
        media: ["https://www.balaghni.ly/balaghni-logo.jpg"],
        actions: [
          {
            type: "QUICK_REPLY",
            title: "أنا قادم الآن",
            id: "COMING_NOW",
          },
        ],
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
        body: "(منصة بلّغني) اتصال صوتي بخصوص سيارتك ({{2}})\nالمُبلّغ ينتظر عند المركبة ويتصل بك صوتياً الآن عبر المتصفح (مكالمة مشفرة دون كشف رقمك أو رقمه)\nاضغط على الزر أدناه للرد والتحدث فوراً — منصة بلّغني",
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
  {
    friendlyName: "balaghni_remind_extension",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "هونداي سوناتا",
    },
    types: {
      "twilio/text": {
        body: "(منصة بلّغني) تنبيه تذكيري أخير (تمديد 5 دقائق): الطرف الآخر ما زال بانتظارك عند سيارتك ({{1}}). يرجى التوجه للمركبة فوراً.",
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
    friendlyName: "balaghni_subscription_expiry",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "حيتم خلال شهر",
      "2": "تاريخ الانتهاء 2026/12/01",
    },
    types: {
      "twilio/text": {
        body: "(منصة بلّغني): اشتراك ملصق بلّغني {{1}} لاستمرار الخدمة ({{2}}) — منصة بلّغني",
      },
    },
  },
  {
    friendlyName: "balaghni_document_reminder",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "مزال شهر بس ويطيح",
      "2": "تأمين السيارة",
      "3": "تويوتا كامري",
      "4": "2026/12/15",
    },
    types: {
      "twilio/text": {
        body: "(منصة بلّغني) خدمة نبّهني: {{1}} {{2}} سيارتك ({{3}}) تاريخ الانتهاء {{4}} — منصة بلّغني",
      },
    },
  },
  {
    friendlyName: "balaghni_weekly_overdue",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "تأمين السيارة",
      "2": "تويوتا كامري",
      "3": "2026/11/01",
    },
    types: {
      "twilio/text": {
        body: "(منصة بلّغني) خدمة نبّهني: تذكير أسبوعي — {{1}} سيارتك ({{2}}) طاح من يوم {{3}} ومزال ما جددتاش، حدّث التاريخ في حسابك بعد التجديد باش نوقفو التذكير",
      },
    },
  },
  {
    friendlyName: "balaghni_order_cod_received",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "محمد الليبي",
      "2": "LY-2026-8841",
      "3": "باقة نبّهني",
      "4": "100",
    },
    types: {
      "twilio/text": {
        body: "مرحبا {{1}}، تم استلام طلبك لملصق بلّغني بنجاح\nكود الملصق المحجوز: {{2}}\nالباقة: {{3}}\nطريقة الدفع: كاش عند الاستلام ({{4}} د.ل)\nحالة الطلب: بانتظار التوصيل والدفع\nسيتم التواصل معك قريباً لتنسيق التوصيل، وبعد الاستلام يمكنك ربط الملصق بسيارتك",
      },
    },
  },
  {
    friendlyName: "balaghni_order_activated",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "محمد الليبي",
      "2": "LY-2026-8841",
      "3": "باقة نبّهني",
      "4": "2027-11-19",
    },
    types: {
      "twilio/text": {
        body: "مرحبا {{1}}، تم تأكيد طلبك وتفعيل ملصق بلّغني الخاص بك بنجاح\nكود الملصق: {{2}}\nالباقة: {{3}}\nصالح لمدة 365 يوماً حتى: {{4}}\nيمكنك الآن ربط الملصق بالسيارة عبر مسح رمز QR أو الدخول لصفحة التفعيل على المنصة",
      },
    },
  },
  {
    friendlyName: "balaghni_sticker_linked",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "LY-2026-8841",
      "2": "باقة نبّهني (100 د.ل)",
      "3": "2027-11-19",
    },
    types: {
      "twilio/text": {
        body: "تم تفعيل وربط ملصق بلّغني ({{1}}) بحسابك بنجاح\nالباقة: {{2}}\nصالح حتى: {{3}}\nيمكنك إدارة بيانات سيارتك من لوحة التحكم في منصة بلّغني",
      },
    },
  },
  {
    friendlyName: "balaghni_gift_activated",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "LY-2026-8841",
      "2": "2026-12-19",
    },
    types: {
      "twilio/text": {
        body: "تم ربط وتفعيل ملصق الهدية ({{1}}) على سيارتك مجاناً لمدة 30 يوماً بكامل مزايا باقة نبّهني\nتنتهي الفترة المجانية بتاريخ {{2}} — منصة بلّغني",
      },
    },
  },
  {
    friendlyName: "balaghni_admin_alert",
    language: "ar",
    category: "UTILITY",
    variables: {
      "1": "دفع كاش عند الاستلام",
      "2": "LY-2026-8841",
      "3": "باقة نبّهني",
      "4": "محمد الليبي",
      "5": "0912345678",
      "6": "طرابلس - حي الأندلس",
      "7": "100",
    },
    types: {
      "twilio/text": {
        body: "تنبيه إداري - منصة بلّغني:\nتم استلام طلب جديد ({{1}})\nالأكواد: {{2}}\nالباقة: {{3}}\nالمستلم: {{4}} ({{5}})\nالمدينة والعنوان: {{6}}\nالإجمالي: {{7}} د.ل — يرجى المتابعة من لوحة الإدارة",
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
