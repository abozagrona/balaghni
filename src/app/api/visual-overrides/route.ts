import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import {
  verifyAdminLiveEditPermission,
  recordAdminAuditLog,
} from "@/lib/supabase/client";

const OVERRIDES_PATH = path.join(process.cwd(), "src/data/visual-overrides.json");

const ALLOWED_OVERRIDE_FIELDS = new Set([
  "text",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "color",
  "backgroundColor",
  "lineHeight",
  "textAlign",
  "marginTop",
  "marginBottom",
  "width",
]);

const MAX_SELECTORS = 500;
const MAX_FIELD_VALUE_LENGTH = 2000;

/**
 * تنقية صارمة بقائمة سماح (Allowlist) لحفظ وقراءة إعدادات التصميم فقط،
 * ومنع تخزين أو كشف sessionToken أو أي بيانات مصادقة أو مفاتيح غير معتمدة.
 */
function sanitizeVisualOverridesPayload(raw: unknown): {
  elements: Record<string, Record<string, string>>;
} {
  const cleanElements: Record<string, Record<string, string>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { elements: cleanElements };
  }

  const rawElements = (raw as Record<string, unknown>).elements;
  if (!rawElements || typeof rawElements !== "object" || Array.isArray(rawElements)) {
    return { elements: cleanElements };
  }

  let selectorCount = 0;
  for (const [selector, styles] of Object.entries(rawElements as Record<string, unknown>)) {
    if (selectorCount >= MAX_SELECTORS) break;
    if (
      typeof selector !== "string" ||
      selector.length === 0 ||
      selector.length > 500 ||
      selector === "__proto__" ||
      selector === "constructor" ||
      selector === "prototype"
    ) {
      continue;
    }
    if (!styles || typeof styles !== "object" || Array.isArray(styles)) {
      continue;
    }

    const cleanStyle: Record<string, string> = {};
    for (const [field, val] of Object.entries(styles as Record<string, unknown>)) {
      if (!ALLOWED_OVERRIDE_FIELDS.has(field)) continue;
      if (typeof val !== "string") continue;
      cleanStyle[field] = val.slice(0, MAX_FIELD_VALUE_LENGTH);
    }

    if (Object.keys(cleanStyle).length > 0) {
      cleanElements[selector] = cleanStyle;
      selectorCount += 1;
    }
  }

  return { elements: cleanElements };
}

export async function GET() {
  try {
    const content = await fs.readFile(OVERRIDES_PATH, "utf-8");
    const parsed = JSON.parse(content);
    return NextResponse.json(sanitizeVisualOverridesPayload(parsed));
  } catch {
    return NextResponse.json({ elements: {} });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // استخراج رمز الجلسة الموقّع من الترويسات أو الكوكيز فقط (منع الاعتماد على body.sessionToken)
    const authHeader = request.headers.get("authorization") || "";
    const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const xAdminToken = request.headers.get("x-admin-token") || "";
    const cookieToken = request.cookies.get("balaghni_admin_session")?.value || "";

    const candidateToken = bearerToken || xAdminToken || cookieToken;

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

    const sanitized = sanitizeVisualOverridesPayload(body);

    await fs.mkdir(path.dirname(OVERRIDES_PATH), { recursive: true });
    await fs.writeFile(OVERRIDES_PATH, JSON.stringify(sanitized, null, 2), "utf-8");

    await recordAdminAuditLog({
      adminId: authCheck.profile.id,
      adminName: authCheck.profile.fullName || authCheck.profile.phone,
      actionType: "VISUAL_OVERRIDES_UPDATED",
      actionDetails: `قام المشرف (${authCheck.profile.fullName} - ${authCheck.profile.role}) بحفظ وتحديث التعديلات المرئية المباشرة للموقع`,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[visual-overrides POST]",
      error instanceof Error ? error.message : "unknown_error"
    );
    return NextResponse.json(
      { ok: false, error: "تعذر حفظ التعديلات المرئية حالياً." },
      { status: 500 }
    );
  }
}
