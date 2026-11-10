import { NextResponse } from "next/server";
import { verifyOwnerLogin } from "@/lib/supabase/client";
import { formatFullLibyaE164 } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawPhone = String(body.ownerPhone || "").trim();
    const pin = body.pin ? String(body.pin).trim() : undefined;
    const passkeyCredentialId = body.passkeyCredentialId
      ? String(body.passkeyCredentialId).trim()
      : undefined;

    // 1. الدخول الفوري بالبصمة الحيوية دون اشتراط رقم الهاتف (Zero-Typing Customer Passkey)
    if (passkeyCredentialId) {
      const result = await verifyOwnerLogin({
        passkeyCredentialId,
      });

      if (!result.ok || !result.record) {
        return NextResponse.json(
          {
            ok: false,
            error:
              result.error ||
              "لم يتم العثور على سيارة مرتبطة بهذه البصمة، يرجى الدخول برمز الـ PIN.",
          },
          { status: 401 }
        );
      }

      return NextResponse.json({
        ok: true,
        tag: result.record,
      });
    }

    // 2. الدخول برقم الهاتف ورمز المرور (PIN)
    const fullPhone = formatFullLibyaE164(rawPhone);
    if (!fullPhone) {
      return NextResponse.json(
        {
          ok: false,
          error: "رقم الهاتف غير مسجل أو رمز المرور غير صحيح",
        },
        { status: 401 }
      );
    }

    const result = await verifyOwnerLogin({
      ownerPhone: fullPhone,
      pin,
    });

    if (!result.ok || !result.record) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error || "رقم الهاتف غير مسجل أو رمز المرور غير صحيح",
        },
        { status: 401 }
      );
    }

    return NextResponse.json({
      ok: true,
      tag: result.record,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "حدث خطأ أثناء الاتصال بقاعدة البيانات.",
      },
      { status: 500 }
    );
  }
}
