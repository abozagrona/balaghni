import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  supabaseAdmin,
  syncTagActivationToLocalStore,
} from "@/lib/supabase/client";
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

export interface OrderRecord {
  id: string;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  city: string;
  address: string;
  vehicleModel?: string | null;
  packageType: PackageType;
  quantity: number;
  totalLyd: number;
  paymentMethod: "online" | "cod";
  paymentStatus: string;
  assignedTagCode?: string | null;
  status: string;
  subscriptionStartsAt?: string | null;
  subscriptionExpiresAt?: string | null;
  createdAt: string;
}

interface LocalLifecycleStore {
  stickers: Record<string, StickerRecord>;
  vendors: VendorRecord[];
  settlements: VendorSettlementRecord[];
  giftRedemptions: Record<string, { phone: string; stickerCode: string; redeemedAt: string }>;
  corporateLeads: CorporateLeadRecord[];
  unassignedPaidOrders: UnassignedPaidOrderRecord[];
  orders: OrderRecord[];
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
        orders: Array.isArray(parsed.orders) ? parsed.orders : [],
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
    orders: [],
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
  skipOrderInsert?: boolean;
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
        if (
          params.activationSource === "online" &&
          !params.companyAccountId &&
          !params.skipOrderInsert
        ) {
          await recordMarketplaceOrder({
            orderCode: `ORD-${Date.now().toString(36).toUpperCase()}`,
            packageType: pkg,
            quantity: 1,
            customerName: params.ownerName || "عميل تفعيل أونلاين",
            customerPhone: params.ownerPhone,
            city: "تفعيل مباشر (QR)",
            address: `تفعيل مباشر عبر مسح الملصق ${code}`,
            vehicleModel: params.vehicleInfo || null,
            totalLyd: getPackagePriceLyd(pkg),
            paymentMethod: "online",
            paymentStatus: "paid",
            assignedTagCode: code,
            status: "completed",
            subscriptionStartsAt: startsAt,
            subscriptionExpiresAt: expiresAt,
            skipAdminWhatsapp: true,
          });
          await sendWhatsappAlertMessage(
            params.ownerPhone,
            `✅ تم تفعيل ملصق «بَلِّغْنِي» (${code}) بنجاح!\nالباقة: ${pkg === "basic" ? "الباقة الأساسية (50 د.ل)" : "باقة نَبِّهْنِي (100 د.ل)"}\nصالح لمدة 365 يوماً حتى: ${expiresAt.slice(0, 10)}\nرابط لوحة التحكم: https://www.balaghni.ly/login`
          );
          await sendWhatsappAlertMessage(
            getAdminWhatsappNumber(),
            `✅ تفعيل أونلاين مباشر لملصق (${code})\nالباقة: ${pkg}\nالهاتف: ${params.ownerPhone}\nالاسم: ${params.ownerName || "-"}`
          );
        }
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

export async function recordMarketplaceOrder(params: {
  orderCode: string;
  packageType: PackageType;
  quantity: number;
  customerName: string;
  customerPhone: string;
  city: string;
  address: string;
  vehicleModel?: string | null;
  totalLyd: number;
  paymentMethod: "online" | "cod";
  paymentStatus: string;
  assignedTagCode?: string | null;
  status?: string;
  subscriptionStartsAt: string;
  subscriptionExpiresAt: string;
  skipAdminWhatsapp?: boolean;
}): Promise<{ ok: boolean; order: OrderRecord; supabaseSaved: boolean }> {
  const nowIso = params.subscriptionStartsAt || new Date().toISOString();
  const orderStatus =
    params.status ||
    (params.assignedTagCode ? "completed" : "pending_assignment");
  let id = `ord_${Date.now().toString(36)}`;
  let supabaseSaved = false;

  try {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .insert({
        order_code: params.orderCode,
        tier: params.packageType,
        quantity: params.quantity,
        full_name: params.customerName,
        phone: params.customerPhone,
        city: params.city,
        address: params.address,
        vehicle_model: params.vehicleModel || null,
        total_lyd: params.totalLyd,
        payment_method: params.paymentMethod,
        payment_status: params.paymentStatus,
        assigned_tag_code: params.assignedTagCode || null,
        status: orderStatus,
        subscription_starts_at: params.subscriptionStartsAt,
        subscription_expires_at: params.subscriptionExpiresAt,
        created_at: nowIso,
      })
      .select("id")
      .single();

    if (!error && data?.id) {
      id = String(data.id);
      supabaseSaved = true;
    } else if (error) {
      // Fallback to base columns if extended columns are not yet present
      const { data: baseData, error: baseErr } = await supabaseAdmin
        .from("orders")
        .insert({
          order_code: params.orderCode,
          tier: params.packageType,
          quantity: params.quantity,
          full_name: params.customerName,
          phone: params.customerPhone,
          city: params.city,
          address: params.address,
          vehicle_model: params.vehicleModel || null,
          total_lyd: params.totalLyd,
          status: orderStatus,
          created_at: nowIso,
        })
        .select("id")
        .single();
      if (!baseErr && baseData?.id) {
        id = String(baseData.id);
        supabaseSaved = true;
      }
    }
  } catch {
    // local store fallback below
  }

  const order: OrderRecord = {
    id,
    orderCode: params.orderCode,
    customerName: params.customerName,
    customerPhone: params.customerPhone,
    city: params.city,
    address: params.address,
    vehicleModel: params.vehicleModel || null,
    packageType: params.packageType,
    quantity: params.quantity,
    totalLyd: params.totalLyd,
    paymentMethod: params.paymentMethod,
    paymentStatus: params.paymentStatus,
    assignedTagCode: params.assignedTagCode || null,
    status: orderStatus,
    subscriptionStartsAt: params.subscriptionStartsAt,
    subscriptionExpiresAt: params.subscriptionExpiresAt,
    createdAt: nowIso,
  };

  const store = loadStore();
  store.orders.unshift(order);
  saveStore(store);

  return { ok: true, order, supabaseSaved };
}

export async function listAllOrders(): Promise<OrderRecord[]> {
  const store = loadStore();
  const byCode = new Map<string, OrderRecord>();

  for (const o of store.orders) {
    byCode.set(o.orderCode || o.id, o);
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const orderCode = String(row.order_code || row.id);
        const existingLocal = byCode.get(orderCode);
        const startsAt =
          row.subscription_starts_at ||
          existingLocal?.subscriptionStartsAt ||
          row.created_at;
        let expiresAt =
          row.subscription_expires_at ||
          existingLocal?.subscriptionExpiresAt ||
          null;
        if (!expiresAt && startsAt) {
          expiresAt = addDaysIso(String(startsAt), 365);
        }
        const paymentMethod =
          String(
            row.payment_method || existingLocal?.paymentMethod || "cod"
          ).toLowerCase() === "online"
            ? "online"
            : "cod";
        const paymentStatus = String(
          row.payment_status ||
            existingLocal?.paymentStatus ||
            (paymentMethod === "online" ? "paid" : "pending_cod")
        );
        byCode.set(orderCode, {
          id: String(row.id),
          orderCode,
          customerName: String(row.full_name || existingLocal?.customerName || ""),
          customerPhone: String(row.phone || existingLocal?.customerPhone || ""),
          city: String(row.city || existingLocal?.city || ""),
          address: String(row.address || existingLocal?.address || ""),
          vehicleModel: row.vehicle_model || existingLocal?.vehicleModel || null,
          packageType: normalizePackageType(row.tier || existingLocal?.packageType),
          quantity: Number(row.quantity || existingLocal?.quantity || 1),
          totalLyd: Number(row.total_lyd || existingLocal?.totalLyd || 100),
          paymentMethod,
          paymentStatus,
          assignedTagCode:
            row.assigned_tag_code || existingLocal?.assignedTagCode || null,
          status: String(
            row.status ||
              existingLocal?.status ||
              (row.assigned_tag_code ? "completed" : "pending_assignment")
          ),
          subscriptionStartsAt: startsAt ? String(startsAt) : null,
          subscriptionExpiresAt: expiresAt ? String(expiresAt) : null,
          createdAt: String(row.created_at || existingLocal?.createdAt || ""),
        });
      }
    }
  } catch {
    // ignore
  }

  return Array.from(byCode.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

export async function listAvailableStickers(): Promise<string[]> {
  const codes = new Set<string>();

  try {
    const { data: tagRows, error: tagErr } = await supabaseAdmin
      .from("tags")
      .select("tag_code,status,owner_phone")
      .order("created_at", { ascending: true })
      .limit(500);
    if (!tagErr && Array.isArray(tagRows)) {
      for (const row of tagRows) {
        const st = String(row.status || "").trim().toUpperCase();
        if (row.tag_code && (st === "LOCKED" || st === "UNACTIVATED")) {
          codes.add(formatBalaghniTagCode(String(row.tag_code)));
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("stickers")
      .select("code,status")
      .order("created_at", { ascending: true })
      .limit(500);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const st = String(row.status || "").trim().toUpperCase();
        if (row.code && (st === "UNACTIVATED" || st === "LOCKED")) {
          codes.add(formatBalaghniTagCode(String(row.code)));
        }
      }
    }
  } catch {
    // ignore
  }

  const store = loadStore();
  for (const s of Object.values(store.stickers)) {
    const st = String(s.status || "").trim().toUpperCase();
    if (st === "UNACTIVATED" || st === "LOCKED") {
      codes.add(formatBalaghniTagCode(s.code));
    }
  }

  return Array.from(codes);
}

export async function pullAndActivateLockedTag(params: {
  packageType: PackageType;
  ownerPhone: string;
  ownerName: string;
  vehicleInfo?: string | null;
  city: string;
  paymentMethod: "online" | "cod";
  startsAt: string;
  expiresAt: string;
}): Promise<{ ok: boolean; stickerCode?: string; error?: string }> {
  const pkg = normalizePackageType(params.packageType);
  const features = getDefaultFeaturesForPackage(pkg);
  const alertChannel = pkg === "basic" ? "WHATSAPP" : "BOTH";
  const activationSource =
    params.paymentMethod === "online" ? "online" : "cod_delivered";
  const vehicleLabel =
    String(params.vehicleInfo || "").trim() || params.ownerName || "مركبة مسجلة";

  const candidates = await listAvailableStickers();
  let lastError = "";
  for (const candidateCode of candidates) {
    try {
      // التحديث الذري في جدول tags باستخدام الأعمدة الفعلية للجدول:
      // status, owner_phone, vehicle_make_model, vehicle_city, notification_channel, activated_at
      let updated = false;
      const { data: tagRows, error: tagErr } = await supabaseAdmin
        .from("tags")
        .update({
          status: "ACTIVE",
          owner_phone: params.ownerPhone,
          vehicle_make_model: vehicleLabel,
          vehicle_city: params.city,
          notification_channel: alertChannel,
          activated_at: params.startsAt,
        })
        .eq("tag_code", candidateCode)
        .in("status", ["LOCKED", "locked", "unactivated", "UNACTIVATED"])
        .select("tag_code");

      if (!tagErr && Array.isArray(tagRows) && tagRows.length > 0) {
        updated = true;
      } else {
        lastError = tagErr
          ? `${tagErr.code || ""} ${tagErr.message}`
          : `0 rows updated for ${candidateCode}`;
      }

      if (!updated) continue;

      // مزامنة جدول stickers والمخازن المحلية
      try {
        await supabaseAdmin.from("stickers").upsert(
          {
            code: candidateCode,
            status: "active",
            package_type: pkg,
            features,
            owner_phone: params.ownerPhone,
            owner_name: params.ownerName,
            vehicle_info: vehicleLabel,
            activation_source: activationSource,
            subscription_starts_at: params.startsAt,
            subscription_expires_at: params.expiresAt,
            updated_at: params.startsAt,
          },
          { onConflict: "code" }
        );
      } catch {
        // ignore
      }

      syncTagActivationToLocalStore({
        tagCode: candidateCode,
        ownerPhone: params.ownerPhone,
        vehicleInfo: vehicleLabel,
        city: params.city,
        alertChannel,
        packageType: pkg,
        activationSource,
        subscriptionStartsAt: params.startsAt,
        subscriptionExpiresAt: params.expiresAt,
        activatedAt: params.startsAt,
      });

      const store = loadStore();
      store.stickers[candidateCode] = {
        code: candidateCode,
        status: "active",
        packageType: pkg,
        features,
        ownerPhone: params.ownerPhone,
        ownerName: params.ownerName,
        vehicleInfo: vehicleLabel,
        activationSource,
        subscriptionStartsAt: params.startsAt,
        subscriptionExpiresAt: params.expiresAt,
        createdAt: store.stickers[candidateCode]?.createdAt || params.startsAt,
        updatedAt: params.startsAt,
      };
      saveStore(store);

      return { ok: true, stickerCode: candidateCode };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: false,
    error:
      candidates.length === 0
        ? "لا توجد ملصقات متاحة بحالة LOCKED في المخزن حالياً."
        : `تعذر تفعيل الملصق (${candidates.length} متاح): ${lastError}`,
  };
}

export async function importStickerCodes(
  rawCodes: string[]
): Promise<{ ok: boolean; importedCount: number; codes: string[]; error?: string }> {
  const cleaned = Array.from(
    new Set(
      rawCodes
        .map((c) => formatBalaghniTagCode(c))
        .filter((c) => /^LY-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c))
    )
  );
  if (cleaned.length === 0) {
    return {
      ok: false,
      importedCount: 0,
      codes: [],
      error: "لم يتم العثور على أي أكواد صالحة بصيغة LY-XXXX-XXXX في الملف.",
    };
  }

  const nowIso = new Date().toISOString();
  const store = loadStore();

  for (const code of cleaned) {
    try {
      await supabaseAdmin.from("stickers").upsert(
        {
          code,
          status: "unactivated",
          package_type: "nabbihni",
          features: NABBIHNI_FEATURES,
          created_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "code" }
      );
      await supabaseAdmin.from("tags").upsert(
        {
          tag_code: code,
          status: "LOCKED",
          type: "car",
          package_type: "nabbihni",
          features: NABBIHNI_FEATURES,
          updated_at: nowIso,
        },
        { onConflict: "tag_code" }
      );
    } catch {
      // ignore
    }

    store.stickers[code] = {
      code,
      status: "unactivated",
      packageType: "nabbihni",
      features: NABBIHNI_FEATURES,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  saveStore(store);
  return { ok: true, importedCount: cleaned.length, codes: cleaned };
}

export async function assignOrderToSticker(
  orderIdOrCode: string,
  stickerCode: string
): Promise<{ ok: boolean; error?: string }> {
  const code = formatBalaghniTagCode(stickerCode);
  if (!code) {
    return { ok: false, error: "يرجى تحديد كود ملصق صحيح." };
  }

  const orders = await listAllOrders();
  const target = orders.find(
    (o) => o.id === orderIdOrCode || o.orderCode === orderIdOrCode
  );
  if (!target) {
    return { ok: false, error: "الطلب غير موجود." };
  }

  const res = await activateStickerAtomic({
    code,
    packageType: target.packageType,
    ownerPhone: target.customerPhone,
    ownerName: target.customerName,
    vehicleInfo: target.vehicleModel || undefined,
    activationSource:
      target.paymentMethod === "online" ? "online" : "cod_delivered",
    durationDays: 365,
  });
  if (!res.ok) {
    return { ok: false, error: res.error || "تعذر تفعيل الملصق المختار." };
  }

  try {
    await supabaseAdmin
      .from("orders")
      .update({
        status: "completed",
        assigned_tag_code: code,
        payment_status: "paid",
      })
      .or(`id.eq.${target.id},order_code.eq.${target.orderCode}`);
  } catch {
    // ignore
  }

  const store = loadStore();
  const idx = store.orders.findIndex(
    (o) => o.id === target.id || o.orderCode === target.orderCode
  );
  if (idx >= 0) {
    store.orders[idx].status = "completed";
    store.orders[idx].assignedTagCode = code;
    store.orders[idx].paymentStatus = "paid";
    saveStore(store);
  }

  await sendWhatsappAlertMessage(
    target.customerPhone,
    `✅ مرحباً ${target.customerName}، تم ربط طلبك (${target.orderCode}) بملصق «بَلِّغْنِي» الخاص بك!\nكود الملصق: ${code}\nالباقة: ${target.packageType === "basic" ? "الباقة الأساسية (50 د.ل)" : "باقة نَبِّهْنِي (100 د.ل)"}\nرابط لوحة التحكم: https://www.balaghni.ly/login\nرابط صفحة الملصق: https://www.balaghni.ly/s/${code}`
  );

  return { ok: true };
}

export async function wipeAllOldData(): Promise<{
  ok: boolean;
  clearedTables: string[];
}> {
  const tables = [
    "reports",
    "vehicle_documents",
    "maintenance_records",
    "gift_redemptions",
    "corporate_leads",
    "vendor_settlements",
    "orders",
    "stickers",
    "tags",
    "vendors",
    "admin_audit_logs",
  ];
  const clearedTables: string[] = [];

  for (const tbl of tables) {
    try {
      const { error } = await supabaseAdmin
        .from(tbl)
        .delete()
        .neq("created_at", "1970-01-01T00:00:00Z");
      if (!error) {
        clearedTables.push(tbl);
      } else {
        // Fallback delete condition in case created_at isn't present or null
        const pk = tbl === "stickers" ? "code" : tbl === "tags" ? "tag_code" : "id";
        const { error: err2 } = await supabaseAdmin
          .from(tbl)
          .delete()
          .neq(pk, "__never_match__");
        if (!err2) clearedTables.push(tbl);
      }
    } catch {
      // ignore missing tables
    }
  }

  saveStore({
    stickers: {},
    vendors: [],
    settlements: [],
    giftRedemptions: {},
    corporateLeads: [],
    unassignedPaidOrders: [],
    orders: [],
  });

  for (const fname of ["local-tags-store.json", "local-admin-store.json"]) {
    try {
      const fpath = path.join(process.cwd(), "src", "data", fname);
      if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
    } catch {
      // ignore
    }
  }

  return { ok: true, clearedTables };
}
