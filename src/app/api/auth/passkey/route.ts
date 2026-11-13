import { NextRequest, NextResponse } from "next/server";
import {
  supabase,
  getPasskeyCredentialByPhone,
  savePasskeyCredentialForTag,
  clearPasskeyCredentialForTag,
} from "@/lib/supabase/client";

const PRODUCTION_ORIGINS = [
  "https://balaghni.ly",
  "https://www.balaghni.ly",
];

function resolveWebAuthnContext(request: NextRequest) {
  const rawHost =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    request.nextUrl.host ||
    "balaghni.ly";

  const hostname = rawHost.split(",")[0].trim().split(":")[0].toLowerCase();
  const rpId = hostname.replace(/^www\./, "") || "balaghni.ly";

  const allowedOrigins = Array.from(
    new Set([
      ...PRODUCTION_ORIGINS,
      ...(rpId !== "balaghni.ly"
        ? [
            `https://${rpId}`,
            `https://www.${rpId}`,
            `http://${hostname}`,
            `http://${hostname}:3000`,
          ]
        : []),
    ])
  );

  const origin = request.headers.get("origin")?.trim() || "";
  const isOriginAllowed =
    !origin ||
    allowedOrigins.includes(origin) ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.endsWith(".vercel.app");

  return {
    rpId,
    allowedOrigins,
    origin,
    isOriginAllowed,
  };
}

function buildCorsHeaders(origin: string, isOriginAllowed: boolean) {
  if (!origin || !isOriginAllowed) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  const { origin, isOriginAllowed } = resolveWebAuthnContext(request);
  if (!isOriginAllowed) {
    return NextResponse.json(
      { ok: false, error: "أصل الطلب غير مصرح به." },
      { status: 403 }
    );
  }
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...(buildCorsHeaders(origin, isOriginAllowed) || {}),
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function GET(request: NextRequest) {
  const { rpId, allowedOrigins, origin, isOriginAllowed } =
    resolveWebAuthnContext(request);
  const headers = buildCorsHeaders(origin, isOriginAllowed);
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

      return NextResponse.json(
        {
          ok: true,
          rpId,
          allowedOrigins,
          passkeyCredentialIds: credIds,
          credentialIds: credIds,
        },
        { headers }
      );
    } catch {
      return NextResponse.json(
        {
          ok: true,
          rpId,
          allowedOrigins,
          passkeyCredentialIds: [],
          credentialIds: [],
        },
        { headers }
      );
    }
  }

  const result = await getPasskeyCredentialByPhone(phone.trim());
  if (!result.ok || !result.passkeyCredentialId) {
    return NextResponse.json(
      {
        ok: false,
        rpId,
        allowedOrigins,
        error:
          result.error ||
          "لم يتم تفعيل البصمة لهذا الرقم بعد، يرجى الدخول بالـ PIN",
      },
      { status: 404, headers }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      rpId,
      allowedOrigins,
      passkeyCredentialId: result.passkeyCredentialId,
      tagCode: result.tagCode,
    },
    { headers }
  );
}

export async function POST(request: NextRequest) {
  const { rpId, allowedOrigins, origin, isOriginAllowed } =
    resolveWebAuthnContext(request);
  const headers = buildCorsHeaders(origin, isOriginAllowed);

  if (!isOriginAllowed) {
    return NextResponse.json(
      { ok: false, error: "أصل الطلب غير مصرح به لتسجيل البصمة." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const tagCode = String(body.tagCode || "").trim();
    const passkeyCredentialId = String(body.passkeyCredentialId || "").trim();
    const ownerPhone = String(body.ownerPhone || "").trim();

    if (!tagCode || !passkeyCredentialId) {
      return NextResponse.json(
        { ok: false, error: "بيانات البصمة غير مكتملة." },
        { status: 400, headers }
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
        { status: 400, headers }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        rpId,
        allowedOrigins,
        passkeyCredentialId,
      },
      { headers }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر حفظ البصمة في قاعدة البيانات." },
      { status: 500, headers }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { rpId, allowedOrigins, origin, isOriginAllowed } =
    resolveWebAuthnContext(request);
  const headers = buildCorsHeaders(origin, isOriginAllowed);

  if (!isOriginAllowed) {
    return NextResponse.json(
      { ok: false, error: "أصل الطلب غير مصرح به." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const tagCode = String(
      body.tagCode || request.nextUrl.searchParams.get("tagCode") || ""
    ).trim();

    if (!tagCode) {
      return NextResponse.json(
        { ok: false, error: "كود الملصق مطلوب." },
        { status: 400, headers }
      );
    }

    const result = await clearPasskeyCredentialForTag(tagCode);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 400, headers }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        rpId,
        allowedOrigins,
      },
      { headers }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر إلغاء تفعيل البصمة." },
      { status: 500, headers }
    );
  }
}
