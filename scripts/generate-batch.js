#!/usr/bin/env node
/**
 * أداة التوليد المحلية لدفعات ملصقات «بَلِّغْنِي | BALAGHNI»
 * الاستخدام:
 *   node scripts/generate-batch.js [العدد] [الرابط_الأساسي]
 * مثال:
 *   node scripts/generate-batch.js 50 https://balaghni.ly
 *
 * المخرجات:
 *   1) print_batch.csv   -> مخصص للمطبعة (رابط QR العام، كود الملصق الظاهر، وكود الخدش PIN)
 *   2) seed_supabase.sql -> لإدراج الدفعة مباشرة في قاعدة البيانات بحالة LOCKED (مع التجزئة SHA-256 فقط)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// الأبجدية الصافية (بدون الأحرف والأرقام الملتبسة: 0, O, 1, I, L)
const SAFE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SAFE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const SAFE_DIGITS = "23456789";

/**
 * توليد كود ملصق عشوائي غير متسلسل من 8 خانات بصيغة LY-XXXX-XXXX
 * يضمن:
 * - عدم تكرار أي حرف/رقم داخل الكود الواحد (8 خانات فريدة)
 * - مزيج من الحروف والأرقام بدون الأحرف الملتبسة
 */
function generateUniqueTagCode(existingCodes) {
  while (true) {
    const pool = SAFE_CHARS.split("");
    const chosen = [];

    // سحب 8 خانات غير متكررة عشوائياً عبر CSPRNG
    for (let i = 0; i < 8; i++) {
      const idx = crypto.randomInt(0, pool.length);
      chosen.push(pool[idx]);
      pool.splice(idx, 1);
    }

    // التأكد من احتواء الكود على حرفين ورقمين على الأقل لضمان المزج
    const hasLetters = chosen.filter((c) => SAFE_LETTERS.includes(c)).length >= 2;
    const hasDigits = chosen.filter((c) => SAFE_DIGITS.includes(c)).length >= 2;
    if (!hasLetters || !hasDigits) continue;

    const part1 = chosen.slice(0, 4).join("");
    const part2 = chosen.slice(4, 8).join("");
    const tagCode = `LY-${part1}-${part2}`;

    if (!existingCodes.has(tagCode)) {
      existingCodes.add(tagCode);
      return tagCode;
    }
  }
}

/**
 * توليد رمز الخدش السري (PIN) من 6 أرقام عشوائية غير متوقعة
 */
function generateScratchPin() {
  const num = crypto.randomInt(100000, 1000000);
  return String(num);
}

/**
 * حساب التجزئة المشفرة SHA-256 لرمز الـ PIN
 */
function hashPinSha256(pin) {
  return crypto
    .createHash("sha256")
    .update(String(pin).trim(), "utf8")
    .digest("hex");
}

function main() {
  const countArg = parseInt(process.argv[2] || "20", 10);
  const batchSize = Number.isFinite(countArg) && countArg > 0 ? countArg : 20;
  const baseUrl = (process.argv[3] || process.env.NEXT_PUBLIC_SITE_URL || "https://balaghni.ly").replace(
    /\/+$/,
    ""
  );

  const generatedCodes = new Set();
  const records = [];

  // إضافة كود تجريبي ثابت بحالة LOCKED لتسهيل الاختبار الفوري (LY-K7W9-P2M4 / PIN: 482915)
  const demoLockedCode = "LY-K7W9-P2M4";
  const demoLockedPin = "482915";
  generatedCodes.add(demoLockedCode);
  records.push({
    tagCode: demoLockedCode,
    pin: demoLockedPin,
    pinHash: hashPinSha256(demoLockedPin),
    qrUrl: `${baseUrl}/s/${demoLockedCode}`,
  });

  while (records.length < batchSize) {
    const tagCode = generateUniqueTagCode(generatedCodes);
    const pin = generateScratchPin();
    const pinHash = hashPinSha256(pin);
    const qrUrl = `${baseUrl}/s/${tagCode}`;

    records.push({
      tagCode,
      pin,
      pinHash,
      qrUrl,
    });
  }

  // 1. بناء ملف المطبعة print_batch.csv
  const csvLines = [
    "qr_url,tag_code,scratch_pin",
    ...records.map((r) => `"${r.qrUrl}","${r.tagCode}","${r.pin}"`),
  ];
  const csvPath = path.join(process.cwd(), "print_batch.csv");
  fs.writeFileSync(csvPath, csvLines.join("\n") + "\n", "utf8");

  // 2. بناء ملف الإدراج في قاعدة البيانات seed_supabase.sql
  const sqlValues = records
    .map(
      (r) =>
        `  ('${r.tagCode}', '${r.pinHash}', 'LOCKED')`
    )
    .join(",\n");

  const sqlContent = [
    "-- ملف تغذية دفعة الملصقات في قاعدة بيانات Supabase لمنصة «بَلِّغْنِي | BALAGHNI»",
    `-- تاريخ التوليد: ${new Date().toISOString()}`,
    `-- إجمالي الملصقات: ${records.length} ملصق بحالة LOCKED`,
    "",
    "insert into public.tags (tag_code, activation_pin_hash, status)",
    "values",
    `${sqlValues}`,
    "on conflict (tag_code) do nothing;",
    "",
  ].join("\n");

  const sqlPath = path.join(process.cwd(), "seed_supabase.sql");
  fs.writeFileSync(sqlPath, sqlContent, "utf8");

  console.log("✅ تم توليد دفعة الملصقات بنجاح!");
  console.log(`📦 عدد الملصقات المولدة: ${records.length}`);
  console.log(`🖨️ ملف المطبعة (سري): ${csvPath}`);
  console.log(`🗄️ ملف قاعدة البيانات: ${sqlPath}`);
  console.log(
    `🔑 مثال للتجربة الفورية (LOCKED): الكود ${records[0].tagCode} | رمز الخدش PIN: ${records[0].pin}`
  );
}

main();
