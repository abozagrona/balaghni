import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  getTagDashboardData,
  upsertVehicleDocumentForTag,
  addMaintenanceRecordForTag,
  supabaseAdmin,
  syncTagActivationToLocalStore,
} from "@/lib/supabase/client";
import { getStickerLifecycle } from "@/lib/lifecycle-service";
import { formatBalaghniTagCode } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const tagCode = request.nextUrl.searchParams.get("tag") || "";
  if (!tagCode.trim()) {
    return NextResponse.json(
      { ok: false, error: "يرجى تحديد كود الملصق." },
      { status: 400 }
    );
  }

  const [data, lifecycle] = await Promise.all([
    getTagDashboardData(tagCode.trim()),
    getStickerLifecycle(tagCode.trim()),
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

    if (action === "update_owner_profile") {
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

      try {
        const stickerUpdate: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
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

      if (vehicleInfo || city || ownerPhone) {
        const existingLifecycle = await getStickerLifecycle(tagCode);
        const planType = existingLifecycle?.planType || "basic";
        syncTagActivationToLocalStore({
          tagCode,
          ownerPhone: ownerPhone || existingLifecycle?.ownerPhone || "",
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

      return NextResponse.json({
        ok: true,
        tag: updatedData.tag,
        lifecycle: updatedLifecycle,
      });
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
