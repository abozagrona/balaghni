#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import twilio from "twilio";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const WEBHOOK_URL = "https://www.balaghni.ly/api/webhooks/whatsapp-status";

function loadEnvLocal() {
  if (!fs.existsSync(ENV_PATH)) return;
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

function upsertEnvLocal(updates) {
  let env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  for (const [k, v] of Object.entries(updates)) {
    if (!v) continue;
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(env)) env = env.replace(re, `${k}=${v}`);
    else env += (env.endsWith("\n") || !env ? "" : "\n") + `${k}=${v}\n`;
  }
  fs.writeFileSync(ENV_PATH, env, "utf8");
}

loadEnvLocal();

const ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || "").trim();
const AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || "").trim();
const WHATSAPP_NUMBER = (process.env.TWILIO_WHATSAPP_NUMBER || "+19789919899").trim();

if (!ACCOUNT_SID || !AUTH_TOKEN) {
  console.error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN in .env.local");
  process.exit(1);
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
const authHeader = `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64")}`;

const ENV_KEY_MAP = {
  balaghni_vehicle_alert: "TWILIO_CONTENT_SID_ALERT",
  balaghni_nabbihni_media_alert: "TWILIO_CONTENT_SID_MEDIA_ALERT",
  balaghni_voice_call_invite: "TWILIO_CONTENT_SID_VOICE_CALL",
  balaghni_remind_extension: "TWILIO_CONTENT_SID_REMIND",
  balaghni_otp_code: "TWILIO_CONTENT_SID_OTP",
  balaghni_subscription_expiry: "TWILIO_CONTENT_SID_SUBSCRIPTION",
  balaghni_document_reminder: "TWILIO_CONTENT_SID_DOC_REMINDER",
  balaghni_weekly_overdue: "TWILIO_CONTENT_SID_WEEKLY_OVERDUE",
  balaghni_order_cod_received: "TWILIO_CONTENT_SID_ORDER_COD",
  balaghni_order_activated: "TWILIO_CONTENT_SID_ORDER_ACTIVATED",
  balaghni_sticker_linked: "TWILIO_CONTENT_SID_STICKER_LINKED",
  balaghni_gift_activated: "TWILIO_CONTENT_SID_GIFT_ACTIVATED",
  balaghni_admin_alert: "TWILIO_CONTENT_SID_ADMIN_ALERT",
};

function buildTemplatesFromJson() {
  const jsonPath = path.join(ROOT, "balaghni_templates.json");
  const rawList = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  return rawList.map((item) => {
    const friendlyName = item.friendly_name;
    const category =
      friendlyName === "balaghni_otp_code" ? "AUTHENTICATION" : "UTILITY";
    const language = item.language || "ar";
    const variables = item.variables || {};
    let types = {};

    if (item.button_type === "COPY_CODE") {
      types = {
        "whatsapp/authentication": {
          add_security_recommendation: true,
          code_expiration_minutes: 5,
          actions: [
            {
              type: "COPY_CODE",
              copy_code_text: item.button_title || "نسخ الرمز",
            },
          ],
        },
      };
    } else if (item.button_type === "QUICK_REPLY" && item.media_url) {
      // قالب 2: وسائط بصورة + زر رد سريع (twilio/card يدعم media + QUICK_REPLY في واتساب، والمتغيرات توضع في title الذي يمثل body البطاقة)
      types = {
        "twilio/card": {
          title: item.body,
          media: ["https://www.balaghni.ly/balaghni-logo.jpg"],
          actions: [
            {
              type: "QUICK_REPLY",
              title: item.button_title || "أنا قادم الآن",
              id: "COMING_NOW",
            },
          ],
        },
      };
    } else if (item.button_type === "QUICK_REPLY") {
      // قالب 1: زر رد سريع
      types = {
        "twilio/quick-reply": {
          body: item.body,
          actions: [
            {
              title: item.button_title || "أنا قادم الآن",
              id: "COMING_NOW",
            },
          ],
        },
      };
    } else if (item.button_type === "URL") {
      // قالب 3: زر رابط ديناميكي
      types = {
        "twilio/call-to-action": {
          body: item.body,
          actions: [
            {
              type: "URL",
              title: item.button_title || "رد على المكالمة الآن",
              url: item.button_url || "https://balaghni.ly/call/{{1}}",
            },
          ],
        },
      };
    } else {
      types = {
        "twilio/text": {
          body: item.body,
        },
      };
    }

    return {
      friendlyName,
      envKey:
        ENV_KEY_MAP[friendlyName] ||
        `TWILIO_CONTENT_SID_${friendlyName.toUpperCase()}`,
      language,
      category,
      variables,
      types,
      rawBody: item.body,
    };
  });
}

const TEMPLATES = buildTemplatesFromJson();

async function listContents() {
  const res = await fetch("https://content.twilio.com/v1/Content?PageSize=50", {
    headers: { Authorization: authHeader },
  });
  const json = await res.json();
  return Array.isArray(json.contents) ? json.contents : [];
}

async function getApproval(sid) {
  const res = await fetch(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`, {
    headers: { Authorization: authHeader },
  });
  const json = await res.json();
  return json.whatsapp || { status: "unsubmitted" };
}

async function runSetup() {
  const forceRecreateAll = process.argv.includes("--recreate");
  const existing = await listContents();
  const envUpdates = {};
  const templateReport = [];

  // حذف أي قوالب قديمة لم تعد موجودة في قائمة الـ 13 قالب المعتمدة
  const validNames = new Set(TEMPLATES.map((t) => t.friendlyName));
  for (const oldItem of existing) {
    if (!validNames.has(oldItem.friendly_name)) {
      await fetch(`https://content.twilio.com/v1/Content/${oldItem.sid}`, {
        method: "DELETE",
        headers: { Authorization: authHeader },
      });
    }
  }

  for (const spec of TEMPLATES) {
    const existingItems = existing.filter((c) => c.friendly_name === spec.friendlyName);
    let sid = existingItems[0]?.sid || "";
    if (sid) {
      const existingApp = await getApproval(sid);
      const existingTypes = existingItems[0]?.types || {};
      const expectedTypeKey = Object.keys(spec.types)[0];
      const hasExpectedType = Boolean(existingTypes[expectedTypeKey]);
      if (
        forceRecreateAll ||
        existingApp.status === "rejected" ||
        !hasExpectedType
      ) {
        for (const item of existingItems) {
          await fetch(`https://content.twilio.com/v1/Content/${item.sid}`, {
            method: "DELETE",
            headers: { Authorization: authHeader },
          });
        }
        sid = "";
      }
    }

    if (!sid) {
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
      const created = await createRes.json();
      if (!createRes.ok || !created.sid) {
        templateReport.push({
          friendlyName: spec.friendlyName,
          contentSid: null,
          approvalStatus: "create_failed",
          error: created.message || `HTTP ${createRes.status}`,
        });
        continue;
      }
      sid = created.sid;
    }

    envUpdates[spec.envKey] = sid;
    if (spec.friendlyName === "balaghni_order_cod_received") {
      envUpdates.TWILIO_CONTENT_SID_ORDER = sid;
    }

    let approval = await getApproval(sid);
    if (!approval.status || approval.status === "unsubmitted" || approval.status === "rejected") {
      const appRes = await fetch(
        `https://content.twilio.com/v1/Content/${sid}/ApprovalRequests/whatsapp`,
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
      const appJson = await appRes.json();
      approval = appRes.ok
        ? appJson
        : { status: `http_${appRes.status}`, rejection_reason: appJson.message };
    }

    templateReport.push({
      friendlyName: spec.friendlyName,
      contentSid: sid,
      category: spec.category,
      approvalStatus: approval.status || "received",
      rejectionReason: approval.rejection_reason || null,
    });
  }

  // Configure IncomingPhoneNumber & MessagingService webhooks
  const nums = await client.incomingPhoneNumbers.list({
    phoneNumber: WHATSAPP_NUMBER,
    limit: 5,
  });
  let phoneNumberSid = null;
  if (nums.length > 0) {
    phoneNumberSid = nums[0].sid;
    await client.incomingPhoneNumbers(phoneNumberSid).update({
      smsUrl: WEBHOOK_URL,
      smsMethod: "POST",
      statusCallback: WEBHOOK_URL,
      statusCallbackMethod: "POST",
    });
  }

  const svcs = await client.messaging.v1.services.list({ limit: 20 });
  let svc = svcs.find((s) => s.friendlyName.toLowerCase().includes("balaghni"));
  if (!svc) {
    svc = await client.messaging.v1.services.create({
      friendlyName: "Balaghni Messaging Service",
      inboundRequestUrl: WEBHOOK_URL,
      inboundMethod: "POST",
      statusCallback: WEBHOOK_URL,
    });
  } else {
    svc = await client.messaging.v1.services(svc.sid).update({
      inboundRequestUrl: WEBHOOK_URL,
      inboundMethod: "POST",
      statusCallback: WEBHOOK_URL,
    });
  }

  if (phoneNumberSid && svc.sid) {
    const attached = await client.messaging.v1
      .services(svc.sid)
      .phoneNumbers.list({ limit: 20 });
    if (!attached.some((p) => p.sid === phoneNumberSid)) {
      await client.messaging.v1
        .services(svc.sid)
        .phoneNumbers.create({ phoneNumberSid });
    }
  }

  // Update WhatsApp Sender webhook directly (Channels API v2)
  let senderWebhookUpdated = false;
  try {
    const sendersRes = await fetch(
      "https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp",
      { headers: { Authorization: authHeader } }
    );
    const sendersJson = await sendersRes.json();
    const targetSender = (sendersJson.senders || []).find(
      (s) =>
        s.sid === "XEedf047d7c8acce6021cbfaf97716036a" ||
        s.sender_id === `whatsapp:${WHATSAPP_NUMBER}`
    );
    if (targetSender?.sid) {
      const updRes = await fetch(
        `https://messaging.twilio.com/v2/Channels/Senders/${targetSender.sid}`,
        {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            webhook: {
              callback_url: WEBHOOK_URL,
              callback_method: "POST",
              status_callback_url: WEBHOOK_URL,
              status_callback_method: "POST",
            },
          }),
        }
      );
      senderWebhookUpdated = updRes.ok;
    }
  } catch {
    // ignore
  }

  envUpdates.TWILIO_MESSAGING_SERVICE_SID = svc.sid;
  upsertEnvLocal(envUpdates);

  console.log(
    JSON.stringify(
      {
        ok: true,
        templates: templateReport,
        webhooks: {
          webhookUrl: WEBHOOK_URL,
          phoneNumberSid,
          messagingServiceSid: svc.sid,
          senderWebhookUpdated,
        },
      },
      null,
      2
    )
  );
}

async function runStatus() {
  const contents = await listContents();
  const report = [];
  for (const c of contents) {
    const app = await getApproval(c.sid);
    report.push({
      friendlyName: c.friendly_name,
      contentSid: c.sid,
      language: c.language,
      contentTypes: Object.keys(c.types || {}),
      status: app.status || "unsubmitted",
      category: app.category || null,
      rejectionReason: app.rejection_reason || null,
    });
  }
  console.log(JSON.stringify({ ok: true, templates: report }, null, 2));
}

async function runLogs() {
  const msgs = await client.messages.list({ limit: 25 });
  console.log(
    JSON.stringify(
      {
        ok: true,
        count: msgs.length,
        messages: msgs.map((m) => ({
          sid: m.sid,
          direction: m.direction,
          from: m.from,
          to: m.to,
          status: m.status,
          body: m.body,
          errorCode: m.errorCode,
          dateCreated: m.dateCreated?.toISOString() || null,
        })),
      },
      null,
      2
    )
  );
}

const cmd = process.argv[2] || "status";
if (cmd === "setup") {
  await runSetup();
} else if (cmd === "logs") {
  await runLogs();
} else {
  await runStatus();
}
