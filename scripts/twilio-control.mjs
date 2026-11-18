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

const TEMPLATES = [
  {
    friendlyName: "balaghni_vehicle_alert",
    envKey: "TWILIO_CONTENT_SID_ALERT",
    language: "ar",
    category: "UTILITY",
    variables: {
      1: "هونداي سوناتا",
      2: "مْسَكِّر عليا بسيارتك — لو سمحت تجي تحول سيارتك بسرعة",
      3: "https://balaghni.ly/r/A7K9M2",
    },
    types: {
      "twilio/text": {
        body: "🚨 (منصة بَلِّغْنِي) تنبيه لسيارتك ({{1}}):\n• {{2}}\n✅ للرد السريع (أنا قادم الآن): {{3}}\nاضغط على الرابط أعلاه لتأكيد قدومك — منصة بَلِّغْنِي.",
      },
    },
  },
  {
    friendlyName: "balaghni_nabbihni_media_alert",
    envKey: "TWILIO_CONTENT_SID_MEDIA_ALERT",
    language: "ar",
    category: "UTILITY",
    variables: {
      1: "تويوتا كامري",
      2: "ضي سيارتك والع — ناسي ضي سيارتك والع بتاريتك حتفضى",
      3: "0912345678",
      4: "https://balaghni.ly/r/B8M3P4",
      5: "https://www.balaghni.ly/balaghni-logo.jpg",
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
    envKey: "TWILIO_CONTENT_SID_OTP",
    language: "ar",
    category: "AUTHENTICATION",
    variables: {
      1: "482910",
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
];

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
  const existing = await listContents();
  const envUpdates = {};
  const templateReport = [];

  for (const spec of TEMPLATES) {
    const existingItem = existing.find((c) => c.friendly_name === spec.friendlyName);
    let sid = existingItem?.sid || "";
    if (sid) {
      const existingApp = await getApproval(sid);
      if (existingApp.status === "rejected") {
        await fetch(`https://content.twilio.com/v1/Content/${sid}`, {
          method: "DELETE",
          headers: { Authorization: authHeader },
        });
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
