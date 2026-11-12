#!/usr/bin/env node
/**
 * سكربت توليد دفعات ملصقات «بَلِّغْنِي | BALAGHNI» (نظام الملفات الخارجية - Offline Only)
 * مسار الملف: scripts/generate-batch.mjs
 *
 * الخصائص:
 * - يعمل دون أي إدراج أو اتصال تعديل بقاعدة البيانات (Offline Generator).
 * - يصدر ملف CSV محلي جاهز للطباعة وللرفع المباشر عبر لوحة الإدارة (/admin).
 * - الأعمدة المطابقة لمستورد الدفعات: code, qr_url, batch_name, status
 *
 * الاستخدام:
 *   node scripts/generate-batch.mjs [العدد] [اسم_الدفعة]
 * مثال:
 *   node scripts/generate-batch.mjs 10 "دفعة-المطبعة-الأولى"
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// 1. قراءة الإعدادات العامة (الرابط الأساسي)
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
 * جمع الأكواد المسجلة سابقاً لمنع التكرار بنسبة 100%
 */
function collectExistingCodes() {
  const existing = new Set();

  // فحص ملفات التصدير السابقة في مجلد exports
  const exportsDir = path.join(projectRoot, "exports");
  if (fs.existsSync(exportsDir)) {
    const files = fs.readdirSync(exportsDir);
    for (const file of files) {
      if (!file.endsWith(".csv")) continue;
      try {
        const content = fs.readFileSync(path.join(exportsDir, file), "utf8");
        const matches = content.match(/LY-[A-Z0-9]{4}-[A-Z0-9]{4}/gi);
        if (matches) {
          for (const m of matches) existing.add(m.toUpperCase());
        }
      } catch {
        // ignore
      }
    }
  }

  // فحص print_batch.csv إن وجد
  const printBatchPath = path.join(projectRoot, "print_batch.csv");
  if (fs.existsSync(printBatchPath)) {
    try {
      const content = fs.readFileSync(printBatchPath, "utf8");
      const matches = content.match(/LY-[A-Z0-9]{4}-[A-Z0-9]{4}/gi);
      if (matches) {
        for (const m of matches) existing.add(m.toUpperCase());
      }
    } catch {
      // ignore
    }
  }

  return existing;
}

/**
 * توليد رمز خدش سري (Scratch PIN) مكون من 6 أرقام عشوائية آمنة
 */
function generateScratchPin() {
  return String(crypto.randomInt(100000, 1000000));
}

export async function generateOfflineBatch(options = {}) {
  const args = process.argv.slice(2);
  let batchCount = options.count || 10;
  let batchName = options.batchName || "";

  for (const arg of args) {
    if (arg.startsWith("--count=")) {
      batchCount = parseInt(arg.replace("--count=", ""), 10) || 10;
    } else if (arg.startsWith("--batch-name=")) {
      batchName = arg.replace("--batch-name=", "").trim();
    } else if (!isNaN(parseInt(arg, 10)) && !options.count) {
      batchCount = parseInt(arg, 10);
    } else if (!batchName && !options.batchName) {
      batchName = arg.trim();
    }
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19).replace(/[:.]/g, "-");
  if (!batchName) {
    batchName = `BATCH-${dateStr}-${timeStr.slice(0, 5)}`;
  }

  console.log("==================================================");
  console.log("  أداة توليد ملصقات «بَلِّغْنِي» (تصدير خارجي فقط)  ");
  console.log("==================================================");
  console.log(`📦 عدد الأكواد المطلوب: ${batchCount}`);
  console.log(`🏷️  اسم الدفعة: ${batchName}`);
  console.log(`🌐 الرابط المعتمد: ${BASE_URL}`);
  console.log(`🔒 وضع التشغيل: ملف خارجي فقط (بدون أي إدراج في قاعدة البيانات)`);

  const existingCodes = collectExistingCodes();
  console.log(`🔍 تم فحص الملفات السابقة: (${existingCodes.size}) كود مسجل مسبقاً لمنع التكرار.`);

  // 3. توليد الأكواد الجديدة مع رمز الخدش السري (6 أرقام) وحساب SHA-256
  const records = [];
  for (let i = 0; i < batchCount; i++) {
    const code = generateSecureTagCode(existingCodes);
    const qrUrl = `${BASE_URL}/s/${code}`;
    const scratchPin = generateScratchPin();
    const activationPinHash = crypto
      .createHash("sha256")
      .update(scratchPin)
      .digest("hex");
    records.push({
      code,
      qrUrl,
      batchName,
      status: "LOCKED",
      scratchPin,
      activationPinHash,
    });
  }

  // 4. تصدير ملف الـ CSV بدون أكواد الخدش الصريحة (فقط الكود والرابط والدفعة والحالة والتشفير)
  const exportsDir = path.join(projectRoot, "exports");
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const exportFileName = `balaghni-batch-${dateStr}-${timeStr}.csv`;
  const exportFilePath = path.join(exportsDir, exportFileName);

  // رأس الملف: code, qr_url, batch_name, status, activation_pin_hash
  const header = "code,qr_url,batch_name,status,activation_pin_hash";
  const rows = records.map(
    (r) => `"${r.code}","${r.qrUrl}","${r.batchName}","${r.status}","${r.activationPinHash}"`
  );

  // إضافة UTF-8 BOM (\uFEFF) لدعم اللغة العربية في إكسل مباشرة
  const bom = "\uFEFF";
  const csvContent = bom + [header, ...rows].join("\r\n") + "\r\n";
  fs.writeFileSync(exportFilePath, csvContent, "utf8");

  // حفظ نسخة تلقائية في مجلد التنزيلات العام بالجهاز (/sdcard/Download/) لسهولة الرفع
  const downloadDir = "/sdcard/Download";
  let downloadFilePath = null;
  try {
    if (fs.existsSync(downloadDir)) {
      downloadFilePath = path.join(downloadDir, exportFileName);
      fs.writeFileSync(downloadFilePath, csvContent, "utf8");
    }
  } catch (err) {
    console.warn("⚠️ تعذر نسخ الملف إلى /sdcard/Download:", err.message);
  }

  console.log("");
  console.log("==================================================");
  console.log("          تم توليد وتصدير الملف بنجاح!            ");
  console.log("==================================================");
  console.log(`📄 المسار داخل مجلد المشروع (exports):`);
  console.log(`   ${exportFilePath}`);
  if (downloadFilePath) {
    console.log(`📥 مسار نسخة التنزيلات العامة (جاهزة للرفع المباشر من المتصفح):`);
    console.log(`   ${downloadFilePath}`);
  }
  console.log(`📊 إجمالي الأكواد المولدة: ${records.length}`);
  console.log(`📑 الأعمدة في الملف: code, qr_url, batch_name, status, activation_pin_hash`);
  console.log(`🔒 أكواد الخدش السرية (للمشرف هنا فقط - غير مكتوبة في الملف):`);
  for (const r of records) {
    console.log(`   ${r.code}  =>  رمز الخدش: ${r.scratchPin}`);
  }
  console.log("==================================================");

  return {
    success: true,
    count: records.length,
    exportFilePath,
    downloadFilePath,
    exportFileName,
    records,
  };
}

if (process.argv[1] && process.argv[1].endsWith("generate-batch.mjs")) {
  generateOfflineBatch().catch((err) => {
    console.error("❌ خطأ أثناء توليد الدفعة:", err);
    process.exit(1);
  });
}
