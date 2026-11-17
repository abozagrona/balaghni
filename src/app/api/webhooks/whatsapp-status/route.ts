import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  parseWebhookBody,
  processWhatsappWebhookPayload,
} from "@/lib/whatsapp-webhook-handler";

export const dynamic = "force-dynamic";

function verifyMetaSignatureIfPresent(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  if (!signatureHeader) return true;
  const appSecret = (
    process.env.WHATSAPP_APP_SECRET ||
    process.env.META_APP_SECRET ||
    ""
  ).trim();
  if (!appSecret) return true;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const expectedSig = `sha256=${crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex")}`;

  const a = Buffer.from(signatureHeader, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  const expectedToken = (
    process.env.WHATSAPP_VERIFY_TOKEN || "balaghni_wa_2026_clean"
  ).trim();

  if (mode === "subscribe" && token?.trim() === expectedToken) {
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.json(
    { ok: true, endpoint: "whatsapp-status" },
    { status: 200 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text().catch(() => "");
    const signatureHeader = req.headers.get("x-hub-signature-256");

    if (!verifyMetaSignatureIfPresent(rawBody, signatureHeader)) {
      return NextResponse.json(
        { ok: false, error: "Invalid webhook signature" },
        { status: 401 }
      );
    }

    const contentType = req.headers.get("content-type") || "";
    const body = parseWebhookBody(rawBody, contentType);
    const result = await processWhatsappWebhookPayload(body);

    return NextResponse.json(
      { ok: true, status: "EVENT_RECEIVED", ...result },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error("[WhatsApp Status Webhook Error]:", err);
    return NextResponse.json(
      { ok: true, status: "EVENT_HANDLED" },
      { status: 200 }
    );
  }
}
