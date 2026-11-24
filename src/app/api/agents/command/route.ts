import { NextRequest, NextResponse } from "next/server";
import {
  verifyAdminSessionToken,
  verifyAdminActionPermission,
} from "@/lib/supabase/client";
import { clearAdminSessionCookie } from "@/lib/security-tokens";
import { dispatchOfficeCommand } from "@/lib/ai-office/workforce-dispatcher";
import type { TaskPriority } from "@/lib/ai-office/task-orchestrator";
import { consumeDistributedRateLimit, getClientIp } from "@/lib/rate-limiter";

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

    const rateRes = await consumeDistributedRateLimit(
      "ai_cmd",
      `${activeCheck.profile.username || "admin"}:${getClientIp(req)}`,
      20,
      5 * 60 * 1000
    );
    if (!rateRes.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: `تم تجاوز الحد المسموح لأوامر غرفة العمليات مؤقتاً. يرجى الانتظار ${rateRes.retryAfterSeconds} ثانية.`,
          retryAfterSeconds: rateRes.retryAfterSeconds,
        },
        { status: 429 }
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
    const targetRole:
      | "orchestrator"
      | "principal_architect"
      | "skills_architect" =
      rawTarget === "principal_architect"
        ? "principal_architect"
        : rawTarget === "skills_architect"
        ? "skills_architect"
        : "orchestrator";

    const rawPriority = String(body?.priority || "normal").trim();
    const priority: TaskPriority =
      rawPriority === "low" ||
      rawPriority === "high" ||
      rawPriority === "urgent"
        ? rawPriority
        : "normal";

    const rawIdempotencyKey =
      typeof body?.idempotencyKey === "string"
        ? body.idempotencyKey.trim().slice(0, 64)
        : undefined;

    // ملاحظة أمنية: يتم تجاهل أي حقول client-supplied مثل approvalGranted أو approvalId أو featureFlag
    const result = await dispatchOfficeCommand({
      command,
      targetRole,
      priority,
      idempotencyKey: rawIdempotencyKey || undefined,
      stageTimeBudgetMs: 42000,
      adminId: activeCheck.profile.id,
      adminName: activeCheck.profile.fullName || activeCheck.profile.username,
    });

    const httpStatus = result.needsResume
      ? 202
      : result.ok
      ? 200
      : 500;
    return NextResponse.json(result, { status: httpStatus });
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
