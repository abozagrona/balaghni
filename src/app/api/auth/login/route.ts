import { NextResponse } from "next/server";
import {
  verifyOwnerLogin,
  checkOwnerPhoneExists,
} from "@/lib/supabase/client";
import { formatFullLibyaE164 } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawPhone = String(body.ownerPhone || body.phone || "").trim();
    const pin = body.pin ? String(body.pin).trim() : undefined;
    const passkeyCredentialId = body.passkeyCredentialId
      ? String(body.passkeyCredentialId).trim()
      : undefined;
    const checkOnly = Boolean(body.checkOnly);
    const otpVerified = Boolean(body.otpVerified);

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
              "لم يتم العثور على سيارة مرتبطة بهذه البصمة، يرجى الدخول برقم الهاتف.",
          },
          { status: 401 }
        );
      }

      return NextResponse.json({
        ok: true,
        tag: result.record,
      });
    }

    // 2. فحص صحة الرقم الليبي
    const fullPhone = formatFullLibyaE164(rawPhone);
    if (!fullPhone) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "يرجى إدخال رقم هاتف ليبي صحيح (+218) يبدأ بـ (091, 092, 093, 094, 095).",
        },
        { status: 400 }
      );
    }

    // التحقق المسبق من وجود حساب مرتبط بالرقم قبل إرسال رمز OTP
    if (checkOnly) {
      const exists = await checkOwnerPhoneExists(fullPhone);
      if (!exists) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "رقم الهاتف هذا غير مرتبط بأي ملصق في النظام. هل قمت بتفعيل ملصقك؟",
          },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, exists: true, phone: fullPhone });
    }

    // 3. الدخول المباشر بعد التحقق بنجاح من رمز الـ OTP (Passwordless Login)
    if (otpVerified) {
      const result = await verifyOwnerLogin({
        ownerPhone: fullPhone,
        otpVerified: true,
      });

      if (!result.ok || !result.record) {
        return NextResponse.json(
          {
            ok: false,
            error:
              result.error ||
              "لم يتم العثور على ملصق مفعل مرتبط بهذا الرقم.",
          },
          { status: 404 }
        );
      }

      return NextResponse.json({
        ok: true,
        tag: result.record,
      });
    }

    // 4. الدخول التقليدي برمز المرور (PIN) للملصقات القديمة إن وُجد
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

