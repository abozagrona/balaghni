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
  getPackageConfig,
  getPackagePriceLyd,
  NABBIHNI_FEATURES,
  normalizePackageType,
  resolvePlanType,
  type PackageFeatures,
  type PackageType,
  type PlanType,
} from "@/lib/packages";
import { formatBalaghniTagCode } from "@/lib/utils";

let schemaMigrationPromise: Promise<void> | null = null;

export async function ensurePlanSchemaAndFixTag(): Promise<void> {
  if (schemaMigrationPromise) return schemaMigrationPromise;
  schemaMigrationPromise = (async () => {
    try {
      await supabaseAdmin
        .from("tags")
        .update({ notification_channel: "WHATSAPP" })
        .eq("tag_code", "LY-Y8D8-J4XH");
    } catch {
      // ignore
    }
    try {
      await supabaseAdmin
        .from("tags")
        .update({
          plan_type: "basic",
          package_type: "basic",
          notification_channel: "WHATSAPP",
        })
        .eq("tag_code", "LY-Y8D8-J4XH");
    } catch {
      // ignore if extended columns not in cache
    }
    try {
      await supabaseAdmin.from("stickers").upsert(
        {
          code: "LY-Y8D8-J4XH",
          status: "active",
          plan_type: "basic",
          package_type: "basic",
          features: getDefaultFeaturesForPackage("basic"),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "code" }
      );
    } catch {
      // ignore
    }
  })();
  return schemaMigrationPromise;
}

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
  planType?: PlanType;
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

export interface SalesLedgerEntry {
  id: string;
  tagCode: string;
  customerName: string;
  operationType: "new_sale" | "gift_upgrade" | "gift_free";
  packageType: PackageType | "gift";
  amountLyd: number;
  paymentMethod: "cash" | "online" | "free";
  custodyStatus: "open" | "closed" | "settled";
  createdAt: string;
}

export interface CustodyClosureRecord {
  id: string;
  closedAt: string;
  closedBy: string;
  totalLyd: number;
  count: number;
  entryIds: string[];
}

interface LocalLifecycleStore {
  stickers: Record<string, StickerRecord>;
  vendors: VendorRecord[];
  settlements: VendorSettlementRecord[];
  giftRedemptions: Record<string, { phone: string; stickerCode: string; redeemedAt: string }>;
  corporateLeads: CorporateLeadRecord[];
  unassignedPaidOrders: UnassignedPaidOrderRecord[];
  orders: OrderRecord[];
  salesLedger?: SalesLedgerEntry[];
  custodyClosures?: CustodyClosureRecord[];
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
        salesLedger: Array.isArray(parsed.salesLedger) ? parsed.salesLedger : [],
        custodyClosures: Array.isArray(parsed.custodyClosures)
          ? parsed.custodyClosures
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
    orders: [],
    salesLedger: [],
    custodyClosures: [],
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
  await ensurePlanSchemaAndFixTag();
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
      const planType = resolvePlanType({
        planType: data.plan_type ? String(data.plan_type) : null,
        packageType: data.package_type ? String(data.package_type) : null,
        activationSource: data.activation_source ? String(data.activation_source) : null,
      });
      const pkg: PackageType =
        planType === "basic" ? "basic" : normalizePackageType(data.package_type || "nabbihni");
      const defaultFeatures = getDefaultFeaturesForPackage(planType);
      return {
        code,
        status,
        vendorId: data.vendor_id || null,
        activationSource: data.activation_source || null,
        activatedByVendorId: data.activated_by_vendor_id || null,
        planType,
        packageType: pkg,
        features:
          planType === "basic"
            ? defaultFeatures
            : (data.features as PackageFeatures) || defaultFeatures,
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
    const rec = { ...store.stickers[code] };
    const resolvedPlan = resolvePlanType({
      planType: rec.planType,
      packageType: rec.packageType,
      activationSource: rec.activationSource,
    });
    rec.planType = resolvedPlan;
    rec.packageType = resolvedPlan === "basic" ? "basic" : "nabbihni";
    rec.features = getDefaultFeaturesForPackage(resolvedPlan);
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
      const planType = resolvePlanType({
        planType: tag.plan_type ? String(tag.plan_type) : null,
        packageType: tag.package_type ? String(tag.package_type) : null,
        activationSource: tag.activation_source ? String(tag.activation_source) : null,
        notificationChannel: tag.notification_channel ? String(tag.notification_channel) : null,
        defaultPlan: "basic",
      });
      const defaultDurationDays = planType === "gift" ? 30 : 365;
      const startsAt = tag.subscription_starts_at
        ? String(tag.subscription_starts_at)
        : tag.activated_at
        ? String(tag.activated_at)
        : null;
      const expiresAt = tag.subscription_expires_at
        ? String(tag.subscription_expires_at)
        : startsAt
        ? addDaysIso(startsAt, defaultDurationDays)
        : null;

      let status: StickerStatus =
        rawStatus === "ACTIVE" ? "active" : "unactivated";
      if (status === "active" && expiresAt && new Date(expiresAt).getTime() < Date.now()) {
        status = "expired";
      }
      const pkg: PackageType = planType === "basic" ? "basic" : "nabbihni";
      return {
        code,
        status,
        vendorId: tag.vendor_id || null,
        activationSource:
          tag.activation_source || (planType === "gift" ? "gift_promo" : null),
        activatedByVendorId: tag.activated_by_vendor_id || null,
        planType,
        packageType: pkg,
        features: getDefaultFeaturesForPackage(planType),
        ownerPhone: tag.owner_phone || null,
        vehicleInfo: tag.vehicle_make_model || tag.vehicle_info || null,
        subscriptionStartsAt: startsAt,
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
  planType?: PlanType;
  packageType: PackageType;
  features: PackageFeatures;
  ownerPhone: string;
  vehicleInfo?: string;
  startsAt: string;
  expiresAt: string;
  vendorId?: string | null;
  activationSource: ActivationSource;
}) {
  const planType: PlanType =
    params.planType ||
    resolvePlanType({
      packageType: params.packageType,
      activationSource: params.activationSource,
    });
  const alertChannel =
    planType === "basic" ? "WHATSAPP" : planType === "gift" ? "SMS" : "BOTH";
  const vehicleLabel = params.vehicleInfo || "مركبة مفعلة";
  try {
    const { error } = await supabaseAdmin
      .from("tags")
      .update({
        status: "ACTIVE",
        owner_phone: params.ownerPhone,
        vehicle_make_model: vehicleLabel,
        notification_channel: alertChannel,
        plan_type: planType,
        package_type: planType,
        subscription_starts_at: params.startsAt,
        subscription_expires_at: params.expiresAt,
        activation_source: params.activationSource,
        activated_at: params.startsAt,
      })
      .eq("tag_code", params.code);
    if (error) {
      await supabaseAdmin
        .from("tags")
        .update({
          status: "ACTIVE",
          owner_phone: params.ownerPhone,
          vehicle_make_model: vehicleLabel,
          notification_channel: alertChannel,
          activated_at: params.startsAt,
        })
        .eq("tag_code", params.code);
    }
  } catch {
    // ignore if remote tags columns differ
  }
  syncTagActivationToLocalStore({
    tagCode: params.code,
    ownerPhone: params.ownerPhone,
    vehicleInfo: vehicleLabel,
    city: "طرابلس",
    alertChannel,
    packageType: planType,
    activationSource: params.activationSource,
    subscriptionStartsAt: params.startsAt,
    subscriptionExpiresAt: params.expiresAt,
    activatedAt: params.startsAt,
  });
}

export async function activateStickerAtomic(params: {
  code: string;
  planType?: PlanType;
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
  await ensurePlanSchemaAndFixTag();
  const code = formatBalaghniTagCode(params.code);
  const planType: PlanType =
    params.planType ||
    resolvePlanType({
      packageType: params.packageType,
      activationSource: params.activationSource,
    });
  const pkg: PackageType =
    planType === "basic" ? "basic" : normalizePackageType(params.packageType);
  const features =
    params.customFeatures || getDefaultFeaturesForPackage(planType);
  const startsAt = new Date().toISOString();
  const expiresAt = addDaysIso(
    startsAt,
    params.durationDays ?? (planType === "gift" ? 30 : 365)
  );
  // حماية أمنية: منع إعادة ربط أو تجديد ملصق مرتبط بمالك سابق لهاتف مختلف غير مصرح به
  const currentSticker = await getStickerLifecycle(code);
  const isGiftUpgrade = Boolean(
    currentSticker &&
      (currentSticker.planType === "gift" ||
        currentSticker.activationSource === "gift_promo") &&
      planType !== "gift"
  );
  const allowedStatuses = isGiftUpgrade
    ? ["unactivated", "gift_ready", "active", "expired"]
    : params.allowExpiredRenewal
    ? ["unactivated", "expired"]
    : ["unactivated"];

  if (
    currentSticker &&
    currentSticker.ownerPhone &&
    currentSticker.ownerPhone.trim() &&
    currentSticker.ownerPhone.trim() !== "-"
  ) {
    const existingDigits = currentSticker.ownerPhone.replace(/[^\d]/g, "").slice(-9);
    const callerDigits = params.ownerPhone.replace(/[^\d]/g, "").slice(-9);
    if (existingDigits && callerDigits && existingDigits !== callerDigits) {
      return {
        ok: false,
        error: "هذا الملصق مسجل باسم مالك آخر؛ لا يمكن إعادة ربطه أو تجديده بهاتف مختلف.",
      };
    }
  }
  if (currentSticker && !allowedStatuses.includes(currentSticker.status)) {
    return {
      ok: false,
      error: "هذا الملصق مفعل مسبقاً ولا يمكن إعادة تفعيله.",
    };
  }

  // 1. محاولة التحديث الذري في Supabase بشرط WHERE code = $code AND status = 'unactivated'
  try {
    const { data: updatedRows, error: updateErr } = await supabaseAdmin
      .from("stickers")
      .update({
        status: "active",
        plan_type: planType,
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
          planType,
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
            totalLyd: getPackagePriceLyd(planType),
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
            `✅ تم تفعيل ملصق «بَلِّغْنِي» (${code}) بنجاح!\nالباقة: ${planType === "basic" ? "الباقة الأساسية (50 د.ل)" : planType === "gift" ? "باقة الهدية (شهر مجاني)" : "باقة نَبِّهْنِي (100 د.ل)"}\nصالح حتى: ${expiresAt.slice(0, 10)}\nرابط لوحة التحكم: https://www.balaghni.ly/login`
          );
          await sendWhatsappAlertMessage(
            getAdminWhatsappNumber(),
            `✅ تفعيل أونلاين مباشر لملصق (${code})\nالباقة: ${planType}\nالهاتف: ${params.ownerPhone}\nالاسم: ${params.ownerName || "-"}`
          );
        }
        await recordSaleTransaction({
          tagCode: code,
          customerName: params.ownerName || params.ownerPhone,
          operationType: isGiftUpgrade
            ? "gift_upgrade"
            : planType === "gift"
            ? "gift_free"
            : "new_sale",
          packageType: pkg,
          amountLyd: planType === "gift" ? 0 : getPackagePriceLyd(planType),
          paymentMethod:
            planType === "gift"
              ? "free"
              : params.activationSource === "online"
              ? "online"
              : "cash",
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
    planType,
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
    planType,
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
  await ensurePlanSchemaAndFixTag();
  const code = formatBalaghniTagCode(params.code);
  const cleanPhone = params.phone.replace(/[^\d]/g, "");
  if (!cleanPhone) {
    return { ok: false, error: "يرجى إدخال رقم هاتف ليبي صحيح." };
  }

  const existing = await getStickerLifecycle(code);
  if (
    existing &&
    existing.ownerPhone &&
    existing.ownerPhone.trim() &&
    existing.ownerPhone.trim() !== "-"
  ) {
    return {
      ok: false,
      alreadyRedeemed: true,
      error: "تم ربط ملصق الهدية هذا برقم هاتف مسبقاً.",
    };
  }

  const store = loadStore();
  const nowIso = new Date().toISOString();
  const expiresAt = addDaysIso(nowIso, 30);

  try {
    await supabaseAdmin
      .from("stickers")
      .upsert(
        {
          code,
          status: "active",
          activation_source: "gift_promo",
          plan_type: "gift",
          package_type: "nabbihni",
          features: NABBIHNI_FEATURES,
          owner_phone: params.phone,
          owner_name: params.ownerName || null,
          vehicle_info: params.vehicleInfo || null,
          subscription_starts_at: nowIso,
          subscription_expires_at: expiresAt,
          updated_at: nowIso,
        },
        { onConflict: "code" }
      );
  } catch {
    // ignore
  }

  const rec: StickerRecord = {
    code,
    status: "active",
    activationSource: "gift_promo",
    planType: "gift",
    packageType: "nabbihni",
    features: NABBIHNI_FEATURES,
    ownerPhone: params.phone,
    ownerName: params.ownerName || null,
    vehicleInfo: params.vehicleInfo || null,
    subscriptionStartsAt: nowIso,
    subscriptionExpiresAt: expiresAt,
    createdAt: store.stickers[code]?.createdAt || nowIso,
    updatedAt: nowIso,
  };
  store.stickers[code] = rec;
  saveStore(store);

  await syncTagActivationRecord({
    code,
    planType: "gift",
    packageType: "nabbihni",
    features: NABBIHNI_FEATURES,
    ownerPhone: params.phone,
    vehicleInfo: params.vehicleInfo,
    startsAt: nowIso,
    expiresAt,
    activationSource: "gift_promo",
  });

  await recordSaleTransaction({
    tagCode: code,
    customerName: params.ownerName || params.phone,
    operationType: "gift_free",
    packageType: "gift",
    amountLyd: 0,
    paymentMethod: "free",
  });

  await sendWhatsappAlertMessage(
    params.phone,
    `🎁 مبروك! تم ربط وتفعيل ملصق الهدية (${code}) على سيارتك مجاناً لمدة 30 يوماً بكامل مزايا باقة نَبِّهْنِي.\nتنتهي الفترة المجانية بتاريخ ${expiresAt.slice(0, 10)}.`
  );

  return { ok: true, sticker: rec };
}

export async function linkPrepaidSticker(params: {
  code: string;
  phone: string;
  ownerName?: string;
  vehicleInfo?: string;
}): Promise<{
  ok: boolean;
  alreadyLinked?: boolean;
  sticker?: StickerRecord;
  error?: string;
}> {
  await ensurePlanSchemaAndFixTag();
  const code = formatBalaghniTagCode(params.code);
  const cleanPhone = params.phone.replace(/[^\d]/g, "");
  if (!cleanPhone) {
    return { ok: false, error: "يرجى إدخال رقم هاتف ليبي صحيح." };
  }

  const existing = await getStickerLifecycle(code);
  if (!existing || existing.status === "unactivated") {
    return {
      ok: false,
      error: "هذا الملصق غير مدفوع أو غير مفعل مسبقاً.",
    };
  }

  if (
    existing.ownerPhone &&
    existing.ownerPhone.trim() &&
    existing.ownerPhone.trim() !== "-"
  ) {
    return {
      ok: false,
      alreadyLinked: true,
      error: "تم ربط هذا الملصق بحساب مالك آخر مسبقاً.",
    };
  }

  const store = loadStore();
  const nowIso = new Date().toISOString();
  const planType = existing.planType || "nabbihni";
  const pkg: PackageType = planType === "basic" ? "basic" : "nabbihni";
  const features = getDefaultFeaturesForPackage(planType);
  const durationDays = planType === "gift" ? 30 : 365;
  const startsAt = existing.subscriptionStartsAt || nowIso;
  const expiresAt =
    existing.subscriptionExpiresAt || addDaysIso(startsAt, durationDays);
  const activationSource: ActivationSource =
    existing.activationSource || "vendor_cash";

  try {
    await supabaseAdmin
      .from("stickers")
      .upsert(
        {
          code,
          status: "active",
          activation_source: activationSource,
          plan_type: planType,
          package_type: pkg,
          features,
          owner_phone: params.phone,
          owner_name: params.ownerName || null,
          vehicle_info: params.vehicleInfo || null,
          vendor_id: existing.vendorId || null,
          activated_by_vendor_id: existing.activatedByVendorId || null,
          subscription_starts_at: startsAt,
          subscription_expires_at: expiresAt,
          updated_at: nowIso,
        },
        { onConflict: "code" }
      );
  } catch {
    // ignore
  }

  const rec: StickerRecord = {
    ...existing,
    status: "active",
    activationSource,
    planType,
    packageType: pkg,
    features,
    ownerPhone: params.phone,
    ownerName: params.ownerName || null,
    vehicleInfo: params.vehicleInfo || null,
    subscriptionStartsAt: startsAt,
    subscriptionExpiresAt: expiresAt,
    updatedAt: nowIso,
  };
  store.stickers[code] = rec;
  saveStore(store);

  await syncTagActivationRecord({
    code,
    planType,
    packageType: pkg,
    features,
    ownerPhone: params.phone,
    vehicleInfo: params.vehicleInfo,
    startsAt,
    expiresAt,
    vendorId: existing.activatedByVendorId || existing.vendorId,
    activationSource,
  });

  await sendWhatsappAlertMessage(
    params.phone,
    `✅ تم ربط ملصق «بَلِّغْنِي» (${code}) بحسابك بنجاح!\nالباقة: ${planType === "gift" ? "باقة هدية - شهر مجاني" : pkg === "basic" ? "الباقة الأساسية" : "باقة نَبِّهْنِي"}\nصالح حتى: ${expiresAt.slice(0, 10)}\nلوحة التحكم: https://www.balaghni.ly/dashboard`
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
  const generatedPin = params.pin && params.pin.trim()
    ? params.pin.trim()
    : String(crypto.randomInt(100000, 1000000));
  const pinHash = hashPinSimple(generatedPin);
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
  customerPhone?: string;
  customerName?: string;
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

  const cleanPhone = String(params.customerPhone || "").trim();
  const res = await activateStickerAtomic({
    code,
    packageType: params.packageType,
    ownerPhone: cleanPhone || "",
    ownerName: params.customerName || "",
    activationSource: "vendor_cash",
    vendorId: params.vendorId,
    durationDays: 365,
  });

  if (res.ok && cleanPhone) {
    await sendWhatsappAlertMessage(
      cleanPhone,
      `🎉 تم تفعيل ملصق «بَلِّغْنِي» (${code}) بنجاح لمدة سنة كاملة!\nيرجى الدخول لحسابك على https://www.balaghni.ly/dashboard?tag=${code} لإكمال بيانات سيارتك.`
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

export interface GiftStickerItem {
  code: string;
  isLinked: boolean;
  ownerPhone: string | null;
  ownerName: string | null;
  vehicleInfo: string | null;
  subscriptionStartsAt: string | null;
  subscriptionExpiresAt: string | null;
  createdAt: string;
}

export interface GiftStickersSummary {
  totalGifts: number;
  linkedGifts: number;
  unlinkedGifts: number;
  items: GiftStickerItem[];
}

export async function importGiftStickers(
  rawCodes: string[]
): Promise<{ ok: boolean; importedCount: number; codes: string[]; error?: string }> {
  const codes = Array.from(
    new Set(
      rawCodes
        .map((c) => formatBalaghniTagCode(c))
        .filter((c) => /^LY-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c))
    )
  );
  if (codes.length === 0) {
    return {
      ok: false,
      importedCount: 0,
      codes: [],
      error: "لم يتم العثور على أكواد صالحة بصيغة LY-XXXX-XXXX.",
    };
  }

  const nowIso = new Date().toISOString();
  const store = loadStore();

  for (const code of codes) {
    const pinHash = crypto
      .createHash("sha256")
      .update(String(crypto.randomInt(100000, 1000000)))
      .digest("hex");

    try {
      const { error: tagErr } = await supabaseAdmin.from("tags").upsert(
        {
          tag_code: code,
          activation_pin_hash: pinHash,
          status: "ACTIVE",
          owner_phone: null,
          vehicle_make_model: null,
          vehicle_city: null,
          notification_channel: "SMS",
          plan_type: "gift",
          package_type: "gift",
          activation_source: "gift_promo",
          activated_at: nowIso,
        },
        { onConflict: "tag_code" }
      );
      if (tagErr) {
        await supabaseAdmin.from("tags").upsert(
          {
            tag_code: code,
            activation_pin_hash: pinHash,
            status: "ACTIVE",
            owner_phone: null,
            vehicle_make_model: null,
            vehicle_city: null,
            notification_channel: "SMS",
            activated_at: nowIso,
          },
          { onConflict: "tag_code" }
        );
      }
    } catch {
      // ignore
    }

    try {
      await supabaseAdmin.from("stickers").upsert(
        {
          code,
          status: "active",
          activation_source: "gift_promo",
          plan_type: "gift",
          package_type: "nabbihni",
          features: NABBIHNI_FEATURES,
          owner_phone: null,
          owner_name: null,
          vehicle_info: null,
          subscription_starts_at: null,
          subscription_expires_at: null,
          updated_at: nowIso,
        },
        { onConflict: "code" }
      );
    } catch {
      // ignore
    }

    store.stickers[code] = {
      code,
      status: "active",
      activationSource: "gift_promo",
      planType: "gift",
      packageType: "nabbihni",
      features: NABBIHNI_FEATURES,
      ownerPhone: null,
      ownerName: null,
      vehicleInfo: null,
      subscriptionStartsAt: null,
      subscriptionExpiresAt: null,
      createdAt: store.stickers[code]?.createdAt || nowIso,
      updatedAt: nowIso,
    };
  }

  saveStore(store);
  return { ok: true, importedCount: codes.length, codes };
}

export async function listGiftStickersSummary(): Promise<GiftStickersSummary> {
  const byCode = new Map<string, GiftStickerItem>();
  const store = loadStore();

  for (const s of Object.values(store.stickers)) {
    if (s.activationSource === "gift_promo" || s.status === "gift_ready") {
      const hasPhone = Boolean(
        s.ownerPhone && s.ownerPhone.trim() && s.ownerPhone.trim() !== "-"
      );
      byCode.set(s.code, {
        code: s.code,
        isLinked: hasPhone,
        ownerPhone: hasPhone ? s.ownerPhone || null : null,
        ownerName: s.ownerName || null,
        vehicleInfo: s.vehicleInfo || null,
        subscriptionStartsAt: s.subscriptionStartsAt || null,
        subscriptionExpiresAt: s.subscriptionExpiresAt || null,
        createdAt: s.createdAt,
      });
    }
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("stickers")
      .select("*")
      .eq("activation_source", "gift_promo")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (!error && Array.isArray(data)) {
      for (const row of data as Array<Record<string, unknown>>) {
        const code = formatBalaghniTagCode(String(row.code || ""));
        if (!code) continue;
        const rawPhone = row.owner_phone ? String(row.owner_phone).trim() : "";
        const hasPhone = Boolean(rawPhone && rawPhone !== "-");
        byCode.set(code, {
          code,
          isLinked: hasPhone,
          ownerPhone: hasPhone ? rawPhone : null,
          ownerName: row.owner_name ? String(row.owner_name) : null,
          vehicleInfo: row.vehicle_info ? String(row.vehicle_info) : null,
          subscriptionStartsAt: row.subscription_starts_at
            ? String(row.subscription_starts_at)
            : null,
          subscriptionExpiresAt: row.subscription_expires_at
            ? String(row.subscription_expires_at)
            : null,
          createdAt: String(row.created_at || row.updated_at || ""),
        });
      }
    }
  } catch {
    // ignore
  }

  const giftCodes = Array.from(byCode.keys());
  if (giftCodes.length > 0) {
    try {
      const { data: tagRows, error: tagErr } = await supabaseAdmin
        .from("tags")
        .select("tag_code,owner_phone,vehicle_make_model,activated_at")
        .in("tag_code", giftCodes);
      if (!tagErr && Array.isArray(tagRows)) {
        for (const row of tagRows as Array<Record<string, unknown>>) {
          const code = formatBalaghniTagCode(String(row.tag_code || ""));
          const existing = byCode.get(code);
          if (!existing) continue;
          const tagPhone = row.owner_phone ? String(row.owner_phone).trim() : "";
          const hasTagPhone = Boolean(tagPhone && tagPhone !== "-");
          if (hasTagPhone && !existing.isLinked) {
            existing.isLinked = true;
            existing.ownerPhone = tagPhone;
            existing.vehicleInfo =
              existing.vehicleInfo ||
              (row.vehicle_make_model ? String(row.vehicle_make_model) : null);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const nowMs = Date.now();
  const items = Array.from(byCode.values())
    .filter((item) => {
      if (
        item.subscriptionExpiresAt &&
        new Date(item.subscriptionExpiresAt).getTime() <= nowMs
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const linkedGifts = items.filter((i) => i.isLinked).length;
  return {
    totalGifts: items.length,
    linkedGifts,
    unlinkedGifts: items.length - linkedGifts,
    items,
  };
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
  subscriptionStartsAt?: string | null;
  subscriptionExpiresAt?: string | null;
  skipAdminWhatsapp?: boolean;
}): Promise<{ ok: boolean; order: OrderRecord; supabaseSaved: boolean }> {
  const nowIso = new Date().toISOString();
  const startsAtVal = params.subscriptionStartsAt ?? null;
  const expiresAtVal = params.subscriptionExpiresAt ?? null;
  const orderStatus =
    params.status ||
    (params.assignedTagCode ? "completed" : "pending_assignment");
  let id = `ord_${Date.now().toString(36)}`;
  let finalOrderCode = params.orderCode;
  let supabaseSaved = false;

  const tryInsertOrder = async (codeToUse: string) => {
    const fullPayload = {
      order_code: codeToUse,
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
      subscription_starts_at: startsAtVal,
      subscription_expires_at: expiresAtVal,
      created_at: nowIso,
    };

    const first = await supabaseAdmin
      .from("orders")
      .insert(fullPayload)
      .select("id")
      .single();

    if (!first.error && first.data?.id) {
      return { ok: true, id: String(first.data.id), code: codeToUse };
    }

    if (first.error?.code === "23505") {
      return { ok: false, duplicate: true, error: first.error };
    }

    // Fallback to base columns if extended columns are not yet present, then update extended columns individually
    const base = await supabaseAdmin
      .from("orders")
      .insert({
        order_code: codeToUse,
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

    if (!base.error && base.data?.id) {
      const insertedId = String(base.data.id);
      const extCols: Record<string, unknown> = {
        payment_method: params.paymentMethod,
        payment_status: params.paymentStatus,
        assigned_tag_code: params.assignedTagCode || null,
        subscription_starts_at: startsAtVal,
        subscription_expires_at: expiresAtVal,
      };
      for (const [col, val] of Object.entries(extCols)) {
        try {
          await supabaseAdmin
            .from("orders")
            .update({ [col]: val })
            .eq("id", insertedId);
        } catch {
          // ignore missing column
        }
      }
      return { ok: true, id: insertedId, code: codeToUse };
    }

    if (base.error?.code === "23505") {
      return { ok: false, duplicate: true, error: base.error };
    }

    console.error("[recordMarketplaceOrder] Supabase insert failed:", first.error || base.error);
    return { ok: false, duplicate: false, error: first.error || base.error };
  };

  try {
    let attempt = await tryInsertOrder(finalOrderCode);
    if (!attempt.ok && attempt.duplicate) {
      finalOrderCode = `${params.orderCode}-${Date.now().toString(36).toUpperCase()}`;
      attempt = await tryInsertOrder(finalOrderCode);
    }
    if (attempt.ok && attempt.id) {
      id = attempt.id;
      finalOrderCode = attempt.code || finalOrderCode;
      supabaseSaved = true;
    }
  } catch (err) {
    console.error("[recordMarketplaceOrder] unexpected error:", err);
  }

  const order: OrderRecord = {
    id,
    orderCode: finalOrderCode,
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
    subscriptionStartsAt: startsAtVal,
    subscriptionExpiresAt: expiresAtVal,
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
        const rowStatus = String(
          row.status ||
            existingLocal?.status ||
            (row.assigned_tag_code ? "completed" : "pending_assignment")
        );
        const isPendingOrCancelled =
          rowStatus === "pending_delivery" ||
          rowStatus === "cancelled" ||
          String(row.payment_status || "") === "pending_cod";

        const startsAt = isPendingOrCancelled
          ? row.subscription_starts_at || null
          : row.subscription_starts_at ||
            existingLocal?.subscriptionStartsAt ||
            row.created_at;
        let expiresAt = isPendingOrCancelled
          ? row.subscription_expires_at || null
          : row.subscription_expires_at ||
            existingLocal?.subscriptionExpiresAt ||
            null;
        if (!isPendingOrCancelled && !expiresAt && startsAt) {
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

  // ضمان ظهور أي ملصق حالته LOCKED ويحتوي على رقم هاتف زبون (وليس هدية منتهية) في تبويب «الطلبات الواردة»
  try {
    const existingAssignedSet = new Set<string>();
    for (const ord of byCode.values()) {
      if (
        ord.status === "pending_delivery" ||
        ord.paymentStatus === "pending_cod"
      ) {
        const c = String(ord.assignedTagCode || ord.orderCode || "")
          .trim()
          .toUpperCase();
        if (c) existingAssignedSet.add(c);
      }
    }

    const { data: lockedWithPhone } = await supabaseAdmin
      .from("tags")
      .select("*")
      .eq("status", "LOCKED")
      .not("owner_phone", "is", null)
      .limit(200);

    if (Array.isArray(lockedWithPhone)) {
      const nowMs = Date.now();
      for (const row of lockedWithPhone as Array<Record<string, unknown>>) {
        const code = String(row.tag_code || "").trim().toUpperCase();
        const phone = String(row.owner_phone || "").trim();
        if (!code || !phone || phone === "-" || existingAssignedSet.has(code)) {
          continue;
        }
        const pkgRaw = String(row.package_type || row.plan_type || "").toLowerCase();
        const srcRaw = String(row.activation_source || "").toLowerCase();
        const expIso = row.subscription_expires_at
          ? String(row.subscription_expires_at)
          : null;
        const isExpiredGift =
          (pkgRaw === "gift" || srcRaw === "gift_promo") &&
          expIso &&
          new Date(expIso).getTime() <= nowMs;
        if (isExpiredGift) continue;

        const pkgType = normalizePackageType(pkgRaw || "basic");
        const pkgCfg = getPackageConfig(pkgType);
        byCode.set(`COD-${code}`, {
          id: `tag_${code}`,
          orderCode: code,
          customerName: String(
            row.owner_name || row.vehicle_make_model || row.vehicle_info || phone
          ),
          customerPhone: phone,
          city: String(row.city || row.vehicle_city || "طرابلس"),
          address: String(row.city || row.vehicle_city || "—"),
          vehicleModel: row.vehicle_make_model
            ? String(row.vehicle_make_model)
            : row.vehicle_info
            ? String(row.vehicle_info)
            : null,
          packageType: pkgType,
          quantity: 1,
          totalLyd: Number(pkgCfg.priceLyd || 100),
          paymentMethod: "cod",
          paymentStatus: "pending_cod",
          assignedTagCode: code,
          status: "pending_delivery",
          subscriptionStartsAt: null,
          subscriptionExpiresAt: null,
          createdAt: String(row.created_at || new Date().toISOString()),
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

  const giftCodes = new Set<string>();
  try {
    const { data, error } = await supabaseAdmin
      .from("stickers")
      .select("code,status,activation_source")
      .order("created_at", { ascending: true })
      .limit(500);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const formatted = row.code ? formatBalaghniTagCode(String(row.code)) : "";
        if (!formatted) continue;
        if (String(row.activation_source || "") === "gift_promo") {
          giftCodes.add(formatted);
          codes.delete(formatted);
          continue;
        }
        const st = String(row.status || "").trim().toUpperCase();
        if (st === "UNACTIVATED" || st === "LOCKED") {
          codes.add(formatted);
        }
      }
    }
  } catch {
    // ignore
  }

  const store = loadStore();
  for (const s of Object.values(store.stickers)) {
    const formatted = formatBalaghniTagCode(s.code);
    if (s.activationSource === "gift_promo" || giftCodes.has(formatted)) {
      codes.delete(formatted);
      continue;
    }
    const st = String(s.status || "").trim().toUpperCase();
    if (st === "UNACTIVATED" || st === "LOCKED") {
      codes.add(formatted);
    }
  }

  return Array.from(codes).filter((c) => !giftCodes.has(c));
}

export async function pullAndActivateLockedTag(params: {
  planType?: PlanType;
  packageType: PackageType;
  ownerPhone: string;
  ownerName: string;
  vehicleInfo?: string | null;
  city: string;
  paymentMethod: "online" | "cod";
  startsAt: string;
  expiresAt: string;
}): Promise<{ ok: boolean; stickerCode?: string; error?: string }> {
  await ensurePlanSchemaAndFixTag();
  const planType: PlanType =
    params.planType ||
    resolvePlanType({
      packageType: params.packageType,
    });
  const pkg: PackageType =
    planType === "basic" ? "basic" : normalizePackageType(params.packageType);
  const features = getDefaultFeaturesForPackage(planType);
  const alertChannel =
    planType === "basic" ? "WHATSAPP" : planType === "gift" ? "SMS" : "BOTH";
  const activationSource =
    params.paymentMethod === "online" ? "online" : "cod_delivered";
  const vehicleLabel =
    String(params.vehicleInfo || "").trim() || params.ownerName || "مركبة مسجلة";

  const [rawCandidates, allOrders] = await Promise.all([
    listAvailableStickers(),
    listAllOrders(),
  ]);
  const reservedSet = new Set(
    allOrders
      .filter(
        (o) =>
          o.status === "pending_delivery" || o.paymentStatus === "pending_cod"
      )
      .map((o) => String(o.assignedTagCode || o.orderCode || "").toUpperCase())
      .filter(Boolean)
  );
  const candidates = rawCandidates.filter(
    (c) => !reservedSet.has(c.toUpperCase())
  );
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
        .eq("status", "LOCKED")
        .select("tag_code");

      if (!tagErr && Array.isArray(tagRows) && tagRows.length > 0) {
        updated = true;
        const extFields: Record<string, unknown> = {
          package_type: pkg,
          activation_source: activationSource,
          subscription_starts_at: params.startsAt,
          subscription_expires_at: params.expiresAt,
          owner_name: params.ownerName || null,
          alert_channel: alertChannel,
          vehicle_info: vehicleLabel,
          city: params.city,
          plan_type: planType,
        };
        for (const [col, val] of Object.entries(extFields)) {
          try {
            await supabaseAdmin
              .from("tags")
              .update({ [col]: val })
              .eq("tag_code", candidateCode);
          } catch {
            // ignore missing column
          }
        }
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
            plan_type: planType,
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
        packageType: planType,
        activationSource,
        subscriptionStartsAt: params.startsAt,
        subscriptionExpiresAt: params.expiresAt,
        activatedAt: params.startsAt,
      });

      const store = loadStore();
      store.stickers[candidateCode] = {
        code: candidateCode,
        status: "active",
        planType,
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

      if (params.paymentMethod === "online") {
        await recordSaleTransaction({
          tagCode: candidateCode,
          customerName: params.ownerName || params.ownerPhone,
          operationType: "new_sale",
          packageType: pkg,
          amountLyd: getPackagePriceLyd(pkg),
          paymentMethod: "online",
        });
      }

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

/**
 * حجز ملصق متاح بحالة LOCKED لطلب «الدفع كاش عند الاستلام» دون تفعيله أو بدء عداد الاشتراك
 */
export async function pullAndReserveCodTag(params: {
  planType?: PlanType;
  packageType: PackageType;
  ownerPhone: string;
  ownerName: string;
  vehicleInfo?: string | null;
  city: string;
}): Promise<{ ok: boolean; stickerCode?: string; error?: string }> {
  await ensurePlanSchemaAndFixTag();
  const planType: PlanType =
    params.planType || resolvePlanType({ packageType: params.packageType });
  const pkg: PackageType =
    planType === "basic" ? "basic" : normalizePackageType(params.packageType);
  const features = getDefaultFeaturesForPackage(planType);
  const vehicleLabel =
    String(params.vehicleInfo || "").trim() || params.ownerName || "مركبة مسجلة";
  const nowIso = new Date().toISOString();

  const [candidates, allOrders] = await Promise.all([
    listAvailableStickers(),
    listAllOrders(),
  ]);
  const reservedSet = new Set(
    allOrders
      .filter(
        (o) =>
          o.status === "pending_delivery" || o.paymentStatus === "pending_cod"
      )
      .map((o) => String(o.assignedTagCode || o.orderCode || "").toUpperCase())
      .filter(Boolean)
  );

  const candidateCode = candidates.find((c) => !reservedSet.has(c.toUpperCase()));
  if (!candidateCode) {
    return {
      ok: false,
      error: "لا توجد ملصقات متاحة (LOCKED) في المخزن حالياً لحجز الطلب.",
    };
  }

  // إبقاء الملصق بحالة LOCKED في جدول tags مع حفظ بيانات الزبون والسيارة دون تفعيله أو بدء عداد الاشتراك
  const alertChannel =
    planType === "basic" ? "WHATSAPP" : planType === "gift" ? "SMS" : "BOTH";
  try {
    await supabaseAdmin
      .from("tags")
      .update({
        status: "LOCKED",
        owner_phone: params.ownerPhone,
        vehicle_make_model: vehicleLabel,
        vehicle_city: params.city,
        notification_channel: alertChannel,
        activated_at: null,
      })
      .eq("tag_code", candidateCode);
  } catch {
    // ignore
  }
  const extReserveFields: Record<string, unknown> = {
    owner_name: params.ownerName || null,
    vehicle_info: vehicleLabel,
    city: params.city,
    package_type: pkg,
    alert_channel: alertChannel,
    activation_source: null,
    subscription_starts_at: null,
    subscription_expires_at: null,
  };
  for (const [col, val] of Object.entries(extReserveFields)) {
    try {
      await supabaseAdmin
        .from("tags")
        .update({ [col]: val })
        .eq("tag_code", candidateCode);
    } catch {
      // ignore missing column
    }
  }

  try {
    await supabaseAdmin.from("stickers").upsert(
      {
        code: candidateCode,
        status: "unactivated",
        plan_type: planType,
        package_type: pkg,
        features,
        owner_phone: params.ownerPhone,
        owner_name: params.ownerName,
        vehicle_info: vehicleLabel,
        activation_source: null,
        subscription_starts_at: null,
        subscription_expires_at: null,
        updated_at: nowIso,
      },
      { onConflict: "code" }
    );
  } catch {
    // ignore
  }

  const store = loadStore();
  store.stickers[candidateCode] = {
    code: candidateCode,
    status: "unactivated",
    planType,
    packageType: pkg,
    features,
    ownerPhone: params.ownerPhone,
    ownerName: params.ownerName,
    vehicleInfo: vehicleLabel,
    activationSource: "cod_pending" as StickerRecord["activationSource"],
    subscriptionStartsAt: null,
    subscriptionExpiresAt: null,
    createdAt: store.stickers[candidateCode]?.createdAt || nowIso,
    updatedAt: nowIso,
  };
  saveStore(store);

  return { ok: true, stickerCode: candidateCode };
}

/**
 * تأكيد تسليم ودفع طلب كاش عند الاستلام من لوحة الإدارة -> تفعيل الملصق وبدء عداد 365 يوماً وإرسال رسالة التفعيل
 */
export async function confirmCodOrderDelivery(params: {
  orderId?: string;
  orderCode?: string;
}): Promise<{ ok: boolean; stickerCode?: string; error?: string }> {
  const allOrders = await listAllOrders();
  const target = allOrders.find(
    (o) =>
      (params.orderId && o.id === params.orderId) ||
      (params.orderCode && o.orderCode === params.orderCode)
  );
  if (!target) {
    return { ok: false, error: "الطلب غير موجود في قاعدة البيانات." };
  }

  const tagCode = String(
    target.assignedTagCode || target.orderCode || ""
  )
    .trim()
    .toUpperCase();
  if (!tagCode) {
    return { ok: false, error: "لا يوجد كود ملصق مرتبط بهذا الطلب." };
  }

  const pkgType = normalizePackageType(target.packageType);
  const planType: PlanType = pkgType === "basic" ? "basic" : "nabbihni";
  const pkgConfig = getPackageConfig(pkgType);
  const features = getDefaultFeaturesForPackage(planType);
  const alertChannel = planType === "basic" ? "WHATSAPP" : "BOTH";
  const startsAt = new Date().toISOString();
  const expiresAt = addDaysIso(startsAt, 365);
  const vehicleLabel =
    String(target.vehicleModel || "").trim() ||
    target.customerName ||
    "مركبة مسجلة";

  try {
    await supabaseAdmin
      .from("tags")
      .update({
        status: "ACTIVE",
        owner_phone: target.customerPhone,
        vehicle_make_model: vehicleLabel,
        vehicle_city: target.city || "طرابلس",
        notification_channel: alertChannel,
        activated_at: startsAt,
      })
      .eq("tag_code", tagCode);
  } catch {
    // ignore
  }

  const extFields: Record<string, unknown> = {
    package_type: pkgType,
    activation_source: "cod_delivered",
    subscription_starts_at: startsAt,
    subscription_expires_at: expiresAt,
    owner_name: target.customerName || null,
    alert_channel: alertChannel,
    vehicle_info: vehicleLabel,
    city: target.city || "طرابلس",
    plan_type: planType,
  };
  for (const [col, val] of Object.entries(extFields)) {
    try {
      await supabaseAdmin
        .from("tags")
        .update({ [col]: val })
        .eq("tag_code", tagCode);
    } catch {
      // ignore missing column
    }
  }

  try {
    await supabaseAdmin.from("stickers").upsert(
      {
        code: tagCode,
        status: "active",
        plan_type: planType,
        package_type: pkgType,
        features,
        owner_phone: target.customerPhone,
        owner_name: target.customerName,
        vehicle_info: vehicleLabel,
        activation_source: "cod_delivered",
        subscription_starts_at: startsAt,
        subscription_expires_at: expiresAt,
        updated_at: startsAt,
      },
      { onConflict: "code" }
    );
  } catch {
    // ignore
  }

  syncTagActivationToLocalStore({
    tagCode,
    ownerPhone: target.customerPhone,
    vehicleInfo: vehicleLabel,
    city: target.city || "طرابلس",
    alertChannel,
    packageType: pkgType,
    activationSource: "cod_delivered",
    subscriptionStartsAt: startsAt,
    subscriptionExpiresAt: expiresAt,
    activatedAt: startsAt,
  });

  const store = loadStore();
  store.stickers[tagCode] = {
    code: tagCode,
    status: "active",
    planType,
    packageType: pkgType,
    features,
    ownerPhone: target.customerPhone,
    ownerName: target.customerName,
    vehicleInfo: vehicleLabel,
    activationSource: "cod_delivered",
    subscriptionStartsAt: startsAt,
    subscriptionExpiresAt: expiresAt,
    createdAt: store.stickers[tagCode]?.createdAt || startsAt,
    updatedAt: startsAt,
  };
  store.orders = store.orders.map((o) =>
    o.id === target.id || o.orderCode === target.orderCode
      ? {
          ...o,
          status: "completed",
          paymentStatus: "paid",
          assignedTagCode: tagCode,
          subscriptionStartsAt: startsAt,
          subscriptionExpiresAt: expiresAt,
        }
      : o
  );
  saveStore(store);

  try {
    await supabaseAdmin
      .from("orders")
      .update({
        status: "completed",
        payment_status: "paid",
        assigned_tag_code: tagCode,
        subscription_starts_at: startsAt,
        subscription_expires_at: expiresAt,
      })
      .eq("order_code", target.orderCode);
  } catch {
    // ignore
  }

  await recordSaleTransaction({
    tagCode,
    customerName: target.customerName || target.customerPhone,
    operationType: "new_sale",
    packageType: pkgType,
    amountLyd: getPackagePriceLyd(pkgType),
    paymentMethod: "cash",
  });

  await sendWhatsappAlertMessage(
    target.customerPhone,
    `✅ مرحباً ${target.customerName}، تم تأكيد استلام الدفع وتفعيل ملصق «بَلِّغْنِي» الخاص بك بنجاح!\nكود الملصق: ${tagCode}\nالباقة: ${pkgConfig.name}\nصالح لمدة 365 يوماً حتى: ${expiresAt.slice(0, 10)}\nرابط لوحة التحكم: https://www.balaghni.ly/login`
  );

  return { ok: true, stickerCode: tagCode };
}

/**
 * إلغاء طلب الدفع عند الاستلام وإعادة الملصق المحجوز إلى المخزون بحالة LOCKED
 */
export async function cancelCodOrder(params: {
  orderId?: string;
  orderCode?: string;
}): Promise<{ ok: boolean; stickerCode?: string; error?: string }> {
  const allOrders = await listAllOrders();
  const target = allOrders.find(
    (o) =>
      (params.orderId && o.id === params.orderId) ||
      (params.orderCode && o.orderCode === params.orderCode)
  );
  if (!target) {
    return { ok: false, error: "الطلب غير موجود في قاعدة البيانات." };
  }

  const tagCode = String(target.assignedTagCode || target.orderCode || "")
    .trim()
    .toUpperCase();

  try {
    await supabaseAdmin
      .from("orders")
      .update({
        status: "cancelled",
        payment_status: "cancelled",
        subscription_starts_at: null,
        subscription_expires_at: null,
      })
      .eq("order_code", target.orderCode);
  } catch {
    // ignore
  }

  const store = loadStore();
  store.orders = store.orders.map((o) =>
    o.id === target.id || o.orderCode === target.orderCode
      ? {
          ...o,
          status: "cancelled",
          paymentStatus: "cancelled",
          subscriptionStartsAt: null,
          subscriptionExpiresAt: null,
        }
      : o
  );

  if (tagCode && tagCode.startsWith("LY-")) {
    try {
      await supabaseAdmin
        .from("tags")
        .update({
          status: "LOCKED",
          owner_phone: null,
          activated_at: null,
        })
        .eq("tag_code", tagCode);
    } catch {
      // ignore
    }
    const clearFields: Record<string, unknown> = {
      owner_name: null,
      vehicle_make_model: null,
      vehicle_info: null,
      city: null,
      vehicle_city: null,
      package_type: null,
      activation_source: null,
      subscription_starts_at: null,
      subscription_expires_at: null,
    };
    for (const [col, val] of Object.entries(clearFields)) {
      try {
        await supabaseAdmin
          .from("tags")
          .update({ [col]: val })
          .eq("tag_code", tagCode);
      } catch {
        // ignore missing column
      }
    }
    try {
      await supabaseAdmin
        .from("stickers")
        .update({
          status: "unactivated",
          owner_phone: null,
          owner_name: null,
          vehicle_info: null,
          activation_source: null,
          subscription_starts_at: null,
          subscription_expires_at: null,
        })
        .eq("code", tagCode);
    } catch {
      // ignore
    }
    delete store.stickers[tagCode];
  }

  saveStore(store);
  return { ok: true, stickerCode: tagCode || undefined };
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
          plan_type: "basic",
          package_type: "basic",
          features: getDefaultFeaturesForPackage("basic"),
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
          package_type: "basic",
          features: getDefaultFeaturesForPackage("basic"),
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
      planType: "basic",
      packageType: "basic",
      features: getDefaultFeaturesForPackage("basic"),
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

// ============================================================================
// منظومة المبيعات والخزينة (إغلاق العُهَد) والتحويل إلى ملصق هدية (شهر مجاني)
// ============================================================================

export async function recordSaleTransaction(params: {
  tagCode: string;
  customerName?: string | null;
  operationType: "new_sale" | "gift_upgrade" | "gift_free";
  packageType: PackageType | "gift";
  amountLyd: number;
  paymentMethod: "cash" | "online" | "free";
  adminName?: string;
}): Promise<SalesLedgerEntry> {
  const nowIso = new Date().toISOString();
  const entry: SalesLedgerEntry = {
    id: `sale_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    tagCode: formatBalaghniTagCode(params.tagCode) || params.tagCode.toUpperCase(),
    customerName: String(params.customerName || "").trim() || "بدون اسم",
    operationType: params.operationType,
    packageType: params.packageType,
    amountLyd: Number(params.amountLyd || 0),
    paymentMethod: params.paymentMethod,
    custodyStatus: params.paymentMethod === "cash" ? "open" : "settled",
    createdAt: nowIso,
  };

  try {
    await supabaseAdmin.from("admin_audit_logs").insert({
      admin_name: params.adminName || "منظومة المبيعات",
      action_type: "SALE_RECORDED",
      target_item: entry.tagCode,
      details: JSON.stringify(entry),
      created_at: nowIso,
    });
  } catch {
    // ignore
  }

  const store = loadStore();
  store.salesLedger = [entry, ...(store.salesLedger || [])].slice(0, 1000);
  saveStore(store);
  return entry;
}

export async function getSalesAndTreasurySummary(): Promise<{
  openCashTotalLyd: number;
  openCashCount: number;
  todaySalesLyd: number;
  todayCount: number;
  monthSalesLyd: number;
  monthCount: number;
  yearSalesLyd: number;
  yearCount: number;
  entries: SalesLedgerEntry[];
  closures: CustodyClosureRecord[];
}> {
  const store = loadStore();
  const entryMap = new Map<string, SalesLedgerEntry>();
  const closureMap = new Map<string, CustodyClosureRecord>();

  for (const e of store.salesLedger || []) {
    entryMap.set(e.id, e);
  }
  for (const c of store.custodyClosures || []) {
    closureMap.set(c.id, c);
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("admin_audit_logs")
      .select("id,action_type,details,action_details,created_at")
      .in("action_type", ["SALE_RECORDED", "CUSTODY_CLOSED"])
      .order("created_at", { ascending: false })
      .limit(1000);

    if (!error && Array.isArray(data)) {
      for (const row of data as Array<Record<string, unknown>>) {
        const rawJson = String(row.details || row.action_details || "");
        if (!rawJson.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(rawJson);
          if (row.action_type === "SALE_RECORDED" && parsed?.id) {
            entryMap.set(String(parsed.id), parsed as SalesLedgerEntry);
          } else if (row.action_type === "CUSTODY_CLOSED" && parsed?.id) {
            closureMap.set(String(parsed.id), parsed as CustodyClosureRecord);
          }
        } catch {
          // ignore non-json audit rows
        }
      }
    }
  } catch {
    // ignore
  }

  const closures = Array.from(closureMap.values()).sort(
    (a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime()
  );
  const closedEntryIds = new Set<string>();
  for (const c of closures) {
    for (const id of c.entryIds || []) {
      closedEntryIds.add(id);
    }
  }
  const latestClosedAt = closures[0]?.closedAt
    ? new Date(closures[0].closedAt).getTime()
    : 0;

  const entries = Array.from(entryMap.values())
    .map((e) => {
      if (e.paymentMethod !== "cash") {
        return { ...e, custodyStatus: "settled" as const };
      }
      const isClosed =
        closedEntryIds.has(e.id) ||
        (latestClosedAt > 0 && new Date(e.createdAt).getTime() <= latestClosedAt);
      return {
        ...e,
        custodyStatus: (isClosed ? "closed" : "open") as "open" | "closed",
      };
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const monthStr = now.toISOString().slice(0, 7);
  const yearStr = now.toISOString().slice(0, 4);

  let openCashTotalLyd = 0;
  let openCashCount = 0;
  let todaySalesLyd = 0;
  let todayCount = 0;
  let monthSalesLyd = 0;
  let monthCount = 0;
  let yearSalesLyd = 0;
  let yearCount = 0;

  for (const e of entries) {
    if (e.paymentMethod === "cash" && e.custodyStatus === "open") {
      openCashTotalLyd += Number(e.amountLyd || 0);
      openCashCount += 1;
    }
    if (e.amountLyd > 0) {
      const dateStr = String(e.createdAt || "");
      if (dateStr.startsWith(todayStr)) {
        todaySalesLyd += Number(e.amountLyd);
        todayCount += 1;
      }
      if (dateStr.startsWith(monthStr)) {
        monthSalesLyd += Number(e.amountLyd);
        monthCount += 1;
      }
      if (dateStr.startsWith(yearStr)) {
        yearSalesLyd += Number(e.amountLyd);
        yearCount += 1;
      }
    }
  }

  return {
    openCashTotalLyd,
    openCashCount,
    todaySalesLyd,
    todayCount,
    monthSalesLyd,
    monthCount,
    yearSalesLyd,
    yearCount,
    entries,
    closures,
  };
}

export async function closeCashCustody(params: {
  adminName: string;
}): Promise<{ ok: boolean; closure?: CustodyClosureRecord; error?: string }> {
  const summary = await getSalesAndTreasurySummary();
  const openEntries = summary.entries.filter(
    (e) => e.paymentMethod === "cash" && e.custodyStatus === "open"
  );

  if (openEntries.length === 0 || summary.openCashTotalLyd <= 0) {
    return {
      ok: false,
      error: "لا توجد مبالغ كاش مفتوحة في العهدة الحالية لإغلاقها.",
    };
  }

  const nowIso = new Date().toISOString();
  const closure: CustodyClosureRecord = {
    id: `cust_${Date.now().toString(36)}`,
    closedAt: nowIso,
    closedBy: params.adminName || "مشرف النظام",
    totalLyd: summary.openCashTotalLyd,
    count: openEntries.length,
    entryIds: openEntries.map((e) => e.id),
  };

  try {
    await supabaseAdmin.from("admin_audit_logs").insert({
      admin_name: closure.closedBy,
      action_type: "CUSTODY_CLOSED",
      target_item: `${closure.totalLyd} LYD`,
      details: JSON.stringify(closure),
      created_at: nowIso,
    });
  } catch {
    // ignore
  }

  const store = loadStore();
  store.custodyClosures = [closure, ...(store.custodyClosures || [])];
  saveStore(store);

  return { ok: true, closure };
}

/**
 * تحويل ملصق إلى «ملصق هدية (شهر مجاني - 30 يوماً)» ونقله إلى تبويب الهدايا
 */
export async function convertTagToGift(params: {
  tagCode: string;
  adminName: string;
}): Promise<{ ok: boolean; tagCode?: string; error?: string }> {
  const code = formatBalaghniTagCode(params.tagCode);
  if (!code) {
    return { ok: false, error: "كود الملصق غير صالح." };
  }

  let existingTag: Record<string, unknown> | null = null;
  try {
    const { data } = await supabaseAdmin
      .from("tags")
      .select("*")
      .eq("tag_code", code)
      .maybeSingle();
    if (data) existingTag = data as Record<string, unknown>;
  } catch {
    // ignore
  }

  const ownerPhone = existingTag?.owner_phone
    ? String(existingTag.owner_phone).trim()
    : null;
  const ownerName = existingTag?.owner_name
    ? String(existingTag.owner_name).trim()
    : null;
  const vehicleInfo = existingTag?.vehicle_info || existingTag?.vehicle_make_model
    ? String(existingTag.vehicle_info || existingTag.vehicle_make_model).trim()
    : null;
  const city = existingTag?.city || existingTag?.vehicle_city
    ? String(existingTag.city || existingTag.vehicle_city).trim()
    : "طرابلس";

  const hasOwner = Boolean(ownerPhone && ownerPhone !== "-");
  const nowIso = new Date().toISOString();
  const startsAt = hasOwner ? nowIso : null;
  const expiresAt = hasOwner ? addDaysIso(nowIso, 30) : null;
  const tagStatus = hasOwner ? "ACTIVE" : "LOCKED";
  const stickerStatus = hasOwner ? "active" : "gift_ready";
  const features = getDefaultFeaturesForPackage("gift");

  try {
    await supabaseAdmin
      .from("tags")
      .update({
        status: tagStatus,
        notification_channel: "SMS",
        activated_at: startsAt,
      })
      .eq("tag_code", code);
  } catch {
    // ignore
  }

  const extFields: Record<string, unknown> = {
    package_type: "gift",
    activation_source: "gift_promo",
    alert_channel: "SMS",
    subscription_starts_at: startsAt,
    subscription_expires_at: expiresAt,
    plan_type: "gift",
  };
  for (const [col, val] of Object.entries(extFields)) {
    try {
      await supabaseAdmin
        .from("tags")
        .update({ [col]: val })
        .eq("tag_code", code);
    } catch {
      // ignore missing column
    }
  }

  try {
    await supabaseAdmin.from("stickers").upsert(
      {
        code,
        status: stickerStatus,
        plan_type: "gift",
        package_type: "gift",
        features,
        owner_phone: ownerPhone,
        owner_name: ownerName,
        vehicle_info: vehicleInfo,
        activation_source: "gift_promo",
        subscription_starts_at: startsAt,
        subscription_expires_at: expiresAt,
        updated_at: nowIso,
      },
      { onConflict: "code" }
    );
  } catch {
    // ignore
  }

  const store = loadStore();
  store.stickers[code] = {
    code,
    status: stickerStatus,
    planType: "gift",
    packageType: "nabbihni",
    features,
    ownerPhone,
    ownerName,
    vehicleInfo,
    activationSource: "gift_promo",
    subscriptionStartsAt: startsAt,
    subscriptionExpiresAt: expiresAt,
    createdAt: store.stickers[code]?.createdAt || nowIso,
    updatedAt: nowIso,
  };
  saveStore(store);

  if (hasOwner && ownerPhone) {
    syncTagActivationToLocalStore({
      tagCode: code,
      ownerPhone,
      vehicleInfo: vehicleInfo || ownerName || "مركبة مسجلة",
      city,
      alertChannel: "SMS",
      packageType: "nabbihni",
      activationSource: "gift_promo",
      subscriptionStartsAt: startsAt || undefined,
      subscriptionExpiresAt: expiresAt || undefined,
      activatedAt: startsAt || undefined,
    });

    await recordSaleTransaction({
      tagCode: code,
      customerName: ownerName || ownerPhone,
      operationType: "gift_free",
      packageType: "gift",
      amountLyd: 0,
      paymentMethod: "free",
      adminName: params.adminName,
    });
  }

  return { ok: true, tagCode: code };
}
