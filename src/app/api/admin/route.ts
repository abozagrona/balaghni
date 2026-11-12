import { NextRequest, NextResponse } from "next/server";
import {
  supabase,
  supabaseAdmin,
  verifyAdminAuthentication,
  verifyAdminActionPermission,
  verifyAdminSessionToken,
  createAdminSessionToken,
  ADMIN_COOKIE_MAX_AGE_SECONDS,
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

export async function GET(req: NextRequest) {
  try {
    // التحقق الصارم من حالة الجلسة وانتهاء الصلاحية من جهة الخادم
    const authHeader = req.headers.get("authorization") || "";
    const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const cookieToken =
      req.cookies.get("balaghni_admin_session")?.value || "";
    const candidateToken = bearerToken || cookieToken;

    if (candidateToken) {
      const sessionCheck = verifyAdminSessionToken(candidateToken);
      if (sessionCheck.expired) {
        const res = NextResponse.json(
          {
            ok: false,
            sessionExpired: true,
            error: "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً.",
          },
          { status: 401 }
        );
        res.cookies.set("balaghni_admin_session", "", {
          path: "/",
          maxAge: 0,
          expires: new Date(0),
        });
        return res;
      }
    }

    const identifier = req.nextUrl.searchParams.get("identifier") || "";
    const authStatus = await verifyAdminAuthentication({
      mode: "status",
      identifier,
    });
    const overview = await getExecutiveAdminOverview();

    return NextResponse.json({
      ok: true,
      authStatus: {
        lockedUntilIso: authStatus.lockedUntilIso,
        remainingAttempts: authStatus.remainingAttempts,
      },
      ...overview,
    });
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
    const adminName = String(body.adminName || "مدير النظام الرئيسي").trim();
    const adminId = body.adminId ? String(body.adminId).trim() : null;

    // أ) جلب قائمة بجميع passkey_credential_id المسجلة والنشطة في جدول admin_profiles (بدون اشتراط رقم هاتف)
    if (
      (action === "auth" && body.mode === "lookup_passkey" && !body.identifier) ||
      (body.mode === "lookup_passkey" && !body.identifier)
    ) {
      const { data, error } = await supabaseAdmin
        .from("admin_profiles")
        .select("passkey_credential_id")
        .not("passkey_credential_id", "is", null)
        .eq("is_active", true);

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
    }

    // د) البحث عن المشرف عبر معرّف البصمة فقط (دون اشتراط وجود phone في الطلب نهائياً) وفتح الجلسة فوراً
    if (
      (action === "auth" && body.mode === "passkey_login") ||
      Boolean(body.credential_id && !body.password)
    ) {
      const credentialId = String(
        body.credential_id || body.credentialId || body.passkeyCredentialId || ""
      ).trim();

      if (!credentialId) {
        return NextResponse.json(
          { ok: false, error: "معرّف البصمة غير صالح." },
          { status: 400 }
        );
      }

      const { data: adminProfile, error } = await supabaseAdmin
        .from("admin_profiles")
        .select("*")
        .eq("passkey_credential_id", credentialId)
        .eq("is_active", true)
        .single();

      if (error || !adminProfile) {
        return NextResponse.json(
          {
            ok: false,
            error: "لم يتم العثور على حساب مشرف نشط مطابق لهذه البصمة.",
          },
          { status: 401 }
        );
      }

      const nowIso = new Date().toISOString();
      try {
        await supabaseAdmin
          .from("admin_profiles")
          .update({ last_login: nowIso })
          .eq("id", adminProfile.id);
      } catch {
        // ignore
      }

      let permissions: AdminPermission[] = [];
      if (Array.isArray(adminProfile.permissions)) {
        permissions = adminProfile.permissions.map((x: any) =>
          x === "import_tags" ? "import_batches" : (x as AdminPermission)
        );
      } else if (
        adminProfile.permissions &&
        typeof adminProfile.permissions === "object"
      ) {
        const obj = adminProfile.permissions as Record<string, boolean>;
        if (obj.manage_reports) permissions.push("manage_reports");
        if (obj.manage_tags) permissions.push("manage_tags");
        if (obj.import_tags || obj.import_batches)
          permissions.push("import_batches");
        if (obj.manage_admins) permissions.push("manage_admins");
        if (obj.danger_zone) permissions.push("danger_zone");
        if (obj.can_live_edit) permissions.push("can_live_edit");
      }

      if (adminProfile.role === "SUPER_ADMIN") {
        if (permissions.length === 0) {
          permissions = [
            "manage_reports",
            "manage_tags",
            "import_batches",
            "manage_admins",
            "danger_zone",
            "can_live_edit",
          ];
        } else if (!permissions.includes("can_live_edit")) {
          permissions.push("can_live_edit");
        }
      }

      const formattedProfile = {
        id: adminProfile.id,
        fullName: adminProfile.full_name || adminProfile.phone,
        username: adminProfile.username || adminProfile.phone,
        phone: adminProfile.phone,
        role: adminProfile.role || "SUPER_ADMIN",
        permissions,
        mustChangePassword: false,
        passkeyCredentialId: adminProfile.passkey_credential_id,
        isActive: Boolean(adminProfile.is_active),
        lastLogin: nowIso,
        createdAt: adminProfile.created_at,
      };

      const sessionToken = createAdminSessionToken(formattedProfile);

      const response = NextResponse.json({
        ok: true,
        remainingAttempts: 4,
        adminProfile: formattedProfile,
        sessionToken,
      });
      response.cookies.set("balaghni_admin_session", sessionToken, {
        path: "/",
        maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS,
        sameSite: "lax",
      });
      return response;
    }

    // 1. المصادقة المؤسسية للمشرفين وتغيير كلمة المرور (password_login / enroll_passkey / change_own_password / status)
    if (action === "auth") {
      const mode = body.mode as
        | "lookup_passkey"
        | "passkey_login"
        | "password_login"
        | "enroll_passkey"
        | "unlink_passkey"
        | "change_own_password"
        | "status";
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
        response.cookies.set("balaghni_admin_session", res.sessionToken, {
          path: "/",
          maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS,
          sameSite: "lax",
        });
        return response;
      }

      return NextResponse.json(res, { status: res.ok ? 200 : 401 });
    }

    // التحقق الأمني الصارم من صلاحيات المشرف من جهة الخادم لجميع العمليات الإدارية
    const authHeader = req.headers.get("authorization") || "";
    const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const xAdminId =
      req.headers.get("x-admin-id") || req.headers.get("x-admin-token") || "";
    const cookieToken =
      req.cookies.get("balaghni_admin_session")?.value || "";
    const bodyToken = String(body.sessionToken || body.adminId || "").trim();

    const candidateToken = bearerToken || xAdminId || bodyToken || cookieToken;

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
        res.cookies.set("balaghni_admin_session", "", {
          path: "/",
          maxAge: 0,
          expires: new Date(0),
        });
      }
      return res;
    }

    const effectiveAdminId = authCheck.profile.id;
    const effectiveAdminName =
      authCheck.profile.fullName || authCheck.profile.phone;

    // 2. إدارة دورة حياة الملصقات (تعديل المركبة، تبديل الحالة، ضبط المصنع، إعادة تعيين أمان المالك)
    if (
      action === "update_vehicle" ||
      action === "set_status" ||
      action === "factory_reset" ||
      action === "reset_owner_security" ||
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
        ownerPhone: body.ownerPhone,
        alertChannel: body.alertChannel as AlertChannel | undefined,
        newOwnerPin: body.newOwnerPin,
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

    // 4. التحكم الكامل في فريق المشرفين والصلاحيات بجدول admin_profiles (إنشاء بتوليد تلقائي، إعادة تعيين كلمة السر، تعديل صلاحيات، تجميد، حذف)
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
      return NextResponse.json({
        ...res,
        auditLogs: overview.auditLogs,
      });
    }

    // 5. منطقة الطوارئ وتصفير بيانات الاختبار (Danger Zone)
    if (action === "danger_reset") {
      await adminDangerZoneResetSystem({
        adminId: effectiveAdminId,
        adminName: effectiveAdminName,
      });
      const overview = await getExecutiveAdminOverview();
      return NextResponse.json({
        ok: true,
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

