import { NextResponse } from "next/server";
import { saveOwnerSecuritySetup } from "@/lib/supabase/client";
import { formatBalaghniTagCode } from "@/lib/utils";

interface RouteParams {
  params: Promise<{ tagCode: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { tagCode } = await params;
    const formattedCode = formatBalaghniTagCode(tagCode);
    const body = await request.json();

    const ownerPin = String(body.ownerPin || "").trim();
    const recoveryKey = String(body.recoveryKey || "").trim().toUpperCase();
    const passkeyCredentialId = body.passkeyCredentialId
      ? String(body.passkeyCredentialId).trim()
      : null;

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

    const result = await saveOwnerSecuritySetup({
      tagCode: formattedCode,
      ownerPin,
      recoveryKey,
      passkeyCredentialId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "تم تأمين حساب سيارتك وحفظ الإعدادات المشفرة بنجاح!",
      tag: result.record,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "حدث خطأ غير متوقع أثناء حفظ إعدادات الأمان." },
      { status: 500 }
    );
  }
}
