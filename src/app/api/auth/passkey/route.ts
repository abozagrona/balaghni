import { NextRequest, NextResponse } from "next/server";
import {
  supabase,
  getPasskeyCredentialByPhone,
  savePasskeyCredentialForTag,
} from "@/lib/supabase/client";

export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone") || "";
  if (!phone.trim()) {
    // جلب قائمة بجميع passkey_credential_id المسجلة لملصقات الزبائن (Zero-Typing Customer Passkey)
    try {
      const { data, error } = await supabase
        .from("tags")
        .select("passkey_credential_id")
        .not("passkey_credential_id", "is", null);

      const credIds: string[] = [];
      if (!error && Array.isArray(data)) {
        for (const row of data) {
          const cid = String(row.passkey_credential_id || "").trim();
          if (cid && !credIds.includes(cid)) {
            credIds.push(cid);
          }
        }
      }

      return NextResponse.json({
        ok: true,
        passkeyCredentialIds: credIds,
        credentialIds: credIds,
      });
    } catch {
      return NextResponse.json({
        ok: true,
        passkeyCredentialIds: [],
        credentialIds: [],
      });
    }
  }

  const result = await getPasskeyCredentialByPhone(phone.trim());
  if (!result.ok || !result.passkeyCredentialId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          result.error ||
          "لم يتم تفعيل البصمة لهذا الرقم بعد، يرجى الدخول بالـ PIN",
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    passkeyCredentialId: result.passkeyCredentialId,
    tagCode: result.tagCode,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const tagCode = String(body.tagCode || "").trim();
    const passkeyCredentialId = String(body.passkeyCredentialId || "").trim();
    const ownerPhone = String(body.ownerPhone || "").trim();

    if (!tagCode || !passkeyCredentialId) {
      return NextResponse.json(
        { ok: false, error: "بيانات البصمة غير مكتملة." },
        { status: 400 }
      );
    }

    const result = await savePasskeyCredentialForTag({
      tagCode,
      passkeyCredentialId,
      ownerPhone: ownerPhone || undefined,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      passkeyCredentialId,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر حفظ البصمة في قاعدة البيانات." },
      { status: 500 }
    );
  }
}
