import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import {
  verifyAdminLiveEditPermission,
  recordAdminAuditLog,
} from "@/lib/supabase/client";

const OVERRIDES_PATH = path.join(process.cwd(), "src/data/visual-overrides.json");

export async function GET() {
  try {
    const content = await fs.readFile(OVERRIDES_PATH, "utf-8");
    return NextResponse.json(JSON.parse(content));
  } catch {
    return NextResponse.json({ elements: {} });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // استخراج رمز الجلسة أو معرّف المشرف من Headers أو Cookies أو Body
    const authHeader = request.headers.get("authorization") || "";
    const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const xAdminId = request.headers.get("x-admin-id") || "";
    const cookieToken = request.cookies.get("balaghni_admin_session")?.value || "";
    const bodyToken = String(body.sessionToken || body.adminId || "").trim();

    const candidateToken = bearerToken || xAdminId || bodyToken || cookieToken;

    // التحقق الصارم من صلاحية التعديل المباشر في Supabase
    const authCheck = await verifyAdminLiveEditPermission(candidateToken);

    if (!authCheck.authorized || !authCheck.profile) {
      return NextResponse.json(
        {
          ok: false,
          error:
            authCheck.error ||
            "غير مصرح لك بحفظ التعديلات المباشرة على محتوى الموقع. يتطلب تفعيل صلاحية (can_live_edit) أو حساب الأدمن الرئيسي.",
        },
        { status: 403 }
      );
    }

    // حفظ التعديلات المعتمدة
    await fs.mkdir(path.dirname(OVERRIDES_PATH), { recursive: true });
    await fs.writeFile(OVERRIDES_PATH, JSON.stringify(body, null, 2), "utf-8");

    // توثيق التعديل الإداري في جدول admin_audit_logs
    await recordAdminAuditLog({
      adminId: authCheck.profile.id,
      adminName: authCheck.profile.fullName || authCheck.profile.phone,
      actionType: "VISUAL_OVERRIDES_UPDATED",
      actionDetails: `قام المشرف (${authCheck.profile.fullName} - ${authCheck.profile.role}) بحفظ وتحديث التعديلات المرئية المباشرة للموقع`,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}

