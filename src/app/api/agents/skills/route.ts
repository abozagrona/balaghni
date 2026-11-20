import { NextRequest, NextResponse } from "next/server";
import {
  verifyAdminSessionToken,
  verifyAdminActionPermission,
} from "@/lib/supabase/client";
import { clearAdminSessionCookie } from "@/lib/security-tokens";
import { activateAgentSkill } from "@/lib/ai-office/agents-service";

export const dynamic = "force-dynamic";

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
        { ok: false, authenticated: false, error: "غير مصرح: يرجى تسجيل الدخول كأدمن." },
        { status: 401 }
      );
    }

    const sessionCheck = verifyAdminSessionToken(token);
    if (!sessionCheck.valid || !sessionCheck.payload) {
      const res = NextResponse.json(
        { ok: false, authenticated: false, error: "انتهت جلسة الأدمن، يرجى تسجيل الدخول مجدداً." },
        { status: 401 }
      );
      clearAdminSessionCookie(res);
      return res;
    }

    const activeCheck = await verifyAdminActionPermission(token, "status");
    if (!activeCheck.authorized || !activeCheck.profile) {
      return NextResponse.json(
        { ok: false, authenticated: false, error: "غير مصرح لك باعتماد وتفعيل المهارات." },
        { status: 403 }
      );
    }

    const skillId = String(body?.skillId || "").trim();
    if (!skillId) {
      return NextResponse.json(
        { ok: false, error: "معرّف المهارة (skillId) مطلوب." },
        { status: 400 }
      );
    }

    const result = await activateAgentSkill(
      skillId,
      activeCheck.profile.fullName || activeCheck.profile.username
    );

    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "تعذر تفعيل المهارة حالياً.",
      },
      { status: 500 }
    );
  }
}
