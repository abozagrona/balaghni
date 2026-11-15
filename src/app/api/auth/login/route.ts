import { NextRequest, NextResponse } from "next/server";
import {
  verifyOwnerLogin,
  checkOwnerPhoneExists,
} from "@/lib/supabase/client";
import { formatFullLibyaE164 } from "@/lib/utils";
import {
  verifyAndConsumeOtpProof,
  verifyWebAuthnAssertion,
  extractRawCredentialId,
  createOwnerSessionToken,
  attachOwnerSessionCookie,
  clearOwnerSessionCookie,
} from "@/lib/security-tokens";
import {
  checkPinRateLimit,
  recordPinFailure,
  clearPinFailures,
  getClientIp,
} from "@/lib/rate-limiter";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    if (action === "logout") {
      const res = NextResponse.json({ ok: true });
      clearOwnerSessionCookie(res);
      return res;
    }

    const rawPhone = String(body.ownerPhone || body.phone || "").trim();
    const pin = body.pin ? String(body.pin).trim() : undefined;
    const rawPasskeyId = body.passkeyCredentialId
      ? String(body.passkeyCredentialId).trim()
      : undefined;
    const checkOnly = Boolean(body.checkOnly);
    const otpVerified = Boolean(body.otpVerified);

    // 1. الدخول بمفتاح المرور (Passkey) مع التحقق التشفيري الإلزامي من التحدي والتوقيع
    if (rawPasskeyId) {
      const credentialId = extractRawCredentialId(rawPasskeyId);
      const result = await verifyOwnerLogin({
        passkeyCredentialId: credentialId,
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

      const storedRecord = result.storedPasskeyRecord || "";
      const assertionCheck = verifyWebAuthnAssertion({
        req: request,
        challengeTokenFromBody: body.challengeToken,
        expectedScope: "owner",
        credentialId,
        storedCredentialRecord: storedRecord,
        clientDataJSONBase64: String(body.clientDataJSON || ""),
        authenticatorDataBase64: String(body.authenticatorData || ""),
        signatureBase64: String(body.signature || ""),
      });

      if (!assertionCheck.ok) {
        return NextResponse.json(
          {
            ok: false,
            error:
              assertionCheck.error ||
              "فشل التحقق التشفيري من مفتاح المرور، يرجى الدخول عبر رمز التحقق.",
          },
          { status: 401 }
        );
      }

      const ownerToken = createOwnerSessionToken({
        tagCode: result.record.tagCode,
        ownerPhone: result.record.ownerPhone || "",
      });
      const response = NextResponse.json({
        ok: true,
        tag: result.record,
      });
      attachOwnerSessionCookie(response, ownerToken, result.record.tagCode);
      return response;
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

    // 3. الدخول المباشر بعد التحقق الفعلي من رمز الـ OTP على الخادم (يرفض الثقة براية المتصفح وحدها)
    if (otpVerified || body.otpProofToken) {
      const proofCheck = verifyAndConsumeOtpProof(
        request,
        body.otpProofToken,
        fullPhone
      );
      if (!proofCheck.valid) {
        return NextResponse.json(
          {
            ok: false,
            error:
              proofCheck.error ||
              "يرجى إتمام التحقق من رقم الهاتف عبر رمز التحقق أولاً.",
          },
          { status: 401 }
        );
      }

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

      const ownerToken = createOwnerSessionToken({
        tagCode: result.record.tagCode,
        ownerPhone: result.record.ownerPhone || fullPhone,
      });
      const response = NextResponse.json({
        ok: true,
        tag: result.record,
      });
      attachOwnerSessionCookie(response, ownerToken, result.record.tagCode);
      return response;
    }

    // 4. الدخول التقليدي برمز المرور (PIN) مع حماية القفل بعد المحاولات الخاطئة
    const ip = getClientIp(request);
    const rateKey = `login_pin:${fullPhone}:${ip}`;
    const rateLimit = checkPinRateLimit(rateKey);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: rateLimit.reason,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    const result = await verifyOwnerLogin({
      ownerPhone: fullPhone,
      pin,
    });

    if (!result.ok || !result.record) {
      const failInfo = recordPinFailure(rateKey);
      return NextResponse.json(
        {
          ok: false,
          error: result.error || "رقم الهاتف غير مسجل أو رمز المرور غير صحيح",
          remainingAttempts: failInfo.remainingAttempts,
        },
        { status: 401 }
      );
    }

    clearPinFailures(rateKey);
    const ownerToken = createOwnerSessionToken({
      tagCode: result.record.tagCode,
      ownerPhone: result.record.ownerPhone || fullPhone,
    });
    const response = NextResponse.json({
      ok: true,
      tag: result.record,
    });
    attachOwnerSessionCookie(response, ownerToken, result.record.tagCode);
    return response;
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


