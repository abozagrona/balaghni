import { NextRequest, NextResponse } from "next/server";
import {
  verifyAdminSessionToken,
  verifyAdminActionPermission,
} from "@/lib/supabase/client";
import { clearAdminSessionCookie } from "@/lib/security-tokens";
import {
  ensureAiOfficeSchemaAndSeed,
  getAiOfficeSnapshot,
} from "@/lib/ai-office/agents-service";

export const dynamic = "force-dynamic";

function extractAdminToken(req: NextRequest): string {
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const xAdminToken = req.headers.get("x-admin-token") || "";
  const cookieToken = req.cookies.get("balaghni_admin_session")?.value || "";
  return bearerToken || xAdminToken || cookieToken;
}

export async function GET(req: NextRequest) {
  try {
    const token = extractAdminToken(req);
    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          authenticated: false,
          error: "يجب تسجيل الدخول بحساب الأدمن الرئيسي للوصول إلى غرفة العمليات.",
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
          error: "انتهت جلسة الأدمن أو أنها غير صالحة. يرجى تسجيل الدخول مجدداً.",
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
          error: activeCheck.error || "غير مصرح لك بالوصول إلى غرفة العمليات.",
        },
        { status: 403 }
      );
    }

    const bootstrap = await ensureAiOfficeSchemaAndSeed();
    if (!bootstrap.ok) {
      return NextResponse.json(
        {
          ok: false,
          authenticated: true,
          migrationRequired: true,
          error: bootstrap.error,
          adminProfile: {
            id: activeCheck.profile.id,
            fullName: activeCheck.profile.fullName,
            role: activeCheck.profile.role,
          },
        },
        { status: 503 }
      );
    }

    const snapshot = await getAiOfficeSnapshot();
    return NextResponse.json({
      ok: true,
      authenticated: true,
      migrated: Boolean(bootstrap.migrated),
      adminProfile: {
        id: activeCheck.profile.id,
        fullName: activeCheck.profile.fullName,
        role: activeCheck.profile.role,
      },
      ...snapshot,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "تعذر تحميل بيانات غرفة العمليات حالياً.",
      },
      { status: 500 }
    );
  }
}
