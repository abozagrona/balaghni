import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, verifyAdminSessionToken } from "@/lib/supabase/client";
import {
  assignStickersToVendor,
  assignUnassignedPaidOrderToSticker,
  createCorporatePackageAccount,
  createVendor,
  getVendorInventory,
  listCorporateLeads,
  listUnassignedPaidOrders,
  listVendors,
  markStickersGiftReady,
  settleVendorMonth,
} from "@/lib/lifecycle-service";
import type { PackageFeatures } from "@/lib/packages";

function isAdminAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const cookie = req.cookies.get("balaghni_admin_session")?.value || "";
  const token = bearer || cookie;
  if (!token) return false;
  const check = verifyAdminSessionToken(token);
  return check.valid;
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [vendors, corporateLeads, unassignedPaidOrders] = await Promise.all([
    listVendors(),
    listCorporateLeads(),
    listUnassignedPaidOrders(),
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
  });
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "create_vendor") {
      const res = await createVendor({
        name: String(body.name || ""),
        phone: String(body.phone || ""),
        city: String(body.city || "طرابلس"),
        pin: String(body.pin || "123456"),
      });
      return NextResponse.json(res);
    }

    if (action === "assign_vendor_stickers") {
      const codes = String(body.codes || "")
        .split(/[\s,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
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

    if (action === "mark_gift_ready") {
      const codes = String(body.codes || "")
        .split(/[\s,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await markStickersGiftReady(codes);
      return NextResponse.json(res);
    }

    if (action === "create_corporate_account") {
      const codes = String(body.codes || "")
        .split(/[\s,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
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
        ownerPhone: String(body.ownerPhone || ""),
        agreedAmountLyd: Number(body.agreedAmountLyd || 0),
        features,
        stickerCodes: codes,
      });
      return NextResponse.json(res);
    }

    if (action === "assign_unassigned_paid") {
      const res = await assignUnassignedPaidOrderToSticker(
        String(body.orderId || ""),
        String(body.stickerCode || "")
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

    return NextResponse.json({ ok: false, error: "إجراء غير مدعوم." }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "خطأ غير متوقع." },
      { status: 500 }
    );
  }
}
