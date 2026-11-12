#!/usr/bin/env node
/**
 * سكربت إصدار دفعات ملصقات «بَلِّغْنِي | BALAGHNI»
 * مسار الملف: scripts/generate-batch.mjs
 *
 * الاستخدام:
 *   node scripts/generate-batch.mjs [العدد] [اسم_الدفعة]
 * مثال:
 *   node scripts/generate-batch.mjs 10 "دفعة-تجريبية-1"
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// 1. قراءة متغيرات البيئة من ملفات .env محلياً
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const envLocal = loadEnvFile(path.join(projectRoot, ".env.local"));
const envDefault = loadEnvFile(path.join(projectRoot, ".env"));
const mergedEnv = { ...envDefault, ...envLocal, ...process.env };

const SUPABASE_URL =
  mergedEnv.NEXT_PUBLIC_SUPABASE_URL || "https://aivxhxnvgqxylugqrjei.supabase.co";

const SERVICE_ROLE_KEY = mergedEnv.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY =
  mergedEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_wUsqBoHbhbuvVitBDo2wuw_xOhU-IEe";

const ACTIVE_SUPABASE_KEY = SERVICE_ROLE_KEY || ANON_KEY;
const BASE_URL = (mergedEnv.NEXT_PUBLIC_SITE_URL || "https://balaghni.ly").replace(/\/+$/, "");

// 2. الأحرف المعتمدة: استبعاد الأحرف والأرقام المتشابهة بصرياً (0, O, 1, I)
const SAFE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SAFE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const SAFE_DIGITS = "23456789";

/**
 * توليد كود ملصق آمن وغير قابل للتخمين بصيغة LY-XXXX-XXXX
 */
function generateSecureTagCode(existingCodes) {
  while (true) {
    const pool = SAFE_CHARS.split("");
    const chosen = [];

    // اختيار 8 خانات عشوائية باستخدام CSPRNG
    for (let i = 0; i < 8; i++) {
      const idx = crypto.randomInt(0, pool.length);
      chosen.push(pool[idx]);
      pool.splice(idx, 1);
    }

    // التحقق من احتواء الكود على حرفين ورقمين على الأقل
    const lettersCount = chosen.filter((c) => SAFE_LETTERS.includes(c)).length;
    const digitsCount = chosen.filter((c) => SAFE_DIGITS.includes(c)).length;
    if (lettersCount < 2 || digitsCount < 2) continue;

    const part1 = chosen.slice(0, 4).join("");
    const part2 = chosen.slice(4, 8).join("");
    const code = `LY-${part1}-${part2}`;

    if (!existingCodes.has(code)) {
      existingCodes.add(code);
      return code;
    }
  }
}

/**
 * توليد كود خدش سري PIN من 6 أرقام
 */
function generateScratchPin() {
  return String(crypto.randomInt(100000, 1000000));
}

/**
 * حساب التجزئة المشفرة SHA-256
 */
function hashSha256(text) {
  return crypto.createHash("sha256").update(String(text).trim(), "utf8").digest("hex");
}

async function main() {
  const args = process.argv.slice(2);
  let batchCount = 10;
  let batchName = "";

  for (const arg of args) {
    if (arg.startsWith("--count=")) {
      batchCount = parseInt(arg.replace("--count=", ""), 10) || 10;
    } else if (arg.startsWith("--batch-name=")) {
      batchName = arg.replace("--batch-name=", "").trim();
    } else if (!isNaN(parseInt(arg, 10)) && batchCount === 10) {
      batchCount = parseInt(arg, 10);
    } else if (!batchName) {
      batchName = arg.trim();
    }
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const timeStr = new Date().toISOString().slice(11, 16).replace(":", "");
  if (!batchName) {
    batchName = `BATCH-${dateStr}-${timeStr}`;
  }

  console.log("==================================================");
  console.log("   منظومة إصدار دفعات ملصقات «بَلِّغْنِي» الآمنة   ");
  console.log("==================================================");
  console.log(`📦 عدد الملصقات المطلوب: ${batchCount}`);
  console.log(`🏷️  اسم الدفعة: ${batchName}`);
  console.log(`🌐 الرابط الأساسي: ${BASE_URL}`);
  console.log(`🔑 مفتاح Supabase المستخدم: ${SERVICE_ROLE_KEY ? "Service Role Key (Admin)" : "Anon Publishable Key"}`);

  const supabase = createClient(SUPABASE_URL, ACTIVE_SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 3. فحص قاعدة البيانات للتأكد من عدم تكرار أي كود مسبقاً بنسبة 100%
  const existingCodes = new Set();

  // فحص جدول tags
  try {
    const { data: tagRows, error: tagErr } = await supabase.from("tags").select("tag_code");
    if (!tagErr && Array.isArray(tagRows)) {
      for (const r of tagRows) {
        if (r.tag_code) existingCodes.add(String(r.tag_code).toUpperCase());
      }
    }
  } catch {
    // ignore
  }

  // فحص جدول stickers إن وجد
  try {
    const { data: stickerRows, error: stErr } = await supabase.from("stickers").select("tag_code");
    if (!stErr && Array.isArray(stickerRows)) {
      for (const r of stickerRows) {
        if (r.tag_code) existingCodes.add(String(r.tag_code).toUpperCase());
      }
    }
  } catch {
    // ignore
  }

  // فحص المخزن المحلي local-tags-store.json
  const localStorePath = path.join(projectRoot, "src/data/local-tags-store.json");
  let localStore = {};
  if (fs.existsSync(localStorePath)) {
    try {
      localStore = JSON.parse(fs.readFileSync(localStorePath, "utf8"));
      for (const code of Object.keys(localStore)) {
        existingCodes.add(code.toUpperCase());
      }
    } catch {
      localStore = {};
    }
  }

  console.log(`🔍 تم فحص النظام: يوجد (${existingCodes.size}) ملصق مسجل مسبقاً.`);

  // 4. توليد السجلات الجديدة
  const records = [];
  for (let i = 0; i < batchCount; i++) {
    const tagCode = generateSecureTagCode(existingCodes);
    const pin = generateScratchPin();
    const pinHash = hashSha256(pin);
    const qrUrl = `${BASE_URL}/s/${tagCode}`;

    records.push({
      index: i + 1,
      tagCode,
      qrUrl,
      batchName,
      status: "LOCKED",
      pin,
      pinHash,
      createdAt: new Date().toISOString(),
    });
  }

  // 5. حفظ الأكواد في Supabase
  console.log(`⏳ جاري حقن (${records.length}) ملصق جديد بحالة LOCKED في قاعدة البيانات...`);
  let dbSuccess = false;
  let dbErrorMsg = null;

  const dbRows = records.map((r) => ({
    tag_code: r.tagCode,
    activation_pin_hash: r.pinHash,
    status: "LOCKED",
    created_at: r.createdAt,
  }));

  try {
    // محاولة الإدراج في جدول tags (الجدول المعتمد في المنصة)
    const { error: insErr } = await supabase.from("tags").insert(dbRows);
    if (!insErr) {
      dbSuccess = true;
      console.log(`✅ تم إدراج الملصقات بنجاح في جدول (tags) داخل Supabase!`);
    } else {
      dbErrorMsg = insErr.message;
      console.warn(`⚠️ تعذر الإدراج المباشر في Supabase (tags): ${insErr.message}`);
    }

    // محاولة إضافية لجدول stickers إن وجد كجدول بديل أو إضافي
    try {
      await supabase.from("stickers").insert(dbRows);
    } catch {
      // ignore
    }

    // تسجيل العملية في سجل تدقيق المشرفين
    try {
      await supabase.from("admin_audit_logs").insert({
        action_type: "BATCH_ISSUE_TAGS",
        target_item: batchName,
        details: `إصدار دفعة جديدة [${batchName}] تضم ${records.length} ملصق بحالة LOCKED عبر generate-batch.mjs`,
        admin_name: "CLI Batch Generator",
      });
    } catch {
      // ignore
    }
  } catch (err) {
    dbErrorMsg = err.message;
    console.warn(`⚠️ حدث استثناء أثناء الاتصال بقاعدة البيانات: ${err.message}`);
  }

  // 6. المزامنة في المخزن المحلي للمشروع local-tags-store.json لضمان استجابة الموقع فوراً
  for (const r of records) {
    localStore[r.tagCode] = {
      tag_code: r.tagCode,
      activation_pin_hash: r.pinHash,
      status: "LOCKED",
      batch_name: r.batchName,
      created_at: r.createdAt,
      tier: "premium",
      alert_channel: "BOTH",
      has_emergency_contacts: false,
    };
  }
  fs.writeFileSync(localStorePath, JSON.stringify(localStore, null, 2), "utf8");
  console.log(`💾 تم تحديث المخزن الداخلي للمنصة (${path.relative(projectRoot, localStorePath)}).`);

  // 7. تصدير ملف الطباعة (CSV / Excel Ready بترميز UTF-8 BOM)
  const exportsDir = path.join(projectRoot, "exports");
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const exportFileName = `balaghni-batch-${dateStr}-${timeStr}.csv`;
  const exportFilePath = path.join(exportsDir, exportFileName);

  // رأس الملف والأعمدة المطلوبة:
  // 1) التسلسل 2) كود_الملصق 3) رابط_الباركود_QR 4) اسم_الدفعة 5) الحالة 6) رمز_الخدش_PIN
  const headers = ["التسلسل", "كود_الملصق", "رابط_الباركود_QR", "اسم_الدفعة", "الحالة", "رمز_الخدش_PIN"];

  const csvRows = [
    headers.map((h) => `"${h}"`).join(","),
    ...records.map((r) =>
      [
        r.index,
        `"${r.tagCode}"`,
        `"${r.qrUrl}"`,
        `"${r.batchName}"`,
        `"${r.status}"`,
        `"${r.pin}"`,
      ].join(",")
    ),
  ];

  // علامة \uFEFF (UTF-8 Byte Order Mark) تجعل الإكسل يقرأ اللغة العربية تلقائياً وبشكل سليم
  const bom = "\uFEFF";
  const csvContent = bom + csvRows.join("\r\n") + "\r\n";
  fs.writeFileSync(exportFilePath, csvContent, "utf8");

  // تحديث ملف print_batch.csv التراكمي للمطبعة
  const printBatchPath = path.join(projectRoot, "print_batch.csv");
  const printBatchRows = records.map((r) => `"${r.qrUrl}","${r.tagCode}","${r.pin}"`).join("\n");
  try {
    if (!fs.existsSync(printBatchPath)) {
      fs.writeFileSync(printBatchPath, "qr_url,tag_code,scratch_pin\n" + printBatchRows + "\n", "utf8");
    } else {
      fs.appendFileSync(printBatchPath, printBatchRows + "\n", "utf8");
    }
  } catch {
    // ignore
  }

  // 8. حفظ ملف SQL احتياطي للدفعة في حال الحاجة لإعادة الحقن اليدوي في Supabase SQL Editor
  const sqlValues = records
    .map((r) => `  ('${r.tagCode}', '${r.pinHash}', 'LOCKED', '${r.createdAt}')`)
    .join(",\n");
  const sqlContent = [
    `-- دفعة ملصقات بَلِّغْنِي: ${batchName}`,
    `-- تاريخ: ${new Date().toISOString()}`,
    "insert into public.tags (tag_code, activation_pin_hash, status, created_at)",
    "values",
    sqlValues,
    "on conflict (tag_code) do nothing;",
  ].join("\n");
  const sqlFilePath = path.join(exportsDir, `balaghni-batch-${dateStr}-${timeStr}.sql`);
  fs.writeFileSync(sqlFilePath, sqlContent, "utf8");

  console.log("");
  console.log("==================================================");
  console.log("             تم إصدار الدفعة بنجاح!               ");
  console.log("==================================================");
  console.log(`📄 ملف التصدير للطباعة (Excel Ready):`);
  console.log(`   ${exportFilePath}`);
  console.log(`📊 إجمالي الملصقات المصدرة: ${records.length}`);
  console.log(`🔒 الحالة الافتراضية: LOCKED (غير مرتبطة بأي سيارة أو هاتف)`);
  if (!dbSuccess && dbErrorMsg) {
    console.log(`ℹ️  ملاحظة قاعدة البيانات: تم الحفظ محلياً وتجهيز ملف SQL الاحتياطي: ${sqlFilePath}`);
  }
  console.log("==================================================");

  return {
    success: true,
    count: records.length,
    exportFilePath,
    sqlFilePath,
    dbSuccess,
    dbErrorMsg,
    records,
  };
}

main().catch((err) => {
  console.error("❌ فشل تنفيذ السكربت:", err);
  process.exit(1);
});
