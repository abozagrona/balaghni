import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/client";
import { sendWhatsappAlertMessage } from "@/lib/otp-service";
import {
  getAdminWhatsappNumber,
  getDefaultFeaturesForPackage,
  getPackagePriceLyd,
  NABBIHNI_FEATURES,
  normalizePackageType,
  type PackageFeatures,
  type PackageType,
} from "@/lib/packages";
import { formatBalaghniTagCode } from "@/lib/utils";

export type StickerStatus = "unactivated" | "gift_ready" | "active" | "expired";
export type ActivationSource =
  | "online"
  | "vendor_cash"
  | "cod_delivered"
  | "gift_promo";

export interface StickerRecord {
  code: string;
  status: StickerStatus;
  vendorId?: string | null;
  activationSource?: ActivationSource | null;
  activatedByVendorId?: string | null;
  packageType: PackageType;
  features: PackageFeatures;
  ownerPhone?: string | null;
  ownerName?: string | null;
  vehicleInfo?: string | null;
  companyAccountId?: string | null;
  subscriptionStartsAt?: string | null;
  subscriptionExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VendorRecord {
  id: string;
  name: string;
  phone: string;
  city: string;
  pinHash?: string;
  isActive: boolean;
  createdAt: string;
}

export interface VendorSettlementRecord {
  id: string;
  vendorId: string;
  periodMonth: string;
  stickersSoldCount: number;
  totalCashCollected: number;
  status: "open" | "settled";
  settledAt?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface CorporateLeadRecord {
  id: string;
  companyName: string;
  city: string;
  fleetCount: number;
  selectedFeatures: string[];
  contactPhone?: string | null;
  agreedAmountLyd?: number | null;
  status: string;
  notes?: string | null;
  createdAt: string;
}

export interface UnassignedPaidOrderRecord {
  id: string;
  customerName: string;
  customerPhone: string;
  packageType: PackageType;
  amountLyd: number;
  originalStickerCode: string;
  assignedTagCode?: string | null;
  status: "unassigned_paid" | "assigned";
  createdAt: string;
}

interface LocalLifecycleStore {
  stickers: Record<string, StickerRecord>;
  vendors: VendorRecord[];
  settlements: VendorSettlementRecord[];
  giftRedemptions: Record<string, { phone: string; stickerCode: string; redeemedAt: string }>;
  corporateLeads: CorporateLeadRecord[];
  unassignedPaidOrders: UnassignedPaidOrderRecord[];
}

const STORE_PATH = path.join(
  process.cwd(),
  "src",
  "data",
  "local-lifecycle-store.json"
);

function loadStore(): LocalLifecycleStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
      return {
        stickers: parsed.stickers || {},
        vendors: Array.isArray(parsed.vendors) ? parsed.vendors : [],
        settlements: Array.isArray(parsed.settlements) ? parsed.settlements : [],
        giftRedemptions: parsed.giftRedemptions || {},
        corporateLeads: Array.isArray(parsed.corporateLeads) ? parsed.corporateLeads : [],
        unassignedPaidOrders: Array.isArray(parsed.unassignedPaidOrders)
          ? parsed.unassignedPaidOrders
          : [],
      };
    }
  } catch {
    // ignore read error
  }
  return {
    stickers: {},
    vendors: [],
    settlements: [],
    giftRedemptions: {},
    corporateLeads: [],
    unassignedPaidOrders: [],
  };
}

function saveStore(store: LocalLifecycleStore) {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // Vercel serverless filesystem is read-only; Supabase is primary
  }
}

export function hashPinSimple(pin: string): string {
  return crypto.createHash("sha256").update(pin.trim()).digest("hex");
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function addDaysIso(startIso: string, days: number): string {
  const d = new Date(startIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export async function getStickerLifecycle(
  rawCode: string
): Promise<StickerRecord | null> {
  const code = formatBalaghniTagCode(rawCode);
  const store = loadStore();

  try {
    const { data, error } = await supabaseAdmin
      .from("stickers")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (!error && data) {
      const expiresAt = data.subscription_expires_at
        ? String(data.subscription_expires_at)
        : null;
      let status = String(data.status || "unactivated") as StickerStatus;
      if (status === "active" && expiresAt && new Date(expiresAt).getTime() < Date.now()) {
        status = "expired";
      }
      return {
        code,
        status,
        vendorId: data.vendor_id || null,
        activationSource: data.activation_source || null,
        activatedByVendorId: data.activated_by_vendor_id || null,
        packageType: normalizePackageType(data.package_type),
        features:
          (data.features as PackageFeatures) ||
          getDefaultFeaturesForPackage(data.package_type),
        ownerPhone: data.owner_phone || null,
        ownerName: data.owner_name || null,
        vehicleInfo: data.vehicle_info || null,
        companyAccountId: data.company_account_id || null,
        subscriptionStartsAt: data.subscription_starts_at || null,
        subscriptionExpiresAt: expiresAt,
        createdAt: String(data.created_at || new Date().toISOString()),
        updatedAt: String(data.updated_at || new Date().toISOString()),
      };
    }
  } catch {
    // fallback to tags / local store
  }

  if (store.stickers[code]) {
    const rec = store.stickers[code];
    if (
      rec.status === "active" &&
      rec.subscriptionExpiresAt &&
      new Date(rec.subscriptionExpiresAt).getTime() < Date.now()
    ) {
      return { ...rec, status: "expired" };
    }
    return rec;
  }

  // Fallback: map legacy tags table record into StickerRecord
  try {
    const { data: tag } = await supabaseAdmin
      .from("tags")
      .select("*")
      .eq("tag_code", code)
      .maybeSingle();

    if (tag) {
      const rawStatus = String(tag.status || "LOCKED").toUpperCase();
      const expiresAt = tag.subscription_expires_at
        ? String(tag.subscription_expires_at)
        : tag.activated_at
        ? addDaysIso(String(tag.activated_at), 365)
        : null;

      let status: StickerStatus =
        rawStatus === "ACTIVE" ? "active" : "unactivated";
      if (status === "active" && expiresAt && new Date(expiresAt).getTime() < Date.now()) {
        status = "expired";
      }
      const pkg = normalizePackageType(tag.package_type);
      return {
        code,
        status,
        vendorId: tag.vendor_id || null,
        activationSource: tag.activation_source || null,
        activatedByVendorId: tag.activated_by_vendor_id || null,
        packageType: pkg,
        features:
          (tag.features as PackageFeatures) ||
          getDefaultFeaturesForPackage(pkg),
        ownerPhone: tag.owner_phone || null,
        vehicleInfo: tag.vehicle_make_model || tag.vehicle_info || null,
        subscriptionStartsAt: tag.subscription_starts_at || tag.activated_at || null,
        subscriptionExpiresAt: expiresAt,
        createdAt: String(tag.created_at || new Date().toISOString()),
        updatedAt: String(tag.created_at || new Date().toISOString()),
      };
    }
  } catch {
    // ignore
  }

  return null;
}

async function syncTagActivationRecord(params: {
  code: string;
  packageType: PackageType;
  features: PackageFeatures;
  ownerPhone: string;
  vehicleInfo?: string;
  startsAt: string;
  expiresAt: string;
  vendorId?: string | null;
  activationSource: ActivationSource;
}) {
  try {
    await supabaseAdmin
      .from("tags")
      .update({
        status: "ACTIVE",
        owner_phone: params.ownerPhone,
        vehicle_make_model: params.vehicleInfo || "مركبة مفعلة",
        activated_at: params.startsAt,
        package_type: params.packageType,
        features: params.features,
        subscription_starts_at: params.startsAt,
        subscription_expires_at: params.expiresAt,
        vendor_id: params.vendorId || null,
        activation_source: params.activationSource,
        activated_by_vendor_id: params.vendorId || null,
      })
      .eq("tag_code", params.code);
  } catch {
    // ignore if remote tags columns differ
  }
}

export async function activateStickerAtomic(params: {
  code: string;
  packageType: PackageType;
  ownerPhone: string;
  ownerName?: string;
  vehicleInfo?: string;
  activationSource: ActivationSource;
  vendorId?: string | null;
  customFeatures?: PackageFeatures;
  durationDays?: number;
  companyAccountId?: string | null;
  allowExpiredRenewal?: boolean;
}): Promise<{
  ok: boolean;
  unassignedPaid?: boolean;
  orderId?: string;
  sticker?: StickerRecord;
  error?: string;
}> {
  const code = formatBalaghniTagCode(params.code);
  const pkg = normalizePackageType(params.packageType);
  const features = params.customFeatures || getDefaultFeaturesForPackage(pkg);
  const startsAt = new Date().toISOString();
  const expiresAt = addDaysIso(startsAt, params.durationDays ?? 365);
  const allowedStatuses = params.allowExpiredRenewal
    ? ["unactivated", "expired"]
    : ["unactivated"];

  // 1. محاولة التحديث الذري في Supabase بشرط WHERE code = $code AND status = 'unactivated'
  try {
    const { data: updatedRows, error: updateErr } = await supabaseAdmin
      .from("stickers")
      .update({
        status: "active",
        package_type: pkg,
        features,
        owner_phone: params.ownerPhone,
        owner_name: params.ownerName || null,
        vehicle_info: params.vehicleInfo || null,
        activation_source: params.activationSource,
        activated_by_vendor_id: params.vendorId || null,
        company_account_id: params.companyAccountId || null,
        subscription_starts_at: startsAt,
        subscription_expires_at: expiresAt,
        updated_at: startsAt,
      })
      .eq("code", code)
      .in("status", allowedStatuses)
      .select("*");

    if (!updateErr) {
      if (Array.isArray(updatedRows) && updatedRows.length > 0) {
        await syncTagActivationRecord({
          code,
          packageType: pkg,
          features,
          ownerPhone: params.ownerPhone,
          vehicleInfo: params.vehicleInfo,
          startsAt,
          expiresAt,
          vendorId: params.vendorId,
          activationSource: params.activationSource,
        });
        const rec = await getStickerLifecycle(code);
        return { ok: true, sticker: rec || undefined };
      }

      // إذا لم تتأثر أي صفوف: تحقق هل الملصق موجود ومُفعّل بالفعل (حالة تزامن الدفع الإلكتروني)
      const existing = await getStickerLifecycle(code);
      if (existing && existing.status !== "unactivated" && params.activationSource === "online") {
        const amountLyd = getPackagePriceLyd(pkg);
        const orderId = `UNASSIGNED-${Date.now().toString(36).toUpperCase()}`;
        const store = loadStore();
        store.unassignedPaidOrders.unshift({
          id: orderId,
          customerName: params.ownerName || "عميل دفع إلكتروني",
          customerPhone: params.ownerPhone,
          packageType: pkg,
          amountLyd,
          originalStickerCode: code,
          status: "unassigned_paid",
          createdAt: startsAt,
        });
        saveStore(store);

        try {
          await supabaseAdmin.from("orders").insert({
            full_name: params.ownerName || "عميل دفع إلكتروني",
            phone: params.ownerPhone,
            city: "أونلاين",
            address: `دفع متزامن على ملصق ${code}`,
            tier: pkg,
            quantity: 1,
            total_lyd: amountLyd,
            status: "unassigned_paid",
            payment_method: "online",
            payment_status: "paid",
            assigned_tag_code: null,
          });
        } catch {
          // ignore
        }

        const adminNum = getAdminWhatsappNumber();
        await Promise.allSettled([
          sendWhatsappAlertMessage(
            adminNum,
            `⚠️ دفعة إلكترونية متزامنة (unassigned_paid)\nرقم الطلب: ${orderId}\nالملصق: ${code}\nهاتف الزبون: ${params.ownerPhone}\nالقيمة: ${amountLyd} د.ل\nيرجى ربط الرصيد بملصق بديل من لوحة الأدمن.`
          ),
          sendWhatsappAlertMessage(
            params.ownerPhone,
            `✅ تم استلام دفعتك بنجاح في منصة بَلِّغْنِي (${amountLyd} د.ل).\nنظراً لتفعيل الملصق ${code} في نفس اللحظة، رصيدك محفوظ (${orderId}) وسيتم ربطه بملصق بديل فوراً من الإدارة.`
          ),
        ]);

        return {
          ok: false,
          unassignedPaid: true,
          orderId,
          error:
            "تم تفعيل هذا الملصق في نفس اللحظة لطرف آخر؛ رصيدك محفوظ برقم طلب معلق وسيتم ربطه بملصق بديل فوراً.",
        };
      }
    }
  } catch {
    // fallback to local store
  }

  // 2. Fallback المحلي / أو تحديث tags مباشرة
  const store = loadStore();
  const local = store.stickers[code];
  if (local && !allowedStatuses.includes(local.status)) {
    if (params.activationSource === "online") {
      const amountLyd = getPackagePriceLyd(pkg);
      const orderId = `UNASSIGNED-${Date.now().toString(36).toUpperCase()}`;
      store.unassignedPaidOrders.unshift({
        id: orderId,
        customerName: params.ownerName || "عميل دفع إلكتروني",
        customerPhone: params.ownerPhone,
        packageType: pkg,
        amountLyd,
        originalStickerCode: code,
        status: "unassigned_paid",
        createdAt: startsAt,
      });
      saveStore(store);
      return {
        ok: false,
        unassignedPaid: true,
        orderId,
        error:
          "تم تفعيل هذا الملصق في نفس اللحظة؛ رصيدك محفوظ وسيتم ربطه بملصق بديل فوراً.",
      };
    }
    return { ok: false, error: "الملصق غير متاح للتفعيل في هذه الحالة." };
  }

  const newRec: StickerRecord = {
    code,
    status: "active",
    vendorId: local?.vendorId || params.vendorId || null,
    activationSource: params.activationSource,
    activatedByVendorId: params.vendorId || null,
    packageType: pkg,
    features,
    ownerPhone: params.ownerPhone,
    ownerName: params.ownerName || null,
    vehicleInfo: params.vehicleInfo || null,
    companyAccountId: params.companyAccountId || null,
    subscriptionStartsAt: startsAt,
    subscriptionExpiresAt: expiresAt,
    createdAt: local?.createdAt || startsAt,
    updatedAt: startsAt,
  };
  store.stickers[code] = newRec;
  saveStore(store);

  await syncTagActivationRecord({
    code,
    packageType: pkg,
    features,
    ownerPhone: params.ownerPhone,
    vehicleInfo: params.vehicleInfo,
    startsAt,
    expiresAt,
    vendorId: params.vendorId,
    activationSource: params.activationSource,
  });

  return { ok: true, sticker: newRec };
}

export async function redeemGiftSticker(params: {
  code: string;
  phone: string;
  ownerName?: string;
  vehicleInfo?: string;
}): Promise<{
  ok: boolean;
  alreadyRedeemed?: boolean;
  sticker?: StickerRecord;
  error?: string;
}> {
  const code = formatBalaghniTagCode(params.code);
  const cleanPhone = params.phone.replace(/[^\d]/g, "");
  if (!cleanPhone) {
    return { ok: false, error: "يرجى إدخال رقم هاتف ليبي صحيح." };
  }

  const store = loadStore();

  // فحص جدول gift_redemptions في Supabase والمخزن المحلي
  let alreadyUsed = Boolean(store.giftRedemptions[cleanPhone]);
  if (!alreadyUsed) {
    try {
      const { data } = await supabaseAdmin
        .from("gift_redemptions")
        .select("phone")
        .eq("phone", cleanPhone)
        .maybeSingle();
      if (data?.phone) alreadyUsed = true;
    } catch {
      // ignore
    }
  }

  if (alreadyUsed) {
    return {
      ok: false,
      alreadyRedeemed: true,
      error: "هذا الرقم استهلك الشهر الهدية مسبقاً، يرجى اختيار باقة للاشتراك",
    };
  }

  const nowIso = new Date().toISOString();
  const expiresAt = addDaysIso(nowIso, 30);

  try {
    await supabaseAdmin.from("gift_redemptions").insert({
      phone: cleanPhone,
      sticker_code: code,
      redeemed_at: nowIso,
    });
  } catch {
    // ignore
  }

  store.giftRedemptions[cleanPhone] = {
    phone: cleanPhone,
    stickerCode: code,
    redeemedAt: nowIso,
  };

  try {
    await supabaseAdmin
      .from("stickers")
      .upsert({
        code,
        status: "active",
        activation_source: "gift_promo",
        package_type: "nabbihni",
        features: NABBIHNI_FEATURES,
        owner_phone: params.phone,
        owner_name: params.ownerName || null,
        vehicle_info: params.vehicleInfo || null,
        subscription_starts_at: nowIso,
        subscription_expires_at: expiresAt,
        updated_at: nowIso,
      });
  } catch {
    // ignore
  }

  const rec: StickerRecord = {
    code,
    status: "active",
    activationSource: "gift_promo",
    packageType: "nabbihni",
    features: NABBIHNI_FEATURES,
    ownerPhone: params.phone,
    ownerName: params.ownerName || null,
    vehicleInfo: params.vehicleInfo || null,
    subscriptionStartsAt: nowIso,
    subscriptionExpiresAt: expiresAt,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.stickers[code] = rec;
  saveStore(store);

  await syncTagActivationRecord({
    code,
    packageType: "nabbihni",
    features: NABBIHNI_FEATURES,
    ownerPhone: params.phone,
    vehicleInfo: params.vehicleInfo,
    startsAt: nowIso,
    expiresAt,
    activationSource: "gift_promo",
  });

  await sendWhatsappAlertMessage(
    params.phone,
    `🎁 مبروك! تم تفعيل ملصق الهدية (${code}) مجاناً لمدة 30 يوماً بكامل مزايا باقة نَبِّهْنِي.\nتنتهي الفترة التجريبية بتاريخ ${expiresAt.slice(0, 10)}.`
  );

  return { ok: true, sticker: rec };
}

export async function createCorporateLead(params: {
  companyName: string;
  city: string;
  fleetCount: number;
  selectedFeatures: string[];
  contactPhone?: string;
}): Promise<{ ok: boolean; lead?: CorporateLeadRecord; error?: string }> {
  const fleetCount = Math.max(10, Math.round(Number(params.fleetCount || 10)));
  const nowIso = new Date().toISOString();
  const lead: CorporateLeadRecord = {
    id: `lead_${Date.now().toString(36)}`,
    companyName: params.companyName.trim(),
    city: params.city.trim(),
    fleetCount,
    selectedFeatures: params.selectedFeatures,
    contactPhone: params.contactPhone?.trim() || null,
    status: "new",
    createdAt: nowIso,
  };

  try {
    await supabaseAdmin.from("corporate_leads").insert({
      company_name: lead.companyName,
      city: lead.city,
      fleet_count: lead.fleetCount,
      selected_features: lead.selectedFeatures,
      contact_phone: lead.contactPhone,
      status: "new",
    });
  } catch {
    // fallback
  }

  const store = loadStore();
  store.corporateLeads.unshift(lead);
  saveStore(store);

  const adminNum = getAdminWhatsappNumber();
  await sendWhatsappAlertMessage(
    adminNum,
    `🏢 طلب جديد لباقة إيليت للشركات!\nالشركة: ${lead.companyName}\nالمدينة: ${lead.city}\nعدد السيارات: ${lead.fleetCount}\nالمزايا المطلوبة: ${lead.selectedFeatures.join("، ") || "غير محددة"}${lead.contactPhone ? `\nرقم التواصل: ${lead.contactPhone}` : ""}`
  );

  return { ok: true, lead };
}

export async function listCorporateLeads(): Promise<CorporateLeadRecord[]> {
  const store = loadStore();
  try {
    const { data, error } = await supabaseAdmin
      .from("corporate_leads")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((r) => ({
        id: String(r.id),
        companyName: String(r.company_name),
        city: String(r.city),
        fleetCount: Number(r.fleet_count || 10),
        selectedFeatures: Array.isArray(r.selected_features)
          ? (r.selected_features as string[])
          : [],
        contactPhone: r.contact_phone || null,
        agreedAmountLyd: r.agreed_amount_lyd ? Number(r.agreed_amount_lyd) : null,
        status: String(r.status || "new"),
        notes: r.notes || null,
        createdAt: String(r.created_at),
      }));
    }
  } catch {
    // ignore
  }
  return store.corporateLeads;
}

export async function listVendors(): Promise<VendorRecord[]> {
  const store = loadStore();
  try {
    const { data, error } = await supabaseAdmin
      .from("vendors")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((v) => ({
        id: String(v.id),
        name: String(v.name),
        phone: String(v.phone),
        city: String(v.city || "طرابلس"),
        pinHash: v.pin_hash || undefined,
        isActive: Boolean(v.is_active ?? true),
        createdAt: String(v.created_at),
      }));
    }
  } catch {
    // ignore
  }
  return store.vendors;
}

export async function createVendor(params: {
  name: string;
  phone: string;
  city: string;
  pin?: string;
}): Promise<{ ok: boolean; vendor?: VendorRecord; error?: string }> {
  const nowIso = new Date().toISOString();
  const pinHash = params.pin ? hashPinSimple(params.pin) : hashPinSimple("123456");
  let id = `vnd_${Date.now().toString(36)}`;

  try {
    const { data, error } = await supabaseAdmin
      .from("vendors")
      .insert({
        name: params.name.trim(),
        phone: params.phone.trim(),
        city: params.city.trim(),
        pin_hash: pinHash,
        is_active: true,
      })
      .select("*")
      .single();
    if (!error && data?.id) id = String(data.id);
  } catch {
    // fallback
  }

  const vendor: VendorRecord = {
    id,
    name: params.name.trim(),
    phone: params.phone.trim(),
    city: params.city.trim(),
    pinHash,
    isActive: true,
    createdAt: nowIso,
  };
  const store = loadStore();
  store.vendors.unshift(vendor);
  saveStore(store);
  return { ok: true, vendor };
}

export async function authenticateVendor(
  phone: string,
  pin: string
): Promise<{ ok: boolean; vendor?: VendorRecord; error?: string }> {
  const cleanDigits = phone.replace(/[^\d]/g, "").slice(-9);
  const vendors = await listVendors();
  const match = vendors.find((v) =>
    v.phone.replace(/[^\d]/g, "").endsWith(cleanDigits)
  );
  if (!match || !match.isActive) {
    return { ok: false, error: "رقم التاجر غير مسجل أو الحساب غير نشط." };
  }
  if (match.pinHash && match.pinHash !== hashPinSimple(pin)) {
    return { ok: false, error: "رمز الدخول غير صحيح." };
  }
  return { ok: true, vendor: match };
}

export async function assignStickersToVendor(
  vendorId: string,
  rawCodes: string[]
): Promise<{ ok: boolean; assignedCount: number }> {
  const codes = Array.from(
    new Set(rawCodes.map((c) => formatBalaghniTagCode(c)).filter(Boolean))
  );
  const nowIso = new Date().toISOString();
  const store = loadStore();

  for (const code of codes) {
    try {
      await supabaseAdmin.from("stickers").upsert({
        code,
        status: "unactivated",
        vendor_id: vendorId,
        package_type: "nabbihni",
        features: NABBIHNI_FEATURES,
        updated_at: nowIso,
      });
    } catch {
      // ignore
    }

    const existing = store.stickers[code];
    store.stickers[code] = {
      ...(existing || {
        code,
        status: "unactivated",
        packageType: "nabbihni",
        features: NABBIHNI_FEATURES,
        createdAt: nowIso,
      }),
      vendorId,
      updatedAt: nowIso,
    };
  }
  saveStore(store);
  return { ok: true, assignedCount: codes.length };
}

export async function getVendorInventory(vendorId: string): Promise<{
  assignedStickers: StickerRecord[];
  soldThisMonthCount: number;
  remainingUnactivatedCount: number;
  totalCashCollected: number;
  settlements: VendorSettlementRecord[];
}> {
  const monthKey = currentMonthKey();
  const store = loadStore();
  let stickers: StickerRecord[] = [];

  try {
    const { data, error } = await supabaseAdmin
      .from("stickers")
      .select("*")
      .or(`vendor_id.eq.${vendorId},activated_by_vendor_id.eq.${vendorId}`);
    if (!error && Array.isArray(data)) {
      stickers = data.map((s) => ({
        code: String(s.code),
        status: String(s.status || "unactivated") as StickerStatus,
        vendorId: s.vendor_id || null,
        activationSource: s.activation_source || null,
        activatedByVendorId: s.activated_by_vendor_id || null,
        packageType: normalizePackageType(s.package_type),
        features:
          (s.features as PackageFeatures) ||
          getDefaultFeaturesForPackage(s.package_type),
        ownerPhone: s.owner_phone || null,
        ownerName: s.owner_name || null,
        subscriptionStartsAt: s.subscription_starts_at || null,
        subscriptionExpiresAt: s.subscription_expires_at || null,
        createdAt: String(s.created_at || ""),
        updatedAt: String(s.updated_at || ""),
      }));
    }
  } catch {
    // ignore
  }

  if (stickers.length === 0) {
    stickers = Object.values(store.stickers).filter(
      (s) => s.vendorId === vendorId || s.activatedByVendorId === vendorId
    );
  }

  const remainingUnactivatedCount = stickers.filter(
    (s) => s.status === "unactivated"
  ).length;
  const soldThisMonth = stickers.filter(
    (s) =>
      s.activatedByVendorId === vendorId &&
      s.activationSource === "vendor_cash" &&
      String(s.subscriptionStartsAt || s.updatedAt || "").startsWith(monthKey)
  );
  const totalCashCollected = soldThisMonth.reduce(
    (acc, s) => acc + getPackagePriceLyd(s.packageType),
    0
  );

  let settlements = store.settlements.filter((st) => st.vendorId === vendorId);
  try {
    const { data, error } = await supabaseAdmin
      .from("vendor_settlements")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data) && data.length > 0) {
      settlements = data.map((r) => ({
        id: String(r.id),
        vendorId: String(r.vendor_id),
        periodMonth: String(r.period_month),
        stickersSoldCount: Number(r.stickers_sold_count || 0),
        totalCashCollected: Number(r.total_cash_collected || 0),
        status: (r.status === "settled" ? "settled" : "open") as "open" | "settled",
        settledAt: r.settled_at || null,
        notes: r.notes || null,
        createdAt: String(r.created_at),
      }));
    }
  } catch {
    // ignore
  }

  return {
    assignedStickers: stickers,
    soldThisMonthCount: soldThisMonth.length,
    remainingUnactivatedCount,
    totalCashCollected,
    settlements,
  };
}

export async function vendorActivateCashSticker(params: {
  vendorId: string;
  code: string;
  packageType: PackageType;
  customerPhone: string;
  customerName: string;
}): Promise<{ ok: boolean; sticker?: StickerRecord; error?: string }> {
  const code = formatBalaghniTagCode(params.code);
  const existing = await getStickerLifecycle(code);
  if (!existing || existing.status !== "unactivated") {
    return {
      ok: false,
      error: "هذا الكود غير متاح للتفعيل (قد يكون مفعلاً مسبقاً أو غير موجود).",
    };
  }
  if (existing.vendorId && existing.vendorId !== params.vendorId) {
    return {
      ok: false,
      error: "هذا الملصق غير مدرج ضمن عهدتك الحالية.",
    };
  }

  const res = await activateStickerAtomic({
    code,
    packageType: params.packageType,
    ownerPhone: params.customerPhone,
    ownerName: params.customerName,
    activationSource: "vendor_cash",
    vendorId: params.vendorId,
    durationDays: 365,
  });

  if (res.ok) {
    await sendWhatsappAlertMessage(
      params.customerPhone,
      `🎉 تم تفعيل ملصق «بَلِّغْنِي» (${code}) بنجاح لمدة سنة كاملة!\nيرجى الدخول لحسابك على https://www.balaghni.ly/s/${code} لإكمال بيانات سيارتك.`
    );
  }

  return res;
}

export async function settleVendorMonth(
  vendorId: string,
  notes?: string
): Promise<{ ok: boolean; settlement?: VendorSettlementRecord }> {
  const inv = await getVendorInventory(vendorId);
  const periodMonth = currentMonthKey();
  const nowIso = new Date().toISOString();
  const settlement: VendorSettlementRecord = {
    id: `stl_${Date.now().toString(36)}`,
    vendorId,
    periodMonth,
    stickersSoldCount: inv.soldThisMonthCount,
    totalCashCollected: inv.totalCashCollected,
    status: "settled",
    settledAt: nowIso,
    notes: notes || "تم استلام الكاش وإقفال عهدة الشهر",
    createdAt: nowIso,
  };

  try {
    await supabaseAdmin.from("vendor_settlements").insert({
      vendor_id: vendorId,
      period_month: periodMonth,
      stickers_sold_count: settlement.stickersSoldCount,
      total_cash_collected: settlement.totalCashCollected,
      status: "settled",
      settled_at: nowIso,
      notes: settlement.notes,
    });
  } catch {
    // ignore
  }

  const store = loadStore();
  store.settlements.unshift(settlement);
  saveStore(store);
  return { ok: true, settlement };
}

export async function markStickersGiftReady(
  rawCodes: string[]
): Promise<{ ok: boolean; updatedCount: number }> {
  const codes = Array.from(
    new Set(rawCodes.map((c) => formatBalaghniTagCode(c)).filter(Boolean))
  );
  const nowIso = new Date().toISOString();
  const store = loadStore();

  for (const code of codes) {
    try {
      await supabaseAdmin.from("stickers").upsert({
        code,
        status: "gift_ready",
        package_type: "nabbihni",
        features: NABBIHNI_FEATURES,
        updated_at: nowIso,
      });
    } catch {
      // ignore
    }
    store.stickers[code] = {
      ...(store.stickers[code] || {
        code,
        createdAt: nowIso,
      }),
      code,
      status: "gift_ready",
      packageType: "nabbihni",
      features: NABBIHNI_FEATURES,
      updatedAt: nowIso,
    };
  }
  saveStore(store);
  return { ok: true, updatedCount: codes.length };
}

export async function createCorporatePackageAccount(params: {
  companyName: string;
  city: string;
  ownerPhone: string;
  agreedAmountLyd: number;
  features: PackageFeatures;
  stickerCodes: string[];
}): Promise<{ ok: boolean; companyAccountId: string; activatedCount: number }> {
  const companyAccountId = `CORP-${Date.now().toString(36).toUpperCase()}`;
  let activatedCount = 0;

  for (const raw of params.stickerCodes) {
    const code = formatBalaghniTagCode(raw);
    if (!code) continue;
    const res = await activateStickerAtomic({
      code,
      packageType: "elite",
      ownerPhone: params.ownerPhone,
      ownerName: params.companyName,
      vehicleInfo: `${params.companyName} (${params.city})`,
      activationSource: "online",
      customFeatures: params.features,
      durationDays: 365,
      companyAccountId,
      allowExpiredRenewal: true,
    });
    if (res.ok) activatedCount += 1;
  }

  return { ok: true, companyAccountId, activatedCount };
}

export async function listUnassignedPaidOrders(): Promise<
  UnassignedPaidOrderRecord[]
> {
  const store = loadStore();
  try {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("status", "unassigned_paid")
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((o) => ({
        id: String(o.id),
        customerName: String(o.full_name || ""),
        customerPhone: String(o.phone || ""),
        packageType: normalizePackageType(o.tier),
        amountLyd: Number(o.total_lyd || 100),
        originalStickerCode: String(o.address || "").replace("دفع متزامن على ملصق ", ""),
        assignedTagCode: o.assigned_tag_code || null,
        status: "unassigned_paid",
        createdAt: String(o.created_at),
      }));
    }
  } catch {
    // ignore
  }
  return store.unassignedPaidOrders.filter((o) => o.status === "unassigned_paid");
}

export async function assignUnassignedPaidOrderToSticker(
  orderId: string,
  stickerCode: string
): Promise<{ ok: boolean; error?: string }> {
  const code = formatBalaghniTagCode(stickerCode);
  const store = loadStore();
  const list = await listUnassignedPaidOrders();
  const targetOrder = list.find((o) => o.id === orderId);
  if (!targetOrder) {
    return { ok: false, error: "الطلب المعلق غير موجود." };
  }

  const res = await activateStickerAtomic({
    code,
    packageType: targetOrder.packageType,
    ownerPhone: targetOrder.customerPhone,
    ownerName: targetOrder.customerName,
    activationSource: "online",
    durationDays: 365,
  });
  if (!res.ok) return { ok: false, error: res.error };

  try {
    await supabaseAdmin
      .from("orders")
      .update({
        status: "completed",
        assigned_tag_code: code,
      })
      .eq("id", orderId);
  } catch {
    // ignore
  }

  const idx = store.unassignedPaidOrders.findIndex((o) => o.id === orderId);
  if (idx >= 0) {
    store.unassignedPaidOrders[idx].status = "assigned";
    store.unassignedPaidOrders[idx].assignedTagCode = code;
    saveStore(store);
  }

  await sendWhatsappAlertMessage(
    targetOrder.customerPhone,
    `✅ تم ربط رصيدك المحفوظ في منصة بَلِّغْنِي بالملصق البديل (${code}) وتفعيله لمدة سنة كاملة!`
  );

  return { ok: true };
}
