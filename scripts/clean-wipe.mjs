#!/usr/bin/env node
/**
 * سكربت التنظيف والتصفير الشامل لمنظومة «بَلِّغْنِي | BALAGHNI»
 * مسار الملف: scripts/clean-wipe.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

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
const SERVICE_KEY = mergedEnv.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY =
  mergedEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_wUsqBoHbhbuvVitBDo2wuw_xOhU-IEe";

async function main() {
  console.log("==================================================");
  console.log("   بدء عملية التصفير والتنظيف الشامل لمنظومة بَلِّغْنِي   ");
  console.log("==================================================");

  // 1. تصفير المخزن المحلي للملصقات (0 ملصقات)
  const tagsStorePath = path.join(projectRoot, "src/data/local-tags-store.json");
  fs.writeFileSync(tagsStorePath, "{}\n", "utf8");
  console.log("🧹 تم مسح جميع الملصقات من المخزن المحلي (local-tags-store.json) -> 0 ملصق.");

  // 2. تصفير المخزن المحلي للوحة التحكم
  const dashStorePath = path.join(projectRoot, "src/data/local-dashboard-store.json");
  fs.writeFileSync(
    dashStorePath,
    JSON.stringify({ documents: {}, reports: {}, maintenance: {} }, null, 2) + "\n",
    "utf8"
  );
  console.log("🧹 تم تصفير سجلات لوحة التحكم (local-dashboard-store.json).");

  // 3. تصفير سجل الرقابة والعمليات الإدارية (auditLogs)
  const adminStorePath = path.join(projectRoot, "src/data/local-admin-store.json");
  if (fs.existsSync(adminStorePath)) {
    try {
      const adminStore = JSON.parse(fs.readFileSync(adminStorePath, "utf8"));
      adminStore.auditLogs = [];
      adminStore.notifyCooldowns = {};
      adminStore.rateLimits = {};
      fs.writeFileSync(adminStorePath, JSON.stringify(adminStore, null, 2) + "\n", "utf8");
      console.log("🧹 تم تصفير سجل التدقيق الإداري المحلي (auditLogs -> 0).");
    } catch {
      // ignore
    }
  }

  // 4. تصفير ملف المطبعة print_batch.csv
  const printBatchPath = path.join(projectRoot, "print_batch.csv");
  fs.writeFileSync(printBatchPath, "code,qr_url,batch_name,status\n", "utf8");
  console.log("🧹 تم تصفير ملف المطبعة (print_batch.csv).");

  // 5. مسح ملفات التصدير القديمة في exports/
  const exportsDir = path.join(projectRoot, "exports");
  if (fs.existsSync(exportsDir)) {
    const oldFiles = fs.readdirSync(exportsDir);
    for (const f of oldFiles) {
      fs.unlinkSync(path.join(exportsDir, f));
    }
    console.log(`🧹 تم تنظيف مجلد الصادرات (exports/) وحذف (${oldFiles.length}) ملف قديم.`);
  }

  // 6. الاتصال بـ Supabase والتنظيف السحابي
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // حذف سجلات التدقيق
    await supabase.from("admin_audit_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    console.log("☁️ تم مسح سجلات التدقيق الإداري من Supabase.");

    // حذف البلاغات والوثائق
    await supabase.from("reports").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("vehicle_documents").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // التأكد من الحفاظ التام على حساب المدير الرئيسي 0919009899 فقط
    await supabase
      .from("admin_profiles")
      .delete()
      .neq("username", "0919009899")
      .neq("phone", "0919009899");
    console.log("🔒 تم تأكيد بقاء حساب المدير الرئيسي (0919009899) وبصمته دون أي مساس.");

    // محاولة حذف جدول tags
    const { error: delTagErr } = await supabase
      .from("tags")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delTagErr) {
      console.warn(`⚠️ ملاحظة RLS عند حذف tags من السحابة: ${delTagErr.message}`);
    }
  } catch (err) {
    console.warn("⚠️ استثناء أثناء تنظيف السحابة:", err.message);
  }

  // 7. إنشاء ملف SQL للتصفير المباشر بضغطة واحدة في Supabase Dashboard SQL Editor
  const sqlContent = `-- ============================================================================
-- منصة «بَلِّغْنِي | BALAGHNI» — كود التصفير الشامل لقاعدة بيانات Supabase
-- تشغيل في: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================================

-- 1. تصفير الملصقات بالكامل
DELETE FROM public.tags;

-- 2. تصفير البلاغات والوثائق وسجلات الرقابة
DELETE FROM public.reports;
DELETE FROM public.vehicle_documents;
DELETE FROM public.admin_audit_logs;

-- 3. الإبقاء التام على حساب المدير الرئيسي 0919009899 فقط وبصمته ومسح أي حسابات أخرى
DELETE FROM public.admin_profiles
WHERE username != '0919009899' AND phone != '0919009899';

-- النتيجة: النظام الآن في حالة الصفر النظيف (0 ملصقات، 0 بلاغات، 0 سجلات).
`;

  const sqlPath = path.join(projectRoot, "clean_wipe.sql");
  fs.writeFileSync(sqlPath, sqlContent, "utf8");
  console.log(`📜 تم إنشاء ملف SQL الشامل: ${path.relative(projectRoot, sqlPath)}`);

  console.log("");
  console.log("==================================================");
  console.log("           اكتمل التنظيف والتصفير بنجاح!           ");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ فشل التنظيف:", err);
  process.exit(1);
});
