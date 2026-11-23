import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, verifyAdminActionPermission } from "@/lib/supabase/client";
import {
  consumeDistributedRateLimit,
  getClientIp,
  canonicalizeRateIp,
} from "@/lib/rate-limiter";
import {
  assertDestructiveLifecycleWipeAllowed,
  assignOrderToSticker,
  assignStickersToVendor,
  assignUnassignedPaidOrderToSticker,
  cancelCodOrder,
  closeCashCustody,
  confirmCodOrderDelivery,
  convertTagToGift,
  createCorporatePackageAccount,
  createVendor,
  getSalesAndTreasurySummary,
  getVendorInventory,
  importGiftStickers,
  importStickerCodes,
  LIFECYCLE_WIPE_CONFIRMATION_TEXT,
  LIFECYCLE_WIPE_GLOBAL_LOCK_KEY,
  listAllOrders,
  listAvailableStickers,
  listCorporateLeads,
  listGiftStickersSummary,
  listUnassignedPaidOrders,
  listVendors,
  recordGiftStickersImportAuditLog,
  recordLifecycleWipeAuditLog,
  settleVendorMonth,
  syncCodOrderToTreasury,
  wipeAllOldData,
} from "@/lib/lifecycle-service";
import type { PackageFeatures } from "@/lib/packages";

function normalizeCodeArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((s) => String(s).trim()).filter(Boolean);
  }
  return String(input || "")
    .split(/[\s,;،\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getAdminAuth(
  req: NextRequest,
  bodySessionToken?: unknown
): Promise<{
  authorized: boolean;
  isSuperAdmin: boolean;
  adminId: string;
  adminName: string;
}> {
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const xAdminToken = req.headers.get("x-admin-token") || "";
  const cookie = req.cookies.get("balaghni_admin_session")?.value || "";
  const bodyToken =
    typeof bodySessionToken === "string" ? bodySessionToken.trim() : "";
  const token = bearer || xAdminToken || bodyToken || cookie;
  if (!token) {
    return {
      authorized: false,
      isSuperAdmin: false,
      adminId: "unknown_admin",
      adminName: "مشرف النظام",
    };
  }
  const check = await verifyAdminActionPermission(token, "status");
  return {
    authorized: check.authorized && Boolean(check.profile),
    isSuperAdmin:
      check.authorized && check.profile?.role === "SUPER_ADMIN",
    adminId: check.profile?.id || check.profile?.phone || "unknown_admin",
    adminName: check.profile?.fullName || check.profile?.phone || "مشرف النظام",
  };
}

export async function GET(req: NextRequest) {
  const auth = await getAdminAuth(req);
  if (!auth.authorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [
    vendors,
    corporateLeads,
    unassignedPaidOrders,
    orders,
    availableStickers,
    giftSummary,
    treasury,
  ] = await Promise.all([
    listVendors(),
    listCorporateLeads(),
    listUnassignedPaidOrders(),
    listAllOrders(),
    listAvailableStickers(),
    auth.isSuperAdmin ? listGiftStickersSummary() : Promise.resolve(null),
    getSalesAndTreasurySummary(),
  ]);

  const vendorSummaries = await Promise.all(
    vendors.map(async (v) => ({
      ...v,
      inventory: await getVendorInventory(v.id),
    }))
  );

  return NextResponse.json({
    ok: true,
    vendors: vendorSummaries,
    corporateLeads,
    unassignedPaidOrders,
    orders,
    availableStickers,
    giftSummary,
    treasury,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const auth = await getAdminAuth(req, body.sessionToken);
    if (!auth.authorized) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const action = String(body.action || "");

    // حماية موزّعة بوضع fail_closed لعمليات POST التشغيلية (60 عملية لكل 10 دقائق لكل مشرف+IP)
    // بينما تحتفظ عملية wipe_all_old_data بقفلها الخاص الأشد صرامة (1 لكل 10 دقائق + حظر بيئي)
    if (action !== "wipe_all_old_data") {
      const clientIp = canonicalizeRateIp(getClientIp(req)) || "127.0.0.1";
      const opLimit = await consumeDistributedRateLimit(
        "admin:lifecycle:action",
        `${auth.adminId}:${clientIp}`,
        60,
        10 * 60 * 1000,
        "fail_closed"
      );
      if (!opLimit.allowed) {
        return NextResponse.json(
          {
            ok: false,
            error:
              opLimit.source === "fail_closed"
                ? opLimit.reason || "خدمة التحقق الأمني غير متاحة مؤقتاً."
                : "تم تجاوز الحد المسموح للعمليات الإدارية المتتالية. يرجى الانتظار قليلاً.",
            retryAfterSeconds: opLimit.retryAfterSeconds,
          },
          { status: opLimit.source === "fail_closed" ? 503 : 429 }
        );
      }
    }

    if (action === "import_stickers") {
      const codes = normalizeCodeArray(body.codes);
      const res = await importStickerCodes(codes);
      return NextResponse.json(
        {
          ...res,
          message: res.ok
            ? `تم استيراد ${res.importedCount} ملصق جديد بحالة unactivated بنجاح.`
            : res.error,
        },
        { status: res.ok ? 200 : 400 }
      );
    }

    if (action === "assign_order_sticker") {
      const res = await assignOrderToSticker(
        String(body.orderId || body.orderCode || ""),
        String(body.stickerCode || body.code || "")
      );
      return NextResponse.json(
        {
          ...res,
          message: res.ok
            ? "تم ربط الملصق بالطلب وتفعيله وإرسال رسالة واتساب للزبون بنجاح."
            : res.error,
        },
        { status: res.ok ? 200 : 400 }
      );
    }

    if (action === "wipe_all_old_data") {
      if (!auth.isSuperAdmin) {
        await recordLifecycleWipeAuditLog({
          adminId: auth.adminId,
          adminName: auth.adminName,
          actionType: "LIFECYCLE_WIPE_BLOCKED",
          outcome: "blocked",
          attemptType: "unauthorized_role",
          reason: "non_super_admin",
        });
        return NextResponse.json(
          { ok: false, error: "عملية مسح البيانات مقتصرة على مدير النظام الرئيسي فقط." },
          { status: 403 }
        );
      }

      const envGuard = assertDestructiveLifecycleWipeAllowed();
      if (!envGuard.allowed) {
        await recordLifecycleWipeAuditLog({
          adminId: auth.adminId,
          adminName: auth.adminName,
          actionType: "LIFECYCLE_WIPE_BLOCKED",
          outcome: "blocked",
          attemptType: "environment_guard",
          reason: envGuard.reason,
        });
        return NextResponse.json(
          {
            ok: false,
            blockedByEnvironment: true,
            error: envGuard.reason,
          },
          { status: 403 }
        );
      }

      const confirmWipe = body.confirmWipe === true;
      const confirmationText =
        typeof body.confirmationText === "string"
          ? body.confirmationText.trim()
          : "";

      if (!confirmWipe || confirmationText !== LIFECYCLE_WIPE_CONFIRMATION_TEXT) {
        await recordLifecycleWipeAuditLog({
          adminId: auth.adminId,
          adminName: auth.adminName,
          actionType: "LIFECYCLE_WIPE_BLOCKED",
          outcome: "blocked",
          attemptType: "missing_confirmation",
          reason: "missing_or_invalid_confirmation_text",
        });
        return NextResponse.json(
          {
            ok: false,
            requiresConfirmation: true,
            error: `يتطلب تنفيذ المسح تأكيداً صريحاً (confirmWipe=true وعبارة التأكيد ${LIFECYCLE_WIPE_CONFIRMATION_TEXT}).`,
          },
          { status: 400 }
        );
      }

      // قفل موزّع ذري شامل على مستوى النظام (global_system_wipe) بوضع fail_closed
      // يمنع أي Super Admin آخر من تشغيل عملية المسح بالتزامن
      const wipeLock = await consumeDistributedRateLimit(
        "admin:lifecycle:wipe",
        LIFECYCLE_WIPE_GLOBAL_LOCK_KEY,
        1,
        10 * 60 * 1000,
        "fail_closed"
      );
      if (!wipeLock.allowed) {
        await recordLifecycleWipeAuditLog({
          adminId: auth.adminId,
          adminName: auth.adminName,
          actionType: "LIFECYCLE_WIPE_BLOCKED",
          outcome: "blocked",
          attemptType:
            wipeLock.source === "fail_closed"
              ? "lock_service_unavailable"
              : "concurrent_or_cooldown_lock",
          reason: wipeLock.reason || "global_wipe_lock_active",
        });
        return NextResponse.json(
          {
            ok: false,
            error:
              wipeLock.source === "fail_closed"
                ? wipeLock.reason || "خدمة التحقق الأمني غير متاحة مؤقتاً. تم إيقاف العملية بأمان."
                : "تم تنفيذ أو طلب عملية المسح على مستوى النظام خلال الدقائق العشر الأخيرة. يرجى الانتظار.",
            retryAfterSeconds: wipeLock.retryAfterSeconds,
          },
          { status: wipeLock.source === "fail_closed" ? 503 : 429 }
        );
      }

      const res = await wipeAllOldData({
        adminId: auth.adminId,
        adminName: auth.adminName,
      });
      if (!res.ok) {
        return NextResponse.json(
          {
            ok: false,
            blockedByEnvironment: res.blockedByEnvironment,
            auditLogFailed: res.auditLogFailed,
            error: res.error || "تعذر تنفيذ عملية مسح البيانات.",
          },
          { status: res.blockedByEnvironment ? 403 : res.auditLogFailed ? 503 : 500 }
        );
      }

      return NextResponse.json({
        ...res,
        message: `تم مسح كافة البيانات القديمة بنجاح (${res.clearedTables.join("، ")}) مع الإبقاء على حساب الأدمن الرئيسي وسجل التدقيق.`,
      });
    }

    if (action === "create_vendor") {
      const res = await createVendor({
        name: String(body.name || ""),
        phone: String(body.phone || ""),
        city: String(body.city || "طرابلس"),
        pin: body.pin ? String(body.pin) : undefined,
      });
      return NextResponse.json(res);
    }

    if (action === "assign_vendor_stickers") {
      const codes = normalizeCodeArray(body.codes);
      const res = await assignStickersToVendor(String(body.vendorId || ""), codes);
      return NextResponse.json(res);
    }

    if (action === "settle_vendor_month") {
      const res = await settleVendorMonth(
        String(body.vendorId || ""),
        String(body.notes || "")
      );
      return NextResponse.json(res);
    }

    if (action === "import_gift_stickers") {
      const codes = normalizeCodeArray(body.codes);
      if (!auth.isSuperAdmin) {
        await recordGiftStickersImportAuditLog({
          adminId: auth.adminId,
          adminName: auth.adminName,
          actionType: "GIFT_STICKERS_IMPORT_BLOCKED",
          outcome: "blocked",
          importedCount: 0,
          requestedCount: codes.length,
          reason: "non_super_admin",
        });
        return NextResponse.json(
          { ok: false, error: "هذا القسم حصري لمدير النظام الرئيسي فقط." },
          { status: 403 }
        );
      }
      const res = await importGiftStickers(codes, {
        adminId: auth.adminId,
        adminName: auth.adminName,
      });
      return NextResponse.json(
        {
          ...res,
          message: res.ok
            ? `تم استيراد وتفعيل ${res.importedCount} ملصق هدية (شهر مجاني) بنجاح.`
            : res.error,
        },
        { status: res.ok ? 200 : res.auditLogFailed ? 503 : 400 }
      );
    }

    if (action === "create_corporate_account") {
      const codes = normalizeCodeArray(body.codes);
      const features: PackageFeatures = {
        whatsapp: Boolean(body.features?.whatsapp ?? true),
        sms_fallback: Boolean(body.features?.sms_fallback),
        nabbihni_reminders: Boolean(body.features?.nabbihni_reminders),
        photo_attachments: Boolean(body.features?.photo_attachments),
        emergency_portal: Boolean(body.features?.emergency_portal),
      };
      const res = await createCorporatePackageAccount({
        companyName: String(body.companyName || ""),
        city: String(body.city || "طرابلس"),
        ownerPhone: String(body.phone || body.ownerPhone || ""),
        agreedAmountLyd: Number(body.agreedAmountLyd || 0),
        features,
        stickerCodes: codes,
      });
      return NextResponse.json(res);
    }

    if (action === "assign_unassigned_paid") {
      const res = await assignUnassignedPaidOrderToSticker(
        String(body.orderId || body.orderRef || ""),
        String(body.stickerCode || body.code || "")
      );
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }

    if (action === "reset_order_subscription_start") {
      const orderId = String(body.orderId || "");
      const startIso = body.startIso
        ? new Date(String(body.startIso)).toISOString()
        : new Date().toISOString();
      const expDate = new Date(startIso);
      expDate.setUTCDate(expDate.getUTCDate() + 365);
      const expiresIso = expDate.toISOString();

      await supabaseAdmin
        .from("orders")
        .update({
          subscription_starts_at: startIso,
          subscription_expires_at: expiresIso,
        })
        .eq("id", orderId);

      if (body.tagCode) {
        await supabaseAdmin
          .from("stickers")
          .update({
            subscription_starts_at: startIso,
            subscription_expires_at: expiresIso,
          })
          .eq("code", String(body.tagCode).toUpperCase().trim());
      }

      return NextResponse.json({
        ok: true,
        subscriptionStartsAt: startIso,
        subscriptionExpiresAt: expiresIso,
      });
    }

    if (action === "confirm_cod_delivery") {
      const res = await confirmCodOrderDelivery({
        orderId: body.orderId ? String(body.orderId) : undefined,
        orderCode: body.orderCode ? String(body.orderCode) : undefined,
      });
      return NextResponse.json(
        {
          ...res,
          message: res.ok
            ? `تم تأكيد التسليم والدفع وتفعيل الملصق (${res.stickerCode}) وإرسال رسالة التفعيل للزبون ✓`
            : res.error,
        },
        { status: res.ok ? 200 : 400 }
      );
    }

    if (action === "cancel_cod_order") {
      const res = await cancelCodOrder({
        orderId: body.orderId ? String(body.orderId) : undefined,
        orderCode: body.orderCode ? String(body.orderCode) : undefined,
      });
      return NextResponse.json(
        {
          ...res,
          message: res.ok
            ? `تم إلغاء الطلب وإعادة الملصق (${res.stickerCode || "—"}) إلى المخزون بحالة LOCKED ✓`
            : res.error,
        },
        { status: res.ok ? 200 : 400 }
      );
    }

    if (action === "convert_to_gift") {
      const res = await convertTagToGift({
        tagCode: String(body.tagCode || ""),
        adminName: auth.adminName,
      });
      return NextResponse.json(
        {
          ...res,
          message: res.ok
            ? `تم تحويل الملصق (${res.tagCode}) إلى ملصق هدية (شهر مجاني - 30 يوماً) ونقله إلى تبويب الهدايا ✓`
            : res.error,
        },
        { status: res.ok ? 200 : 400 }
      );
    }

    if (action === "close_cash_custody") {
      const res = await closeCashCustody({
        adminName: auth.adminName,
      });
      return NextResponse.json(
        {
          ...res,
          message: res.ok
            ? `تم إغلاق العهدة النقدية وتصفية الكاش (${res.closure?.totalLyd || 0} د.ل) بنجاح ✓`
            : res.error,
        },
        { status: res.ok ? 200 : 400 }
      );
    }

    if (action === "sync_cod_to_treasury") {
      const res = await syncCodOrderToTreasury({
        orderId: body.orderId ? String(body.orderId) : undefined,
        orderCode: body.orderCode ? String(body.orderCode) : undefined,
        adminName: auth.adminName,
      });
      return NextResponse.json(
        {
          ...res,
          message: res.ok
            ? "تم تأكيد استلام الكاش وترحيل المعاملة إلى الخزينة وعهدة الكاش ✓"
            : res.error,
        },
        { status: res.ok ? 200 : 400 }
      );
    }

    return NextResponse.json({ ok: false, error: "إجراء غير مدعوم." }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
