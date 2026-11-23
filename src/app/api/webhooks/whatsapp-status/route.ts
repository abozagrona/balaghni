import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import twilio from "twilio";
import {
  parseWebhookBody,
  processWhatsappWebhookPayload,
} from "@/lib/whatsapp-webhook-handler";

export const dynamic = "force-dynamic";

const EXPECTED_STATUS_WEBHOOK_PATH = "/api/webhooks/whatsapp-status";

function safeTimingEqual(aStr: string, bStr: string): boolean {
  const a = Buffer.from(aStr, "utf8");
  const b = Buffer.from(bStr, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * التحقق الصارم (Fail-Closed) من توقيع Meta WhatsApp Cloud API (X-Hub-Signature-256)
 */
function verifyMetaStatusSignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  const appSecret = (
    process.env.WHATSAPP_APP_SECRET ||
    process.env.META_APP_SECRET ||
    ""
  ).trim();

  if (!appSecret || !signatureHeader) {
    return false;
  }

  const trimmedSig = signatureHeader.trim();
  if (!/^sha256=[0-9a-f]{64}$/i.test(trimmedSig)) {
    return false;
  }

  const expectedSig = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex")}`;

  return safeTimingEqual(trimmedSig.toLowerCase(), expectedSig.toLowerCase());
}

/**
 * بناء عنوان التحقق الموثوق لـ Twilio StatusCallback حصراً من إعداد خادمي صريح (HTTPS)
 * دون أي اعتماد على x-forwarded-host أو x-forwarded-proto أو عنوان احتياطي صامت.
 */
function resolveTrustedTwilioStatusUrl(search: string): string | null {
  const explicitUrl = (
    process.env.TWILIO_WHATSAPP_STATUS_WEBHOOK_URL || ""
  ).trim();
  if (explicitUrl) {
    try {
      const parsed = new URL(explicitUrl);
      const normalizedPath = parsed.pathname.replace(/\/+$/, "");
      if (
        parsed.protocol !== "https:" ||
        !parsed.hostname ||
        normalizedPath !== EXPECTED_STATUS_WEBHOOK_PATH ||
        parsed.search ||
        parsed.hash
      ) {
        console.error(
          "[WhatsApp Status Webhook] إعداد TWILIO_WHATSAPP_STATUS_WEBHOOK_URL غير صالح أو لا يطابق المسار المتوقع."
        );
        return null;
      }
      return `${parsed.origin}${EXPECTED_STATUS_WEBHOOK_PATH}${search}`;
    } catch {
      console.error(
        "[WhatsApp Status Webhook] تعذر تحليل TWILIO_WHATSAPP_STATUS_WEBHOOK_URL."
      );
      return null;
    }
  }

  const baseUrl = (process.env.TWILIO_WEBHOOK_BASE_URL || "").trim();
  if (!baseUrl) {
    console.error(
      "[WhatsApp Status Webhook] غياب إعداد العنوان الموثوق (TWILIO_WEBHOOK_BASE_URL أو TWILIO_WHATSAPP_STATUS_WEBHOOK_URL)."
    );
    return null;
  }

  try {
    const parsed = new URL(baseUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      normalizedPath !== "" ||
      parsed.search ||
      parsed.hash
    ) {
      console.error(
        "[WhatsApp Status Webhook] إعداد TWILIO_WEBHOOK_BASE_URL يجب أن يكون أصل HTTPS صالحاً دون مسار أو استعلام."
      );
      return null;
    }
    return `${parsed.origin}${EXPECTED_STATUS_WEBHOOK_PATH}${search}`;
  } catch {
    console.error(
      "[WhatsApp Status Webhook] تعذر تحليل TWILIO_WEBHOOK_BASE_URL."
    );
    return null;
  }
}

function parseFormUrlEncodedParams(
  rawBody: string
): Record<string, string | string[]> {
  const searchParams = new URLSearchParams(rawBody);
  const params: Record<string, string | string[]> = {};
  searchParams.forEach((value, key) => {
    const existing = params[key];
    if (existing === undefined) {
      params[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      params[key] = [existing, value];
    }
  });
  return params;
}

/**
 * التحقق الصارم (Fail-Closed) من توقيع Twilio الرسمي عبر حزمة twilio الرسمية
 * باستخدام عنوان HTTPS موثوق مضبوط خادمياً فقط.
 */
function verifyTwilioStatusSignature(
  search: string,
  rawBody: string,
  contentType: string,
  twilioSignatureHeader: string | null
): boolean {
  const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (!authToken || !twilioSignatureHeader) {
    return false;
  }

  const trimmedSig = twilioSignatureHeader.trim();
  if (!trimmedSig) {
    return false;
  }

  const trustedUrl = resolveTrustedTwilioStatusUrl(search);
  if (!trustedUrl) {
    return false;
  }

  try {
    const ct = String(contentType || "").toLowerCase();
    if (ct.includes("application/x-www-form-urlencoded")) {
      const params = parseFormUrlEncodedParams(rawBody);
      return twilio.validateRequest(authToken, trimmedSig, trustedUrl, params);
    }
    return twilio.validateRequestWithBody(
      authToken,
      trimmedSig,
      trustedUrl,
      rawBody
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  const expectedToken = (process.env.WHATSAPP_VERIFY_TOKEN || "").trim();

  if (
    expectedToken &&
    mode === "subscribe" &&
    token &&
    safeTimingEqual(token.trim(), expectedToken)
  ) {
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text().catch(() => "");
    const contentType = req.headers.get("content-type") || "";
    const metaSig = req.headers.get("x-hub-signature-256");
    const twilioSig = req.headers.get("x-twilio-signature");

    let verified = false;
    if (metaSig !== null && twilioSig !== null) {
      verified = false;
    } else if (metaSig !== null) {
      verified = verifyMetaStatusSignature(rawBody, metaSig);
    } else if (twilioSig !== null) {
      verified = verifyTwilioStatusSignature(
        req.nextUrl.search || "",
        rawBody,
        contentType,
        twilioSig
      );
    }

    if (!verified) {
      console.warn("[WhatsApp Status Webhook] تم رفض الطلب بسبب غياب أو فشل توقيع المزود.");
      return NextResponse.json(
        { ok: false, error: "Unauthorized: invalid or missing webhook signature" },
        { status: 401 }
      );
    }

    const body = parseWebhookBody(rawBody, contentType);
    const result = await processWhatsappWebhookPayload(body);

    return NextResponse.json(
      { ok: true, status: "STATUS_PROCESSED", ...result },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error("[WhatsApp Status Webhook Error]:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { ok: false, error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
