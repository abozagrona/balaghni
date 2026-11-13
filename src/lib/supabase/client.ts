import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  sendWhatsappAlertMessage,
  sendSmsAlertMessage,
} from "@/lib/otp-service";

const rawSupabaseUrl = (
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
  "https://aivxhxnvgqxylugqrjei.supabase.co"
).replace(/\/+$/, "");

const rawSupabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  "sb_publishable_wUsqBoHbhbuvVitBDo2wuw_xOhU-IEe";

// تصحيح تلقائي لحالة الحرف الأول في مفتاح Supabase القابل للنشر (sb_publishable_...)
const normalizedAnonKey = rawSupabaseAnonKey.replace(
  /^Sb_publishable_/,
  "sb_publishable_"
);

export const supabase = createClient(rawSupabaseUrl, normalizedAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const rawServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  process.env.SUPABASE_SECRET_KEY?.trim() ||
  "";
const isValidServiceJwt =
  (rawServiceRoleKey.startsWith("eyJ") &&
    rawServiceRoleKey.split(".").length === 3) ||
  rawServiceRoleKey.startsWith("sb_secret_");

if (rawServiceRoleKey && !isValidServiceJwt) {
  console.warn(
    "[Supabase Config Warning] المفتاح SUPABASE_SERVICE_ROLE_KEY في Vercel غير مكتمل أو بصيغة غير صالحة."
  );
}

export const supabaseAdmin = createClient(
  rawSupabaseUrl,
  isValidServiceJwt ? rawServiceRoleKey : normalizedAnonKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export type TagStatus = "LOCKED" | "ACTIVE" | "REVOKED";
export type AlertChannel = "SMS" | "WHATSAPP" | "BOTH";

export interface VehicleTagRecord {
  tagCode: string;
  status: TagStatus;
  type: "car" | "generic";
  ownerPhone?: string | null;
  vehicleInfo?: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleColor?: string;
  city?: string;
  tier: "standard" | "premium" | "elite";
  alertChannel: AlertChannel;
  hasEmergencyContacts: boolean;
  hasSecuritySetup?: boolean;
  hasPasskey?: boolean;
  activatedAt?: string | null;
}

interface StoredTagRow {
  tag_code: string;
  activation_pin_hash: string;
  status: TagStatus;
  owner_phone?: string | null;
  owner_pin_hash?: string | null;
  recovery_key_hash?: string | null;
  emergency_recovery_hash?: string | null;
  passkey_credential_id?: string | null;
  vehicle_info?: string | null;
  vehicle_make_model?: string | null;
  vehicle_brand?: string;
  vehicle_model?: string;
  vehicle_color?: string;
  city?: string;
  vehicle_city?: string | null;
  tier?: "standard" | "premium" | "elite";
  alert_channel?: AlertChannel;
  notification_channel?: string | null;
  has_emergency_contacts?: boolean;
  activated_at?: string | null;
}

const LOCAL_STORE_PATH = path.join(
  process.cwd(),
  "src/data/local-tags-store.json"
);
const SEED_SQL_PATH = path.join(process.cwd(), "seed_supabase.sql");

export function hashSha256(value: string): string {
  return crypto
    .createHash("sha256")
    .update(String(value || "").trim(), "utf8")
    .digest("hex");
}

export const hashPinSha256 = hashSha256;

function normalizeStatus(raw?: string | null): TagStatus {
  const upper = String(raw || "").toUpperCase();
  if (upper === "ACTIVE") return "ACTIVE";
  if (upper === "REVOKED" || upper === "SUSPENDED") return "REVOKED";
  return "LOCKED";
}

export const LEGACY_TEST_CODES = new Set([
  "LY-JMG8-5Q7T",
  "LY-2TB5-C89Y",
  "LY-FUQ6-SD32",
  "LY-N9RX-3P8B",
  "LY-Q987-GECA",
]);

export const INITIAL_SEED_TAGS: Record<string, StoredTagRow> = {};

function loadSyncedStore(): Record<string, StoredTagRow> {
  const map: Record<string, StoredTagRow> = {};

  // 1. شحن الملصقات المعتمدة أولاً (تضمن تواجدها دائماً على Vercel وجميع البيئات السحابية)
  for (const [k, v] of Object.entries(INITIAL_SEED_TAGS)) {
    if (!LEGACY_TEST_CODES.has(k.toUpperCase())) {
      map[k.toUpperCase()] = { ...v };
    }
  }

  // 2. دمج أي تحديثات لاحقة من ملف التخزين المحلي إن وُجد
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const saved = JSON.parse(
        fs.readFileSync(LOCAL_STORE_PATH, "utf8")
      ) as Record<string, StoredTagRow>;
      for (const [k, v] of Object.entries(saved)) {
        if (!LEGACY_TEST_CODES.has(k.toUpperCase())) {
          map[k.toUpperCase()] = {
            ...(map[k.toUpperCase()] || {}),
            ...v,
          };
        }
      }
    }
  } catch {
    // ignore read error
  }

  return map;
}

function saveToSyncedStore(row: StoredTagRow) {
  try {
    let saved: Record<string, StoredTagRow> = {};
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      saved = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, "utf8"));
    }
    saved[row.tag_code.toUpperCase()] = row;
    fs.mkdirSync(path.dirname(LOCAL_STORE_PATH), { recursive: true });
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(saved, null, 2), "utf8");
  } catch {
    // ignore write error
  }
}

function removeFromSyncedStore(tagCode: string) {
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const saved = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, "utf8"));
      delete saved[tagCode.toUpperCase()];
      fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(saved, null, 2), "utf8");
    }
  } catch {
    // ignore write error
  }
}

function mapRowToRecord(row: StoredTagRow): VehicleTagRecord {
  const ch = String(
    row.alert_channel || row.notification_channel || "BOTH"
  ).toUpperCase();
  const alertChannel: AlertChannel =
    ch === "SMS" || ch === "WHATSAPP" ? ch : "BOTH";
  const resolvedVehicleInfo =
    row.vehicle_info || row.vehicle_make_model || undefined;
  return {
    tagCode: row.tag_code,
    status: normalizeStatus(row.status),
    type: "car",
    ownerPhone: row.owner_phone || null,
    vehicleInfo: resolvedVehicleInfo,
    vehicleBrand:
      row.vehicle_brand || resolvedVehicleInfo || "مركبة مسجلة",
    vehicleModel: row.vehicle_model || "",
    vehicleColor: row.vehicle_color || undefined,
    city: row.city || row.vehicle_city || "طرابلس",
    tier: row.tier || "premium",
    alertChannel,
    hasEmergencyContacts: Boolean(row.has_emergency_contacts ?? false),
    hasSecuritySetup: Boolean(row.owner_pin_hash),
    hasPasskey: Boolean(row.passkey_credential_id),
    activatedAt: row.activated_at || null,
  };
}

export async function ensureDemoTagSeededInSupabase() {
  // تم إيقاف أي إدراج افتراضي لملصقات تجريبية لضمان الاعتماد الحصري على قاعدة البيانات النظيفة بنسبة 100%
  return;
}

/**
 * جلب بيانات الملصق وفحص حالته من Supabase (ومخزن المزامنة)
 */
export async function getVehicleTagByCode(
  rawCode: string
): Promise<VehicleTagRecord | null> {
  const normalizedCode = rawCode.toUpperCase().startsWith("LY-")
    ? rawCode.toUpperCase()
    : `LY-${rawCode.toUpperCase().replace(/^[A-Z]+-/, "")}`;

  if (LEGACY_TEST_CODES.has(normalizedCode)) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("tags")
      .select("*")
      .eq("tag_code", normalizedCode)
      .maybeSingle();

    if (!error && data) {
      const synced = loadSyncedStore()[normalizedCode];
      const merged: StoredTagRow = {
        ...(synced || {}),
        ...data,
        tag_code: data.tag_code,
        status: normalizeStatus(data.status),
      };
      return mapRowToRecord(merged);
    }
  } catch {
    // fallback to synced store
  }

  const localMap = loadSyncedStore();
  const found = localMap[normalizedCode];
  if (!found) {
    return null;
  }

  return mapRowToRecord(found);
}

/**
 * التحقق المسبق من صلاحية رمز الخدش السري (PIN) للملصق قبل إرسال أي رمز OTP
 */
export async function verifyTagScratchPin(params: {
  tagCode: string;
  pin: string;
}): Promise<{ ok: boolean; error?: string; targetRow?: StoredTagRow }> {
  const normalizedCode = params.tagCode.toUpperCase().trim();
  const inputPinHash = hashSha256(params.pin.trim());

  if (LEGACY_TEST_CODES.has(normalizedCode)) {
    return {
      ok: false,
      error: "كود الملصق غير مسجل في قاعدة البيانات.",
    };
  }

  let targetRow: StoredTagRow | null = null;
  try {
    const { data, error } = await supabase
      .from("tags")
      .select("*")
      .eq("tag_code", normalizedCode)
      .maybeSingle();

    if (!error && data) {
      targetRow = data as StoredTagRow;
    }
  } catch {
    // ignore
  }

  const localMap = loadSyncedStore();
  if (!targetRow && localMap[normalizedCode]) {
    targetRow = localMap[normalizedCode];
  }

  if (!targetRow) {
    return {
      ok: false,
      error: "كود الملصق غير مسجل في قاعدة البيانات.",
    };
  }

  const currentStatus = normalizeStatus(targetRow.status);
  if (currentStatus === "ACTIVE") {
    return {
      ok: false,
      error: "هذا الملصق مفعّل مسبقاً ومرتبط بمركبة أخرى.",
    };
  }
  if (currentStatus === "REVOKED") {
    return {
      ok: false,
      error: "هذا الملصق موقوف أمنياً ولا يمكن تفعيله.",
    };
  }

  if (
    String(targetRow.activation_pin_hash || "").toLowerCase() !== inputPinHash
  ) {
    return {
      ok: false,
      error:
        "رمز الخدش السري (PIN) غير صحيح. يرجى التأكد من الأرقام الستة تحت طبقة الخدش.",
    };
  }

  return { ok: true, targetRow };
}

/**
 * الخطوة 1: تفعيل الملصق عبر رمز الخدش السري (PIN) وتحديث حالته إلى ACTIVE وربطه برقم الهاتف ونوع السيارة
 */
export async function activateVehicleTag(params: {
  tagCode: string;
  pin: string;
  ownerPhone: string;
  vehicleInfo: string;
  city?: string;
}): Promise<{ ok: boolean; error?: string; record?: VehicleTagRecord }> {
  const normalizedCode = params.tagCode.toUpperCase().trim();
  const nowIso = new Date().toISOString();

  const pinCheck = await verifyTagScratchPin({
    tagCode: normalizedCode,
    pin: params.pin,
  });
  if (!pinCheck.ok || !pinCheck.targetRow) {
    return { ok: false, error: pinCheck.error };
  }
  const targetRow = pinCheck.targetRow;

  const dbUpdateFields = {
    status: "ACTIVE" as TagStatus,
    owner_phone: params.ownerPhone,
    vehicle_make_model: params.vehicleInfo.trim(),
    vehicle_city: params.city || "طرابلس",
    activated_at: nowIso,
  };

  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from("tags")
    .update(dbUpdateFields)
    .eq("tag_code", normalizedCode)
    .select("*");

  if (updateError || !Array.isArray(updatedRows) || updatedRows.length === 0) {
    return {
      ok: false,
      error: updateError?.message
        ? `تعذر تفعيل الملصق في قاعدة البيانات: ${updateError.message}`
        : "تعذر تفعيل الملصق في قاعدة البيانات (لم يتم تحديث أي صف).",
    };
  }

  const persistedRow = updatedRows[0] as StoredTagRow;
  const updatedRow: StoredTagRow = {
    ...targetRow,
    ...persistedRow,
    vehicle_info: persistedRow.vehicle_make_model || params.vehicleInfo.trim(),
    vehicle_brand: persistedRow.vehicle_make_model || params.vehicleInfo.trim(),
    city: persistedRow.vehicle_city || params.city || "طرابلس",
  };
  saveToSyncedStore(updatedRow);

  return {
    ok: true,
    record: mapRowToRecord(updatedRow),
  };
}

/**
 * الخطوة 2: حفظ إعدادات أمان المالك (owner_pin_hash, emergency_recovery_hash) وضمان تفعيل الملصق (ACTIVE) في جدول tags
 */
export async function saveOwnerSecuritySetup(params: {
  tagCode: string;
  ownerPin: string;
  recoveryKey: string;
  passkeyCredentialId?: string | null;
  ownerPhone?: string;
  vehicleInfo?: string;
  city?: string;
}): Promise<{ ok: boolean; error?: string; record?: VehicleTagRecord }> {
  const normalizedCode = params.tagCode.toUpperCase().trim();
  const ownerPinHash = hashSha256(params.ownerPin);
  const recoveryKeyHash = hashSha256(
    params.recoveryKey.trim().toUpperCase()
  );

  const { data: existingRow, error: fetchError } = await supabaseAdmin
    .from("tags")
    .select("*")
    .eq("tag_code", normalizedCode)
    .maybeSingle();

  if (fetchError) {
    return {
      ok: false,
      error: `تعذر التحقق من سجل الملصق في قاعدة البيانات: ${fetchError.message}`,
    };
  }

  const localMap = loadSyncedStore();
  const targetRow: StoredTagRow | null = existingRow
    ? (existingRow as StoredTagRow)
    : localMap[normalizedCode] || null;

  if (!targetRow) {
    return {
      ok: false,
      error: "لم يتم العثور على الملصق المطلوب تأمينه في قاعدة البيانات.",
    };
  }

  const nowIso = new Date().toISOString();
  const securityFields: Partial<StoredTagRow> = {
    status: "ACTIVE" as TagStatus,
    owner_pin_hash: ownerPinHash,
    emergency_recovery_hash: recoveryKeyHash,
    activated_at: targetRow.activated_at || nowIso,
    ...(params.ownerPhone && params.ownerPhone.trim()
      ? { owner_phone: params.ownerPhone.trim() }
      : {}),
    ...(params.vehicleInfo && params.vehicleInfo.trim()
      ? { vehicle_make_model: params.vehicleInfo.trim() }
      : {}),
    ...(params.city && params.city.trim()
      ? { vehicle_city: params.city.trim() }
      : {}),
    ...(params.passkeyCredentialId
      ? { passkey_credential_id: params.passkeyCredentialId }
      : {}),
  };

  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from("tags")
    .update(securityFields)
    .eq("tag_code", normalizedCode)
    .select("*");

  if (
    updateError ||
    !Array.isArray(updatedRows) ||
    updatedRows.length === 0 ||
    normalizeStatus((updatedRows[0] as StoredTagRow).status) !== "ACTIVE"
  ) {
    return {
      ok: false,
      error: updateError?.message
        ? `تعذر حفظ إعدادات الأمان وتفعيل الملصق في قاعدة البيانات: ${updateError.message}`
        : "تعذر تحديث حالة الملصق إلى ACTIVE في قاعدة البيانات (0 rows updated). يرجى التحقق من صلاحيات الخدمة.",
    };
  }

  const persistedRow = updatedRows[0] as StoredTagRow;
  const updatedRow: StoredTagRow = {
    ...targetRow,
    ...persistedRow,
    vehicle_info:
      persistedRow.vehicle_make_model ||
      targetRow.vehicle_info ||
      params.vehicleInfo,
    city: persistedRow.vehicle_city || targetRow.city || params.city,
  };
  saveToSyncedStore(updatedRow);

  return {
    ok: true,
    record: mapRowToRecord(updatedRow),
  };
}

export async function checkOwnerPhoneExists(rawPhone: string): Promise<boolean> {
  const normalizedPhone = String(rawPhone || "").trim();
  if (!normalizedPhone) return false;
  const localMap = loadSyncedStore();
  for (const row of Object.values(localMap)) {
    if (row.owner_phone === normalizedPhone) return true;
  }
  try {
    const { data, error } = await supabase
      .from("tags")
      .select("tag_code")
      .eq("owner_phone", normalizedPhone)
      .limit(1);
    if (!error && Array.isArray(data) && data.length > 0) return true;
  } catch {
    // ignore
  }
  return false;
}

/**
 * التحقق الحقيقي لتسجيل دخول المالك عبر رقم الهاتف الليبي ورمز المرور (PIN) أو رمز التحقق (OTP) أو البصمة
 */
export async function verifyOwnerLogin(params: {
  ownerPhone?: string;
  pin?: string;
  passkeyCredentialId?: string;
  otpVerified?: boolean;
}): Promise<{ ok: boolean; error?: string; record?: VehicleTagRecord }> {
  // أ) التحقق الفوري عبر البصمة الحيوية (Zero-Typing Customer Passkey) دون اشتراط رقم الهاتف
  if (params.passkeyCredentialId) {
    const credId = params.passkeyCredentialId.trim();
    let matchedPasskeyRow: StoredTagRow | null = null;
    try {
      const { data, error } = await supabase
        .from("tags")
        .select("*")
        .eq("passkey_credential_id", credId);

      if (!error && Array.isArray(data) && data.length > 0) {
        matchedPasskeyRow = data[0] as StoredTagRow;
      }
    } catch {
      // ignore
    }

    if (!matchedPasskeyRow) {
      const localMap = loadSyncedStore();
      for (const row of Object.values(localMap)) {
        if (row.passkey_credential_id === credId) {
          matchedPasskeyRow = row;
          break;
        }
      }
    }

    if (!matchedPasskeyRow) {
      return {
        ok: false,
        error: "لم يتم العثور على سيارة مرتبطة بهذه البصمة، يرجى الدخول برمز الـ PIN.",
      };
    }

    return {
      ok: true,
      record: mapRowToRecord(matchedPasskeyRow),
    };
  }

  const normalizedPhone = String(params.ownerPhone || "").trim();
  if (!normalizedPhone) {
    return {
      ok: false,
      error: "يرجى إدخال رقم الهاتف الليبي المسجل.",
    };
  }

  // 1. البحث عن الملصقات المرتبطة برقم الهاتف في جدول tags بـ Supabase
  let candidateRows: StoredTagRow[] = [];
  try {
    const { data, error } = await supabase
      .from("tags")
      .select("*")
      .eq("owner_phone", normalizedPhone);

    if (!error && Array.isArray(data) && data.length > 0) {
      candidateRows = data as StoredTagRow[];
    }
  } catch {
    // ignore
  }

  // دمج نتائج المخزن المتزامن لنفس رقم الهاتف
  const localMap = loadSyncedStore();
  for (const row of Object.values(localMap)) {
    if (
      row.owner_phone === normalizedPhone &&
      !candidateRows.some((r) => r.tag_code === row.tag_code)
    ) {
      candidateRows.push(row);
    } else if (row.owner_phone === normalizedPhone) {
      candidateRows = candidateRows.map((r) =>
        r.tag_code === row.tag_code ? { ...r, ...row } : r
      );
    }
  }

  if (candidateRows.length === 0) {
    return {
      ok: false,
      error: "رقم الهاتف غير مسجل في النظام. يرجى تفعيل ملصقك أولاً.",
    };
  }

  // في حال كان التحقق عبر OTP مؤكداً (Passwordless OTP Login)
  if (params.otpVerified) {
    return {
      ok: true,
      record: mapRowToRecord(candidateRows[0]),
    };
  }

  // التحقق الصارم من تجزئة رمز المرور (owner_pin_hash)
  const inputPinHash = hashSha256(params.pin || "");
  const matchedRow = candidateRows.find(
    (r) =>
      r.owner_pin_hash &&
      r.owner_pin_hash.toLowerCase() === inputPinHash.toLowerCase()
  );

  if (!matchedRow) {
    return {
      ok: false,
      error: "رقم الهاتف غير مسجل أو رمز المرور غير صحيح",
    };
  }

  return {
    ok: true,
    record: mapRowToRecord(matchedRow),
  };
}

/**
 * استرجاع الحساب وإعادة تعيين رمز المرور عبر مطابقة تجزئة كود الطوارئ الرقمي (recovery_key_hash) في قاعدة البيانات
 */
export async function resetOwnerPinByRecoveryKey(params: {
  ownerPhone: string;
  recoveryKey: string;
  newPin: string;
}): Promise<{ ok: boolean; error?: string; record?: VehicleTagRecord }> {
  const normalizedPhone = params.ownerPhone.trim();
  const inputRecoveryHash = hashSha256(
    params.recoveryKey.trim().toUpperCase()
  );
  const newPinHash = hashSha256(params.newPin.trim());

  let candidateRows: StoredTagRow[] = [];
  try {
    const { data, error } = await supabase
      .from("tags")
      .select("*")
      .eq("owner_phone", normalizedPhone);

    if (!error && Array.isArray(data) && data.length > 0) {
      candidateRows = data as StoredTagRow[];
    }
  } catch {
    // ignore
  }

  const localMap = loadSyncedStore();
  for (const row of Object.values(localMap)) {
    if (
      row.owner_phone === normalizedPhone &&
      !candidateRows.some((r) => r.tag_code === row.tag_code)
    ) {
      candidateRows.push(row);
    } else if (row.owner_phone === normalizedPhone) {
      candidateRows = candidateRows.map((r) =>
        r.tag_code === row.tag_code ? { ...r, ...row } : r
      );
    }
  }

  const matchedRow = candidateRows.find(
    (r) =>
      r.recovery_key_hash &&
      r.recovery_key_hash.toLowerCase() === inputRecoveryHash.toLowerCase()
  );

  if (!matchedRow) {
    return {
      ok: false,
      error: "رقم الهاتف أو كود بطاقة الأمان غير مطابق للسجلات المشفرة.",
    };
  }

  // تحديث owner_pin_hash في Supabase
  try {
    await supabase
      .from("tags")
      .update({ owner_pin_hash: newPinHash })
      .eq("tag_code", matchedRow.tag_code);
  } catch {
    // ignore
  }

  const updatedRow: StoredTagRow = {
    ...matchedRow,
    owner_pin_hash: newPinHash,
  };
  saveToSyncedStore(updatedRow);

  return {
    ok: true,
    record: mapRowToRecord(updatedRow),
  };
}

/**
 * إعادة تعيين رمز الدخول (PIN) لمالك السيارة بعد التحقق الناجح عبر رمز OTP (واتساب / SMS)
 */
export async function resetOwnerPinByOtp(params: {
  ownerPhone: string;
  newPin: string;
}): Promise<{ ok: boolean; error?: string; record?: VehicleTagRecord }> {
  const normalizedPhone = params.ownerPhone.trim();
  const newPinHash = hashSha256(params.newPin.trim());

  let candidateRows: StoredTagRow[] = [];
  try {
    const { data, error } = await supabase
      .from("tags")
      .select("*")
      .eq("owner_phone", normalizedPhone);

    if (!error && Array.isArray(data) && data.length > 0) {
      candidateRows = data as StoredTagRow[];
    }
  } catch {
    // ignore
  }

  const localMap = loadSyncedStore();
  for (const row of Object.values(localMap)) {
    if (
      row.owner_phone === normalizedPhone &&
      !candidateRows.some((r) => r.tag_code === row.tag_code)
    ) {
      candidateRows.push(row);
    } else if (row.owner_phone === normalizedPhone) {
      candidateRows = candidateRows.map((r) =>
        r.tag_code === row.tag_code ? { ...r, ...row } : r
      );
    }
  }

  if (candidateRows.length === 0) {
    return {
      ok: false,
      error: "لم يتم العثور على أي سيارة أو ملصق مسجل بهذا الرقم في النظام.",
    };
  }

  const targetRow = candidateRows[0];

  try {
    await supabase
      .from("tags")
      .update({ owner_pin_hash: newPinHash })
      .eq("tag_code", targetRow.tag_code);
  } catch {
    // ignore
  }

  const updatedRow: StoredTagRow = {
    ...targetRow,
    owner_pin_hash: newPinHash,
  };
  saveToSyncedStore(updatedRow);

  return {
    ok: true,
    record: mapRowToRecord(updatedRow),
  };
}

/**
 * جلب passkey_credential_id المسجل لرقم الهاتف من جدول tags
 */
export async function getPasskeyCredentialByPhone(ownerPhone: string): Promise<{
  ok: boolean;
  passkeyCredentialId?: string | null;
  tagCode?: string | null;
  error?: string;
}> {
  const normalizedPhone = ownerPhone.trim();
  if (!normalizedPhone) {
    return {
      ok: false,
      error: "يرجى إدخال رقم الهاتف أولاً",
    };
  }

  let candidateRows: StoredTagRow[] = [];
  try {
    const { data, error } = await supabase
      .from("tags")
      .select("*")
      .eq("owner_phone", normalizedPhone);

    if (!error && Array.isArray(data) && data.length > 0) {
      candidateRows = data as StoredTagRow[];
    }
  } catch {
    // ignore
  }

  const localMap = loadSyncedStore();
  for (const row of Object.values(localMap)) {
    if (
      row.owner_phone === normalizedPhone &&
      !candidateRows.some((r) => r.tag_code === row.tag_code)
    ) {
      candidateRows.push(row);
    } else if (row.owner_phone === normalizedPhone) {
      candidateRows = candidateRows.map((r) =>
        r.tag_code === row.tag_code ? { ...r, ...row } : r
      );
    }
  }

  const rowWithPasskey = candidateRows.find(
    (r) => r.passkey_credential_id && r.passkey_credential_id.trim().length > 0
  );

  if (!rowWithPasskey || !rowWithPasskey.passkey_credential_id) {
    return {
      ok: false,
      passkeyCredentialId: null,
      error: "لم يتم تفعيل البصمة لهذا الرقم بعد، يرجى الدخول بالـ PIN",
    };
  }

  return {
    ok: true,
    passkeyCredentialId: rowWithPasskey.passkey_credential_id,
    tagCode: rowWithPasskey.tag_code,
  };
}

/**
 * حفظ passkey_credential_id بصيغة Base64URL مباشرة في جدول tags بـ Supabase
 */
export async function savePasskeyCredentialForTag(params: {
  tagCode: string;
  passkeyCredentialId: string;
  ownerPhone?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const normalizedCode = params.tagCode.toUpperCase().trim();
  const credentialId = params.passkeyCredentialId.trim();

  if (!normalizedCode || !credentialId) {
    return {
      ok: false,
      error: "بيانات البصمة غير مكتملة",
    };
  }

  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from("tags")
    .update({
      passkey_credential_id: credentialId,
      ...(params.ownerPhone ? { owner_phone: params.ownerPhone.trim() } : {}),
    })
    .eq("tag_code", normalizedCode)
    .select("tag_code");

  if (updateError || !Array.isArray(updatedRows) || updatedRows.length === 0) {
    return {
      ok: false,
      error: updateError?.message
        ? `تعذر حفظ البصمة في قاعدة البيانات: ${updateError.message}`
        : "تعذر حفظ البصمة في قاعدة البيانات.",
    };
  }

  const localMap = loadSyncedStore();
  const existing = localMap[normalizedCode] || {
    tag_code: normalizedCode,
    activation_pin_hash: "",
    status: "ACTIVE" as TagStatus,
  };

  saveToSyncedStore({
    ...existing,
    passkey_credential_id: credentialId,
    ...(params.ownerPhone ? { owner_phone: params.ownerPhone.trim() } : {}),
  });

  return { ok: true };
}

/**
 * إلغاء ربط البصمة (Passkey) عن ملصق محدد من لوحة تحكم الزبون
 */
export async function clearPasskeyCredentialForTag(
  rawTagCode: string
): Promise<{ ok: boolean; error?: string }> {
  const normalizedCode = rawTagCode.toUpperCase().trim();
  if (!normalizedCode) {
    return { ok: false, error: "كود الملصق مطلوب." };
  }

  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from("tags")
    .update({ passkey_credential_id: null })
    .eq("tag_code", normalizedCode)
    .select("tag_code");

  if (updateError || !Array.isArray(updatedRows) || updatedRows.length === 0) {
    return {
      ok: false,
      error: updateError?.message || "تعذر إلغاء ربط البصمة في قاعدة البيانات.",
    };
  }

  const localMap = loadSyncedStore();
  if (localMap[normalizedCode]) {
    saveToSyncedStore({
      ...localMap[normalizedCode],
      passkey_credential_id: null,
    });
  }

  return { ok: true };
}

export interface VehicleDocumentRecord {
  id: string;
  tagCode: string;
  title: string;
  subtitle: string;
  expiryDate: string;
  createdAt: string;
}

export interface TagReportRecord {
  id: string;
  tagCode: string;
  reasonTitle: string;
  reasonBadge: string;
  message: string;
  location: string;
  photoUrl?: string | null;
  iconType: "blocking" | "lights" | "window" | "emergency";
  createdAt: string;
}

export interface TagMaintenanceRecord {
  id: string;
  tagCode: string;
  serviceType: string;
  date: string;
  mileageKm: string;
  costLyd: number;
  workshop: string;
  notes: string;
  createdAt: string;
}

interface SyncedTagDashboardStore {
  documents: Record<string, VehicleDocumentRecord[]>;
  reports: Record<string, TagReportRecord[]>;
  maintenance: Record<string, TagMaintenanceRecord[]>;
}

const DASHBOARD_STORE_PATH = path.join(
  process.cwd(),
  "src/data/local-dashboard-store.json"
);

function loadDashboardStore(): SyncedTagDashboardStore {
  const empty: SyncedTagDashboardStore = {
    documents: {},
    reports: {},
    maintenance: {},
  };
  try {
    if (fs.existsSync(DASHBOARD_STORE_PATH)) {
      const parsed = JSON.parse(
        fs.readFileSync(DASHBOARD_STORE_PATH, "utf8")
      ) as Partial<SyncedTagDashboardStore>;
      return {
        documents: parsed.documents || {},
        reports: parsed.reports || {},
        maintenance: parsed.maintenance || {},
      };
    }
  } catch {
    // ignore read error
  }
  return empty;
}

function saveDashboardStore(store: SyncedTagDashboardStore) {
  try {
    fs.mkdirSync(path.dirname(DASHBOARD_STORE_PATH), { recursive: true });
    fs.writeFileSync(
      DASHBOARD_STORE_PATH,
      JSON.stringify(store, null, 2),
      "utf8"
    );
  } catch {
    // ignore write error
  }
}

/**
 * جلب بيانات لوحة تحكم المالك الحقيقية لملصق محدد من Supabase (جدول tags + vehicle_documents + reports + maintenance_records)
 * بدون أي بيانات افتراضية أو وهمية
 */
export async function getTagDashboardData(rawTagCode: string): Promise<{
  ok: boolean;
  error?: string;
  tag?: VehicleTagRecord;
  documents: VehicleDocumentRecord[];
  reports: TagReportRecord[];
  maintenance: TagMaintenanceRecord[];
}> {
  const normalizedCode = rawTagCode.toUpperCase().trim();
  const tag = await getVehicleTagByCode(normalizedCode);

  if (!tag) {
    return {
      ok: false,
      error: "لم يتم العثور على هذا الملصق في جدول tags.",
      documents: [],
      reports: [],
      maintenance: [],
    };
  }

  const store = loadDashboardStore();
  let documents: VehicleDocumentRecord[] = [
    ...(store.documents[normalizedCode] || []),
  ];
  let reports: TagReportRecord[] = [...(store.reports[normalizedCode] || [])];
  let maintenance: TagMaintenanceRecord[] = [
    ...(store.maintenance[normalizedCode] || []),
  ];

  // 1. جلب وثائق المركبة من جدول vehicle_documents في Supabase الخاصة بهذا الملصق حصراً
  try {
    const { data, error } = await supabase
      .from("vehicle_documents")
      .select("*")
      .eq("tag_code", normalizedCode)
      .order("expiry_date", { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      const remoteDocs: VehicleDocumentRecord[] = data.map((row) => ({
        id: String(row.id),
        tagCode: String(row.tag_code || normalizedCode),
        title: String(row.title || ""),
        subtitle: String(row.subtitle || ""),
        expiryDate: String(row.expiry_date || ""),
        createdAt: String(row.created_at || new Date().toISOString()),
      }));
      const mergedMap = new Map<string, VehicleDocumentRecord>();
      for (const d of [...documents, ...remoteDocs]) {
        mergedMap.set(d.id, d);
      }
      documents = Array.from(mergedMap.values());
    }
  } catch {
    // ignore if table does not exist yet on remote
  }

  // 2. جلب البلاغات الواردة من جدول reports في Supabase الخاصة بهذا الملصق حصراً
  try {
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .eq("tag_code", normalizedCode)
      .order("created_at", { ascending: false });

    if (!error && Array.isArray(data) && data.length > 0) {
      const remoteReports: TagReportRecord[] = data.map((row) => ({
        id: String(row.id),
        tagCode: String(row.tag_code || normalizedCode),
        reasonTitle: String(row.reason_title || row.reason || "تنبيه وارد"),
        reasonBadge: String(row.reason_badge || "تنبيه مركبة"),
        message: String(row.message || row.note || ""),
        location: String(row.location || ""),
        photoUrl: row.photo_url || row.image_url || null,
        iconType:
          row.icon_type === "lights" ||
          row.icon_type === "window" ||
          row.icon_type === "emergency"
            ? row.icon_type
            : "blocking",
        createdAt: String(row.created_at || new Date().toISOString()),
      }));
      const mergedMap = new Map<string, TagReportRecord>();
      for (const r of [...reports, ...remoteReports]) {
        mergedMap.set(r.id, r);
      }
      reports = Array.from(mergedMap.values());
    }
  } catch {
    // ignore if table does not exist yet on remote
  }

  // 3. جلب سجل الصيانة من جدول maintenance_records في Supabase الخاص بهذا الملصق حصراً
  try {
    const { data, error } = await supabase
      .from("maintenance_records")
      .select("*")
      .eq("tag_code", normalizedCode)
      .order("service_date", { ascending: false });

    if (!error && Array.isArray(data) && data.length > 0) {
      const remoteMaintenance: TagMaintenanceRecord[] = data.map((row) => ({
        id: String(row.id),
        tagCode: String(row.tag_code || normalizedCode),
        serviceType: String(row.service_type || ""),
        date: String(row.service_date || ""),
        mileageKm: String(row.mileage_km || ""),
        costLyd: Number(row.cost_lyd || 0),
        workshop: String(row.workshop || ""),
        notes: String(row.notes || ""),
        createdAt: String(row.created_at || new Date().toISOString()),
      }));
      const mergedMap = new Map<string, TagMaintenanceRecord>();
      for (const m of [...maintenance, ...remoteMaintenance]) {
        mergedMap.set(m.id, m);
      }
      maintenance = Array.from(mergedMap.values());
    }
  } catch {
    // ignore
  }

  return {
    ok: true,
    tag,
    documents,
    reports,
    maintenance,
  };
}

/**
 * إضافة أو تحديث وثيقة مركبة في جدول vehicle_documents بـ Supabase
 */
export async function upsertVehicleDocumentForTag(params: {
  tagCode: string;
  id?: string;
  title: string;
  subtitle?: string;
  expiryDate: string;
}): Promise<{ ok: boolean; document?: VehicleDocumentRecord; error?: string }> {
  const normalizedCode = params.tagCode.toUpperCase().trim();
  const docId = params.id || `doc_${Date.now().toString(36)}`;
  const nowIso = new Date().toISOString();

  const docRecord: VehicleDocumentRecord = {
    id: docId,
    tagCode: normalizedCode,
    title: params.title.trim(),
    subtitle: (params.subtitle || "").trim(),
    expiryDate: params.expiryDate.trim(),
    createdAt: nowIso,
  };

  try {
    await supabaseAdmin.from("vehicle_documents").upsert({
      id: params.id || undefined,
      tag_code: normalizedCode,
      title: docRecord.title,
      subtitle: docRecord.subtitle,
      expiry_date: docRecord.expiryDate,
    });
  } catch {
    // ignore if remote table not created yet
  }

  const store = loadDashboardStore();
  const currentList = store.documents[normalizedCode] || [];
  const existingIdx = currentList.findIndex((d) => d.id === docId);
  if (existingIdx >= 0) {
    currentList[existingIdx] = docRecord;
  } else {
    currentList.push(docRecord);
  }
  store.documents[normalizedCode] = currentList;
  saveDashboardStore(store);

  return { ok: true, document: docRecord };
}

/**
 * إضافة سجل صيانة جديد للمركبة في جدول maintenance_records بـ Supabase
 */
export async function addMaintenanceRecordForTag(params: {
  tagCode: string;
  serviceType: string;
  date: string;
  mileageKm?: string;
  costLyd: number;
  workshop?: string;
  notes?: string;
}): Promise<{
  ok: boolean;
  record?: TagMaintenanceRecord;
  error?: string;
}> {
  const normalizedCode = params.tagCode.toUpperCase().trim();
  const nowIso = new Date().toISOString();
  const item: TagMaintenanceRecord = {
    id: `mnt_${Date.now().toString(36)}`,
    tagCode: normalizedCode,
    serviceType: params.serviceType.trim(),
    date: params.date.trim(),
    mileageKm: (params.mileageKm || "").trim(),
    costLyd: Number(params.costLyd) || 0,
    workshop: (params.workshop || "").trim(),
    notes: (params.notes || "").trim(),
    createdAt: nowIso,
  };

  try {
    await supabase.from("maintenance_records").insert({
      tag_code: normalizedCode,
      service_type: item.serviceType,
      service_date: item.date,
      mileage_km: item.mileageKm,
      cost_lyd: item.costLyd,
      workshop: item.workshop,
      notes: item.notes,
    });
  } catch {
    // ignore
  }

  const store = loadDashboardStore();
  const currentList = store.maintenance[normalizedCode] || [];
  store.maintenance[normalizedCode] = [item, ...currentList];
  saveDashboardStore(store);

  return { ok: true, record: item };
}

/**
 * حفظ بلاغ حقيقي وارد عند مسح الملصق في جدول reports بـ Supabase
 */
export async function addReportForTag(params: {
  tagCode: string;
  reasonTitle: string;
  reasonBadge?: string;
  message: string;
  location?: string;
  photoUrl?: string | null;
  iconType?: "blocking" | "lights" | "window" | "emergency";
}): Promise<{ ok: boolean; report?: TagReportRecord }> {
  const normalizedCode = params.tagCode.toUpperCase().trim();
  const nowIso = new Date().toISOString();
  const report: TagReportRecord = {
    id: `rep_${Date.now().toString(36)}`,
    tagCode: normalizedCode,
    reasonTitle: params.reasonTitle.trim(),
    reasonBadge: (params.reasonBadge || "تنبيه وارد").trim(),
    message: params.message.trim(),
    location: (params.location || "").trim(),
    photoUrl: params.photoUrl || null,
    iconType: params.iconType || "blocking",
    createdAt: nowIso,
  };

  try {
    await supabase.from("reports").insert({
      tag_code: normalizedCode,
      reason_title: report.reasonTitle,
      reason_badge: report.reasonBadge,
      message: report.message,
      location: report.location,
      photo_url: report.photoUrl,
      icon_type: report.iconType,
    });
  } catch {
    // ignore
  }

  const store = loadDashboardStore();
  const currentList = store.reports[normalizedCode] || [];
  store.reports[normalizedCode] = [report, ...currentList];
  saveDashboardStore(store);

  return { ok: true, report };
}

// ============================================================================
// منظومة الإدارة التنفيذية المتقدمة (Enterprise Admin Engine - admin_profiles)
// ============================================================================

export interface AdminAuditLogRecord {
  id: string;
  adminId?: string | null;
  adminName: string;
  actionType: string;
  actionDetails: string;
  tagCode?: string | null;
  createdAt: string;
}

export type AdminPermission =
  | "manage_reports"
  | "manage_tags"
  | "import_batches"
  | "manage_admins"
  | "danger_zone"
  | "can_live_edit";

export interface AdminProfileRecord {
  id: string;
  fullName: string;
  username: string;
  phone: string;
  role: string;
  permissions: AdminPermission[];
  mustChangePassword: boolean;
  passkeyCredentialId: string | null;
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
}

export interface AdminTeamMemberRecord {
  id: string;
  fullName: string;
  username: string;
  roleTitle: string;
  phone: string;
  permissions: AdminPermission[];
  mustChangePassword: boolean;
  passkeyCredentialId?: string | null;
  status: "ACTIVE" | "FROZEN";
  lastLogin?: string | null;
  createdAt: string;
}

interface IdentifierRateLimitState {
  failedAttempts: number;
  lockoutUntilIso: string | null;
}

interface AdminStoreData {
  rateLimits: Record<string, IdentifierRateLimitState>; // identifierKey -> state
  lastLogins: Record<string, string>; // adminId -> lastLoginIso
  notifyCooldowns: Record<string, string>; // tagCode -> lastNotifyIso
  auditLogs: AdminAuditLogRecord[];
}

const ADMIN_STORE_PATH = path.join(
  process.cwd(),
  "src/data/local-admin-store.json"
);

function loadAdminStore(): AdminStoreData {
  const fallback: AdminStoreData = {
    rateLimits: {},
    lastLogins: {},
    notifyCooldowns: {},
    auditLogs: [],
  };

  try {
    if (fs.existsSync(ADMIN_STORE_PATH)) {
      const parsed = JSON.parse(
        fs.readFileSync(ADMIN_STORE_PATH, "utf8")
      ) as Partial<AdminStoreData>;
      return {
        rateLimits: parsed.rateLimits || fallback.rateLimits,
        lastLogins: parsed.lastLogins || fallback.lastLogins,
        notifyCooldowns: parsed.notifyCooldowns || fallback.notifyCooldowns,
        auditLogs: Array.isArray(parsed.auditLogs)
          ? parsed.auditLogs
          : fallback.auditLogs,
      };
    }
  } catch {
    // ignore
  }

  return fallback;
}

function saveAdminStore(data: AdminStoreData) {
  try {
    fs.mkdirSync(path.dirname(ADMIN_STORE_PATH), { recursive: true });
    fs.writeFileSync(ADMIN_STORE_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch {
    // ignore
  }
}

function normalizeAdminPhoneKey(identifier: string): string {
  const clean = String(identifier || "").trim();
  const digits = clean.replace(/\D/g, "");
  if (digits.length >= 9) {
    if (digits.startsWith("218")) return `0${digits.slice(3)}`;
    if (digits.startsWith("9") && digits.length === 9) return `0${digits}`;
    return digits;
  }
  return clean.toLowerCase() || "unknown";
}

function parsePermissionsFromDb(raw: unknown): AdminPermission[] {
  if (Array.isArray(raw)) {
    return raw.map((x) =>
      x === "import_tags" ? "import_batches" : (x as AdminPermission)
    );
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, boolean>;
    const list: AdminPermission[] = [];
    if (obj.manage_reports) list.push("manage_reports");
    if (obj.manage_tags) list.push("manage_tags");
    if (obj.import_tags || obj.import_batches) list.push("import_batches");
    if (obj.manage_admins) list.push("manage_admins");
    if (obj.danger_zone) list.push("danger_zone");
    if (obj.can_live_edit) list.push("can_live_edit");
    return list;
  }
  return ["manage_reports", "manage_tags"];
}

function parseMustChangePasswordFromDb(raw: unknown): boolean {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Boolean((raw as Record<string, unknown>).must_change_password);
  }
  return false;
}

function serializePermissionsForDb(
  perms: AdminPermission[],
  mustChangePassword = false
): Record<string, boolean> {
  const set = new Set(perms);
  return {
    manage_reports: set.has("manage_reports"),
    manage_tags: set.has("manage_tags"),
    import_tags: set.has("import_batches"),
    manage_admins: set.has("manage_admins"),
    danger_zone: set.has("danger_zone"),
    can_live_edit: set.has("can_live_edit"),
    must_change_password: Boolean(mustChangePassword),
  };
}

interface RawAdminProfileRow {
  id: string;
  full_name: string;
  username: string;
  phone: string;
  role: string;
  permissions: unknown;
  pin_hash: string;
  passkey_credential_id?: string | null;
  is_active: boolean;
  last_login?: string | null;
  created_at?: string;
}

function mapAdminProfileRow(
  row: RawAdminProfileRow,
  store: AdminStoreData
): AdminProfileRecord {
  const normalizedPhone = normalizeAdminPhoneKey(row.phone || row.username);
  const rawUsername = String(row.username || normalizedPhone).trim();
  const perms = parsePermissionsFromDb(row.permissions);
  // الأدمن الرئيسي يمتلك دائماً صلاحية تعديل الموقع المباشر
  if (row.role === "SUPER_ADMIN" && !perms.includes("can_live_edit")) {
    perms.push("can_live_edit");
  }
  return {
    id: String(row.id),
    fullName: String(row.full_name || row.phone || "مشرف النظام"),
    username: rawUsername || normalizedPhone,
    phone: normalizedPhone,
    role: String(row.role || "OPERATIONS_ADMIN"),
    permissions: perms,
    mustChangePassword: parseMustChangePasswordFromDb(row.permissions),
    passkeyCredentialId: row.passkey_credential_id
      ? String(row.passkey_credential_id)
      : null,
    isActive: Boolean(row.is_active),
    lastLogin:
      (row.last_login ? String(row.last_login) : null) ||
      store.lastLogins[row.id] ||
      null,
    createdAt: String(row.created_at || new Date().toISOString()),
  };
}

/**
 * البحث عن حساب المشرف في جدول public.admin_profiles عبر رقم الهاتف الإداري أو اسم المستخدم (username)
 */
async function findAdminProfileByPhone(
  phoneInput: string
): Promise<RawAdminProfileRow | null> {
  const clean = String(phoneInput || "").trim();
  if (!clean) return null;

  const cleanLower = clean.toLowerCase();
  const normalizedTarget = normalizeAdminPhoneKey(clean);
  const digits = clean.replace(/\D/g, "");

  try {
    const { data, error } = await supabase.from("admin_profiles").select("*");
    if (!error && Array.isArray(data)) {
      const matched = (data as RawAdminProfileRow[]).find((row) => {
        const rowPhoneNorm = normalizeAdminPhoneKey(row.phone || "");
        const rowUserNorm = normalizeAdminPhoneKey(row.username || "");
        const rowUserLower = String(row.username || "").trim().toLowerCase();
        const rowDigits = String(row.phone || "").replace(/\D/g, "");
        return (
          rowPhoneNorm === normalizedTarget ||
          rowUserNorm === normalizedTarget ||
          rowUserLower === cleanLower ||
          (digits.length >= 9 && rowDigits === digits)
        );
      });
      if (matched) return matched;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * تسجيل حركة إدارية في جدول public.admin_audit_logs بـ Supabase والمخزن المحلي
 */
export async function recordAdminAuditLog(params: {
  adminId?: string | null;
  adminName: string;
  actionType: string;
  actionDetails: string;
  tagCode?: string | null;
}): Promise<AdminAuditLogRecord> {
  const nowIso = new Date().toISOString();
  const entry: AdminAuditLogRecord = {
    id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    adminId: params.adminId || null,
    adminName: params.adminName.trim() || "مشرف النظام",
    actionType: params.actionType.trim(),
    actionDetails: params.actionDetails.trim(),
    tagCode: params.tagCode ? params.tagCode.toUpperCase().trim() : null,
    createdAt: nowIso,
  };

  try {
    await supabase.from("admin_audit_logs").insert({
      admin_id:
        entry.adminId && entry.adminId.includes("-") ? entry.adminId : null,
      admin_name: entry.adminName,
      action_type: entry.actionType,
      target_item: entry.tagCode,
      details: entry.actionDetails,
      created_at: nowIso,
    });
  } catch {
    // ignore if remote insert fails
  }

  const store = loadAdminStore();
  store.auditLogs = [entry, ...store.auditLogs].slice(0, 250);
  saveAdminStore(store);

  return entry;
}

/**
 * منظومة المصادقة المؤسسية للمشرفين عبر رقم الهاتف الإداري فقط
 * تعتمد بالكامل على جدول public.admin_profiles مع حماية Rate Limiting (4 محاولات -> قفل 15 دقيقة لكل رقم هاتف)
 */
export async function verifyAdminAuthentication(params: {
  mode:
    | "lookup_passkey"
    | "passkey_login"
    | "password_login"
    | "enroll_passkey"
    | "unlink_passkey"
    | "change_own_password"
    | "status";
  identifier?: string;
  password?: string;
  currentPassword?: string;
  newPassword?: string;
  passkeyCredentialId?: string;
  credential_id?: string;
  adminId?: string;
}): Promise<{
  ok: boolean;
  error?: string;
  lockedUntilIso?: string | null;
  remainingAttempts?: number;
  adminProfile?: AdminProfileRecord | null;
  passkeyCredentialId?: string | null;
  passkeyCredentialIds?: string[];
  sessionToken?: string;
}> {
  const store = loadAdminStore();
  const identifierRaw = String(params.identifier || "").trim();
  const rateKey = normalizeAdminPhoneKey(identifierRaw || "global");
  const currentLimit = store.rateLimits[rateKey] || {
    failedAttempts: 0,
    lockoutUntilIso: null,
  };

  // التحقق من حالة القفل الزمني (15 دقيقة بعد 4 محاولات خاطئة متتالية لنفس رقم الهاتف)
  if (currentLimit.lockoutUntilIso) {
    const lockUntilMs = new Date(currentLimit.lockoutUntilIso).getTime();
    if (lockUntilMs > Date.now()) {
      if (params.mode === "status") {
        return {
          ok: true,
          lockedUntilIso: currentLimit.lockoutUntilIso,
          remainingAttempts: 0,
        };
      }
      return {
        ok: false,
        lockedUntilIso: currentLimit.lockoutUntilIso,
        remainingAttempts: 0,
        error:
          "تم تجميد المحاولة لرقم الهاتف هذا لمدة 15 دقيقة بسبب 4 محاولات خاطئة متتالية.",
      };
    } else {
      currentLimit.lockoutUntilIso = null;
      currentLimit.failedAttempts = 0;
      store.rateLimits[rateKey] = currentLimit;
      saveAdminStore(store);
    }
  }

  if (params.mode === "status") {
    return {
      ok: true,
      lockedUntilIso: null,
      remainingAttempts: Math.max(0, 4 - currentLimit.failedAttempts),
    };
  }

  // تغيير كلمة المرور الخاصة بالمشرف (عند أول دخول إلزامي أو من لوحة التحكم في أي وقت)
  if (params.mode === "change_own_password") {
    const newPass = String(params.newPassword || "").trim();
    if (newPass.length < 6) {
      return {
        ok: false,
        error: "يجب أن تتكون كلمة المرور الجديدة من 6 خانات على الأقل.",
      };
    }

    let profileRow: RawAdminProfileRow | null = null;
    if (params.adminId) {
      const { data } = await supabase
        .from("admin_profiles")
        .select("*")
        .eq("id", params.adminId)
        .maybeSingle();
      if (data) profileRow = data as RawAdminProfileRow;
    }
    if (!profileRow && identifierRaw) {
      profileRow = await findAdminProfileByPhone(identifierRaw);
    }

    if (!profileRow) {
      return { ok: false, error: "لم يتم العثور على حساب المشرف." };
    }

    const isForcedChange = parseMustChangePasswordFromDb(profileRow.permissions);
    if (!params.currentPassword && !isForcedChange) {
      return { ok: false, error: "يرجى إدخال كلمة المرور الحالية." };
    }

    if (params.currentPassword) {
      const currHash = hashSha256(params.currentPassword.trim()).toLowerCase();
      if (currHash !== String(profileRow.pin_hash || "").toLowerCase()) {
        return {
          ok: false,
          error: "كلمة المرور الحالية غير صحيحة.",
        };
      }
    }

    const newHash = hashSha256(newPass);
    const updatedPermissions = serializePermissionsForDb(
      parsePermissionsFromDb(profileRow.permissions),
      false // إلغاء إلزام تغيير كلمة المرور بعد تغييرها بنجاح
    );

    const { data: updatedRows } = await supabase
      .from("admin_profiles")
      .update({
        pin_hash: newHash,
        permissions: updatedPermissions,
      })
      .eq("id", profileRow.id)
      .select("*");

    const finalRow: RawAdminProfileRow =
      Array.isArray(updatedRows) && updatedRows[0]
        ? (updatedRows[0] as RawAdminProfileRow)
        : {
            ...profileRow,
            pin_hash: newHash,
            permissions: updatedPermissions,
          };

    await recordAdminAuditLog({
      adminId: finalRow.id,
      adminName: finalRow.full_name || finalRow.phone,
      actionType: "ADMIN_PASSWORD_CHANGED",
      actionDetails: `قام المشرف (${finalRow.full_name} - ${finalRow.phone}) بتحديث كلمة المرور الخاصة بحسابه`,
    });

    return {
      ok: true,
      adminProfile: mapAdminProfileRow(finalRow, store),
    };
  }

  // معالج ربط البصمة من داخل الحساب (Admin Passkey Enrollment)
  if (params.mode === "enroll_passkey") {
    const credId = String(params.passkeyCredentialId || "").trim();
    if (!credId) {
      return { ok: false, error: "معرف البصمة غير صالح." };
    }

    let profileRow: RawAdminProfileRow | null = null;
    if (params.adminId) {
      const { data } = await supabase
        .from("admin_profiles")
        .select("*")
        .eq("id", params.adminId)
        .maybeSingle();
      if (data) profileRow = data as RawAdminProfileRow;
    }
    if (!profileRow && identifierRaw) {
      profileRow = await findAdminProfileByPhone(identifierRaw);
    }

    if (!profileRow) {
      return { ok: false, error: "لم يتم العثور على حساب المشرف في النظام." };
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from("admin_profiles")
      .update({ passkey_credential_id: credId })
      .eq("id", profileRow.id)
      .select("*");

    if (updateErr || !updatedRows || updatedRows.length === 0) {
      console.error("[enroll_passkey error]", updateErr);
      return {
        ok: false,
        error: updateErr?.message || "فشل تحديث معرف البصمة في قاعدة بيانات Supabase.",
      };
    }

    const finalRow: RawAdminProfileRow = updatedRows[0] as RawAdminProfileRow;

    await recordAdminAuditLog({
      adminId: finalRow.id,
      adminName: finalRow.full_name || finalRow.phone,
      actionType: "ADMIN_PASSKEY_ENROLLED",
      actionDetails: `تم تفعيل وربط البصمة الحيوية (Passkey) لحساب المشرف (${finalRow.phone})`,
    });

    return {
      ok: true,
      passkeyCredentialId: credId,
      adminProfile: mapAdminProfileRow(finalRow, store),
    };
  }

  // مسح وفك ارتباط البصمة الحيوية (Admin Passkey Unlink)
  if (params.mode === "unlink_passkey") {
    let profileRow: RawAdminProfileRow | null = null;
    if (params.adminId) {
      const { data } = await supabase
        .from("admin_profiles")
        .select("*")
        .eq("id", params.adminId)
        .maybeSingle();
      if (data) profileRow = data as RawAdminProfileRow;
    }
    if (!profileRow && identifierRaw) {
      profileRow = await findAdminProfileByPhone(identifierRaw);
    }

    if (!profileRow) {
      return { ok: false, error: "لم يتم العثور على حساب المشرف." };
    }

    const { data: updatedRows, error: updateErr } = await supabase
      .from("admin_profiles")
      .update({ passkey_credential_id: null })
      .eq("id", profileRow.id)
      .select("*");

    if (updateErr || !updatedRows || updatedRows.length === 0) {
      console.error("[unlink_passkey error]", updateErr);
      return {
        ok: false,
        error: updateErr?.message || "فشل مسح معرف البصمة من قاعدة بيانات Supabase.",
      };
    }

    const finalRow: RawAdminProfileRow = updatedRows[0] as RawAdminProfileRow;

    await recordAdminAuditLog({
      adminId: finalRow.id,
      adminName: finalRow.full_name || finalRow.phone,
      actionType: "ADMIN_PASSKEY_UNLINKED",
      actionDetails: `تم مسح وفك ارتباط البصمة الحيوية (Passkey) لحساب المشرف (${finalRow.phone})`,
    });

    return {
      ok: true,
      passkeyCredentialId: null,
      adminProfile: mapAdminProfileRow(finalRow, store),
    };
  }

  // ============================================================================
  // 1. استعلام معرّفات البصمة المسجلة (Zero-Typing 1-Tap Passkey Lookup)
  // ============================================================================
  if (params.mode === "lookup_passkey") {
    // أ) إذا تم تحديد رقم هاتف المشرف
    if (identifierRaw) {
      const byPhone = await findAdminProfileByPhone(identifierRaw);
      if (!byPhone || !byPhone.is_active) {
        return {
          ok: false,
          error: "رقم الهاتف غير مسجل أو الحساب غير مفعل.",
        };
      }
      if (!byPhone.passkey_credential_id) {
        return {
          ok: false,
          error:
            "لم يتم ربط بصمة (Passkey) بهذا الحساب بعد. يرجى تسجيل الدخول بكلمة المرور أولاً لتفعيل البصمة.",
        };
      }
      return {
        ok: true,
        passkeyCredentialId: byPhone.passkey_credential_id,
        passkeyCredentialIds: [byPhone.passkey_credential_id],
        adminProfile: mapAdminProfileRow(byPhone, store),
      };
    }

    // ب) الدخول الفوري دون كتابة رقم الهاتف نهائياً: استرجاع كافة البصمات النشطة من جدول admin_profiles
    try {
      const { data, error } = await supabase
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

      return {
        ok: true,
        passkeyCredentialIds: credIds,
        passkeyCredentialId: credIds[0] || null,
      };
    } catch {
      return {
        ok: true,
        passkeyCredentialIds: [],
        passkeyCredentialId: null,
      };
    }
  }

  // ============================================================================
  // 2. المصادقة الفورية بالبصمة الحيوية والتعرف العكسي (Reverse Credential Lookup)
  // ============================================================================
  if (params.mode === "passkey_login") {
    const credId = String(
      params.passkeyCredentialId || params.credential_id || ""
    ).trim();
    if (!credId) {
      return { ok: false, error: "معرّف البصمة غير صالح." };
    }

    let profileRow: RawAdminProfileRow | null = null;

    // أ) البحث العكسي المباشر في Supabase عن الحساب المطابق للمعرّف
    try {
      const { data, error } = await supabase
        .from("admin_profiles")
        .select("*")
        .eq("passkey_credential_id", credId)
        .eq("is_active", true);

      if (!error && Array.isArray(data) && data.length > 0) {
        profileRow = data[0] as RawAdminProfileRow;
      }
    } catch {
      // ignore
    }

    // ب) البحث التكميلي برقم الهاتف إذا تم تمريره
    if (!profileRow && identifierRaw) {
      const byPhone = await findAdminProfileByPhone(identifierRaw);
      if (
        byPhone &&
        byPhone.passkey_credential_id === credId &&
        byPhone.is_active
      ) {
        profileRow = byPhone;
      }
    }

    if (!profileRow || !profileRow.is_active) {
      return {
        ok: false,
        error: "لم يتم العثور على حساب مشرف نشط مطابق لهذه البصمة.",
      };
    }

    const matchedPhone = profileRow.phone || profileRow.username;
    const userRateKey = normalizeAdminPhoneKey(matchedPhone);
    const userLimit = store.rateLimits[userRateKey] || {
      failedAttempts: 0,
      lockoutUntilIso: null,
    };
    userLimit.failedAttempts = 0;
    userLimit.lockoutUntilIso = null;
    store.rateLimits[userRateKey] = userLimit;

    const nowIso = new Date().toISOString();
    store.lastLogins[profileRow.id] = nowIso;
    saveAdminStore(store);

    try {
      await supabase
        .from("admin_profiles")
        .update({ last_login: nowIso })
        .eq("id", profileRow.id);
    } catch {
      // ignore
    }

    await recordAdminAuditLog({
      adminId: profileRow.id,
      adminName: profileRow.full_name || profileRow.phone,
      actionType: "ADMIN_LOGIN",
      actionDetails: `تسجيل دخول مؤسسي ناجح بنقرة واحدة بالبصمة الحيوية (Zero-Typing Passkey Login) للمشرف (${profileRow.full_name || profileRow.phone})`,
    });

    const mappedProfile = mapAdminProfileRow(
      { ...profileRow, last_login: nowIso },
      store
    );

    const sessionToken = createAdminSessionToken(mappedProfile);

    return {
      ok: true,
      remainingAttempts: 4,
      adminProfile: mappedProfile,
      sessionToken,
    };
  }

  if (!identifierRaw) {
    return {
      ok: false,
      error: "يرجى إدخال رقم الهاتف الإداري أولاً.",
    };
  }

  const profileRow = await findAdminProfileByPhone(identifierRaw);

  // دالة مساعدة لتسجيل محاولة فاشلة وتطبيق القفل بعد 4 محاولات خاطئة
  const registerFailedAttempt = async (reasonDetail: string) => {
    currentLimit.failedAttempts += 1;
    const remaining = Math.max(0, 4 - currentLimit.failedAttempts);

    await recordAdminAuditLog({
      adminId: profileRow?.id || null,
      adminName: profileRow?.full_name || identifierRaw,
      actionType: "ADMIN_LOGIN_FAILED",
      actionDetails: `محاولة دخول فاشلة لرقم الهاتف (${identifierRaw}): ${reasonDetail} — المحاولة ${currentLimit.failedAttempts} من 4`,
    });

    if (currentLimit.failedAttempts >= 4) {
      const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      currentLimit.lockoutUntilIso = lockUntil;
      store.rateLimits[rateKey] = currentLimit;
      saveAdminStore(store);

      await recordAdminAuditLog({
        adminId: profileRow?.id || null,
        adminName: profileRow?.full_name || identifierRaw,
        actionType: "ADMIN_RATE_LIMIT_LOCKOUT",
        actionDetails: `تم تجميد محاولات الدخول لرقم الهاتف (${identifierRaw}) لمدة 15 دقيقة بعد 4 محاولات خاطئة متتالية`,
      });

      return {
        ok: false,
        lockedUntilIso: lockUntil,
        remainingAttempts: 0,
        error:
          "تم تجميد المحاولة لرقم الهاتف هذا لمدة 15 دقيقة بعد 4 محاولات خاطئة متتالية.",
      };
    }

    store.rateLimits[rateKey] = currentLimit;
    saveAdminStore(store);

    return {
      ok: false,
      remainingAttempts: remaining,
      error: "بيانات الاعتماد غير صحيحة أو الحساب غير مفعل",
    };
  };

  // التأكد من وجود الحساب وأنه نشط (is_active = true)
  if (!profileRow || !profileRow.is_active) {
    return registerFailedAttempt(
      !profileRow ? "رقم الهاتف غير مسجل" : "الحساب غير مفعل (is_active = false)"
    );
  }

  // المصادقة بكلمة المرور / الرمز الإداري (password_login)
  const rawPassword = String(params.password || "").trim();
  if (!rawPassword) {
    return registerFailedAttempt("حقل كلمة المرور فارغ");
  }

  const inputHash = hashSha256(rawPassword).toLowerCase();
  const storedHash = String(profileRow.pin_hash || "").trim().toLowerCase();

  if (inputHash !== storedHash && rawPassword !== storedHash) {
    return registerFailedAttempt("كلمة المرور غير مطابقة");
  }

  currentLimit.failedAttempts = 0;
  currentLimit.lockoutUntilIso = null;
  const nowIso = new Date().toISOString();
  store.rateLimits[rateKey] = currentLimit;
  store.lastLogins[profileRow.id] = nowIso;
  saveAdminStore(store);

  try {
    await supabase
      .from("admin_profiles")
      .update({ last_login: nowIso })
      .eq("id", profileRow.id);
  } catch {
    // ignore
  }

  await recordAdminAuditLog({
    adminId: profileRow.id,
    adminName: profileRow.full_name || profileRow.phone,
    actionType: "ADMIN_LOGIN",
    actionDetails: `تسجيل دخول مؤسسي ناجح بكلمة المرور للمشرف (${profileRow.phone})`,
  });

  const mappedProfile = mapAdminProfileRow(
    { ...profileRow, last_login: nowIso },
    store
  );
  const sessionToken = createAdminSessionToken(mappedProfile);

  return {
    ok: true,
    remainingAttempts: 4,
    adminProfile: mappedProfile,
    sessionToken,
  };
}

/**
 * الحدود الزمنية الصارمة لجلسات المديرين
 */
export const ADMIN_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 دقيقة خمول
export const ADMIN_ABSOLUTE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // ساعتان كحد أقصى للجلسة
export const ADMIN_COOKIE_MAX_AGE_SECONDS = 2 * 60 * 60; // 7200 ثانية

/**
 * توليد رمز جلسة إدارية مشفر وموثق زمنياً
 */
export function createAdminSessionToken(profile: {
  id: string;
  phone: string;
  fullName: string;
  role: string;
  permissions: AdminPermission[];
  sessionCreatedAt?: number;
}): string {
  const now = Date.now();
  const sessionCreatedAt = profile.sessionCreatedAt || now;
  return Buffer.from(
    JSON.stringify({
      id: profile.id,
      phone: profile.phone,
      fullName: profile.fullName,
      role: profile.role,
      permissions: profile.permissions,
      iat: sessionCreatedAt,
      sessionCreatedAt,
      lastActivityAt: now,
      exp: sessionCreatedAt + ADMIN_ABSOLUTE_TIMEOUT_MS,
    })
  ).toString("base64");
}

/**
 * فحص صلاحية وتوقيت جلسة المدير (مهلة خمول 15 دقيقة / حد أقصى ساعتان)
 */
export function verifyAdminSessionToken(token?: string): {
  valid: boolean;
  expired?: boolean;
  error?: string;
  payload?: {
    id?: string;
    phone?: string;
    fullName?: string;
    role?: string;
    permissions?: AdminPermission[];
    sessionCreatedAt?: number;
    lastActivityAt?: number;
  };
} {
  const raw = String(token || "").trim();
  if (!raw) {
    return { valid: false, error: "لا توجد جلسة إدارية نشطة." };
  }

  try {
    const jsonStr = Buffer.from(raw, "base64").toString("utf-8");
    if (jsonStr.startsWith("{") && jsonStr.endsWith("}")) {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === "object") {
        const now = Date.now();
        const createdAt = Number(parsed.sessionCreatedAt || parsed.iat || 0);
        const lastActive = Number(parsed.lastActivityAt || createdAt || 0);

        // 1. فحص الحد الأقصى لعمر الجلسة (ساعتان من لحظة تسجيل الدخول)
        if (
          (createdAt > 0 && now - createdAt >= ADMIN_ABSOLUTE_TIMEOUT_MS) ||
          (typeof parsed.exp === "number" && now >= parsed.exp)
        ) {
          return {
            valid: false,
            expired: true,
            error:
              "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً.",
          };
        }

        // 2. فحص مهلة الخمول (15 دقيقة من عدم النشاط)
        if (lastActive > 0 && now - lastActive >= ADMIN_IDLE_TIMEOUT_MS) {
          return {
            valid: false,
            expired: true,
            error:
              "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً.",
          };
        }

        return {
          valid: true,
          payload: {
            id: parsed.id,
            phone: parsed.phone,
            fullName: parsed.fullName,
            role: parsed.role,
            permissions: parsed.permissions,
            sessionCreatedAt: createdAt,
            lastActivityAt: lastActive,
          },
        };
      }
    }
  } catch {
    // ليس JSON Base64 صالحاً
  }

  return { valid: false, error: "رمز الجلسة غير صالح." };
}

/**
 * التحقق الأمني الصارم من صلاحية المشرف لتعديل وحفظ التعديلات المرئية المباشرة (can_live_edit أو SUPER_ADMIN)
 */
export async function verifyAdminLiveEditPermission(authTokenOrId?: string): Promise<{
  authorized: boolean;
  expired?: boolean;
  profile?: AdminProfileRecord | null;
  error?: string;
}> {
  const token = String(authTokenOrId || "").trim();
  if (!token) {
    return {
      authorized: false,
      error: "مطلوب تسجيل الدخول كأدمن رئيسي أو مشرف يمتلك صلاحية تعديل الموقع.",
    };
  }

  let adminId: string | null = null;
  let adminPhone: string | null = null;

  // فحص صلاحية رمز الجلسة والمهل الزمنية
  const sessionCheck = verifyAdminSessionToken(token);
  if (sessionCheck.expired) {
    return {
      authorized: false,
      expired: true,
      error:
        sessionCheck.error ||
        "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً.",
    };
  }

  if (sessionCheck.valid && sessionCheck.payload) {
    if (sessionCheck.payload.id) adminId = sessionCheck.payload.id;
    if (sessionCheck.payload.phone) adminPhone = sessionCheck.payload.phone;
  }

  if (!adminId && token.includes("-") && token.length >= 32) {
    adminId = token;
  } else if (!adminId && !adminPhone) {
    adminPhone = token;
  }

  let profileRow: RawAdminProfileRow | null = null;

  if (adminId) {
    try {
      const { data, error } = await supabase
        .from("admin_profiles")
        .select("*")
        .eq("id", adminId)
        .maybeSingle();
      if (!error && data) {
        profileRow = data as RawAdminProfileRow;
      }
    } catch {
      // ignore
    }
  }

  if (!profileRow && adminPhone) {
    profileRow = await findAdminProfileByPhone(adminPhone);
  }

  if (!profileRow) {
    return {
      authorized: false,
      error: "لم يتم العثور على حساب مشرف نشط مطابق لرمز الاعتماد في جدول admin_profiles.",
    };
  }

  if (!profileRow.is_active) {
    return {
      authorized: false,
      error: "هذا الحساب الإداري مجمد حالياً.",
    };
  }

  if (profileRow.last_login) {
    const lastLoginTime = new Date(profileRow.last_login).getTime();
    if (
      !Number.isNaN(lastLoginTime) &&
      Date.now() - lastLoginTime >= ADMIN_ABSOLUTE_TIMEOUT_MS
    ) {
      return {
        authorized: false,
        expired: true,
        error:
          "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً.",
      };
    }
  }

  const mapped = mapAdminProfileRow(profileRow, loadAdminStore());
  const isSuperAdmin = mapped.role === "SUPER_ADMIN";
  const hasLiveEdit = mapped.permissions.includes("can_live_edit");

  if (!isSuperAdmin && !hasLiveEdit) {
    return {
      authorized: false,
      profile: mapped,
      error: "غير مصرح لك بتعديل الموقع مباشرة. يتطلب تفعيل صلاحية (can_live_edit) من قبل الأدمن الرئيسي.",
    };
  }

  return {
    authorized: true,
    profile: mapped,
  };
}

/**
 * التحقق الأمني الصارم من صلاحية المشرف لتنفيذ العمليات الإدارية الحساسة من جهة الخادم
 */
export async function verifyAdminActionPermission(
  authTokenOrId?: string,
  action?: string
): Promise<{
  authorized: boolean;
  expired?: boolean;
  profile?: AdminProfileRecord | null;
  error?: string;
}> {
  const token = String(authTokenOrId || "").trim();
  if (!token) {
    return {
      authorized: false,
      error: "مطلوب تسجيل الدخول كمسؤول مصرح له لتنفيذ هذا الإجراء الإداري.",
    };
  }

  let adminId: string | null = null;
  let adminPhone: string | null = null;

  // فحص صلاحية رمز الجلسة والمهل الزمنية (15 دقيقة خمول / ساعتان حد أقصى)
  const sessionCheck = verifyAdminSessionToken(token);
  if (sessionCheck.expired) {
    return {
      authorized: false,
      expired: true,
      error:
        sessionCheck.error ||
        "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً.",
    };
  }

  if (sessionCheck.valid && sessionCheck.payload) {
    if (sessionCheck.payload.id) adminId = sessionCheck.payload.id;
    if (sessionCheck.payload.phone) adminPhone = sessionCheck.payload.phone;
  }

  if (!adminId && token.includes("-") && token.length >= 32) {
    adminId = token;
  } else if (!adminId && !adminPhone) {
    adminPhone = token;
  }

  let profileRow: RawAdminProfileRow | null = null;

  if (adminId) {
    try {
      const { data, error } = await supabase
        .from("admin_profiles")
        .select("*")
        .eq("id", adminId)
        .maybeSingle();
      if (!error && data) {
        profileRow = data as RawAdminProfileRow;
      }
    } catch {
      // ignore
    }
  }

  if (!profileRow && adminPhone) {
    profileRow = await findAdminProfileByPhone(adminPhone);
  }

  if (!profileRow) {
    return {
      authorized: false,
      error: "لم يتم العثور على حساب مشرف نشط مطابق في السجلات الإدارية.",
    };
  }

  if (!profileRow.is_active) {
    return {
      authorized: false,
      error: "هذا الحساب الإداري مجمد حالياً.",
    };
  }

  if (profileRow.last_login) {
    const lastLoginTime = new Date(profileRow.last_login).getTime();
    if (
      !Number.isNaN(lastLoginTime) &&
      Date.now() - lastLoginTime >= ADMIN_ABSOLUTE_TIMEOUT_MS
    ) {
      return {
        authorized: false,
        expired: true,
        error:
          "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً.",
      };
    }
  }

  const mapped = mapAdminProfileRow(profileRow, loadAdminStore());
  const isSuperAdmin = mapped.role === "SUPER_ADMIN";

  // فحص صلاحيات العمليات الخاصة:
  if (action === "danger_reset" && !isSuperAdmin) {
    return {
      authorized: false,
      profile: mapped,
      error: "عملية تصفير النظام مقصورة حصرياً على الأدمن الرئيسي (Super Admin).",
    };
  }

  if (action === "delete_tag" && !isSuperAdmin) {
    return {
      authorized: false,
      profile: mapped,
      error: "عملية مسح الملصق نهائياً مقصورة حصرياً على الأدمن الرئيسي (Super Admin).",
    };
  }

  if (
    action &&
    action.startsWith("team_") &&
    !isSuperAdmin &&
    !mapped.permissions.includes("manage_admins")
  ) {
    return {
      authorized: false,
      profile: mapped,
      error: "غير مصرح لك بإدارة فريق المشرفين والصلاحيات. تتطلب صلاحية (manage_admins).",
    };
  }

  return {
    authorized: true,
    profile: mapped,
  };
}

/**
 * مسار الإشعارات المعزول ومكافحة الإزعاج (Zero-Leak & 5-Minute Cooldown)
 * يستعلم داخلياً عن هاتف المالك وقناة التنبيه دون كشف الرقم للواجهة الأمامية مطلقاً
 */
export async function sendZeroLeakNotification(params: {
  tagCode: string;
  reason: string;
  customNote?: string | null;
  senderPhone?: string | null;
  location?: string | null;
  photoUrl?: string | null;
}): Promise<{
  ok: boolean;
  cooldownActive?: boolean;
  waitSeconds?: number;
  error?: string;
  deliveredChannels?: AlertChannel;
}> {
  const normalizedCode = params.tagCode.toUpperCase().trim();
  const tag = await getVehicleTagByCode(normalizedCode);

  if (!tag) {
    return {
      ok: false,
      error: "كود الملصق غير مسجل في قاعدة البيانات.",
    };
  }

  if (tag.status === "REVOKED") {
    return {
      ok: false,
      error: "هذا الملصق ملغى ومسحوب من الخدمة.",
    };
  }

  if (tag.status !== "ACTIVE") {
    return {
      ok: false,
      error: "هذا الملصق غير مفعل بعد.",
    };
  }

  const adminStore = loadAdminStore();
  const dashStore = loadDashboardStore();
  const existingReports = dashStore.reports[normalizedCode] || [];

  const lastCooldownIso =
    adminStore.notifyCooldowns[normalizedCode] ||
    (existingReports.length > 0 ? existingReports[0].createdAt : null);

  if (lastCooldownIso) {
    const elapsedMs = Date.now() - new Date(lastCooldownIso).getTime();
    const cooldownMs = 5 * 60 * 1000;
    if (elapsedMs >= 0 && elapsedMs < cooldownMs) {
      const waitSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
      return {
        ok: false,
        cooldownActive: true,
        waitSeconds,
        error:
          "تم إرسال بلاغ لصاحب السيارة بالفعل، يرجى الانتظار بضع دقائق",
      };
    }
  }

  const REASON_MAP: Record<
    string,
    {
      title: string;
      description: string;
      badge: string;
      iconType: "blocking" | "lights" | "window" | "emergency";
    }
  > = {
    blocking: {
      title: "مْسَكِّر عليا بسيارتك",
      description: "لو سمحت تجي تحول سيارتك بسرعة",
      badge: "تحريك المركبة",
      iconType: "blocking",
    },
    lights_on: {
      title: "ضي سيارتك والع",
      description: "ناسي ضي سيارتك والع بتاريتك حتفضى",
      badge: "حماية البطارية",
      iconType: "lights",
    },
    car_open: {
      title: "مرش/باب السيارة مفتوح",
      description: "انزل سكر سيارتك",
      badge: "تنبيه أمان",
      iconType: "window",
    },
    hit: {
      title: "خبطت سيارتك بالغلط",
      description: "ياريت تتواصل معاي ونتفاهموا",
      badge: "تنبيه طارئ",
      iconType: "emergency",
    },
    other: {
      title: "في مشكلة في سيارة",
      description: "تنبيه عام لصاحب السيارة",
      badge: "تنبيه عام",
      iconType: "blocking",
    },
  };

  const meta = REASON_MAP[params.reason] || REASON_MAP.blocking;
  const noteText = String(params.customNote || "").trim();
  const callerPhone = String(params.senderPhone || "").trim();
  const reportMessage = noteText || meta.description;

  await addReportForTag({
    tagCode: normalizedCode,
    reasonTitle: meta.title,
    reasonBadge: meta.badge,
    message: reportMessage,
    location: params.location || "",
    photoUrl: params.photoUrl || null,
    iconType: meta.iconType,
  });

  let deliveredChannels: AlertChannel = tag.alertChannel || "BOTH";

  if (tag.ownerPhone) {
    const vehicleLabel = tag.vehicleInfo || tag.vehicleBrand || "سيارتك";
    const whatsappLines = [
      `🚨 تنبيه فوري من منصة بَلِّغْنِي (${normalizedCode})`,
      `المركبة: ${vehicleLabel}`,
      `السبب: ${meta.title}`,
      `التفاصيل: ${meta.description}`,
      ...(callerPhone ? [`رقم المبلِّغ للتواصل: ${callerPhone}`] : []),
      ...(params.location ? [`الموقع التقريبي: ${params.location}`] : []),
    ];

    const smsVar1 = (tag.vehicleInfo || tag.vehicleBrand || normalizedCode)
      .trim()
      .slice(0, 30);
    const smsVar2 = `${meta.title}${callerPhone ? ` - ${callerPhone}` : ""}`
      .trim()
      .slice(0, 70);

    const [waResult, smsResult] = await Promise.allSettled([
      sendWhatsappAlertMessage(tag.ownerPhone, whatsappLines.join("\n")),
      sendSmsAlertMessage(tag.ownerPhone, smsVar1, smsVar2),
    ]);

    const waOk = waResult.status === "fulfilled" && waResult.value.ok;
    const smsOk = smsResult.status === "fulfilled" && smsResult.value.ok;

    console.log(
      `[Dual Delivery ${normalizedCode}] WhatsApp=${
        waOk
          ? "OK"
          : waResult.status === "fulfilled"
          ? waResult.value.error
          : waResult.reason
      } | SMS=${
        smsOk
          ? "OK"
          : smsResult.status === "fulfilled"
          ? `${smsResult.value.status || ""} ${smsResult.value.error}`
          : smsResult.reason
      }`
    );

    if (waOk && smsOk) deliveredChannels = "BOTH";
    else if (waOk) deliveredChannels = "WHATSAPP";
    else if (smsOk) deliveredChannels = "SMS";
  }

  adminStore.notifyCooldowns[normalizedCode] = new Date().toISOString();
  saveAdminStore(adminStore);

  return {
    ok: true,
    deliveredChannels,
  };
}

/**
 * جلب كافة بيانات لوحة الإدارة التنفيذية (الملصقات، البلاغات، سجل الرقابة من admin_audit_logs، وفريق المشرفين من admin_profiles)
 */
export async function getExecutiveAdminOverview(): Promise<{
  tags: VehicleTagRecord[];
  auditLogs: AdminAuditLogRecord[];
  teamMembers: AdminTeamMemberRecord[];
  reportsCount: number;
}> {
  const localMap = loadSyncedStore();

  try {
    const { data, error } = await supabase.from("tags").select("*");
    if (!error && Array.isArray(data)) {
      for (const row of data as StoredTagRow[]) {
        const code = String(row.tag_code || "").toUpperCase();
        if (code && !LEGACY_TEST_CODES.has(code)) {
          localMap[code] = {
            ...(localMap[code] || {}),
            ...row,
            tag_code: code,
          };
        }
      }
    }
  } catch {
    // ignore
  }

  const tags = Object.values(localMap)
    .filter((r) => !LEGACY_TEST_CODES.has(r.tag_code.toUpperCase()))
    .map(mapRowToRecord);
  const adminStore = loadAdminStore();
  const dashStore = loadDashboardStore();

  let auditLogs: AdminAuditLogRecord[] = [...adminStore.auditLogs];
  try {
    const { data, error } = await supabase
      .from("admin_audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(150);

    if (!error && Array.isArray(data)) {
      const remoteLogs: AdminAuditLogRecord[] = data.map(
        (row: Record<string, unknown>) => ({
          id: String(row.id || `aud_${Math.random()}`),
          adminId: row.admin_id ? String(row.admin_id) : null,
          adminName: String(row.admin_name || "مشرف النظام"),
          actionType: String(row.action_type || ""),
          actionDetails: String(row.details || row.action_details || ""),
          tagCode: row.target_item
            ? String(row.target_item)
            : row.tag_code
            ? String(row.tag_code)
            : null,
          createdAt: String(row.created_at || new Date().toISOString()),
        })
      );

      const seen = new Set<string>();
      const merged: AdminAuditLogRecord[] = [];
      for (const item of [...remoteLogs, ...auditLogs]) {
        const sig = `${item.actionType}_${item.adminName}_${item.createdAt.slice(0, 19)}`;
        if (!seen.has(sig)) {
          seen.add(sig);
          merged.push(item);
        }
      }
      auditLogs = merged.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }
  } catch {
    // ignore
  }

  let teamMembers: AdminTeamMemberRecord[] = [];
  try {
    const { data, error } = await supabase
      .from("admin_profiles")
      .select("*")
      .order("created_at", { ascending: true });

    if (!error && Array.isArray(data)) {
      teamMembers = (data as RawAdminProfileRow[]).map((row) => {
        const mapped = mapAdminProfileRow(row, adminStore);
        return {
          id: mapped.id,
          fullName: mapped.fullName,
          username: mapped.username,
          roleTitle:
            mapped.role === "SUPER_ADMIN"
              ? "المدير التنفيذي الرئيسي (SUPER_ADMIN)"
              : mapped.role === "SUPPORT"
              ? "دعم فني (SUPPORT)"
              : "مشرف عمليات (OPERATOR)",
          phone: mapped.phone,
          permissions: mapped.permissions,
          mustChangePassword: mapped.mustChangePassword,
          passkeyCredentialId: mapped.passkeyCredentialId,
          status: mapped.isActive ? "ACTIVE" : "FROZEN",
          lastLogin: mapped.lastLogin,
          createdAt: mapped.createdAt,
        };
      });
    }
  } catch {
    // ignore
  }

  let reportsCount = 0;
  for (const list of Object.values(dashStore.reports)) {
    reportsCount += list.length;
  }

  return {
    tags,
    auditLogs,
    teamMembers,
    reportsCount,
  };
}

/**
 * إدارة دورة حياة الملصقات من لوحة الإدارة (تعديل المركبة، تبديل الحالة، ضبط المصنع، إعادة تعيين أمان المالك)
 */
export async function adminManageTagLifecycle(params: {
  action:
    | "update_vehicle"
    | "set_status"
    | "factory_reset"
    | "reset_owner_security"
    | "delete_tag";
  tagCode: string;
  adminId?: string | null;
  adminName: string;
  status?: TagStatus;
  vehicleInfo?: string;
  city?: string;
  ownerPhone?: string;
  alertChannel?: AlertChannel;
  newOwnerPin?: string;
}): Promise<{ ok: boolean; tag?: VehicleTagRecord; error?: string }> {
  const normalizedCode = params.tagCode.toUpperCase().trim();
  const localMap = loadSyncedStore();
  let targetRow: StoredTagRow | null = localMap[normalizedCode] || null;

  try {
    const { data, error } = await supabaseAdmin
      .from("tags")
      .select("*")
      .eq("tag_code", normalizedCode)
      .maybeSingle();
    if (!error && data) {
      targetRow = {
        ...(targetRow || {}),
        ...(data as StoredTagRow),
      };
    }
  } catch {
    // ignore
  }

  if (!targetRow) {
    return {
      ok: false,
      error: "الملصق المطلوب غير موجود في قاعدة البيانات.",
    };
  }

  if (params.action === "update_vehicle") {
    const updated: StoredTagRow = {
      ...targetRow,
      vehicle_info:
        params.vehicleInfo !== undefined
          ? params.vehicleInfo.trim()
          : targetRow.vehicle_info,
      vehicle_brand:
        params.vehicleInfo !== undefined
          ? params.vehicleInfo.trim()
          : targetRow.vehicle_brand,
      city: params.city !== undefined ? params.city.trim() : targetRow.city,
      owner_phone:
        params.ownerPhone !== undefined
          ? params.ownerPhone.trim() || null
          : targetRow.owner_phone,
      alert_channel: params.alertChannel || targetRow.alert_channel || "BOTH",
    };

    try {
      await supabaseAdmin
        .from("tags")
        .update({
          owner_phone: updated.owner_phone,
          vehicle_make_model: updated.vehicle_info,
          vehicle_city: updated.city,
          notification_channel: updated.alert_channel,
        })
        .eq("tag_code", normalizedCode);
    } catch {
      // ignore
    }

    saveToSyncedStore(updated);

    await recordAdminAuditLog({
      adminId: params.adminId,
      adminName: params.adminName,
      actionType: "TAG_UPDATE_VEHICLE",
      actionDetails: `تحديث بيانات المركبة (${updated.vehicle_info || "—"})، الهاتف (${updated.owner_phone || "—"})، قناة التنبيه (${updated.alert_channel})`,
      tagCode: normalizedCode,
    });

    return { ok: true, tag: mapRowToRecord(updated) };
  }

  if (params.action === "set_status" && params.status) {
    const nextStatus = normalizeStatus(params.status);
    const updated: StoredTagRow = {
      ...targetRow,
      status: nextStatus,
    };

    try {
      await supabaseAdmin
        .from("tags")
        .update({ status: nextStatus })
        .eq("tag_code", normalizedCode);
    } catch {
      // ignore
    }

    saveToSyncedStore(updated);

    await recordAdminAuditLog({
      adminId: params.adminId,
      adminName: params.adminName,
      actionType: `TAG_STATUS_${nextStatus}`,
      actionDetails:
        nextStatus === "REVOKED"
          ? "إلغاء وأرشفة الملصق (Soft Delete / REVOKED) وإيقاف استقبال البلاغات عليه نهائياً"
          : `تبديل حالة الملصق إلى ${nextStatus}`,
      tagCode: normalizedCode,
    });

    return { ok: true, tag: mapRowToRecord(updated) };
  }

  if (params.action === "factory_reset") {
    const updated: StoredTagRow = {
      tag_code: normalizedCode,
      activation_pin_hash: targetRow.activation_pin_hash,
      status: "LOCKED",
      owner_phone: null,
      owner_pin_hash: null,
      recovery_key_hash: null,
      passkey_credential_id: null,
      vehicle_info: null,
      vehicle_brand: "",
      vehicle_model: "",
      city: "طرابلس",
      alert_channel: "BOTH",
      activated_at: null,
    };

    try {
      // Base columns
      await supabaseAdmin
        .from("tags")
        .update({
          status: "LOCKED",
          owner_phone: null,
          owner_pin_hash: null,
          passkey_credential_id: null,
          activated_at: null,
        })
        .eq("tag_code", normalizedCode);

      // Extended columns
      await supabaseAdmin
        .from("tags")
        .update({
          vehicle_info: null,
          vehicle_brand: null,
          vehicle_model: null,
          city: null,
          recovery_key_hash: null,
        })
        .eq("tag_code", normalizedCode);
    } catch {
      // ignore
    }

    // حذف جميع البلاغات والتنبيهات والوثائق المسجلة على هذا الملصق في Supabase
    try {
      await supabaseAdmin
        .from("reports")
        .delete()
        .eq("tag_code", normalizedCode);
      await supabaseAdmin
        .from("reports")
        .delete()
        .eq("tag_id", normalizedCode);
      await supabaseAdmin
        .from("vehicle_documents")
        .delete()
        .eq("tag_code", normalizedCode);
    } catch {
      // ignore
    }

    saveToSyncedStore(updated);

    const dashStore = loadDashboardStore();
    delete dashStore.documents[normalizedCode];
    delete dashStore.reports[normalizedCode];
    delete dashStore.maintenance[normalizedCode];
    saveDashboardStore(dashStore);

    await recordAdminAuditLog({
      adminId: params.adminId,
      adminName: params.adminName,
      actionType: "TAG_FACTORY_RESET",
      actionDetails:
        "ضبط مصنع كامل: مسح ربط السيارة، هاتف المالك، رمز PIN، بصمة Passkey، وحذف البلاغات، وإرجاع الملصق لحالة LOCKED كأنه خرج من المطبعة",
      tagCode: normalizedCode,
    });

    return { ok: true, tag: mapRowToRecord(updated) };
  }

  if (params.action === "reset_owner_security") {
    const newPinHash = params.newOwnerPin
      ? hashSha256(params.newOwnerPin.trim())
      : null;
    const updated: StoredTagRow = {
      ...targetRow,
      owner_pin_hash: newPinHash,
      passkey_credential_id: null,
    };

    try {
      await supabaseAdmin
        .from("tags")
        .update({
          owner_pin_hash: newPinHash,
          passkey_credential_id: null,
        })
        .eq("tag_code", normalizedCode);
    } catch {
      // ignore
    }

    saveToSyncedStore(updated);

    await recordAdminAuditLog({
      adminId: params.adminId,
      adminName: params.adminName,
      actionType: "TAG_RESET_OWNER_SECURITY",
      actionDetails: params.newOwnerPin
        ? "تعيين رمز PIN جديد للمالك وفك ربط البصمة السابقة"
        : "فك ربط البصمة وتصفير رمز الـ PIN للمالك",
      tagCode: normalizedCode,
    });

    return { ok: true, tag: mapRowToRecord(updated) };
  }

  if (params.action === "delete_tag") {
    try {
      await supabaseAdmin.from("reports").delete().eq("tag_code", normalizedCode);
      await supabaseAdmin.from("reports").delete().eq("tag_id", normalizedCode);
      await supabaseAdmin
        .from("vehicle_documents")
        .delete()
        .eq("tag_code", normalizedCode);
      await supabaseAdmin.from("tags").delete().eq("tag_code", normalizedCode);
    } catch {
      // ignore
    }

    removeFromSyncedStore(normalizedCode);

    const dashStore = loadDashboardStore();
    delete dashStore.documents[normalizedCode];
    delete dashStore.reports[normalizedCode];
    delete dashStore.maintenance[normalizedCode];
    saveDashboardStore(dashStore);

    await recordAdminAuditLog({
      adminId: params.adminId,
      adminName: params.adminName,
      actionType: "TAG_DELETED",
      actionDetails: `مسح نهائي للملصق (${normalizedCode}) وكافة البلاغات والوثائق المرتبطة به من النظام (بواسطة الأدمن الرئيسي)`,
      tagCode: normalizedCode,
    });

    return { ok: true };
  }

  return { ok: false, error: "إجراء غير معروف." };
}

/**
 * استيراد دفعة ملصقات مطبوعة (CSV / JSON) أو إدخال يدوي لملصق مفرد مع حساب SHA-256
 */
export async function adminImportPrintedTags(params: {
  adminId?: string | null;
  adminName: string;
  items: Array<{
    tagCode: string;
    scratchPin?: string;
    activationPinHash?: string;
    batchName?: string;
    status?: string;
  }>;
}): Promise<{ ok: boolean; importedCount: number; error?: string }> {
  let importedCount = 0;

  for (const rawItem of params.items) {
    const code = String(rawItem.tagCode || "")
      .trim()
      .toUpperCase();
    if (!code || !code.startsWith("LY-")) continue;

    const pin =
      rawItem.scratchPin || String(crypto.randomInt(100000, 1000000));
    const pinHash = rawItem.activationPinHash
      ? rawItem.activationPinHash.trim().toLowerCase()
      : hashSha256(pin.trim());

    if (!pinHash || pinHash.length !== 64) continue;

    const newRow: StoredTagRow = {
      tag_code: code,
      activation_pin_hash: pinHash,
      status: (rawItem.status === "ACTIVE" ? "ACTIVE" : "LOCKED") as TagStatus,
      tier: "premium",
      alert_channel: "BOTH",
      has_emergency_contacts: false,
    };

    try {
      await supabaseAdmin.from("tags").upsert(
        {
          tag_code: code,
          activation_pin_hash: pinHash,
          status: "LOCKED",
        },
        { onConflict: "tag_code" }
      );
    } catch {
      // ignore
    }

    saveToSyncedStore(newRow);
    importedCount += 1;
  }

  if (importedCount > 0) {
    await recordAdminAuditLog({
      adminId: params.adminId,
      adminName: params.adminName,
      actionType: "IMPORT_TAGS_BATCH",
      actionDetails: `تم إدراج ${importedCount} ملصق جديد بحالة LOCKED مع تشفير رموز الخدش عبر SHA-256`,
      tagCode: importedCount === 1 ? params.items[0]?.tagCode : null,
    });
  }

  return { ok: true, importedCount };
}

const SAFE_TAG_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SAFE_TAG_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const SAFE_TAG_DIGITS = "23456789";

function generateSecureTagCode(existingCodes: Set<string>): string {
  while (true) {
    const pool = SAFE_TAG_CHARS.split("");
    const chosen: string[] = [];
    for (let i = 0; i < 8; i++) {
      const idx = crypto.randomInt(0, pool.length);
      chosen.push(pool[idx]);
      pool.splice(idx, 1);
    }
    const hasLetters =
      chosen.filter((c) => SAFE_TAG_LETTERS.includes(c)).length >= 2;
    const hasDigits =
      chosen.filter((c) => SAFE_TAG_DIGITS.includes(c)).length >= 2;
    if (!hasLetters || !hasDigits) continue;
    const code = `LY-${chosen.slice(0, 4).join("")}-${chosen.slice(4, 8).join("")}`;
    if (!existingCodes.has(code)) {
      existingCodes.add(code);
      return code;
    }
  }
}

/**
 * توليد وإصدار دفعة ملصقات جديدة نظيفة بحالة LOCKED وغير مرتبطة بمركبة أو رقم هاتف
 */
export async function adminGenerateNewBatch(params: {
  count?: number;
  adminId?: string | null;
  adminName: string;
}): Promise<{
  ok: boolean;
  generatedCount: number;
  tags: Array<{
    tagCode: string;
    scratchPin: string;
    activationPinHash: string;
    status: TagStatus;
  }>;
  csvContent: string;
  error?: string;
}> {
  const count =
    typeof params.count === "number" && params.count > 0 ? params.count : 5;
  const localMap = loadSyncedStore();
  const existingCodes = new Set<string>(Object.keys(localMap));

  try {
    const { data } = await supabaseAdmin.from("tags").select("tag_code");
    if (Array.isArray(data)) {
      for (const r of data) {
        if (r.tag_code) existingCodes.add(String(r.tag_code).toUpperCase());
      }
    }
  } catch {
    // ignore
  }

  const generatedList: Array<{
    tagCode: string;
    scratchPin: string;
    activationPinHash: string;
    status: TagStatus;
  }> = [];

  const csvRows: string[] = [];
  const baseUrl = "https://balaghni.ly";

  for (let i = 0; i < count; i++) {
    const tagCode = generateSecureTagCode(existingCodes);
    const scratchPin = String(crypto.randomInt(100000, 1000000));
    const activationPinHash = hashSha256(scratchPin);

    const newRow: StoredTagRow = {
      tag_code: tagCode,
      activation_pin_hash: activationPinHash,
      status: "LOCKED",
      tier: "premium",
      alert_channel: "BOTH",
      has_emergency_contacts: false,
    };

    try {
      await supabaseAdmin.from("tags").insert({
        tag_code: tagCode,
        activation_pin_hash: activationPinHash,
        status: "LOCKED",
      });
    } catch {
      // ignore
    }

    saveToSyncedStore(newRow);

    generatedList.push({
      tagCode,
      scratchPin,
      activationPinHash,
      status: "LOCKED",
    });

    csvRows.push(`"${baseUrl}/s/${tagCode}","${tagCode}","${scratchPin}"`);
  }

  // حفظ في print_batch.csv
  const printBatchPath = path.join(process.cwd(), "print_batch.csv");
  const header = "qr_url,tag_code,scratch_pin\n";
  const newCsvData = csvRows.join("\n") + "\n";
  try {
    if (!fs.existsSync(printBatchPath)) {
      fs.writeFileSync(printBatchPath, header + newCsvData, "utf8");
    } else {
      fs.appendFileSync(printBatchPath, newCsvData, "utf8");
    }
  } catch {
    // ignore
  }

  await recordAdminAuditLog({
    adminId: params.adminId,
    adminName: params.adminName,
    actionType: "BATCH_ISSUE_TAGS",
    actionDetails: `تم إصدار دفعة جديدة مكونة من ${count} ملصقات مشفرة بحالة LOCKED (غير مرتبطة بمركبة أو رقم هاتف)`,
  });

  return {
    ok: true,
    generatedCount: count,
    tags: generatedList,
    csvContent: header + newCsvData,
  };
}

/**
 * توليد كلمة مرور أولية عشوائية من 8 أرقام للمشرفين الجدد أو عند إعادة التعيين
 */
/**
 * قيد admin_profiles_role_check في Supabase يسمح فقط بـ: SUPER_ADMIN | OPERATOR | SUPPORT
 * المشرفون الفرعيون لا يمكن أن يكونوا SUPER_ADMIN
 */
function normalizeSubAdminRole(raw?: string | null): "OPERATOR" | "SUPPORT" {
  const v = String(raw || "").trim().toUpperCase();
  return v === "SUPPORT" || v.includes("دعم") ? "SUPPORT" : "OPERATOR";
}

function generateRandomAdminPassword(): string {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

/**
 * التحكم الكامل للمدير الرئيسي في حسابات المشرفين بجدول public.admin_profiles:
 * - إنشاء حساب برقم الهاتف وتوليد كلمة مرور تلقائياً مع إلزام تغييرها عند أول دخول (must_change_password = true)
 * - إعادة تعيين كلمة المرور أو توليد كلمة جديدة وفك البصمة وإلزام التغيير
 * - تعديل بيانات وصلاحيات المشرف (update_member)
 * - تجميد / تفعيل الحساب فوراً (toggle_status)
 * - مسح وحذف حساب المشرف نهائياً (delete)
 */
export async function adminManageTeamMember(params: {
  action:
    | "add"
    | "toggle_status"
    | "reset_password"
    | "update_member"
    | "delete";
  adminId?: string | null;
  adminName: string;
  memberId?: string;
  fullName?: string;
  username?: string;
  roleTitle?: string;
  phone?: string;
  password?: string;
  permissions?: AdminPermission[];
}): Promise<{
  ok: boolean;
  teamMembers: AdminTeamMemberRecord[];
  generatedPassword?: string;
  error?: string;
}> {
  if (params.action === "add" && params.fullName && params.phone) {
    const normalizedPhone = normalizeAdminPhoneKey(params.phone);
    if (normalizedPhone.replace(/\D/g, "").length < 9) {
      return {
        ok: false,
        teamMembers: (await getExecutiveAdminOverview()).teamMembers,
        error: "يرجى إدخال رقم هاتف ليبي صحيح (مثال: 091XXXXXXX).",
      };
    }
    const cleanUsername =
      String(params.username || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "") || normalizedPhone;

    // منع تكرار اسم المستخدم أو رقم الهاتف
    const dupByUser = await findAdminProfileByPhone(cleanUsername);
    const dupByPhone = await findAdminProfileByPhone(normalizedPhone);
    if (dupByUser || dupByPhone) {
      return {
        ok: false,
        teamMembers: (await getExecutiveAdminOverview()).teamMembers,
        error: "اسم المستخدم أو رقم الهاتف مسجل مسبقاً لمشرف آخر.",
      };
    }

    const generatedPassword =
      params.password && params.password.trim().length >= 6
        ? params.password.trim()
        : generateRandomAdminPassword();
    const pinHash = hashSha256(generatedPassword);
    const perms =
      params.permissions && params.permissions.length > 0
        ? params.permissions
        : (["manage_reports", "manage_tags"] as AdminPermission[]);

    const { error } = await supabase.from("admin_profiles").insert({
      full_name: params.fullName.trim(),
      username: cleanUsername,
      phone: normalizedPhone,
      role: normalizeSubAdminRole(params.roleTitle),
      permissions: serializePermissionsForDb(perms, true), // إلزام المشرف بتغيير كلمة المرور عند أول دخول
      pin_hash: pinHash,
      is_active: true,
    });

    if (error) {
      console.error("[admin_profiles insert]", error.code, error.message);
      return {
        ok: false,
        teamMembers: (await getExecutiveAdminOverview()).teamMembers,
        error: `تعذر إضافة المشرف في قاعدة البيانات: ${error.message}`,
      };
    }

    await recordAdminAuditLog({
      adminId: params.adminId,
      adminName: params.adminName,
      actionType: "ADMIN_TEAM_ADD",
      actionDetails: `إنشاء حساب مشرف جديد (${params.fullName.trim()} - ${normalizedPhone}) مع توليد كلمة مرور أولية وإلزام تغييرها عند أول دخول`,
    });

    const overview = await getExecutiveAdminOverview();
    return {
      ok: true,
      teamMembers: overview.teamMembers,
      generatedPassword,
    };
  }

  if (params.action === "toggle_status" && params.memberId) {
    const { data: current } = await supabase
      .from("admin_profiles")
      .select("*")
      .eq("id", params.memberId)
      .maybeSingle();

    if (current) {
      const row = current as RawAdminProfileRow;
      if (row.role === "SUPER_ADMIN") {
        return {
          ok: false,
          teamMembers: (await getExecutiveAdminOverview()).teamMembers,
          error: "لا يمكن تجميد حساب المدير الرئيسي للنظام.",
        };
      }
      const nextActive = !row.is_active;
      await supabase
        .from("admin_profiles")
        .update({ is_active: nextActive })
        .eq("id", params.memberId);

      await recordAdminAuditLog({
        adminId: params.adminId,
        adminName: params.adminName,
        actionType: nextActive ? "ADMIN_UNFROZEN" : "ADMIN_FROZEN",
        actionDetails: `${nextActive ? "إعادة تفعيل" : "تعطيل وتجميد"} حساب المشرف (${row.full_name} - ${row.phone})`,
      });
    }
  }

  if (params.action === "reset_password" && params.memberId) {
    const { data: current } = await supabase
      .from("admin_profiles")
      .select("*")
      .eq("id", params.memberId)
      .maybeSingle();

    if (current) {
      const row = current as RawAdminProfileRow;
      const newPassword =
        params.password && params.password.trim().length >= 6
          ? params.password.trim()
          : generateRandomAdminPassword();
      const newHash = hashSha256(newPassword);
      const currentPerms = parsePermissionsFromDb(row.permissions);
      const mustChange = row.role !== "SUPER_ADMIN";

      await supabase
        .from("admin_profiles")
        .update({
          pin_hash: newHash,
          passkey_credential_id: null,
          permissions: serializePermissionsForDb(currentPerms, mustChange),
        })
        .eq("id", params.memberId);

      // فك أي قفل تخمين سابق لهذا المشرف
      const store = loadAdminStore();
      const phoneKey = normalizeAdminPhoneKey(row.phone || row.username);
      delete store.rateLimits[phoneKey];
      saveAdminStore(store);

      await recordAdminAuditLog({
        adminId: params.adminId,
        adminName: params.adminName,
        actionType: "ADMIN_PASSWORD_RESET_BY_MASTER",
        actionDetails: `قام المدير الرئيسي بإعادة تعيين كلمة المرور وفك البصمة للمشرف (${row.full_name} - ${row.phone}) مع إلزام تغييرها عند الدخول`,
      });

      const overview = await getExecutiveAdminOverview();
      return {
        ok: true,
        teamMembers: overview.teamMembers,
        generatedPassword: newPassword,
      };
    }
  }

  if (params.action === "update_member" && params.memberId) {
    const { data: current } = await supabase
      .from("admin_profiles")
      .select("*")
      .eq("id", params.memberId)
      .maybeSingle();

    if (current) {
      const row = current as RawAdminProfileRow;
      const nextPerms =
        params.permissions && params.permissions.length > 0
          ? params.permissions
          : parsePermissionsFromDb(row.permissions);
      const keepMustChange = parseMustChangePasswordFromDb(row.permissions);
      const nextPhone = params.phone
        ? normalizeAdminPhoneKey(params.phone)
        : row.phone;

      await supabase
        .from("admin_profiles")
        .update({
          full_name: params.fullName ? params.fullName.trim() : row.full_name,
          phone: nextPhone,
          username: params.username
            ? params.username.trim().toLowerCase().replace(/\s+/g, "")
            : row.username || nextPhone,
          role:
            row.role === "SUPER_ADMIN"
              ? "SUPER_ADMIN"
              : normalizeSubAdminRole(params.roleTitle || row.role),
          permissions: serializePermissionsForDb(nextPerms, keepMustChange),
        })
        .eq("id", params.memberId);

      await recordAdminAuditLog({
        adminId: params.adminId,
        adminName: params.adminName,
        actionType: "ADMIN_MEMBER_UPDATED",
        actionDetails: `تحديث بيانات وصلاحيات المشرف (${params.fullName || row.full_name} - ${nextPhone})`,
      });
    }
  }

  if (params.action === "delete" && params.memberId) {
    const { data: current } = await supabase
      .from("admin_profiles")
      .select("*")
      .eq("id", params.memberId)
      .maybeSingle();

    if (current) {
      const row = current as RawAdminProfileRow;
      if (row.role === "SUPER_ADMIN") {
        return {
          ok: false,
          teamMembers: (await getExecutiveAdminOverview()).teamMembers,
          error: "لا يمكن حذف حساب المدير الرئيسي للنظام.",
        };
      }

      await supabase.from("admin_profiles").delete().eq("id", params.memberId);

      await recordAdminAuditLog({
        adminId: params.adminId,
        adminName: params.adminName,
        actionType: "ADMIN_MEMBER_DELETED",
        actionDetails: `حذف ومسح حساب المشرف (${row.full_name} - ${row.phone}) نهائياً من النظام`,
      });
    }
  }

  const overview = await getExecutiveAdminOverview();
  return { ok: true, teamMembers: overview.teamMembers };
}

/**
 * منطقة الطوارئ وتصفير بيانات الاختبار (Danger Zone Reset) دون لمس بنية الجداول
 */
export async function adminDangerZoneResetSystem(params: {
  adminId?: string | null;
  adminName: string;
}): Promise<{ ok: boolean }> {
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      fs.writeFileSync(LOCAL_STORE_PATH, "{}", "utf8");
    }
    if (fs.existsSync(DASHBOARD_STORE_PATH)) {
      fs.writeFileSync(
        DASHBOARD_STORE_PATH,
        JSON.stringify({ documents: {}, reports: {}, maintenance: {} }, null, 2),
        "utf8"
      );
    }
    const printBatchPath = path.join(process.cwd(), "print_batch.csv");
    if (fs.existsSync(printBatchPath)) {
      fs.writeFileSync(printBatchPath, "qr_url,tag_code,scratch_pin\n", "utf8");
    }
  } catch {
    // ignore
  }

  // مسح السجلات من قاعدة بيانات Supabase دون المساس بملفات المشرفين admin_profiles
  try {
    await supabaseAdmin
      .from("reports")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await supabaseAdmin
      .from("vehicle_documents")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await supabaseAdmin
      .from("tags")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
  } catch {
    // ignore
  }

  const adminStore = loadAdminStore();
  adminStore.notifyCooldowns = {};
  saveAdminStore(adminStore);

  await recordAdminAuditLog({
    adminId: params.adminId,
    adminName: params.adminName,
    actionType: "DANGER_ZONE_RESET",
    actionDetails:
      "تم مسح كافة سجلات الملصقات والبيانات الوهمية وإعادة النظام لحالة نظيفة (0 ملصقات) بالكامل",
  });

  return { ok: true };
}

