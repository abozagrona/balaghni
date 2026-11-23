import { NextRequest, NextResponse } from "next/server";
import {
  createAdminSessionToken,
  verifyAdminAuthentication,
  verifyAdminActionPermission,
  verifyAdminSessionToken,
  getExecutiveAdminOverview,
  adminManageTagLifecycle,
  adminImportPrintedTags,
  adminGenerateNewBatch,
  adminManageTeamMember,
  adminDangerZoneResetSystem,
  type TagStatus,
  type AlertChannel,
  type AdminPermission,
} from "@/lib/supabase/client";
import {
  attachAdminSessionCookie,
  clearAdminSessionCookie,
  createWebAuthnChallenge,
  attachWebAuthnChallengeCookie,
  verifyWebAuthnRegistration,
  verifyWebAuthnAssertion,
  encodePasskeyCredentialRecord,
  extractRawCredentialId,
} from "@/lib/security-tokens";
import {
  consumeDistributedRateLimit,
  getClientIp,
  canonicalizeRateIp,
  canonicalizeAdminRateIdentifier,
} from "@/lib/rate-limiter";

function extractAdminCandidateToken(req: NextRequest, bodySessionToken?: unknown): string {
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const xAdminToken = req.headers.get("x-admin-token") || "";
  const cookieToken = req.cookies.get("balaghni_admin_session")?.value || "";
  const bodyToken = typeof bodySessionToken === "string" ? bodySessionToken.trim() : "";
  return bearerToken || xAdminToken || bodyToken || cookieToken;
}

export async function GET(req: NextRequest) {
  try {
    const identifier = req.nextUrl.searchParams.get("identifier") || "";
    const authStatus = await verifyAdminAuthentication({
      mode: "status",
      identifier,
    });

    const mode = req.nextUrl.searchParams.get("mode") || "";
    const candidateToken = extractAdminCandidateToken(req);

    // إذا لم تتوفر جلسة إدارية، لا نرجع أي بيانات حساسة (ملصقات، هواتف ملاك، سجلات تدقيق)؛
    // نكتفي بإرجاع حالة قفل المحاولات عند فحص identifier أو رفض الطلب بـ 401.
    if (!candidateToken) {
      if (identifier.trim() || mode === "status") {
        return NextResponse.json({
          ok: true,
          authenticated: false,
          authStatus: {
            lockedUntilIso: authStatus.lockedUntilIso,
            remainingAttempts: authStatus.remainingAttempts,
          },
        });
      }
      return NextResponse.json(
        {
          ok: false,
          authenticated: false,
          error: "يجب تسجيل الدخول بحساب مشرف صالح للوصول إلى بيانات الإدارة.",
          authStatus: {
            lockedUntilIso: authStatus.lockedUntilIso,
            remainingAttempts: authStatus.remainingAttempts,
          },
        },
        { status: 401 }
      );
    }

    const sessionCheck = verifyAdminSessionToken(candidateToken);
    if (!sessionCheck.valid || !sessionCheck.payload) {
      const res = NextResponse.json(
        {
          ok: false,
          authenticated: false,
          sessionExpired: Boolean(sessionCheck.expired),
          error: sessionCheck.expired
            ? "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
            : "جلسة المشرف غير صالحة، يرجى تسجيل الدخول.",
          authStatus: {
            lockedUntilIso: authStatus.lockedUntilIso,
            remainingAttempts: authStatus.remainingAttempts,
          },
        },
        { status: 401 }
      );
      clearAdminSessionCookie(res);
      return res;
    }

    // تحقق إضافي من أن حساب المشرف لا يزال نشطاً في قاعدة البيانات
    const activeCheck = await verifyAdminActionPermission(candidateToken, "status");
    if (!activeCheck.authorized || !activeCheck.profile) {
      const res = NextResponse.json(
        {
          ok: false,
          authenticated: false,
          sessionExpired: true,
          error: activeCheck.error || "تم إيقاف جلسة المشرف أو إلغاء تنشيط الحساب.",
        },
        { status: 401 }
      );
      clearAdminSessionCookie(res);
      return res;
    }

    const overview = await getExecutiveAdminOverview();
    const refreshedToken = createAdminSessionToken({
      id: activeCheck.profile.id,
      phone: activeCheck.profile.phone,
      fullName: activeCheck.profile.fullName,
      role: activeCheck.profile.role,
      permissions: activeCheck.profile.permissions,
      sessionCreatedAt: sessionCheck.payload.sessionCreatedAt,
    });

    const response = NextResponse.json({
      ok: true,
      authenticated: true,
      sessionToken: refreshedToken,
      adminProfile: activeCheck.profile,
      authStatus: {
        lockedUntilIso: authStatus.lockedUntilIso,
        remainingAttempts: authStatus.remainingAttempts,
      },
      ...overview,
    });
    attachAdminSessionCookie(response, refreshedToken);
    return response;
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر جلب بيانات لوحة الإدارة." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    const adminId = body.adminId ? String(body.adminId).trim() : null;

    if (action === "logout" || (action === "auth" && body.mode === "logout")) {
      const res = NextResponse.json({ ok: true });
      clearAdminSessionCookie(res);
      return res;
    }

    // أ) إصدار تحدي WebAuthn موقّع للتحقق من بصمة المشرف دون كشف قائمة المعرفات للعامة
    if (
      (action === "auth" && body.mode === "lookup_passkey") ||
      body.mode === "lookup_passkey"
    ) {
      const clientIp = canonicalizeRateIp(getClientIp(req)) || "127.0.0.1";
      const lookupLimit = await consumeDistributedRateLimit(
        "admin:lookup:ip",
        clientIp,
        15,
        15 * 60 * 1000,
        "fail_closed"
      );
      if (!lookupLimit.allowed) {
        return NextResponse.json(
          {
            ok: false,
            error:
              lookupLimit.source === "fail_closed"
                ? lookupLimit.reason || "خدمة التحقق الأمني غير متاحة مؤقتاً."
                : "تم تجاوز الحد المسموح لمحاولات التحقق. يرجى الانتظار والمحاولة لاحقاً.",
            retryAfterSeconds: lookupLimit.retryAfterSeconds,
          },
          { status: lookupLimit.source === "fail_closed" ? 503 : 429 }
        );
      }

      const hostHeader = req.headers.get("host") || "localhost";
      const rpId = hostHeader.split(":")[0] || "localhost";
      const { challenge, challengeToken } = createWebAuthnChallenge(rpId, "admin");
      const res = NextResponse.json({
        ok: true,
        rpId,
        challenge,
        challengeToken,
        passkeyCredentialIds: [],
        credentialIds: [],
      });
      attachWebAuthnChallengeCookie(res, challengeToken);
      return res;
    }

    // ب) تسجيل الدخول بمفتاح المرور (Passkey) مع التحقق التشفيري الكامل من التوقيع على الخادم
    if (
      (action === "auth" && body.mode === "passkey_login") ||
      Boolean(body.credential_id && !body.password && action !== "auth")
    ) {
      const clientIp = canonicalizeRateIp(getClientIp(req)) || "127.0.0.1";
      const ipLimit = await consumeDistributedRateLimit(
        "admin:auth:ip",
        clientIp,
        10,
        15 * 60 * 1000,
        "fail_closed"
      );
      if (!ipLimit.allowed) {
        return NextResponse.json(
          {
            ok: false,
            error:
              ipLimit.source === "fail_closed"
                ? ipLimit.reason || "خدمة التحقق الأمني غير متاحة مؤقتاً."
                : "تم تجاوز الحد المسموح لمحاولات تسجيل الدخول الإداري. يرجى الانتظار 15 دقيقة.",
            retryAfterSeconds: ipLimit.retryAfterSeconds,
          },
          { status: ipLimit.source === "fail_closed" ? 503 : 429 }
        );
      }

      const credentialId = extractRawCredentialId(
        String(
          body.credential_id || body.credentialId || body.passkeyCredentialId || ""
        )
      );

      if (!credentialId) {
        return NextResponse.json(
          { ok: false, error: "تعذر التحقق من بيانات تسجيل الدخول الإدارية." },
          { status: 400 }
        );
      }

      const normalizedIdentifier = canonicalizeAdminRateIdentifier(
        body.identifier,
        credentialId
      );
      if (normalizedIdentifier) {
        const idLimit = await consumeDistributedRateLimit(
          "admin:auth:id",
          normalizedIdentifier,
          6,
          15 * 60 * 1000,
          "fail_closed"
        );
        if (!idLimit.allowed) {
          return NextResponse.json(
            {
              ok: false,
              error:
                idLimit.source === "fail_closed"
                  ? idLimit.reason || "خدمة التحقق الأمني غير متاحة مؤقتاً."
                  : "تم تجاوز الحد المسموح لمحاولات تسجيل الدخول الإداري. يرجى الانتظار 15 دقيقة.",
              retryAfterSeconds: idLimit.retryAfterSeconds,
            },
            { status: idLimit.source === "fail_closed" ? 503 : 429 }
          );
        }
      }

      const authRes = await verifyAdminAuthentication({
        mode: "passkey_login",
        identifier: body.identifier,
        passkeyCredentialId: credentialId,
      });

      if (!authRes.ok || !authRes.adminProfile || !authRes.sessionToken) {
        return NextResponse.json(
          {
            ok: false,
            error: "تعذر التحقق من بيانات تسجيل الدخول الإدارية.",
          },
          { status: 401 }
        );
      }

      // التحقق التشفيري الإلزامي من التحدي والتوقيع الرقمي لمفتاح المرور
      const storedRecord =
        authRes.storedPasskeyRecord || authRes.adminProfile.passkeyCredentialId || "";
      const assertionVerification = await verifyWebAuthnAssertion({
        req,
        challengeTokenFromBody: body.challengeToken,
        expectedScope: "admin",
        credentialId,
        storedCredentialRecord: storedRecord,
        clientDataJSONBase64: String(body.clientDataJSON || ""),
        authenticatorDataBase64: String(body.authenticatorData || ""),
        signatureBase64: String(body.signature || ""),
      });

      if (!assertionVerification.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: "تعذر التحقق من بيانات تسجيل الدخول الإدارية.",
          },
          { status: 401 }
        );
      }

      const response = NextResponse.json({
        ok: true,
        remainingAttempts: 4,
        adminProfile: authRes.adminProfile,
        sessionToken: authRes.sessionToken,
      });
      attachAdminSessionCookie(response, authRes.sessionToken);
      return response;
    }

    // 1. المصادقة المؤسسية للمشرفين وتغيير كلمة المرور وربط البصمة
    if (action === "auth") {
      const mode = body.mode as
        | "lookup_passkey"
        | "passkey_login"
        | "password_login"
        | "enroll_passkey"
        | "unlink_passkey"
        | "change_own_password"
        | "status";

      // حماية ربط أو إلغاء البصمة: تتطلب جلسة مشرف نشطة وموقّعة
      if (mode === "enroll_passkey" || mode === "unlink_passkey") {
        const candidateToken = extractAdminCandidateToken(req, body.sessionToken);
        const sessionAuth = await verifyAdminActionPermission(candidateToken, "status");
        if (!sessionAuth.authorized || !sessionAuth.profile) {
          return NextResponse.json(
            {
              ok: false,
              error: "يتطلب ربط أو إلغاء البصمة جلسة مشرف نشطة ومصادق عليها.",
            },
            { status: 401 }
          );
        }

        let credentialToStore = String(
          body.passkeyCredentialId || body.credential_id || ""
        ).trim();

        if (mode === "enroll_passkey") {
          const regVerify = await verifyWebAuthnRegistration({
            req,
            challengeTokenFromBody: body.challengeToken,
            expectedScope: "admin",
            credentialId: credentialToStore,
            clientDataJSONBase64: String(body.clientDataJSON || ""),
            publicKeySpkiBase64: String(body.publicKeySpki || ""),
            publicKeyAlgorithm: Number(body.publicKeyAlgorithm || -7),
          });
          if (!regVerify.ok || !regVerify.encodedRecord) {
            return NextResponse.json(
              {
                ok: false,
                error:
                  regVerify.error || "تعذر التحقق التشفيري من مفتاح المرور الجديد.",
              },
              { status: 400 }
            );
          }
          credentialToStore = regVerify.encodedRecord;
        }

        const res = await verifyAdminAuthentication({
          mode,
          identifier: sessionAuth.profile.phone,
          passkeyCredentialId: credentialToStore,
          adminId: sessionAuth.profile.id,
        });

        if (res.ok && res.sessionToken) {
          const response = NextResponse.json(res, { status: 200 });
          attachAdminSessionCookie(response, res.sessionToken);
          return response;
        }
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }

      // حماية تغيير كلمة المرور: إذا لم يدخل كلمة المرور الحالية، يجب أن يمتلك جلسة نشطة لنفس الحساب
      if (mode === "change_own_password" && !body.currentPassword) {
        const candidateToken = extractAdminCandidateToken(req, body.sessionToken);
        const sessionAuth = await verifyAdminActionPermission(candidateToken, "status");
        if (
          !sessionAuth.authorized ||
          !sessionAuth.profile ||
          (adminId && sessionAuth.profile.id !== adminId)
        ) {
          return NextResponse.json(
            {
              ok: false,
              error: "يرجى إدخال كلمة المرور الحالية أو تسجيل الدخول أولاً.",
            },
            { status: 401 }
          );
        }
      }

      // حماية تسجيل الدخول بكلمة المرور بـ Distributed Rate Limiting (fail_closed)
      if (!mode || mode === "password_login" || mode === "change_own_password") {
        const clientIp = getClientIp(req);
        const ipLimit = await consumeDistributedRateLimit(
          "admin:auth:ip",
          clientIp,
          10,
          15 * 60 * 1000,
          "fail_closed"
        );
        if (!ipLimit.allowed) {
          return NextResponse.json(
            {
              ok: false,
              error:
                ipLimit.source === "fail_closed"
                  ? ipLimit.reason || "خدمة التحقق الأمني غير متاحة مؤقتاً."
                  : "تم تجاوز الحد المسموح لمحاولات تسجيل الدخول الإداري. يرجى الانتظار 15 دقيقة.",
              retryAfterSeconds: ipLimit.retryAfterSeconds,
            },
            { status: ipLimit.source === "fail_closed" ? 503 : 429 }
          );
        }

        const normalizedIdentifier = canonicalizeAdminRateIdentifier(
          body.identifier,
          adminId
        );
        if (normalizedIdentifier) {
          const idLimit = await consumeDistributedRateLimit(
            "admin:auth:id",
            normalizedIdentifier,
            6,
            15 * 60 * 1000,
            "fail_closed"
          );
          if (!idLimit.allowed) {
            return NextResponse.json(
              {
                ok: false,
                error:
                  idLimit.source === "fail_closed"
                    ? idLimit.reason || "خدمة التحقق الأمني غير متاحة مؤقتاً."
                    : "تم تجاوز الحد المسموح لمحاولات تسجيل الدخول الإداري. يرجى الانتظار 15 دقيقة.",
                retryAfterSeconds: idLimit.retryAfterSeconds,
              },
              { status: idLimit.source === "fail_closed" ? 503 : 429 }
            );
          }
        }
      }

      const res = await verifyAdminAuthentication({
        mode: mode || "password_login",
        identifier: body.identifier,
        password: body.password,
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        passkeyCredentialId: body.passkeyCredentialId || body.credential_id,
        adminId: adminId || undefined,
      });

      if (res.ok && res.sessionToken) {
        const response = NextResponse.json(res, { status: 200 });
        attachAdminSessionCookie(response, res.sessionToken);
        return response;
      }

      if (!res.ok && (!mode || mode === "password_login")) {
        return NextResponse.json(
          {
            ok: false,
            error: "تعذر التحقق من بيانات تسجيل الدخول الإدارية.",
          },
          { status: 401 }
        );
      }

      return NextResponse.json(res, { status: res.ok ? 200 : 401 });
    }

    // التحقق الأمني الصارم من صلاحيات المشرف من جهة الخادم لجميع العمليات الإدارية (يرفض معرفات المشرف الخام)
    const candidateToken = extractAdminCandidateToken(req, body.sessionToken);

    const authCheck = await verifyAdminActionPermission(candidateToken, action);
    if (!authCheck.authorized || !authCheck.profile) {
      const res = NextResponse.json(
        {
          ok: false,
          sessionExpired: Boolean(authCheck.expired),
          error:
            authCheck.error ||
            "غير مصرح لك بتنفيذ هذه العملية. يتطلب تسجيل الدخول بحساب إداري نشط.",
        },
        { status: authCheck.expired ? 401 : 403 }
      );
      if (authCheck.expired) {
        clearAdminSessionCookie(res);
      }
      return res;
    }

    const effectiveAdminId = authCheck.profile.id;
    const effectiveAdminName =
      authCheck.profile.fullName || authCheck.profile.phone;

    // تجديد الجلسة التلقائي مع النشاط (Sliding Session Refresh)
    if (action === "refresh_session") {
      const refreshedToken = createAdminSessionToken({
        id: authCheck.profile.id,
        phone: authCheck.profile.phone,
        fullName: authCheck.profile.fullName,
        role: authCheck.profile.role,
        permissions: authCheck.profile.permissions,
      });
      const res = NextResponse.json({
        ok: true,
        sessionToken: refreshedToken,
        lastActivityAt: Date.now(),
      });
      attachAdminSessionCookie(res, refreshedToken);
      return res;
    }

    // حماية موزّعة بوضع fail_closed لجميع العمليات الإدارية الموثقة (60 عملية لكل 10 دقائق لكل مشرف+IP)
    const adminActionIp = getClientIp(req);
    const adminOpLimit = await consumeDistributedRateLimit(
      "admin:action",
      `${effectiveAdminId}:${adminActionIp}`,
      60,
      10 * 60 * 1000,
      "fail_closed"
    );
    if (!adminOpLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            adminOpLimit.source === "fail_closed"
              ? adminOpLimit.reason || "خدمة التحقق الأمني غير متاحة مؤقتاً."
              : "تم تجاوز الحد المسموح للعمليات الإدارية المتتالية. يرجى الانتظار قليلاً.",
          retryAfterSeconds: adminOpLimit.retryAfterSeconds,
        },
        { status: adminOpLimit.source === "fail_closed" ? 503 : 429 }
      );
    }

    // 2. إدارة دورة حياة الملصقات (تعديل المركبة، تبديل الحالة، ضبط المصنع، إعادة تعيين أمان المالك)
    if (
      action === "update_vehicle" ||
      action === "set_status" ||
      action === "factory_reset" ||
      action === "reset_owner_security" ||
      action === "extend_subscription" ||
      action === "delete_tag"
    ) {
      const res = await adminManageTagLifecycle({
        action,
        tagCode: String(body.tagCode || ""),
        adminId: effectiveAdminId,
        adminName: effectiveAdminName,
        status: body.status as TagStatus | undefined,
        vehicleInfo: body.vehicleInfo,
        city: body.city,
        ownerName: body.ownerName,
        ownerPhone: body.ownerPhone,
        alertChannel: body.alertChannel as AlertChannel | undefined,
        planType:
          body.planType === "basic" ||
          body.planType === "nabbihni" ||
          body.planType === "gift"
            ? body.planType
            : undefined,
        newOwnerPin: body.newOwnerPin,
        extendDays:
          typeof body.extendDays === "number"
            ? body.extendDays
            : Number(body.extendDays || 0) || undefined,
      });
      const overview = await getExecutiveAdminOverview();
      return NextResponse.json({
        ...res,
        tags: overview.tags,
        auditLogs: overview.auditLogs,
      });
    }

    // 3. استيراد دفعات المطبعة (CSV / JSON) أو إدخال ملصق مطبوع مفرد
    if (action === "import_tags") {
      const items = Array.isArray(body.items) ? body.items : [];
      const res = await adminImportPrintedTags({
        adminId: effectiveAdminId,
        adminName: effectiveAdminName,
        items,
      });
      const overview = await getExecutiveAdminOverview();
      return NextResponse.json({
        ...res,
        tags: overview.tags,
        auditLogs: overview.auditLogs,
      });
    }

    // إصدار وتوليد دفعة ملصقات جديدة مشفرة بحالة LOCKED (غير مرتبطة بمركبة أو رقم هاتف)
    if (action === "issue_batch") {
      const count =
        typeof body.count === "number" && body.count > 0 ? body.count : 5;
      const res = await adminGenerateNewBatch({
        count,
        adminId: effectiveAdminId,
        adminName: effectiveAdminName,
      });
      const overview = await getExecutiveAdminOverview();
      return NextResponse.json({
        ...res,
        tags: overview.tags,
        auditLogs: overview.auditLogs,
      });
    }

    // 4. التحكم الكامل في فريق المشرفين والصلاحيات بجدول admin_profiles
    if (
      action === "team_add" ||
      action === "team_toggle" ||
      action === "team_reset_password" ||
      action === "team_update_member" ||
      action === "team_delete"
    ) {
      const mappedAction =
        action === "team_add"
          ? "add"
          : action === "team_reset_password"
          ? "reset_password"
          : action === "team_update_member"
          ? "update_member"
          : action === "team_delete"
          ? "delete"
          : "toggle_status";

      const res = await adminManageTeamMember({
        action: mappedAction,
        adminId: effectiveAdminId,
        adminName: effectiveAdminName,
        memberId: body.memberId,
        fullName: body.fullName,
        username: body.username,
        roleTitle: body.roleTitle,
        phone: body.phone,
        password: body.password,
        permissions: body.permissions as AdminPermission[] | undefined,
      });
      const overview = await getExecutiveAdminOverview();
      return NextResponse.json(
        {
          ...res,
          auditLogs: overview.auditLogs,
        },
        { status: res.ok ? 200 : 403 }
      );
    }

    // 5. منطقة الطوارئ وتصفير بيانات الاختبار (Danger Zone)
    if (action === "danger_reset") {
      const resetRes = await adminDangerZoneResetSystem({
        adminId: effectiveAdminId,
        adminName: effectiveAdminName,
        confirmReset: body.confirmReset === true,
        confirmationText:
          typeof body.confirmationText === "string"
            ? body.confirmationText
            : "",
      });
      if (!resetRes.ok) {
        return NextResponse.json(resetRes, {
          status: resetRes.blockedInProduction ? 403 : 400,
        });
      }
      const overview = await getExecutiveAdminOverview();
      return NextResponse.json({
        ok: true,
        summary: resetRes.summary,
        ...overview,
      });
    }

    return NextResponse.json(
      { ok: false, error: "إجراء إداري غير معروف." },
      { status: 400 }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "حدث خطأ في خادم الإدارة." },
      { status: 500 }
    );
  }
}


