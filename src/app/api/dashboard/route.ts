import { NextRequest, NextResponse } from "next/server";
import {
  getTagDashboardData,
  upsertVehicleDocumentForTag,
  addMaintenanceRecordForTag,
} from "@/lib/supabase/client";

export async function GET(request: NextRequest) {
  const tagCode = request.nextUrl.searchParams.get("tag") || "";
  if (!tagCode.trim()) {
    return NextResponse.json(
      { ok: false, error: "يرجى تحديد كود الملصق." },
      { status: 400 }
    );
  }

  const data = await getTagDashboardData(tagCode.trim());
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
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    const tagCode = String(body.tagCode || "").trim();

    if (!tagCode) {
      return NextResponse.json(
        { ok: false, error: "كود الملصق مطلوب." },
        { status: 400 }
      );
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
