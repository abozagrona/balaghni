import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/webhook
 * التحقق الأمني من Webhook لـ Meta / WhatsApp Cloud API
 * Meta Webhook Verification Challenge
 *
 * المعاملات المطلوبة من Meta:
 * - hub.mode: نوع العملية (subscribe)
 * - hub.verify_token: رمز التحقق السري
 * - hub.challenge: كود التحدي الرقمي
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    // التحقق من الـ Token البيئي أو استخدام القيمة الافتراضية
    const expectedToken =
      process.env.WHATSAPP_VERIFY_TOKEN || "balaghni_webhook_3839";

    // التحقق من اشتراك Meta وتطابق رمز التحقق
    if (mode === "subscribe" && token === expectedToken) {
      console.log(
        "[WhatsApp Webhook GET] Meta webhook challenge verified successfully."
      );
      // إرجاع قيمة hub.challenge كنص صريح (plain text) مع الحالة 200
      return new Response(challenge || "", {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    console.warn(
      "[WhatsApp Webhook GET] Verification failed. Mode or token mismatch.",
      {
        receivedMode: mode,
        receivedToken: token ? `${token.slice(0, 4)}***` : null,
      }
    );

    return new Response("Forbidden: Verification token mismatch", {
      status: 403,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("[WhatsApp Webhook GET] Unexpected error:", error);
    return new Response("Internal Server Error", {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
}

/**
 * POST /api/webhook
 * استقبال إشعارات ورسائل WhatsApp / Meta وتحديثات تسليم البلاغات
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    // 1. معالجة أحداث Meta WhatsApp Business Account
    if (body.object === "whatsapp_business_account" || Array.isArray(body.entry)) {
      const entries = body.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change.value;
          if (!value) continue;

          // معالجة الرسائل الواردة (Incoming Messages / Inquiries)
          if (value.messages && Array.isArray(value.messages)) {
            for (const msg of value.messages) {
              const from = msg.from; // رقم المرسل الدولي (مثال: 218912345678)
              const msgId = msg.id;
              const type = msg.type;
              const textBody = msg.text?.body || "";

              console.log(
                `[WhatsApp Webhook Incoming] From: ${from}, MsgId: ${msgId}, Type: ${type}, Body: ${textBody}`
              );
            }
          }

          // معالجة تحديثات حالة تسليم الرسائل (Statuses: sent, delivered, read, failed)
          if (value.statuses && Array.isArray(value.statuses)) {
            for (const statusItem of value.statuses) {
              const status = statusItem.status;
              const recipientId = statusItem.recipient_id;
              const messageId = statusItem.id;

              console.log(
                `[WhatsApp Webhook Status] MessageId: ${messageId}, Recipient: ${recipientId}, Status: ${status}`
              );

              if (statusItem.errors) {
                console.error(
                  `[WhatsApp Webhook Status Error]`,
                  statusItem.errors
                );
              }
            }
          }
        }
      }

      // إشعار Meta بنجاح استلام الحدث (إلزامي كود 200 لتجنب إعادة المحاولات المتكررة)
      return NextResponse.json(
        { success: true, status: "EVENT_RECEIVED" },
        { status: 200 }
      );
    }

    // 2. معالجة أي إشعار أو بلاغ مخصص (Generic Webhook Event)
    console.log("[Webhook POST] Received generic notification payload:", body);
    return NextResponse.json(
      {
        success: true,
        message: "Webhook notification processed successfully",
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[WhatsApp Webhook POST] Error processing webhook:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
