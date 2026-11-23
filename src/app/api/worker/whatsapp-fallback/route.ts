import { NextRequest, NextResponse } from "next/server";
import {
  verifyWorkerCronAuthorization,
  runWhatsappFallbackWorkerCycle,
} from "@/lib/whatsapp-fallback-worker";

// ============================================================================
// Worker مستقل لمعالجة تحويل رسائل WhatsApp غير المؤكدة إلى SMS بعد 60 ثانية
// - محمي إلزامياً بـ CRON_SECRET عبر crypto.timingSafeEqual (Fail-Closed)
// - يصدر فقط معالجات HTTP وإعدادات المسار المتوافقة مع Next.js App Router
// ============================================================================

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function handleWorkerRequest(request: NextRequest) {
  if (!verifyWorkerCronAuthorization(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized: valid CRON_SECRET bearer token required." },
      { status: 401 }
    );
  }

  const cleanup = request.nextUrl.searchParams.get("cleanup") === "true";
  const result = await runWhatsappFallbackWorkerCycle({ cleanupExpired: cleanup });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  return handleWorkerRequest(request);
}

export async function POST(request: NextRequest) {
  return handleWorkerRequest(request);
}
