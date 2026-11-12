const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const SAFE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SAFE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const SAFE_DIGITS = "23456789";

function generateTagCode(existing) {
  while (true) {
    const pool = SAFE_CHARS.split("");
    const chosen = [];
    for (let i = 0; i < 8; i++) {
      const idx = crypto.randomInt(0, pool.length);
      chosen.push(pool[idx]);
      pool.splice(idx, 1);
    }
    const hasLetters = chosen.filter((c) => SAFE_LETTERS.includes(c)).length >= 2;
    const hasDigits = chosen.filter((c) => SAFE_DIGITS.includes(c)).length >= 2;
    if (!hasLetters || !hasDigits) continue;
    const code = `LY-${chosen.slice(0, 4).join("")}-${chosen.slice(4, 8).join("")}`;
    if (!existing.has(code)) {
      existing.add(code);
      return code;
    }
  }
}

function hashSha256(val) {
  return crypto.createHash("sha256").update(String(val).trim(), "utf8").digest("hex");
}

async function main() {
  const storePath = path.join(process.cwd(), "src/data/local-tags-store.json");
  let store = {};
  if (fs.existsSync(storePath)) {
    try {
      store = JSON.parse(fs.readFileSync(storePath, "utf8"));
    } catch {
      store = {};
    }
  }

  const existing = new Set(Object.keys(store));
  const newTags = [];

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://aivxhxnvgqxylugqrjei.supabase.co";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_wUsqBoHbhbuvVitBDo2wuw_xOhU-IEe";
  const supabase = createClient(rawUrl, serviceKey);

  for (let i = 0; i < 5; i++) {
    const tagCode = generateTagCode(existing);
    const pin = String(crypto.randomInt(100000, 1000000));
    const pinHash = hashSha256(pin);

    const tagRecord = {
      tagCode,
      pin,
      pinHash,
      status: "LOCKED",
      tier: "premium",
      alertChannel: "BOTH",
      hasEmergencyContacts: false,
    };

    newTags.push(tagRecord);

    store[tagCode] = {
      tag_code: tagCode,
      activation_pin_hash: pinHash,
      status: "LOCKED",
      tier: "premium",
      alert_channel: "BOTH",
      has_emergency_contacts: false,
    };

    try {
      await supabase.from("tags").upsert({
        tag_code: tagCode,
        activation_pin_hash: pinHash,
        status: "LOCKED",
      }, { onConflict: "tag_code" });
    } catch {
      // ignore
    }
  }

  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");

  // إضافة الأكواد لملف المطبعة
  const baseUrl = "https://balaghni.ly";
  const csvLines = newTags
    .map((t) => `"${baseUrl}/s/${t.tagCode}","${t.tagCode}","${t.pin}"`)
    .join("\n");
  const csvPath = path.join(process.cwd(), "print_batch.csv");
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, "qr_url,tag_code,scratch_pin\n" + csvLines + "\n", "utf8");
  } else {
    fs.appendFileSync(csvPath, csvLines + "\n", "utf8");
  }

  console.log("Successfully generated 5 new tags (LOCKED status):");
  console.log(JSON.stringify(newTags, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
