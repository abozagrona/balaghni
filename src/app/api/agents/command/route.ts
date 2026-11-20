import { NextRequest, NextResponse } from "next/server";
import {
  verifyAdminSessionToken,
  verifyAdminActionPermission,
} from "@/lib/supabase/client";
import { clearAdminSessionCookie } from "@/lib/security-tokens";
import { executeFounderCommand } from "@/lib/ai-office/agents-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function extractAdminToken(req: NextRequest, bodyToken?: unknown): string {
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const xAdminToken = req.headers.get("x-admin-token") || "";
  const cookieToken = req.cookies.get("balaghni_admin_session")?.value || "";
  const fallbackBody = typeof bodyToken === "string" ? bodyToken.trim() : "";
  return bearerToken || xAdminToken || fallbackBody || cookieToken;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = extractAdminToken(req, body?.sessionToken);

    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          authenticated: false,
          error: "غير مصرح: يجب تسجيل الدخول بحساب الأدمن لإرسال الأوامر لفريق الذكاء الاصطناعي.",
        },
        { status: 401 }
      );
    }

    const sessionCheck = verifyAdminSessionToken(token);
    if (!sessionCheck.valid || !sessionCheck.payload) {
      const res = NextResponse.json(
        {
          ok: false,
          authenticated: false,
          sessionExpired: Boolean(sessionCheck.expired),
          error: "انتهت جلسة الأدمن، يرجى تسجيل الدخول مجدداً.",
        },
        { status: 401 }
      );
      clearAdminSessionCookie(res);
      return res;
    }

    const activeCheck = await verifyAdminActionPermission(token, "status");
    if (!activeCheck.authorized || !activeCheck.profile) {
      return NextResponse.json(
        {
          ok: false,
          authenticated: false,
          error: activeCheck.error || "غير مصرح لك بتشغيل أوامر غرفة العمليات.",
        },
        { status: 403 }
      );
    }

    const command = String(body?.command || "").trim();
    if (!command) {
      return NextResponse.json(
        { ok: false, error: "يرجى إدخال نص الأمر المطلوب تنفيذه." },
        { status: 400 }
      );
    }

    const rawTarget = String(body?.targetRole || "orchestrator").trim();
    const targetRole: "orchestrator" | "principal_architect" =
      rawTarget === "principal_architect"
        ? "principal_architect"
        : "orchestrator";

    const result = await executeFounderCommand({
      command,
      targetRole,
      adminName: activeCheck.profile.fullName || activeCheck.profile.username,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "حدث خطأ أثناء تنفيذ الأمر في غرفة العمليات.",
      },
      { status: 500 }
    );
  }
}
