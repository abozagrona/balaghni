import { NextRequest, NextResponse } from "next/server";
import {
  getPasskeyCredentialByPhone,
  savePasskeyCredentialForTag,
  clearPasskeyCredentialForTag,
  verifyAdminActionPermission,
} from "@/lib/supabase/client";
import { formatBalaghniTagCode } from "@/lib/utils";
import {
  createWebAuthnChallenge,
  attachWebAuthnChallengeCookie,
  verifyWebAuthnRegistration,
  verifyOwnerSessionFromRequest,
  extractRawCredentialId,
} from "@/lib/security-tokens";
import {
  checkPasskeyRateLimit,
  getClientIp,
  recordPasskeyAttempt,
} from "@/lib/rate-limiter";

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

async function authorizePasskeyTagMutation(
  request: NextRequest,
  targetTagCode: string
): Promise<boolean> {
  const formattedTarget = formatBalaghniTagCode(targetTagCode);
  const ownerSession = verifyOwnerSessionFromRequest(request);
  if (
    ownerSession.valid &&
    ownerSession.payload &&
    formatBalaghniTagCode(ownerSession.payload.tagCode) === formattedTarget
  ) {
    return true;
  }

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const adminCookie = request.cookies.get("balaghni_admin_session")?.value || "";
  const adminToken = bearer || adminCookie;
  if (adminToken) {
    const adminCheck = await verifyAdminActionPermission(adminToken, "manage_tags");
    if (adminCheck.authorized && adminCheck.profile) {
      return true;
    }
  }

  return false;
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
  const clientIp = getClientIp(request);
  const pkLimit = checkPasskeyRateLimit(clientIp);
  if (!pkLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: pkLimit.reason },
      { status: 429, headers }
    );
  }
  recordPasskeyAttempt(clientIp);

  const phone = request.nextUrl.searchParams.get("phone") || "";
  const tagCode = request.nextUrl.searchParams.get("tagCode") || "";

  // إصدار تحدي WebAuthn موقّع دون كشف قوائم المعرفات المسجلة للعامة
  const { challenge, challengeToken } = createWebAuthnChallenge(
    rpId,
    "owner",
    tagCode ? formatBalaghniTagCode(tagCode) : undefined
  );

  if (!phone.trim()) {
    const res = NextResponse.json(
      {
        ok: true,
        rpId,
        allowedOrigins,
        challenge,
        challengeToken,
        passkeyCredentialIds: [],
        credentialIds: [],
      },
      { headers }
    );
    attachWebAuthnChallengeCookie(res, challengeToken);
    return res;
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
          "لم يتم تفعيل البصمة لهذا الرقم بعد، يرجى الدخول عبر رمز التحقق.",
      },
      { status: 404, headers }
    );
  }

  const res = NextResponse.json(
    {
      ok: true,
      rpId,
      allowedOrigins,
      challenge,
      challengeToken,
      passkeyCredentialId: extractRawCredentialId(result.passkeyCredentialId),
      tagCode: result.tagCode,
    },
    { headers }
  );
  attachWebAuthnChallengeCookie(res, challengeToken);
  return res;
}

export async function POST(request: NextRequest) {
  const { rpId, allowedOrigins, origin, isOriginAllowed } =
    resolveWebAuthnContext(request);
  const headers = buildCorsHeaders(origin, isOriginAllowed);

  const clientIp = getClientIp(request);
  const pkLimit = checkPasskeyRateLimit(clientIp);
  if (!pkLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: pkLimit.reason },
      { status: 429, headers }
    );
  }
  recordPasskeyAttempt(clientIp);

  if (!isOriginAllowed) {
    return NextResponse.json(
      { ok: false, error: "أصل الطلب غير مصرح به لتسجيل البصمة." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const tagCode = formatBalaghniTagCode(String(body.tagCode || "").trim());
    const passkeyCredentialId = String(body.passkeyCredentialId || "").trim();
    const ownerPhone = String(body.ownerPhone || "").trim();

    if (!tagCode || !passkeyCredentialId) {
      return NextResponse.json(
        { ok: false, error: "بيانات البصمة غير مكتملة." },
        { status: 400, headers }
      );
    }

    // إلزام جلسة مالك موقّعة وفعالة لنفس الملصق قبل ربط مفتاح المرور
    const isAuthorized = await authorizePasskeyTagMutation(request, tagCode);
    if (!isAuthorized) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "غير مصرح بربط مفتاح المرور دون تسجيل الدخول بحساب مالك الملصق أولاً.",
        },
        { status: 401, headers }
      );
    }

    const regVerify = verifyWebAuthnRegistration({
      req: request,
      challengeTokenFromBody: body.challengeToken,
      expectedScope: "owner",
      credentialId: passkeyCredentialId,
      clientDataJSONBase64: String(body.clientDataJSON || ""),
      publicKeySpkiBase64: String(body.publicKeySpki || ""),
      publicKeyAlgorithm: Number(body.publicKeyAlgorithm || -7),
    });

    if (!regVerify.ok || !regVerify.encodedRecord) {
      return NextResponse.json(
        {
          ok: false,
          error:
            regVerify.error ||
            "تعذر التحقق التشفيري من مفتاح المرور الجديد.",
        },
        { status: 400, headers }
      );
    }

    const result = await savePasskeyCredentialForTag({
      tagCode,
      passkeyCredentialId: regVerify.encodedRecord,
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
        passkeyCredentialId: regVerify.rawCredentialId,
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
    const tagCode = formatBalaghniTagCode(
      String(
        body.tagCode || request.nextUrl.searchParams.get("tagCode") || ""
      ).trim()
    );

    if (!tagCode) {
      return NextResponse.json(
        { ok: false, error: "كود الملصق مطلوب." },
        { status: 400, headers }
      );
    }

    const isAuthorized = await authorizePasskeyTagMutation(request, tagCode);
    if (!isAuthorized) {
      return NextResponse.json(
        {
          ok: false,
          error: "غير مصرح بإلغاء تفعيل البصمة دون جلسة مالك صالحة.",
        },
        { status: 401, headers }
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

