import { NextResponse } from "next/server";
import { resetOwnerPinByRecoveryKey } from "@/lib/supabase/client";
import { formatFullLibyaE164 } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawPhone = String(body.ownerPhone || "").trim();
    const recoveryKey = String(body.recoveryKey || "").trim().toUpperCase();
    const newPin = String(body.newPin || "").trim();

    const fullPhone = formatFullLibyaE164(rawPhone);
    if (!fullPhone) {
      return NextResponse.json(
        {
          ok: false,
          error: "يرجى إدخال رقم الهاتف الليبي المسجل بشكل صحيح.",
        },
        { status: 400 }
      );
    }

    if (!/^BK-[A-Z0-9]{4}-[A-Z0-9]{4}(-[A-Z0-9]{4})?$/.test(recoveryKey)) {
      return NextResponse.json(
        {
          ok: false,
          error: "صيغة كود بطاقة الأمان غير صحيحة (مثال: BK-XXXX-XXXX).",
        },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(newPin)) {
      return NextResponse.json(
        {
          ok: false,
          error: "يرجى اختيار رمز مرور جديد مكون من 6 أرقام.",
        },
        { status: 400 }
      );
    }

    const result = await resetOwnerPinByRecoveryKey({
      ownerPhone: fullPhone,
      recoveryKey,
      newPin,
    });

    if (!result.ok || !result.record) {
      return NextResponse.json(
        {
          ok: false,
          error:
            result.error ||
            "رقم الهاتف أو كود بطاقة الأمان غير مطابق للسجلات المشفرة.",
        },
        { status: 403 }
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
        error: "حدث خطأ أثناء التحقق من كود الاسترداد في قاعدة البيانات.",
      },
      { status: 500 }
    );
  }
}
