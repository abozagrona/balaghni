import { NextRequest, NextResponse } from "next/server";
import {
  authenticateVendor,
  getVendorInventory,
  listVendors,
  vendorActivateCashSticker,
} from "@/lib/lifecycle-service";
import { normalizePackageType } from "@/lib/packages";
import { formatFullLibyaE164 } from "@/lib/utils";

const VENDOR_COOKIE = "balaghni_vendor_id";

export async function GET(req: NextRequest) {
  const vendorId = req.cookies.get(VENDOR_COOKIE)?.value || "";
  if (!vendorId) {
    return NextResponse.json({ ok: false, authenticated: false }, { status: 401 });
  }

  const vendors = await listVendors();
  const vendor = vendors.find((v) => v.id === vendorId && v.isActive);
  if (!vendor) {
    return NextResponse.json({ ok: false, authenticated: false }, { status: 401 });
  }

  const inventory = await getVendorInventory(vendor.id);
  return NextResponse.json({
    ok: true,
    authenticated: true,
    vendor: {
      id: vendor.id,
      name: vendor.name,
      phone: vendor.phone,
      city: vendor.city,
    },
    inventory,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "logout") {
      const res = NextResponse.json({ ok: true });
      res.cookies.delete(VENDOR_COOKIE);
      return res;
    }

    if (action === "login") {
      const phone = String(body.phone || "").trim();
      const pin = String(body.pin || "").trim();
      const auth = await authenticateVendor(phone, pin);
      if (!auth.ok || !auth.vendor) {
        return NextResponse.json(
          { ok: false, error: auth.error || "تعذر تسجيل الدخول." },
          { status: 401 }
        );
      }

      const inventory = await getVendorInventory(auth.vendor.id);
      const res = NextResponse.json({
        ok: true,
        vendor: {
          id: auth.vendor.id,
          name: auth.vendor.name,
          phone: auth.vendor.phone,
          city: auth.vendor.city,
        },
        inventory,
      });
      res.cookies.set(VENDOR_COOKIE, auth.vendor.id, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      return res;
    }

    if (action === "activate_cash") {
      const vendorId = req.cookies.get(VENDOR_COOKIE)?.value || "";
      if (!vendorId) {
        return NextResponse.json(
          { ok: false, error: "يرجى تسجيل الدخول كـ تاجر أولاً." },
          { status: 401 }
        );
      }

      const customerPhone = formatFullLibyaE164(String(body.customerPhone || ""));
      if (!customerPhone) {
        return NextResponse.json(
          { ok: false, error: "يرجى إدخال رقم هاتف ليبي صحيح للزبون." },
          { status: 400 }
        );
      }

      const code = String(body.code || "").trim();
      const customerName = String(body.customerName || "").trim() || "عميل كاش";
      const packageType = normalizePackageType(body.packageType);

      const activation = await vendorActivateCashSticker({
        vendorId,
        code,
        packageType,
        customerPhone,
        customerName,
      });

      if (!activation.ok) {
        return NextResponse.json(
          { ok: false, error: activation.error },
          { status: 400 }
        );
      }

      const inventory = await getVendorInventory(vendorId);
      return NextResponse.json({
        ok: true,
        sticker: activation.sticker,
        inventory,
      });
    }

    return NextResponse.json({ ok: false, error: "إجراء غير مدعوم." }, { status: 400 });
  } catch {
    return NextResponse.json(
      { ok: false, error: "حدث خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
