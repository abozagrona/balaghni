import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  getTagDashboardData,
  upsertVehicleDocumentForTag,
  addMaintenanceRecordForTag,
  supabaseAdmin,
  syncTagActivationToLocalStore,
  verifyAdminActionPermission,
} from "@/lib/supabase/client";
import { getStickerLifecycle } from "@/lib/lifecycle-service";
import { formatBalaghniTagCode } from "@/lib/utils";
import {
  verifyOwnerSessionFromRequest,
  attachOwnerSessionCookie,
  createOwnerSessionToken,
} from "@/lib/security-tokens";

async function authorizeDashboardTagAccess(
  request: NextRequest,
  requestedTagCode: string
): Promise<{
  authorized: boolean;
  isSuperAdmin: boolean;
  ownerPhone?: string;
  expired?: boolean;
}> {
  const formattedTarget = formatBalaghniTagCode(requestedTagCode);

  // 1. التحقق من جلسة المالك الموقّعة
  const ownerSession = verifyOwnerSessionFromRequest(request);
  if (ownerSession.valid && ownerSession.payload) {
    const sessionTag = formatBalaghniTagCode(ownerSession.payload.tagCode);
    if (sessionTag === formattedTarget) {
      return {
        authorized: true,
        isSuperAdmin: false,
        ownerPhone: ownerSession.payload.ownerPhone,
      };
    }

    // السماح للمالك الذي يمتلك أكثر من ملصق مسجل بنفس رقم هاتفه بالوصول لملصقاته
    const sessionPhoneDigits = ownerSession.payload.ownerPhone
      .replace(/[^\d]/g, "")
      .slice(-9);
    if (sessionPhoneDigits) {
      const targetData = await getTagDashboardData(formattedTarget);
      const targetPhoneDigits = String(targetData.tag?.ownerPhone || "")
        .replace(/[^\d]/g, "")
        .slice(-9);
      if (targetPhoneDigits && targetPhoneDigits === sessionPhoneDigits) {
        return {
          authorized: true,
          isSuperAdmin: false,
          ownerPhone: ownerSession.payload.ownerPhone,
        };
      }
    }
  }

  // 2. التحقق من جلسة المشرف الموقّعة (للسماح للمدير بمراجعة الملصق عند الحاجة)
  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const adminCookie = request.cookies.get("balaghni_admin_session")?.value || "";
  const adminToken = bearer || adminCookie;
  if (adminToken) {
    const adminCheck = await verifyAdminActionPermission(adminToken, "manage_tags");
    if (adminCheck.authorized && adminCheck.profile) {
      return {
        authorized: true,
        isSuperAdmin: adminCheck.profile.role === "SUPER_ADMIN",
      };
    }
  }

  return {
    authorized: false,
    isSuperAdmin: false,
    expired: ownerSession.expired,
  };
}

export async function GET(request: NextRequest) {
  const rawTag = request.nextUrl.searchParams.get("tag") || "";
  const tagCode = formatBalaghniTagCode(rawTag.trim());
  if (!tagCode) {
    return NextResponse.json(
      { ok: false, error: "يرجى تحديد كود الملصق." },
      { status: 400 }
    );
  }

  const auth = await authorizeDashboardTagAccess(request, tagCode);
  if (!auth.authorized) {
    return NextResponse.json(
      {
        ok: false,
        sessionExpired: Boolean(auth.expired),
        error:
          "غير مصرح لك بالوصول لبيانات هذه المركبة. يرجى تسجيل الدخول بحساب مالك الملصق أولاً.",
      },
      { status: 401 }
    );
  }

  const [data, lifecycle] = await Promise.all([
    getTagDashboardData(tagCode),
    getStickerLifecycle(tagCode),
  ]);
  if (!data.ok || !data.tag) {
    return NextResponse.json(
      { ok: false, error: data.error || "الملصق غير موجود في قاعدة البيانات." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    tag: data.tag,
    documents: data.documents,
    reports: data.reports,
    maintenance: data.maintenance,
    lifecycle,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    const tagCode = formatBalaghniTagCode(String(body.tagCode || ""));

    if (!tagCode) {
      return NextResponse.json(
        { ok: false, error: "كود الملصق مطلوب." },
        { status: 400 }
      );
    }

    const auth = await authorizeDashboardTagAccess(request, tagCode);
    if (!auth.authorized) {
      return NextResponse.json(
        {
          ok: false,
          sessionExpired: Boolean(auth.expired),
          error:
            "غير مصرح لك بتعديل بيانات هذه المركبة. يرجى تسجيل الدخول بحساب المالك أولاً.",
        },
        { status: 401 }
      );
    }

    if (action === "update_owner_profile") {
      const ownerName =
        body.ownerName !== undefined ? String(body.ownerName).trim() : undefined;
      const vehicleInfo =
        body.vehicleInfo !== undefined ? String(body.vehicleInfo).trim() : undefined;
      const city = body.city !== undefined ? String(body.city).trim() : undefined;
      const ownerPhone =
        body.ownerPhone !== undefined ? String(body.ownerPhone).trim() : undefined;
      const newPin =
        body.newPin !== undefined && String(body.newPin).trim().length >= 4
          ? String(body.newPin).trim()
          : undefined;

      const updateFields: Record<string, unknown> = {};
      if (vehicleInfo !== undefined) updateFields.vehicle_make_model = vehicleInfo;
      if (city !== undefined) updateFields.vehicle_city = city;
      if (ownerPhone !== undefined && ownerPhone.length > 0) {
        updateFields.owner_phone = ownerPhone;
      }
      if (newPin) {
        updateFields.owner_pin_hash = crypto
          .createHash("sha256")
          .update(newPin)
          .digest("hex");
      }

      if (Object.keys(updateFields).length > 0) {
        await supabaseAdmin
          .from("tags")
          .update(updateFields)
          .eq("tag_code", tagCode);
      }

      if (ownerName !== undefined) {
        try {
          await supabaseAdmin
            .from("tags")
            .update({ owner_name: ownerName || null })
            .eq("tag_code", tagCode);
        } catch {
          // ignore if column missing
        }
        try {
          await supabaseAdmin.from("admin_audit_logs").insert({
            admin_name: ownerName || "مالك المركبة",
            action_type: "OWNER_PROFILE_UPDATED",
            target_item: tagCode,
            details: JSON.stringify({
              tagCode,
              ownerName: ownerName || null,
            }),
            created_at: new Date().toISOString(),
          });
        } catch {
          // ignore
        }
      }

      try {
        const stickerUpdate: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (ownerName !== undefined) stickerUpdate.owner_name = ownerName || null;
        if (vehicleInfo !== undefined) stickerUpdate.vehicle_info = vehicleInfo;
        if (ownerPhone !== undefined && ownerPhone.length > 0) {
          stickerUpdate.owner_phone = ownerPhone;
        }
        await supabaseAdmin
          .from("stickers")
          .update(stickerUpdate)
          .eq("code", tagCode);
      } catch {
        // ignore
      }

      if (ownerName !== undefined || vehicleInfo || city || ownerPhone) {
        const existingLifecycle = await getStickerLifecycle(tagCode);
        const planType = existingLifecycle?.planType || "basic";
        syncTagActivationToLocalStore({
          tagCode,
          ownerPhone: ownerPhone || existingLifecycle?.ownerPhone || "",
          ownerName: ownerName !== undefined ? ownerName : existingLifecycle?.ownerName || undefined,
          vehicleInfo: vehicleInfo || existingLifecycle?.vehicleInfo || "مركبة مسجلة",
          city: city || "طرابلس",
          alertChannel:
            planType === "basic" ? "WHATSAPP" : planType === "gift" ? "SMS" : "BOTH",
          packageType: planType,
          activationSource: existingLifecycle?.activationSource || "online",
          subscriptionStartsAt: existingLifecycle?.subscriptionStartsAt || undefined,
          subscriptionExpiresAt: existingLifecycle?.subscriptionExpiresAt || undefined,
        });
      }

      const [updatedData, updatedLifecycle] = await Promise.all([
        getTagDashboardData(tagCode),
        getStickerLifecycle(tagCode),
      ]);

      const response = NextResponse.json({
        ok: true,
        tag: updatedData.tag,
        lifecycle: updatedLifecycle,
      });

      // تحديث كوكي جلسة المالك في حال تغير رقم الهاتف
      if (ownerPhone && !auth.isSuperAdmin) {
        const newToken = createOwnerSessionToken({
          tagCode,
          ownerPhone,
        });
        attachOwnerSessionCookie(response, newToken, tagCode);
      }

      return response;
    }

    if (action === "upsert_document") {
      const title = String(body.title || "").trim();
      const subtitle = String(body.subtitle || "").trim();
      const expiryDate = String(body.expiryDate || "").trim();
      const id = body.id ? String(body.id).trim() : undefined;

      if (!title || !expiryDate) {
        return NextResponse.json(
          { ok: false, error: "عنوان الوثيقة وتاريخ الانتهاء مطلوبان." },
          { status: 400 }
        );
      }

      const res = await upsertVehicleDocumentForTag({
        tagCode,
        id,
        title,
        subtitle,
        expiryDate,
      });

      return NextResponse.json(res);
    }

    if (action === "add_maintenance") {
      const serviceType = String(body.serviceType || "").trim();
      const date = String(body.date || "").trim();
      const mileageKm = String(body.mileageKm || "").trim();
      const costLyd = Number(body.costLyd || 0);
      const workshop = String(body.workshop || "").trim();
      const notes = String(body.notes || "").trim();

      if (!serviceType || !date) {
        return NextResponse.json(
          { ok: false, error: "نوع الصيانة والتاريخ مطلوبان." },
          { status: 400 }
        );
      }

      const res = await addMaintenanceRecordForTag({
        tagCode,
        serviceType,
        date,
        mileageKm,
        costLyd,
        workshop,
        notes,
      });

      return NextResponse.json(res);
    }

    return NextResponse.json(
      { ok: false, error: "عملية غير معروفة." },
      { status: 400 }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر حفظ البيانات في الخادم." },
      { status: 500 }
    );
  }
}

