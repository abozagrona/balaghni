import { NextRequest, NextResponse } from "next/server";
import {
  saveOwnerSecuritySetup,
  verifyAdminActionPermission,
} from "@/lib/supabase/client";
import { formatBalaghniTagCode } from "@/lib/utils";
import {
  verifyOwnerSessionFromRequest,
  createOwnerSessionToken,
  attachOwnerSessionCookie,
} from "@/lib/security-tokens";

interface RouteParams {
  params: Promise<{ tagCode: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { tagCode } = await params;
    const formattedCode = formatBalaghniTagCode(tagCode);
    const body = await request.json();

    const ownerPin = String(body.ownerPin || "").trim();
    const recoveryKey = String(body.recoveryKey || "").trim().toUpperCase();
    const passkeyCredentialId = body.passkeyCredentialId
      ? String(body.passkeyCredentialId).trim()
      : null;
    const ownerPhone = body.ownerPhone ? String(body.ownerPhone).trim() : undefined;
    const vehicleInfo = body.vehicleInfo ? String(body.vehicleInfo).trim() : undefined;
    const city = body.city ? String(body.city).trim() : undefined;

    if (!/^\d{6}$/.test(ownerPin)) {
      return NextResponse.json(
        {
          ok: false,
          error: "يرجى إدخال رمز مرور للحساب مكون من 6 أرقام بالضبط.",
        },
        { status: 400 }
      );
    }

    if (!/^BK-[A-Z0-9]{4}-[A-Z0-9]{4}(-[A-Z0-9]{4})?$/.test(recoveryKey)) {
      return NextResponse.json(
        {
          ok: false,
          error: "كود أمان الطوارئ الرقمي غير صالح.",
        },
        { status: 400 }
      );
    }

    // التحقق من جلسة المالك أو جلسة المشرف قبل تعديل إعدادات الأمان
    let authorizedOwnerPhone: string | undefined;
    let isSuperAdmin = false;

    const ownerSession = verifyOwnerSessionFromRequest(request);
    if (
      ownerSession.valid &&
      ownerSession.payload &&
      formatBalaghniTagCode(ownerSession.payload.tagCode) === formattedCode
    ) {
      authorizedOwnerPhone = ownerSession.payload.ownerPhone;
    } else {
      const authHeader = request.headers.get("authorization") || "";
      const bearer = authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : "";
      const adminCookie =
        request.cookies.get("balaghni_admin_session")?.value || "";
      const adminToken = bearer || adminCookie;
      if (adminToken) {
        const adminCheck = await verifyAdminActionPermission(
          adminToken,
          "manage_tags"
        );
        if (
          adminCheck.authorized &&
          adminCheck.profile?.role === "SUPER_ADMIN"
        ) {
          isSuperAdmin = true;
        }
      }
    }

    if (!authorizedOwnerPhone && !isSuperAdmin) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "غير مصرح بتعديل إعدادات الأمان لهذا الملصق دون جلسة مالك موقّعة وفعالة.",
        },
        { status: 401 }
      );
    }

    const result = await saveOwnerSecuritySetup({
      tagCode: formattedCode,
      ownerPin,
      recoveryKey,
      passkeyCredentialId,
      ownerPhone: isSuperAdmin ? ownerPhone : authorizedOwnerPhone,
      vehicleInfo,
      city,
      authorizedOwnerPhone,
      isSuperAdmin,
    });

    if (!result.ok || !result.record || result.record.status !== "ACTIVE") {
      return NextResponse.json(
        {
          ok: false,
          error:
            result.error ||
            "تعذر تحديث حالة الملصق إلى ACTIVE في قاعدة البيانات.",
        },
        { status: 400 }
      );
    }

    const response = NextResponse.json({
      ok: true,
      message: "تم تأمين حساب سيارتك وتفعيل الملصق بنجاح!",
      tag: result.record,
    });

    if (!isSuperAdmin && result.record.ownerPhone) {
      const token = createOwnerSessionToken({
        tagCode: formattedCode,
        ownerPhone: result.record.ownerPhone,
      });
      attachOwnerSessionCookie(response, token, formattedCode);
    }

    return response;
  } catch {
    return NextResponse.json(
      { ok: false, error: "حدث خطأ غير متوقع أثناء حفظ إعدادات الأمان." },
      { status: 500 }
    );
  }
}

