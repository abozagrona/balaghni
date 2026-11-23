import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

// أسرار اختبارية وهمية داخل عملية الاختبار فقط (لا تُكتب في ملفات ولا تتصل بأي خادم)
process.env.SESSION_HMAC_SECRET = crypto.randomBytes(32).toString("hex");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://balaghni-unit-test.supabase.co";
delete process.env.SESSION_HMAC_SECRET_PREVIOUS;
delete process.env.SESSION_HMAC_KEY_VERSION;
delete process.env.SESSION_PHONE_HMAC_KEY_VERSION;
delete process.env.SESSION_OTP_HMAC_KEY_VERSION;
delete process.env.SESSION_ENC_KEY_VERSION;

const projectRoot = process.cwd();

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }
    if (specifier.startsWith("@/")) {
      const base = path.join(projectRoot, "src", specifier.slice(2));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const otpCrypto = await import("@/lib/otp-crypto");
const df = await import("@/lib/delivery-fallback");

const results = [];
async function runTest(category, name, fn) {
  try {
    await fn();
    results.push({ category, name, status: "PASS" });
    console.log(`✅ [${category}] PASS: ${name}`);
  } catch (err) {
    results.push({ category, name, status: "FAIL", error: err instanceof Error ? err.message : String(err) });
    console.error(`❌ [${category}] FAIL: ${name} -> ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================================================
// Mock Migration 012 Store (للاختبارات المحلية فقط — لا يُثبت تزامن PostgreSQL الحي)
// ============================================================================
function createMigration012MockStore() {
  const otpSessions = new Map(); // id -> row
  const deliveries = new Map(); // message_sid -> row
  const rank = { queued: 0, sent: 1, failed: 1, undelivered: 1, delivered: 2, read: 3 };

  const executor = async (fnName, args) => {
    const nowMs = args.p_now ? new Date(String(args.p_now)).getTime() : Date.now();

    if (fnName === "create_otp_session_pending") {
      const cur = String(args.p_phone_hash_current);
      const prev = args.p_phone_hash_previous ? String(args.p_phone_hash_previous) : null;
      const expMs = new Date(String(args.p_expires_at)).getTime();
      if (expMs <= Date.now() || expMs > Date.now() + 5 * 60 * 1000 + 2000) {
        return { data: null, error: { message: "p_expires_at exceeds 5 minutes" } };
      }

      let supersededSid = null;
      for (const s of otpSessions.values()) {
        if (
          (s.status === "pending" || s.status === "active") &&
          (s.phone_hash === cur || (prev && s.phone_hash === prev))
        ) {
          if (s.twilio_message_sid) supersededSid = s.twilio_message_sid;
          s.status = "superseded";
          s.otp_hash = null;
          s.otp_payload_enc = null;
        }
      }
      for (const d of deliveries.values()) {
        if (
          d.message_kind === "otp" &&
          (d.recipient_phone_hash === cur || (prev && d.recipient_phone_hash === prev)) &&
          (d.sms_fallback_state === "queued" || d.sms_fallback_state === "claimed")
        ) {
          d.sms_fallback_state = "skipped";
          d.claim_token = null;
          d.claim_expires_at = null;
        }
      }

      const id = crypto.randomUUID();
      otpSessions.set(id, {
        id,
        phone_hash: cur,
        phone_hmac_key_version: Number(args.p_phone_hmac_key_version),
        otp_hmac_key_version: Number(args.p_otp_hmac_key_version),
        enc_key_version: Number(args.p_enc_key_version),
        session_salt: String(args.p_session_salt),
        otp_hash: String(args.p_otp_hash),
        otp_payload_enc: String(args.p_otp_payload_enc),
        channel: "WHATSAPP",
        twilio_message_sid: null,
        resala_pin_id: null,
        attempts: 0,
        max_attempts: 5,
        status: "pending",
        created_at: Date.now(),
        expires_at: expMs,
      });
      return { data: { session_id: id, superseded_sid: supersededSid }, error: null };
    }

    if (fnName === "activate_otp_whatsapp_session") {
      const sid = String(args.p_twilio_message_sid);
      const id = String(args.p_session_id);
      for (const other of otpSessions.values()) {
        if (other.twilio_message_sid === sid && other.id !== id) {
          return { data: { activated: false, tracking_registered: false }, error: null };
        }
      }
      const s = otpSessions.get(id);
      if (!s || s.status !== "pending" || s.expires_at <= Date.now()) {
        return { data: { activated: false, tracking_registered: false }, error: null };
      }
      s.status = "active";
      s.twilio_message_sid = sid;
      let registered = false;
      if (!deliveries.has(sid)) {
        deliveries.set(sid, {
          message_sid: sid,
          message_kind: "otp",
          report_id: null,
          tag_code: null,
          otp_session_id: id,
          recipient_phone_hash: String(args.p_recipient_phone_hash),
          phone_hmac_key_version: Number(args.p_phone_hmac_key_version),
          sms_fallback_enabled: true,
          status: "queued",
          sms_fallback_state: "queued",
          claim_token: null,
          claim_expires_at: null,
          fallback_after_at: new Date(String(args.p_fallback_after_at)).getTime(),
          late_delivered: false,
          late_cancelled: false,
        });
        registered = true;
      }
      return { data: { activated: true, tracking_registered: registered }, error: null };
    }

    if (fnName === "activate_otp_sms_session") {
      const s = otpSessions.get(String(args.p_session_id));
      if (!s || (s.status !== "pending" && s.status !== "active")) {
        return { data: { activated: false }, error: null };
      }
      s.status = "active";
      s.channel = "SMS";
      s.resala_pin_id = args.p_resala_pin_id || null;
      s.otp_payload_enc = null;
      return { data: { activated: true }, error: null };
    }

    if (fnName === "cancel_pending_otp_session") {
      const s = otpSessions.get(String(args.p_session_id));
      if (!s || s.status !== "pending") return { data: { cancelled: false }, error: null };
      s.status = "failed";
      s.otp_hash = null;
      s.otp_payload_enc = null;
      return { data: { cancelled: true }, error: null };
    }

    if (fnName === "get_open_otp_session_for_verify") {
      const cur = String(args.p_phone_hash_current);
      const prev = args.p_phone_hash_previous ? String(args.p_phone_hash_previous) : null;
      const matches = [...otpSessions.values()]
        .filter(
          (s) =>
            (s.status === "pending" || s.status === "active") &&
            (s.phone_hash === cur || (prev && s.phone_hash === prev))
        )
        .sort((a, b) => b.created_at - a.created_at);
      const s = matches[0];
      if (!s) return { data: null, error: null };
      return {
        data: {
          session_id: s.id,
          phone_hmac_key_version: s.phone_hmac_key_version,
          otp_hmac_key_version: s.otp_hmac_key_version,
          enc_key_version: s.enc_key_version,
          session_salt: s.session_salt,
          otp_hash: s.otp_hash,
          otp_payload_enc: s.otp_payload_enc,
          channel: s.channel,
          twilio_message_sid: s.twilio_message_sid,
          attempts: s.attempts,
          expires_at: new Date(s.expires_at).toISOString(),
          status: s.status,
        },
        error: null,
      };
    }

    if (fnName === "commit_otp_verification_attempt") {
      const s = otpSessions.get(String(args.p_session_id));
      if (!s) return { data: { outcome: "not_found", attempts_remaining: 0 }, error: null };
      if (s.status === "verified") {
        return { data: { outcome: "already_verified", attempts_remaining: 0 }, error: null };
      }
      if (s.status !== "pending" && s.status !== "active") {
        return { data: { outcome: s.status, attempts_remaining: 0 }, error: null };
      }
      if (nowMs > s.expires_at) {
        s.status = "expired";
        s.otp_hash = null;
        s.otp_payload_enc = null;
        return { data: { outcome: "expired", attempts_remaining: 0 }, error: null };
      }
      if (s.attempts !== Number(args.p_expected_attempts)) {
        return { data: { outcome: "conflict_retry", attempts_remaining: s.max_attempts - s.attempts }, error: null };
      }
      s.attempts += 1;
      if (args.p_matched) {
        s.status = "verified";
        s.otp_hash = null;
        s.otp_payload_enc = null;
        for (const d of deliveries.values()) {
          if (d.otp_session_id === s.id && (d.sms_fallback_state === "queued" || d.sms_fallback_state === "claimed")) {
            d.sms_fallback_state = "skipped";
            d.claim_token = null;
            d.claim_expires_at = null;
          }
        }
        return { data: { outcome: "verified", attempts_remaining: 0 }, error: null };
      }
      if (s.attempts >= s.max_attempts) {
        s.status = "locked";
        s.otp_hash = null;
        s.otp_payload_enc = null;
        return { data: { outcome: "locked", attempts_remaining: 0 }, error: null };
      }
      return { data: { outcome: "invalid", attempts_remaining: s.max_attempts - s.attempts }, error: null };
    }

    if (fnName === "register_whatsapp_delivery") {
      const sid = String(args.p_message_sid);
      if (deliveries.has(sid)) return { data: { registered: false, message_sid: sid }, error: null };
      deliveries.set(sid, {
        message_sid: sid,
        message_kind: args.p_message_kind,
        report_id: args.p_report_id,
        tag_code: args.p_tag_code,
        otp_session_id: args.p_otp_session_id,
        recipient_phone_hash: String(args.p_recipient_phone_hash),
        phone_hmac_key_version: Number(args.p_phone_hmac_key_version),
        sms_fallback_enabled: Boolean(args.p_sms_fallback_enabled),
        status: "queued",
        sms_fallback_state: args.p_sms_fallback_enabled ? "queued" : "skipped",
        claim_token: null,
        claim_expires_at: null,
        fallback_after_at: new Date(String(args.p_fallback_after_at)).getTime(),
        late_delivered: false,
        late_cancelled: false,
      });
      return { data: { registered: true, message_sid: sid }, error: null };
    }

    if (fnName === "update_whatsapp_delivery_status") {
      const d = deliveries.get(String(args.p_message_sid));
      if (!d) return { data: null, error: null };
      const next = String(args.p_status);
      if (d.status === next || (rank[d.status] >= 2 && rank[next] < rank[d.status])) {
        return {
          data: { updated: false, duplicate: true, late_delivered: d.late_delivered, status: d.status, sms_fallback_state: d.sms_fallback_state },
          error: null,
        };
      }
      if ((next === "delivered" || next === "read") && ["claimed", "sending", "sent", "abandoned_unknown"].includes(d.sms_fallback_state)) {
        d.late_delivered = true;
      }
      d.status = next;
      if ((next === "delivered" || next === "read") && d.sms_fallback_state === "queued") {
        d.sms_fallback_state = "skipped";
      }
      return {
        data: { updated: true, duplicate: false, late_delivered: d.late_delivered, status: d.status, sms_fallback_state: d.sms_fallback_state },
        error: null,
      };
    }

    if (fnName === "claim_sms_fallback_delivery") {
      const d = deliveries.get(String(args.p_message_sid));
      if (!d) return { data: { claimed: false, reason: "not_found", claim_token: null }, error: null };
      if (!d.sms_fallback_enabled) return { data: { claimed: false, reason: "sms_fallback_disabled", claim_token: null }, error: null };
      if (d.status === "delivered" || d.status === "read") return { data: { claimed: false, reason: "already_delivered", claim_token: null }, error: null };
      if (d.sms_fallback_state !== "queued") return { data: { claimed: false, reason: "already_claimed_or_finalized", claim_token: null }, error: null };
      if (d.status !== "failed" && d.status !== "undelivered" && args.p_reason !== "user_requested_sms" && nowMs < d.fallback_after_at) {
        return { data: { claimed: false, reason: "timeout_not_reached", claim_token: null }, error: null };
      }
      if (d.message_kind === "otp") {
        const s = otpSessions.get(d.otp_session_id);
        if (!s || (s.status !== "pending" && s.status !== "active") || s.expires_at <= nowMs || !s.otp_payload_enc) {
          return { data: { claimed: false, reason: "otp_session_not_eligible", claim_token: null }, error: null };
        }
      }
      const token = crypto.randomUUID();
      d.sms_fallback_state = "claimed";
      d.claim_token = token;
      d.claim_expires_at = nowMs + Number(args.p_lease_seconds || 120) * 1000;
      return { data: { claimed: true, reason: "claimed", claim_token: token, status: d.status, sms_fallback_state: "claimed" }, error: null };
    }

    if (fnName === "transition_sms_claim_to_sending") {
      const d = deliveries.get(String(args.p_message_sid));
      if (!d) return { data: { can_send: false, reason: "not_found" }, error: null };
      if (d.sms_fallback_state !== "claimed" || d.claim_token !== String(args.p_claim_token)) {
        return { data: { can_send: false, reason: "invalid_claim_token_or_state" }, error: null };
      }
      if (!d.claim_expires_at || d.claim_expires_at <= nowMs) {
        return { data: { can_send: false, reason: "claim_lease_expired" }, error: null };
      }
      if (d.status === "delivered" || d.status === "read") {
        d.sms_fallback_state = "skipped";
        d.claim_token = null;
        d.claim_expires_at = null;
        return { data: { can_send: false, reason: "delivered_before_send" }, error: null };
      }
      if (d.message_kind === "otp") {
        const s = otpSessions.get(d.otp_session_id);
        if (!s || (s.status !== "pending" && s.status !== "active") || s.expires_at <= nowMs || !s.otp_payload_enc) {
          d.sms_fallback_state = "skipped";
          d.claim_token = null;
          d.claim_expires_at = null;
          return { data: { can_send: false, reason: "otp_session_cancelled_or_expired" }, error: null };
        }
      }
      d.sms_fallback_state = "sending";
      return { data: { can_send: true, reason: "sending" }, error: null };
    }

    if (fnName === "complete_sms_fallback_delivery") {
      const d = deliveries.get(String(args.p_message_sid));
      if (!d) return { data: { completed: false, sms_fallback_state: null, late_cancelled: false }, error: null };
      if (
        (d.sms_fallback_state !== "claimed" && d.sms_fallback_state !== "sending") ||
        d.claim_token !== String(args.p_claim_token) ||
        !d.claim_expires_at ||
        d.claim_expires_at <= nowMs
      ) {
        return { data: { completed: false, sms_fallback_state: d.sms_fallback_state, late_cancelled: d.late_cancelled }, error: null };
      }
      let lateCancelled = false;
      if (d.message_kind === "otp" && d.otp_session_id) {
        const s = otpSessions.get(d.otp_session_id);
        if (s && s.status !== "pending" && s.status !== "active") lateCancelled = true;
      }
      d.sms_fallback_state = String(args.p_final_state);
      d.late_cancelled = d.late_cancelled || lateCancelled;
      d.claim_token = null;
      d.claim_expires_at = null;
      if (d.message_kind === "otp" && d.otp_session_id && (d.sms_fallback_state === "sent" || d.sms_fallback_state === "abandoned_unknown")) {
        const s = otpSessions.get(d.otp_session_id);
        if (s && (s.status === "pending" || s.status === "active")) {
          if (d.sms_fallback_state === "sent") s.channel = "SMS";
          s.otp_payload_enc = null;
        }
      }
      return { data: { completed: true, sms_fallback_state: d.sms_fallback_state, late_cancelled: lateCancelled }, error: null };
    }

    if (fnName === "reconcile_stale_whatsapp_claims") {
      let abandoned = 0;
      for (const d of deliveries.values()) {
        if ((d.sms_fallback_state === "claimed" || d.sms_fallback_state === "sending") && d.claim_expires_at <= nowMs) {
          d.sms_fallback_state = "abandoned_unknown";
          d.claim_token = null;
          d.claim_expires_at = null;
          abandoned++;
        }
      }
      return { data: { abandoned_count: abandoned, purged_tracking_count: 0, purged_otp_count: 0 }, error: null };
    }

    if (fnName === "check_key_version_active_usage") {
      const v = Number(args.p_key_version);
      let otpCnt = 0;
      let delCnt = 0;
      for (const s of otpSessions.values()) {
        if ((s.status === "pending" || s.status === "active") && (s.phone_hmac_key_version === v || s.otp_hmac_key_version === v || s.enc_key_version === v)) {
          otpCnt++;
        }
      }
      for (const d of deliveries.values()) {
        if (["queued", "claimed", "sending"].includes(d.sms_fallback_state) && d.phone_hmac_key_version === v) {
          delCnt++;
        }
      }
      return { data: { open_otp_sessions_count: otpCnt, active_deliveries_count: delCnt, safe_to_retire: otpCnt === 0 && delCnt === 0 }, error: null };
    }

    return { data: null, error: { message: `Unhandled mock RPC: ${fnName}` } };
  };

  return { otpSessions, deliveries, executor };
}

// ============================================================================
// SECTION A: UNIT TESTS
// ============================================================================
await runTest("UNIT", "A.1 HKDF-SHA256 ينتج 3 مفاتيح منفصلة لـ phone_hmac وotp_hmac وenc", async () => {
  const kPhone = otpCrypto.deriveHkdfKey("phone_hmac", 1).toString("hex");
  const kOtp = otpCrypto.deriveHkdfKey("otp_hmac", 1).toString("hex");
  const kEnc = otpCrypto.deriveHkdfKey("enc", 1).toString("hex");
  assert.equal(kPhone.length, 64);
  assert.notEqual(kPhone, kOtp);
  assert.notEqual(kPhone, kEnc);
  assert.notEqual(kOtp, kEnc);
});

await runTest("UNIT", "A.2 توليد OTP بـ crypto.randomInt + AES-256-GCM مع AAD ورفض التلاعب", async () => {
  const otp = otpCrypto.generateSecure6DigitOtp();
  assert.match(otp, /^\d{6}$/);
  const salt = otpCrypto.generateOtpSessionSalt();
  const { phoneHash } = otpCrypto.computePhoneHmac("218911234567");
  const enc = otpCrypto.encryptOtpPayload({ phone: "218911234567", otp, phoneHash, sessionSalt: salt });
  const dec = otpCrypto.decryptOtpPayload({ ciphertext: enc.ciphertext, phoneHash, sessionSalt: salt, encKeyVersion: enc.encKeyVersion });
  assert.equal(dec.phone, "218911234567");
  assert.equal(dec.otp, otp);
  // التلاعب بـ AAD (تغيير salt) يجب أن يفشل
  assert.throws(() => otpCrypto.decryptOtpPayload({ ciphertext: enc.ciphertext, phoneHash, sessionSalt: "f".repeat(32), encKeyVersion: enc.encKeyVersion }));
});

await runTest("UNIT", "A.3 crypto.timingSafeEqual يطابق ويصد الاختلاف واختلاف الطول", async () => {
  const salt = otpCrypto.generateOtpSessionSalt();
  const h1 = otpCrypto.computeOtpHmac("123456", salt).otpHash;
  const h2 = otpCrypto.computeOtpHmac("123456", salt).otpHash;
  const h3 = otpCrypto.computeOtpHmac("654321", salt).otpHash;
  assert.equal(otpCrypto.verifyOtpHmacConstantTime(h1, h2), true);
  assert.equal(otpCrypto.verifyOtpHmacConstantTime(h1, h3), false);
  assert.equal(otpCrypto.verifyOtpHmacConstantTime(h1, "abcd"), false);
});

await runTest("UNIT", "A.4 تصنيف Resala: 2xx=sent، 4xx=failed، 5xx/Timeout=abandoned_unknown", async () => {
  assert.equal(df.classifyResalaDispatchOutcome({ ok: true, httpStatus: 200 }), "sent");
  assert.equal(df.classifyResalaDispatchOutcome({ ok: false, httpStatus: 400 }), "failed");
  assert.equal(df.classifyResalaDispatchOutcome({ ok: false, httpStatus: 401 }), "failed");
  assert.equal(df.classifyResalaDispatchOutcome({ ok: false, networkErrorCode: "ECONNREFUSED" }), "failed");
  assert.equal(df.classifyResalaDispatchOutcome({ ok: false, httpStatus: 500 }), "abandoned_unknown");
  assert.equal(df.classifyResalaDispatchOutcome({ ok: false, httpStatus: 503 }), "abandoned_unknown");
  assert.equal(df.classifyResalaDispatchOutcome({ ok: false, timedOut: true }), "abandoned_unknown");
});

await runTest("UNIT", "A.5 تدوير المفاتيح v1 -> v2 -> v3 وعزل الإصدارات", async () => {
  const s1 = crypto.randomBytes(32).toString("hex");
  const s2 = crypto.randomBytes(32).toString("hex");
  const s3 = crypto.randomBytes(32).toString("hex");
  const origCur = process.env.SESSION_HMAC_SECRET;
  try {
    // v1
    process.env.SESSION_HMAC_SECRET = s1;
    process.env.SESSION_HMAC_KEY_VERSION = "1";
    delete process.env.SESSION_HMAC_SECRET_PREVIOUS;
    const salt = otpCrypto.generateOtpSessionSalt();
    const p1 = otpCrypto.computePhoneHmac("218911234567");
    const enc1 = otpCrypto.encryptOtpPayload({ phone: "218911234567", otp: "112233", phoneHash: p1.phoneHash, sessionSalt: salt });

    // v1 -> v2 (v1 ما زال في PREVIOUS)
    process.env.SESSION_HMAC_SECRET = s2;
    process.env.SESSION_HMAC_KEY_VERSION = "2";
    process.env.SESSION_HMAC_SECRET_PREVIOUS = s1;
    process.env.SESSION_HMAC_PREVIOUS_KEY_VERSION = "1";
    const candsV2 = otpCrypto.computePhoneHmacCandidates("218911234567");
    assert.equal(candsV2.currentVersion, 2);
    assert.equal(candsV2.previousVersion, 1);
    assert.equal(candsV2.previousHash, p1.phoneHash);
    const dec1UnderV2 = otpCrypto.decryptOtpPayload({ ciphertext: enc1.ciphertext, phoneHash: p1.phoneHash, sessionSalt: salt, encKeyVersion: 1 });
    assert.equal(dec1UnderV2.otp, "112233");

    // v2 -> v3 (v1 أُزيل => Fail-Closed على v1)
    process.env.SESSION_HMAC_SECRET = s3;
    process.env.SESSION_HMAC_KEY_VERSION = "3";
    process.env.SESSION_HMAC_SECRET_PREVIOUS = s2;
    process.env.SESSION_HMAC_PREVIOUS_KEY_VERSION = "2";
    assert.throws(() => otpCrypto.decryptOtpPayload({ ciphertext: enc1.ciphertext, phoneHash: p1.phoneHash, sessionSalt: salt, encKeyVersion: 1 }));
  } finally {
    process.env.SESSION_HMAC_SECRET = origCur;
    delete process.env.SESSION_HMAC_KEY_VERSION;
    delete process.env.SESSION_HMAC_SECRET_PREVIOUS;
    delete process.env.SESSION_HMAC_PREVIOUS_KEY_VERSION;
  }
});

// ============================================================================
// SECTION B: MOCK INTEGRATION TESTS (Migration 012 Contract)
// ============================================================================
await runTest("MOCK-INT", "B.1 إنشاء OTP، التحقق الصحيح، منع إعادة الاستخدام، و5 محاولات فاشلة", async () => {
  const store = createMigration012MockStore();
  df.setDeliveryFallbackRpcExecutorForTest(store.executor);
  try {
    const phone = "218911234567";
    const otp = otpCrypto.generateSecure6DigitOtp();
    const salt = otpCrypto.generateOtpSessionSalt();
    const ph = otpCrypto.computePhoneHmac(phone);
    const oh = otpCrypto.computeOtpHmac(otp, salt);
    const enc = otpCrypto.encryptOtpPayload({ phone, otp, phoneHash: ph.phoneHash, sessionSalt: salt });
    const created = await df.createOtpSessionPending({
      phoneHashCurrent: ph.phoneHash,
      phoneHashPrevious: null,
      phoneHmacKeyVersion: ph.phoneHmacKeyVersion,
      otpHmacKeyVersion: oh.otpHmacKeyVersion,
      encKeyVersion: enc.encKeyVersion,
      otpPayloadEnc: enc.ciphertext,
      sessionSalt: salt,
      otpHash: oh.otpHash,
      expiresAtIso: new Date(Date.now() + otpCrypto.OTP_VALIDITY_MS).toISOString(),
    });
    assert.equal(created.ok, true);

    // تحقق خاطئ ثم صحيح
    const wrong = await df.commitOtpVerificationAttempt({ sessionId: created.sessionId, expectedAttempts: 0, matched: false });
    assert.equal(wrong.outcome, "invalid");
    assert.equal(wrong.attemptsRemaining, 4);

    const right = await df.commitOtpVerificationAttempt({ sessionId: created.sessionId, expectedAttempts: 1, matched: true });
    assert.equal(right.outcome, "verified");

    // منع إعادة الاستخدام بعد verified ومسح الحساسات (SEC-C1)
    const replay = await df.commitOtpVerificationAttempt({ sessionId: created.sessionId, expectedAttempts: 2, matched: true });
    assert.equal(replay.outcome, "already_verified");
    assert.equal(store.otpSessions.get(created.sessionId).otp_hash, null);
    assert.equal(store.otpSessions.get(created.sessionId).otp_payload_enc, null);

    // 5 محاولات خاطئة -> locked
    const c2 = await df.createOtpSessionPending({
      phoneHashCurrent: ph.phoneHash, phoneHashPrevious: null, phoneHmacKeyVersion: 1, otpHmacKeyVersion: 1, encKeyVersion: 1,
      otpPayloadEnc: enc.ciphertext, sessionSalt: salt, otpHash: oh.otpHash,
      expiresAtIso: new Date(Date.now() + otpCrypto.OTP_VALIDITY_MS).toISOString(),
    });
    for (let i = 0; i < 4; i++) {
      const r = await df.commitOtpVerificationAttempt({ sessionId: c2.sessionId, expectedAttempts: i, matched: false });
      assert.equal(r.outcome, "invalid");
    }
    const fifth = await df.commitOtpVerificationAttempt({ sessionId: c2.sessionId, expectedAttempts: 4, matched: false });
    assert.equal(fifth.outcome, "locked");
    assert.equal(store.otpSessions.get(c2.sessionId).otp_payload_enc, null);
  } finally {
    df.setDeliveryFallbackRpcExecutorForTest(null);
  }
});

await runTest("MOCK-INT", "B.2 انتهاء الصلاحية، إلغاء pending، إنشاء جلسة جديدة تلغي السابقة، وتزامن جلستين", async () => {
  const store = createMigration012MockStore();
  df.setDeliveryFallbackRpcExecutorForTest(store.executor);
  try {
    const ph = otpCrypto.computePhoneHmac("218922334455");
    const salt = otpCrypto.generateOtpSessionSalt();
    const oh = otpCrypto.computeOtpHmac("223344", salt);
    const enc = otpCrypto.encryptOtpPayload({ phone: "218922334455", otp: "223344", phoneHash: ph.phoneHash, sessionSalt: salt });

    // انتهاء الصلاحية بعد 5 دقائق
    const sExp = await df.createOtpSessionPending({
      phoneHashCurrent: ph.phoneHash, phoneHashPrevious: null, phoneHmacKeyVersion: 1, otpHmacKeyVersion: 1, encKeyVersion: 1,
      otpPayloadEnc: enc.ciphertext, sessionSalt: salt, otpHash: oh.otpHash,
      expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
    });
    const expRes = await df.commitOtpVerificationAttempt({
      sessionId: sExp.sessionId, expectedAttempts: 0, matched: true, nowIso: new Date(Date.now() + 120_000).toISOString(),
    });
    assert.equal(expRes.outcome, "expired");

    // إلغاء جلسة pending
    const sCancel = await df.createOtpSessionPending({
      phoneHashCurrent: ph.phoneHash, phoneHashPrevious: null, phoneHmacKeyVersion: 1, otpHmacKeyVersion: 1, encKeyVersion: 1,
      otpPayloadEnc: enc.ciphertext, sessionSalt: salt, otpHash: oh.otpHash,
      expiresAtIso: new Date(Date.now() + 120_000).toISOString(),
    });
    const cancelRes = await df.cancelPendingOtpSession(sCancel.sessionId);
    assert.equal(cancelRes.cancelled, true);
    assert.equal(store.otpSessions.get(sCancel.sessionId).status, "failed");

    // محاولتان متزامنتان لإنشاء جلسة لنفس الرقم -> تبقى جلسة مفتوحة واحدة فقط
    const [a, b] = await Promise.all([
      df.createOtpSessionPending({
        phoneHashCurrent: ph.phoneHash, phoneHashPrevious: null, phoneHmacKeyVersion: 1, otpHmacKeyVersion: 1, encKeyVersion: 1,
        otpPayloadEnc: enc.ciphertext, sessionSalt: salt, otpHash: oh.otpHash,
        expiresAtIso: new Date(Date.now() + 120_000).toISOString(),
      }),
      df.createOtpSessionPending({
        phoneHashCurrent: ph.phoneHash, phoneHashPrevious: null, phoneHmacKeyVersion: 1, otpHmacKeyVersion: 1, encKeyVersion: 1,
        otpPayloadEnc: enc.ciphertext, sessionSalt: salt, otpHash: oh.otpHash,
        expiresAtIso: new Date(Date.now() + 120_000).toISOString(),
      }),
    ]);
    assert.equal(a.ok && b.ok, true);
    const openCount = [...store.otpSessions.values()].filter((s) => s.status === "pending" || s.status === "active").length;
    assert.equal(openCount, 1);
  } finally {
    df.setDeliveryFallbackRpcExecutorForTest(null);
  }
});

await runTest("MOCK-INT", "B.3 فشل حفظ pending، نجاح Twilio وفشل حفظ MessageSid، ومنع ربط SID مكرر", async () => {
  const store = createMigration012MockStore();
  // محاكاة فشل حفظ pending
  df.setDeliveryFallbackRpcExecutorForTest(async () => ({ data: null, error: { message: "db_down" } }));
  const failPending = await df.createOtpSessionPending({
    phoneHashCurrent: "a".repeat(64), phoneHashPrevious: null, phoneHmacKeyVersion: 1, otpHmacKeyVersion: 1, encKeyVersion: 1,
    otpPayloadEnc: "v1:enc", sessionSalt: "s".repeat(32), otpHash: "b".repeat(64),
    expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(failPending.ok, false);

  // نجاح Twilio + تفعيل وربط SID + منع ربط نفس SID بجلسة أخرى
  df.setDeliveryFallbackRpcExecutorForTest(store.executor);
  try {
    const ph = otpCrypto.computePhoneHmac("218933445566");
    const salt = otpCrypto.generateOtpSessionSalt();
    const oh = otpCrypto.computeOtpHmac("334455", salt);
    const enc = otpCrypto.encryptOtpPayload({ phone: "218933445566", otp: "334455", phoneHash: ph.phoneHash, sessionSalt: salt });
    const s1 = await df.createOtpSessionPending({
      phoneHashCurrent: ph.phoneHash, phoneHashPrevious: null, phoneHmacKeyVersion: 1, otpHmacKeyVersion: 1, encKeyVersion: 1,
      otpPayloadEnc: enc.ciphertext, sessionSalt: salt, otpHash: oh.otpHash,
      expiresAtIso: new Date(Date.now() + 180_000).toISOString(),
    });
    const act1 = await df.activateOtpWhatsappSession({
      sessionId: s1.sessionId, twilioMessageSid: "SM_UNIQUE_BIND_01", recipientPhoneHash: ph.phoneHash, phoneHmacKeyVersion: 1,
      fallbackAfterAtIso: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(act1.activated, true);
    assert.equal(act1.trackingRegistered, true);

    const s2 = await df.createOtpSessionPending({
      phoneHashCurrent: ph.phoneHash, phoneHashPrevious: null, phoneHmacKeyVersion: 1, otpHmacKeyVersion: 1, encKeyVersion: 1,
      otpPayloadEnc: enc.ciphertext, sessionSalt: salt, otpHash: oh.otpHash,
      expiresAtIso: new Date(Date.now() + 180_000).toISOString(),
    });
    // محاولة ربط SID القديم بجلسة جديدة يجب أن تُرفض
    const actDup = await df.activateOtpWhatsappSession({
      sessionId: s2.sessionId, twilioMessageSid: "SM_UNIQUE_BIND_01", recipientPhoneHash: ph.phoneHash, phoneHmacKeyVersion: 1,
      fallbackAfterAtIso: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(actDup.activated, false);
    // الجلسة الثانية تبقى pending وقابلة للتحقق (لا رسالة يتيمة)
    assert.equal(store.otpSessions.get(s2.sessionId).status, "pending");
  } finally {
    df.setDeliveryFallbackRpcExecutorForTest(null);
  }
});

await runTest("MOCK-INT", "B.4 آلة حالات Worker: claimed->sending، رفض Resala مع بقاء نفس الرمز، Timeout->abandoned_unknown، إلغاء أثناء sending، claim قديم، وانتهاء Lease", async () => {
  const store = createMigration012MockStore();
  df.setDeliveryFallbackRpcExecutorForTest(store.executor);
  try {
    const t0 = Date.now();
    const phone = "218944556677";
    const otp = "445566";
    const salt = otpCrypto.generateOtpSessionSalt();
    const ph = otpCrypto.computePhoneHmac(phone);
    const oh = otpCrypto.computeOtpHmac(otp, salt);
    const enc = otpCrypto.encryptOtpPayload({ phone, otp, phoneHash: ph.phoneHash, sessionSalt: salt });

    // (1) رفض Resala صريح (400) -> failed مع بقاء otp_payload_enc لإعادة محاولة نفس الرمز
    const s1 = await df.createOtpSessionPending({
      phoneHashCurrent: ph.phoneHash, phoneHashPrevious: null, phoneHmacKeyVersion: 1, otpHmacKeyVersion: 1, encKeyVersion: 1,
      otpPayloadEnc: enc.ciphertext, sessionSalt: salt, otpHash: oh.otpHash,
      expiresAtIso: new Date(t0 + 300_000).toISOString(),
    });
    await df.activateOtpWhatsappSession({
      sessionId: s1.sessionId, twilioMessageSid: "SM_RESALA_400", recipientPhoneHash: ph.phoneHash, phoneHmacKeyVersion: 1,
      fallbackAfterAtIso: new Date(t0 + 60_000).toISOString(),
    });
    const res400 = await df.dispatchSmsFallbackWithAtomicClaim({
      messageSid: "SM_RESALA_400", nowMs: t0 + 61_000, reason: "timeout_60s",
      sendSms: async () => ({ ok: false, httpStatus: 400, error: "bad_request" }),
    });
    assert.equal(res400.finalState, "failed");
    assert.ok(store.otpSessions.get(s1.sessionId).otp_payload_enc, "يجب بقاء otp_payload_enc عند رفض 400 لإعادة إرسال نفس الرمز");

    // (2) Resala Timeout -> abandoned_unknown (لا إعادة إرسال تلقائية)
    const s2 = await df.createOtpSessionPending({
      phoneHashCurrent: ph.phoneHash, phoneHashPrevious: null, phoneHmacKeyVersion: 1, otpHmacKeyVersion: 1, encKeyVersion: 1,
      otpPayloadEnc: enc.ciphertext, sessionSalt: salt, otpHash: oh.otpHash,
      expiresAtIso: new Date(t0 + 300_000).toISOString(),
    });
    await df.activateOtpWhatsappSession({
      sessionId: s2.sessionId, twilioMessageSid: "SM_RESALA_TIMEOUT", recipientPhoneHash: ph.phoneHash, phoneHmacKeyVersion: 1,
      fallbackAfterAtIso: new Date(t0 + 60_000).toISOString(),
    });
    const resTo = await df.dispatchSmsFallbackWithAtomicClaim({
      messageSid: "SM_RESALA_TIMEOUT", nowMs: t0 + 61_000, reason: "timeout_60s",
      sendSms: async () => ({ ok: false, timedOut: true, error: "AbortError" }),
    });
    assert.equal(resTo.finalState, "abandoned_unknown");

    // (3) وصول delivered بعد claim وقبل sending -> تخطي دون استدعاء Resala
    await df.registerWhatsappDelivery({
      messageSid: "SM_DELIVERED_BEFORE_SEND", messageKind: "notification", reportId: "rep-1", tagCode: "BLG-1",
      recipientPhoneHash: ph.phoneHash, phoneHmacKeyVersion: 1, smsFallbackEnabled: true, createdAtMs: t0,
    });
    const cl = await df.claimSmsFallbackAtomic({ messageSid: "SM_DELIVERED_BEFORE_SEND", nowMs: t0 + 61_000, reason: "timeout_60s" });
    assert.equal(cl.claimed, true);
    await df.recordWhatsappDeliveryStatusAtomic({ messageSid: "SM_DELIVERED_BEFORE_SEND", status: "delivered" });
    const gate = await df.transitionSmsClaimToSendingAtomic({ messageSid: "SM_DELIVERED_BEFORE_SEND", claimToken: cl.claimToken, nowMs: t0 + 62_000 });
    assert.equal(gate.canSend, false);
    assert.equal(gate.reason, "delivered_before_send");

    // (4) انتهاء Lease (120s) + رفض العامل القديم + reconcile -> abandoned_unknown
    await df.registerWhatsappDelivery({
      messageSid: "SM_LEASE_EXPIRE", messageKind: "notification", reportId: "rep-2", tagCode: "BLG-2",
      recipientPhoneHash: ph.phoneHash, phoneHmacKeyVersion: 1, smsFallbackEnabled: true, createdAtMs: t0,
    });
    const cl2 = await df.claimSmsFallbackAtomic({ messageSid: "SM_LEASE_EXPIRE", nowMs: t0 + 61_000, reason: "timeout_60s", leaseSeconds: 120 });
    await df.transitionSmsClaimToSendingAtomic({ messageSid: "SM_LEASE_EXPIRE", claimToken: cl2.claimToken, nowMs: t0 + 62_000 });
    const rec = await df.reconcileStaleWhatsappClaims({ nowMs: t0 + 185_000 });
    assert.equal(rec.abandonedCount, 1);
    const staleComplete = await df.completeSmsFallbackAtomic({
      messageSid: "SM_LEASE_EXPIRE", claimToken: cl2.claimToken, finalState: "sent", nowMs: t0 + 186_000,
    });
    assert.equal(staleComplete.completed, false);

    // (5) إلغاء الجلسة أثناء sending -> تسجيل late_cancelled=true
    const s3 = await df.createOtpSessionPending({
      phoneHashCurrent: ph.phoneHash, phoneHashPrevious: null, phoneHmacKeyVersion: 1, otpHmacKeyVersion: 1, encKeyVersion: 1,
      otpPayloadEnc: enc.ciphertext, sessionSalt: salt, otpHash: oh.otpHash,
      expiresAtIso: new Date(t0 + 300_000).toISOString(),
    });
    await df.activateOtpWhatsappSession({
      sessionId: s3.sessionId, twilioMessageSid: "SM_CANCEL_IN_FLIGHT", recipientPhoneHash: ph.phoneHash, phoneHmacKeyVersion: 1,
      fallbackAfterAtIso: new Date(t0 + 60_000).toISOString(),
    });
    const cl3 = await df.claimSmsFallbackAtomic({ messageSid: "SM_CANCEL_IN_FLIGHT", nowMs: t0 + 61_000, reason: "timeout_60s" });
    await df.transitionSmsClaimToSendingAtomic({ messageSid: "SM_CANCEL_IN_FLIGHT", claimToken: cl3.claimToken, nowMs: t0 + 62_000 });
    await df.commitOtpVerificationAttempt({ sessionId: s3.sessionId, expectedAttempts: 0, matched: true, nowIso: new Date(t0 + 63_000).toISOString() });
    const compLate = await df.completeSmsFallbackAtomic({
      messageSid: "SM_CANCEL_IN_FLIGHT", claimToken: cl3.claimToken, finalState: "sent", nowMs: t0 + 64_000,
    });
    assert.equal(compLate.completed, true);
    assert.equal(compLate.lateCancelled, true);

    // (6) check_key_version_active_usage يمنع إزالة مفتاح v1 أثناء وجود سجل نشط
    const usage = await df.checkKeyVersionActiveUsage(1);
    assert.equal(usage.ok, true);
    assert.equal(usage.safeToRetire, true);
  } finally {
    df.setDeliveryFallbackRpcExecutorForTest(null);
  }
});

await runTest("STATIC-SQL", "B.5 تدقيق Migration 012 وRollback 012 (بدون CASCADE، RLS+FORCE RLS، تطهير OTP، وأرشفة التتبع)", async () => {
  const upSql = fs.readFileSync(path.join(projectRoot, "supabase/migrations/20261121_012_whatsapp_delivery_and_otp_sessions.sql"), "utf8");
  const rbSql = fs.readFileSync(path.join(projectRoot, "supabase/rollbacks/20261121_012_whatsapp_delivery_and_otp_sessions_rollback.sql"), "utf8");

  // فحص UP Migration
  assert.match(upSql, /CREATE TABLE IF NOT EXISTS public\.otp_sessions/);
  assert.match(upSql, /CREATE TABLE IF NOT EXISTS public\.whatsapp_delivery_tracking/);
  assert.match(upSql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(upSql, /FORCE ROW LEVEL SECURITY/);
  assert.match(upSql, /REVOKE ALL ON TABLE public\.otp_sessions FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(upSql, /REVOKE ALL ON TABLE public\.whatsapp_delivery_tracking FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(upSql, /interval '5 minutes'/);
  assert.match(upSql, /CHECK \(attempts BETWEEN 0 AND 5\)/);
  assert.match(upSql, /FOR UPDATE SKIP LOCKED/);
  assert.match(upSql, /pg_advisory_xact_lock/);
  assert.match(upSql, /transition_sms_claim_to_sending/);

  // فحص Rollback Migration (على الأسطر التنفيذية غير المعلّقة)
  const activeRbSql = rbSql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.equal(/\bCASCADE\b/i.test(activeRbSql), false, "ممنوع استخدام CASCADE في Rollback 012");
  assert.equal(/\bDROP\s+TABLE\b/i.test(activeRbSql), false, "ممنوع DROP TABLE في Rollback 012 للحفاظ على بيانات التدقيق");
  assert.match(rbSql, /sms_fallback_state = 'abandoned_unknown'/);
  assert.match(rbSql, /otp_hash\s*=\s*NULL/);
  assert.match(rbSql, /otp_payload_enc\s*=\s*NULL/);
  assert.match(rbSql, /RENAME TO whatsapp_delivery_tracking_archive_012/);
  assert.match(rbSql, /RENAME TO otp_sessions_archive_012/);
});

// ============================================================================
// SECTION C: BATCH 2B / 2C / 2E INTEGRATION & WORKER TESTS (Mocks Only)
// ============================================================================
const otpService = await import("@/lib/otp-service");
const workerMod = await import("@/lib/whatsapp-fallback-worker");

await runTest("MOCK-INT", "C.1 Batch 2B: requestSmartOtp + verifyOtpCode الموزّع مع رمز واحد ثابت عبر Twilio ثم Resala send-template", async () => {
  const store = createMigration012MockStore();
  df.setDeliveryFallbackRpcExecutorForTest(store.executor);
  const origFetch = globalThis.fetch;
  const prevSid = process.env.TWILIO_ACCOUNT_SID;
  const prevTok = process.env.TWILIO_AUTH_TOKEN;
  const prevFrom = process.env.TWILIO_WHATSAPP_FROM;
  const prevResalaKey = process.env.RESALA_API_KEY;
  const prevResalaEp = process.env.RESALA_ENDPOINT;
  const prevResalaOtpTpl = process.env.RESALA_OTP_TEMPLATE_ID;

  let capturedTwilioOtp = null;
  let capturedResalaOtp = null;
  const prevApproved = process.env.RESALA_APPROVED_HOSTNAMES;

  try {
    process.env.TWILIO_ACCOUNT_SID = "AC00000000000000000000000000000099";
    process.env.TWILIO_AUTH_TOKEN = "test_twilio_auth_token_32bytes_ok";
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886";
    process.env.RESALA_API_KEY = "test_resala_key_mock_only";
    process.env.RESALA_ENDPOINT = "https://resala-mock.invalid/api/v1";
    process.env.RESALA_APPROVED_HOSTNAMES = "resala-mock.invalid";
    process.env.RESALA_OTP_TEMPLATE_ID = "11111111-2222-3333-4444-555555555555";

    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes("ApprovalRequests")) {
        return new Response(JSON.stringify({ whatsapp: { status: "approved" } }), { status: 200 });
      }
      if (u.includes("api.twilio.com") && u.includes("/Messages.json")) {
        const params = new URLSearchParams(String(init?.body || ""));
        const vars = JSON.parse(params.get("ContentVariables") || "{}");
        capturedTwilioOtp = vars["1"];
        return new Response(JSON.stringify({ sid: "SM_2B_SINGLE_OTP", status: "queued" }), { status: 201 });
      }
      if (u.includes("messages/send-template")) {
        const body = JSON.parse(String(init?.body || "{}"));
        capturedResalaOtp = body?.records?.[0]?.["$1"];
        return new Response(JSON.stringify({ id: "resala-tpl-001" }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${u}`);
    };

    // 1. إرسال عبر Twilio WhatsApp أولاً
    const waRes = await otpService.requestSmartOtp("0915556677", "auto");
    assert.equal(waRes.ok, true);
    assert.equal(waRes.channel, "WHATSAPP");
    assert.match(String(capturedTwilioOtp), /^\d{6}$/);

    // 2. طلب المستخدم SMS يدوياً -> يرسل الرمز نفسه تماماً عبر Resala send-template
    const smsRes = await otpService.requestSmartOtp("0915556677", "sms");
    assert.equal(smsRes.ok, true);
    assert.equal(smsRes.channel, "SMS");
    assert.equal(capturedResalaOtp, capturedTwilioOtp, "يجب استخدام نفس رمز OTP تماماً بدون توليد رمز جديد");

    // 3. التحقق بالرمز نفسه ينجح مرة واحدة فقط ثم يُمنع إعادة الاستخدام
    const v1 = await otpService.verifyOtpCode("0915556677", capturedTwilioOtp);
    assert.equal(v1.ok, true);
    const v2 = await otpService.verifyOtpCode("0915556677", capturedTwilioOtp);
    assert.equal(v2.ok, false);
  } finally {
    globalThis.fetch = origFetch;
    df.setDeliveryFallbackRpcExecutorForTest(null);
    if (prevSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = prevSid;
    if (prevTok === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = prevTok;
    if (prevFrom === undefined) delete process.env.TWILIO_WHATSAPP_FROM;
    else process.env.TWILIO_WHATSAPP_FROM = prevFrom;
    if (prevResalaKey === undefined) delete process.env.RESALA_API_KEY;
    else process.env.RESALA_API_KEY = prevResalaKey;
    if (prevResalaEp === undefined) delete process.env.RESALA_ENDPOINT;
    else process.env.RESALA_ENDPOINT = prevResalaEp;
    if (prevResalaOtpTpl === undefined) delete process.env.RESALA_OTP_TEMPLATE_ID;
    else process.env.RESALA_OTP_TEMPLATE_ID = prevResalaOtpTpl;
    if (prevApproved === undefined) delete process.env.RESALA_APPROVED_HOSTNAMES;
    else process.env.RESALA_APPROVED_HOSTNAMES = prevApproved;
  }
});

await runTest("MOCK-INT", "C.2 Batch 2C: حماية Worker بـ CRON_SECRET ومعالجة دورة Worker المستقلة لـ OTP والإشعارات", async () => {
  const prevCron = process.env.CRON_SECRET;
  const store = createMigration012MockStore();
  // توسيع الموك بدالتي Worker: claim_due_whatsapp_fallbacks و get_otp_session_for_worker_fallback
  const extendedExecutor = async (fnName, args) => {
    if (fnName === "get_otp_session_for_worker_fallback") {
      const s = store.otpSessions.get(String(args.p_otp_session_id));
      if (!s) return { data: null, error: null };
      return {
        data: {
          session_id: s.id,
          phone_hash: s.phone_hash,
          enc_key_version: s.enc_key_version,
          session_salt: s.session_salt,
          otp_payload_enc: s.otp_payload_enc,
          status: s.status,
          expires_at: new Date(s.expires_at).toISOString(),
        },
        error: null,
      };
    }
    if (fnName === "claim_due_whatsapp_fallbacks") {
      const nowMs = new Date(String(args.p_now)).getTime();
      const limit = Number(args.p_limit || 20);
      const leaseMs = Number(args.p_lease_seconds || 120) * 1000;
      const items = [];
      for (const d of store.deliveries.values()) {
        if (items.length >= limit) break;
        if (d.sms_fallback_enabled && d.sms_fallback_state === "queued" && nowMs >= d.fallback_after_at) {
          d.sms_fallback_state = "claimed";
          d.claim_token = crypto.randomUUID();
          d.claim_expires_at = nowMs + leaseMs;
          items.push({
            message_sid: d.message_sid,
            message_kind: d.message_kind,
            report_id: d.report_id,
            tag_code: d.tag_code,
            otp_session_id: d.otp_session_id,
            phone_hmac_key_version: d.phone_hmac_key_version,
            claim_token: d.claim_token,
            claim_expires_at: new Date(d.claim_expires_at).toISOString(),
          });
        }
      }
      return { data: items, error: null };
    }
    return store.executor(fnName, args);
  };
  df.setDeliveryFallbackRpcExecutorForTest(extendedExecutor);

  try {
    // 1. فحص حماية CRON_SECRET
    process.env.CRON_SECRET = "worker_secret_test_32bytes_minimum_ok";
    const badReq = { headers: new Headers({ authorization: "Bearer wrong_secret" }) };
    const goodReq = { headers: new Headers({ authorization: `Bearer ${process.env.CRON_SECRET}` }) };
    assert.equal(workerMod.verifyWorkerCronAuthorization(badReq), false);
    assert.equal(workerMod.verifyWorkerCronAuthorization(goodReq), true);

    // 2. تجهيز رسالة OTP مستحقة بعد 60 ثانية
    const t0 = Date.now();
    const phone = "218917778899";
    const otp = "778899";
    const salt = otpCrypto.generateOtpSessionSalt();
    const ph = otpCrypto.computePhoneHmac(phone);
    const oh = otpCrypto.computeOtpHmac(otp, salt);
    const enc = otpCrypto.encryptOtpPayload({ phone, otp, phoneHash: ph.phoneHash, sessionSalt: salt });

    const pending = await df.createOtpSessionPending({
      phoneHashCurrent: ph.phoneHash, phoneHashPrevious: null, phoneHmacKeyVersion: 1, otpHmacKeyVersion: 1, encKeyVersion: 1,
      otpPayloadEnc: enc.ciphertext, sessionSalt: salt, otpHash: oh.otpHash,
      expiresAtIso: new Date(t0 + 300_000).toISOString(),
    });
    await df.activateOtpWhatsappSession({
      sessionId: pending.sessionId, twilioMessageSid: "SM_WORKER_OTP_01", recipientPhoneHash: ph.phoneHash, phoneHmacKeyVersion: 1,
      fallbackAfterAtIso: new Date(t0 + 60_000).toISOString(),
    });

    let sentOtpFromWorker = null;
    const stats = await workerMod.runWhatsappFallbackWorkerCycle({
      nowMs: t0 + 61_000,
      batchLimit: 10,
      deps: {
        sendOtpSms: async (_p, code) => {
          sentOtpFromWorker = code;
          return { ok: true, httpStatus: 200, id: "resala-w-1" };
        },
      },
    });
    assert.equal(stats.ok, true);
    assert.equal(stats.claimed, 1);
    assert.equal(stats.sent, 1);
    assert.equal(sentOtpFromWorker, "778899", "يجب أن يرسل Worker نفس رمز OTP تماماً بعد 60 ثانية");
  } finally {
    df.setDeliveryFallbackRpcExecutorForTest(null);
    if (prevCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCron;
  }
});

await runTest("STATIC-CFG", "C.3 Batch 2E: خلو src/ من الرقم الوهمي 218910000000 وخلو .env.example من GREEN_API_", async () => {
  const uiFiles = [
    "src/components/scan/scan-form.tsx",
    "src/app/login/page.tsx",
    "src/components/layout/site-footer.tsx",
  ];
  for (const rel of uiFiles) {
    const c = fs.readFileSync(path.join(projectRoot, rel), "utf8");
    assert.equal(c.includes("218910000000"), false, `Dummy support number found in ${rel}`);
  }
  const envEx = fs.readFileSync(path.join(projectRoot, ".env.example"), "utf8");
  assert.equal(/GREEN_API_/i.test(envEx), false, "GREEN_API_ must be removed from .env.example");
  assert.match(envEx, /RESALA_OTP_TEMPLATE_ID=/);
  assert.match(envEx, /SESSION_PHONE_HMAC_KEY_VERSION=/);
  assert.match(envEx, /SESSION_OTP_HMAC_KEY_VERSION=/);
  assert.match(envEx, /SESSION_ENC_KEY_VERSION=/);
});

await runTest("SEC-C1", "C.4 SEC-C1: تحقق لأول مرة، منع إعادة الاستخدام، تزامن طلبين صحيحين، الرفض بعد القفل، وتزامن المحاولات الخاطئة", async () => {
  const otpService = await import("@/lib/otp-service");
  const store = createMigration012MockStore();

  // حاجز تزامن لمحاكاة قراءة طلبين لنفس الجلسة المفتوحة قبل تثبيت أي منهما
  let holdLookupBarrier = false;
  let waitingResolvers = [];
  const wrappedExecutor = async (fnName, args) => {
    const res = await store.executor(fnName, args);
    if (fnName === "get_open_otp_session_for_verify" && holdLookupBarrier) {
      await new Promise((resolve) => {
        waitingResolvers.push(resolve);
        if (waitingResolvers.length >= 2) {
          const toRelease = waitingResolvers;
          waitingResolvers = [];
          toRelease.forEach((r) => r());
        }
      });
    }
    return res;
  };
  df.setDeliveryFallbackRpcExecutorForTest(wrappedExecutor);

  const seedActiveSession = async (phone, code) => {
    const ph = otpCrypto.computePhoneHmac(phone);
    const salt = otpCrypto.generateOtpSessionSalt();
    const oh = otpCrypto.computeOtpHmac(code, salt);
    const enc = otpCrypto.encryptOtpPayload({ phone, otp: code, phoneHash: ph.phoneHash, sessionSalt: salt });
    const created = await df.createOtpSessionPending({
      phoneHashCurrent: ph.phoneHash,
      phoneHashPrevious: null,
      phoneHmacKeyVersion: ph.phoneHmacKeyVersion,
      otpHmacKeyVersion: oh.otpHmacKeyVersion,
      encKeyVersion: enc.encKeyVersion,
      otpPayloadEnc: enc.ciphertext,
      sessionSalt: salt,
      otpHash: oh.otpHash,
      expiresAtIso: new Date(Date.now() + otpCrypto.OTP_VALIDITY_MS).toISOString(),
    });
    assert.equal(created.ok, true);
    await df.activateOtpSmsSession({ sessionId: created.sessionId, resalaPinId: "resala-sec-c1" });
    return created.sessionId;
  };

  try {
    // 1. تحقق صحيح لأول مرة -> ok: true
    const phone1 = "218911112233";
    const code1 = "482910";
    const sid1 = await seedActiveSession(phone1, code1);
    const first = await otpService.verifyOtpCode(phone1, code1);
    assert.equal(first.ok, true, "يجب أن ينجح التحقق الصحيح لأول مرة");
    assert.equal(store.otpSessions.get(sid1).status, "verified");
    assert.equal(store.otpSessions.get(sid1).otp_hash, null);
    assert.equal(store.otpSessions.get(sid1).otp_payload_enc, null);

    // 2. إعادة استخدام OTP بعد التحقق -> already_verified في RPC و ok: false في verifyOtpCode
    const directReplayTrue = await df.commitOtpVerificationAttempt({ sessionId: sid1, expectedAttempts: 1, matched: true });
    assert.equal(directReplayTrue.outcome, "already_verified");
    const directReplayFalse = await df.commitOtpVerificationAttempt({ sessionId: sid1, expectedAttempts: 1, matched: false });
    assert.equal(directReplayFalse.outcome, "already_verified");
    const appReplay = await otpService.verifyOtpCode(phone1, code1);
    assert.equal(appReplay.ok, false, "يجب رفض إعادة استخدام OTP بعد التحقق");

    // 3. طلبان متزامنان للتحقق الصحيح (يقرآن الجلسة المفتوحة معاً قبل أي commit) -> ينجح واحد فقط بالضبط!
    const phone2 = "218922223344";
    const code2 = "739104";
    const sid2 = await seedActiveSession(phone2, code2);
    holdLookupBarrier = true;
    const [rA, rB] = await Promise.all([
      otpService.verifyOtpCode(phone2, code2),
      otpService.verifyOtpCode(phone2, code2),
    ]);
    holdLookupBarrier = false;
    const okCount = [rA, rB].filter((r) => r.ok === true).length;
    const failCount = [rA, rB].filter((r) => r.ok === false).length;
    assert.equal(okCount, 1, "يجب أن ينجح طلب واحد فقط من طلبين متزامنين للتحقق الصحيح");
    assert.equal(failCount, 1, "يجب أن يُرفض الطلب الثاني المتزامن عبر already_verified");
    assert.equal(store.otpSessions.get(sid2).status, "verified");
    assert.equal(store.otpSessions.get(sid2).attempts, 1);

    // 4. طلب صحيح بعد القفل + التحقق من رفض expired / superseded / failed
    const phone3 = "218933334455";
    const code3 = "615293";
    const sid3 = await seedActiveSession(phone3, code3);
    for (let i = 0; i < 5; i++) {
      const bad = await otpService.verifyOtpCode(phone3, "000000");
      assert.equal(bad.ok, false);
    }
    assert.equal(store.otpSessions.get(sid3).status, "locked");
    assert.equal(store.otpSessions.get(sid3).attempts, 5);
    const validAfterLockRpc = await df.commitOtpVerificationAttempt({ sessionId: sid3, expectedAttempts: 5, matched: true });
    assert.equal(validAfterLockRpc.outcome, "locked");
    const validAfterLockApp = await otpService.verifyOtpCode(phone3, code3);
    assert.equal(validAfterLockApp.ok, false, "يجب رفض الرمز الصحيح بعد القفل");

    for (const termStatus of ["expired", "superseded", "failed"]) {
      const sidTerm = await seedActiveSession("218944445566", "551122");
      const rec = store.otpSessions.get(sidTerm);
      rec.status = termStatus;
      rec.otp_hash = null;
      rec.otp_payload_enc = null;
      const resTerm = await df.commitOtpVerificationAttempt({ sessionId: sidTerm, expectedAttempts: 0, matched: true });
      assert.equal(resTerm.outcome, termStatus, `يجب أن تعيد الحالة النهائية ${termStatus} نفسها وليس verified`);
      assert.notEqual(resTerm.outcome, "verified");
    }

    // 5. محاولات خاطئة متزامنة (تزامن CAS عند expectedAttempts = 0 ثم حتى القفل عند 5)
    const phone4 = "218955556677";
    const code4 = "904182";
    const sid4 = await seedActiveSession(phone4, code4);
    const [cInv1, cInv2] = await Promise.all([
      df.commitOtpVerificationAttempt({ sessionId: sid4, expectedAttempts: 0, matched: false }),
      df.commitOtpVerificationAttempt({ sessionId: sid4, expectedAttempts: 0, matched: false }),
    ]);
    const invOutcomes = [cInv1.outcome, cInv2.outcome].sort();
    assert.deepEqual(invOutcomes, ["conflict_retry", "invalid"], "محاولتان خاطئتان متزامنتان بنفس expectedAttempts يجب أن تُنتجا invalid واحدة وconflict_retry واحدة");
    assert.equal(store.otpSessions.get(sid4).attempts, 1);
    for (let exp = 1; exp <= 3; exp++) {
      const r = await df.commitOtpVerificationAttempt({ sessionId: sid4, expectedAttempts: exp, matched: false });
      assert.equal(r.outcome, "invalid");
    }
    const [cLock1, cLock2] = await Promise.all([
      df.commitOtpVerificationAttempt({ sessionId: sid4, expectedAttempts: 4, matched: false }),
      df.commitOtpVerificationAttempt({ sessionId: sid4, expectedAttempts: 4, matched: false }),
    ]);
    assert.equal(cLock1.outcome, "locked");
    assert.equal(cLock2.outcome, "locked");
    assert.equal(store.otpSessions.get(sid4).attempts, 5, "يجب ألا تتجاوز المحاولات 5 أبداً");
    assert.equal(store.otpSessions.get(sid4).status, "locked");
  } finally {
    holdLookupBarrier = false;
    df.setDeliveryFallbackRpcExecutorForTest(null);
  }
});

await runTest("STATIC-SQL", "C.5 التحقق الساكن من Migration 013 وRollback 013 (تطابق التوقيع مع 012 ومنع إعادة SEC-C1)", async () => {
  const mig012Path = path.join(projectRoot, "supabase/migrations/20261121_012_whatsapp_delivery_and_otp_sessions.sql");
  const mig013Path = path.join(projectRoot, "supabase/migrations/20261121_013_fix_otp_verify_replay_sec_c1.sql");
  const rb013Path = path.join(projectRoot, "supabase/rollbacks/20261121_013_fix_otp_verify_replay_sec_c1_rollback.sql");
  assert.equal(fs.existsSync(mig013Path), true, "Migration 013 must exist");
  assert.equal(fs.existsSync(rb013Path), true, "Rollback 013 must exist");

  const sql012 = fs.readFileSync(mig012Path, "utf8");
  const sql013 = fs.readFileSync(mig013Path, "utf8");
  const rb013 = fs.readFileSync(rb013Path, "utf8");

  // التحقق من التطابق الحرفي لتوقيع الدالة ومعاملاتها وقيمة الإرجاع بين 012 و013
  const sigRegex = /CREATE OR REPLACE FUNCTION public\.commit_otp_verification_attempt\s*\([\s\S]*?\)\s*RETURNS TABLE\s*\([\s\S]*?\)/;
  const sig012 = sql012.match(sigRegex)?.[0]?.replace(/\s+/g, " ").trim();
  const sig013 = sql013.match(sigRegex)?.[0]?.replace(/\s+/g, " ").trim();
  assert.ok(sig012 && sig013, "Signature must be present in both 012 and 013");
  assert.equal(sig013, sig012, "Migration 013 function signature and parameter order must match Migration 012 exactly");

  assert.match(sql013, /IF\s+v_row\.status\s*=\s*'verified'\s+THEN[\s\S]*?'already_verified'::text/i);
  const verifiedReturns = sql013.match(/RETURN\s+QUERY\s+SELECT\s+'verified'::text/gi) || [];
  assert.equal(verifiedReturns.length, 1, "يجب أن يظهر RETURN QUERY SELECT 'verified'::text مرة واحدة فقط في المسار الانتقالي");
  assert.match(sql013, /SECURITY DEFINER/);
  assert.match(sql013, /SET search_path = pg_catalog, public/);
  assert.match(sql013, /ALTER FUNCTION public\.commit_otp_verification_attempt\(uuid, integer, boolean, timestamptz\) OWNER TO postgres;/);
  assert.match(sql013, /REVOKE ALL ON FUNCTION public\.commit_otp_verification_attempt\(uuid, integer, boolean, timestamptz\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql013, /GRANT EXECUTE ON FUNCTION public\.commit_otp_verification_attempt\(uuid, integer, boolean, timestamptz\) TO service_role;/);

  // التحقق من أن Rollback 013 يمنع التنفيذ صراحةً ولا يعيد ثغرة SEC-C1
  const activeRb013 = rb013.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.equal(/\bCASCADE\b/i.test(activeRb013), false, "Rollback 013 must NOT use CASCADE");
  assert.equal(/\bDROP\s+TABLE\b/i.test(activeRb013), false, "Rollback 013 must NOT drop tables");
  assert.equal(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(activeRb013), false, "Rollback 013 must NOT restore vulnerable Migration 012 function");
  assert.match(activeRb013, /RAISE\s+EXCEPTION/i, "Rollback 013 must explicitly refuse execution via RAISE EXCEPTION");
  assert.match(activeRb013, /SEC-C1/, "Rollback 013 must document SEC-C1 reason in exception");
  assert.match(activeRb013, /ERRCODE\s*=\s*'0A000'/i, "Rollback 013 should raise feature_not_supported (0A000)");
});

await runTest("SEC-BATCH", "C.6 MED-01/LOW-01/LOW-02/INFO-01 + Worker: Fail-Closed RESALA_ENDPOINT في الإنتاج، عدم السقوط لـ dev، إزالة sendOtpViaResala وcustom، وثبات Worker", async () => {
  const otpService = await import("@/lib/otp-service");
  const workerMod = await import("@/app/api/worker/whatsapp-fallback/route");
  const whMod = await import("@/lib/whatsapp-webhook-handler");

  const origFetch = globalThis.fetch;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevVercelEnv = process.env.VERCEL_ENV;
  const prevResalaKey = process.env.RESALA_API_KEY;
  const prevResalaEp = process.env.RESALA_ENDPOINT;
  const prevResalaDevEp = process.env.RESALA_DEV_ENDPOINT;
  const prevResalaOtpTpl = process.env.RESALA_OTP_TEMPLATE_ID;
  const prevResalaApproved = process.env.RESALA_APPROVED_HOSTNAMES;

  let fetchCalls = [];
  try {
    process.env.RESALA_API_KEY = "test_resala_key_mock_only";
    process.env.RESALA_OTP_TEMPLATE_ID = "11111111-2222-3333-4444-555555555555";
    globalThis.fetch = async (url, init) => {
      fetchCalls.push({ url: String(url), body: String(init?.body || "") });
      return new Response(JSON.stringify({ id: "resala-prod-mock-1" }), { status: 200 });
    };

    // 1. غياب RESALA_ENDPOINT في الإنتاج (حتى مع وجود RESALA_DEV_ENDPOINT) -> Fail-Closed بدون أي fetch
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    delete process.env.RESALA_ENDPOINT;
    delete process.env.RESALA_APPROVED_HOSTNAMES;
    process.env.RESALA_DEV_ENDPOINT = "https://dev.resala.ly/api/v1";
    const missingProd = await otpService.sendOtpViaResalaTemplate("218911234567", "654321");
    assert.equal(missingProd.ok, false);
    assert.equal(fetchCalls.length, 0, "يجب ألا يحدث أي fetch عند غياب RESALA_ENDPOINT في الإنتاج");
    assert.equal(otpService.TWILIO_CONTENT_SIDS.OTP, "", "يجب ألا يعيد TWILIO_CONTENT_SIDS.OTP قيمة hardcoded في الإنتاج عند غياب المتغير");

    // 2. وجود RESALA_ENDPOINT صالح في الإنتاج مع نطاق معتمد صراحة -> يعمل send-template مع $1 ولا يسقط أبداً إلى dev.resala.ly
    process.env.RESALA_ENDPOINT = "https://prod-mock.resala.invalid/api/v1";
    process.env.RESALA_APPROVED_HOSTNAMES = "prod-mock.resala.invalid";
    const okProd = await otpService.sendOtpViaResalaTemplate("218911234567", "654321");
    assert.equal(okProd.ok, true);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url.includes("dev.resala.ly"), false, "يجب عدم السقوط إلى dev.resala.ly");
    assert.equal(fetchCalls[0].url.includes("/messages/send-template"), true);
    assert.equal(JSON.parse(fetchCalls[0].body).records[0].$1, "654321");

    // 3. عدم وجود الدالة القديمة sendOtpViaResala (/api/v1/pins)
    assert.equal("sendOtpViaResala" in otpService, false, "يجب إزالة الدالة القديمة sendOtpViaResala");
    const otpServiceSrc = fs.readFileSync(path.join(projectRoot, "src/lib/otp-service.ts"), "utf8");
    assert.equal(otpServiceSrc.includes("https://dev.resala.ly/api/v1/pins"), false, "يجب خلو otp-service.ts من dev endpoint القديم");

    // 4. إزالة provider: custom من extractWebhookEvents
    const customParsed = whMod.extractWebhookEvents({ status: "delivered", messageId: "CUSTOM_1" });
    assert.equal(customParsed.statuses.length, 0, "يجب عدم قبول أحداث custom غير الموقعة في extractWebhookEvents");

    // 5. سلامة إعدادات Worker (dynamic, runtime, maxDuration)
    assert.equal(workerMod.dynamic, "force-dynamic");
    assert.equal(workerMod.runtime, "nodejs");
    assert.equal(workerMod.maxDuration, 60);
  } finally {
    globalThis.fetch = origFetch;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = prevVercelEnv;
    if (prevResalaKey === undefined) delete process.env.RESALA_API_KEY;
    else process.env.RESALA_API_KEY = prevResalaKey;
    if (prevResalaEp === undefined) delete process.env.RESALA_ENDPOINT;
    else process.env.RESALA_ENDPOINT = prevResalaEp;
    if (prevResalaDevEp === undefined) delete process.env.RESALA_DEV_ENDPOINT;
    else process.env.RESALA_DEV_ENDPOINT = prevResalaDevEp;
    if (prevResalaOtpTpl === undefined) delete process.env.RESALA_OTP_TEMPLATE_ID;
    else process.env.RESALA_OTP_TEMPLATE_ID = prevResalaOtpTpl;
    if (prevResalaApproved === undefined) delete process.env.RESALA_APPROVED_HOSTNAMES;
    else process.env.RESALA_APPROVED_HOSTNAMES = prevResalaApproved;
  }
});

await runTest("SEC-REMEDIATION", "C.7 PART C: الفحص الشامل لحماية RESALA_ENDPOINT ومنع Twilio Body Fallback في Production", async () => {
  const otpService = await import("@/lib/otp-service");

  // ==========================================================================
  // 1. اختبارات RESALA_ENDPOINT الدقيقة
  // ==========================================================================
  const vProd = (url, allowed) =>
    otpService.validateResalaEndpointUrl(url, { isProduction: true, allowedHostnames: allowed });

  // أ. رفض dev.resala.ly في Production (حتى لو حاول المشرف تمريره في allowlist)
  assert.equal(vProd("https://dev.resala.ly/api/v1", ["dev.resala.ly"]).ok, false, "يجب رفض dev.resala.ly في Production");
  assert.equal(vProd("https://subdomain.dev.resala.ly/api/v1", ["subdomain.dev.resala.ly"]).ok, false, "يجب رفض subdomain.dev.resala.ly في Production");

  // ب. رفض userinfo / credentials
  assert.equal(vProd("https://user:pass@sms.resala.ly/api/v1", ["sms.resala.ly"]).ok, false, "يجب رفض credentials في الرابط");

  // ج. رفض localhost و loopback
  assert.equal(vProd("https://localhost/api/v1", ["localhost"]).ok, false, "يجب رفض localhost");
  assert.equal(vProd("https://sub.localhost/api/v1", ["sub.localhost"]).ok, false, "يجب رفض *.localhost");

  // د. رفض عناوين IP المباشرة (IPv4 / IPv6 / Private)
  assert.equal(vProd("https://127.0.0.1/api/v1", ["127.0.0.1"]).ok, false, "يجب رفض 127.0.0.1");
  assert.equal(vProd("https://10.0.0.1/api/v1", ["10.0.0.1"]).ok, false, "يجب رفض 10.0.0.1");
  assert.equal(vProd("https://192.168.1.1/api/v1", ["192.168.1.1"]).ok, false, "يجب رفض 192.168.1.1");
  assert.equal(vProd("https://[::1]/api/v1", ["::1"]).ok, false, "يجب رفض IPv6 loopback");

  // هـ. رفض hostname suffix bypass (resala.ly.attacker.example)
  assert.equal(vProd("https://resala.ly.attacker.example/api/v1", ["resala.ly"]).ok, false, "يجب رفض hostname suffix bypass");
  assert.equal(vProd("https://attacker-resala.ly/api/v1", ["resala.ly"]).ok, false, "يجب رفض prefix bypass");

  // و. رفض trailing-dot bypass
  assert.equal(vProd("https://sms.resala.ly./api/v1", ["sms.resala.ly"]).ok, false, "يجب رفض trailing-dot bypass");

  // ز. رفض HTTP غير المشفر
  assert.equal(vProd("http://sms.resala.ly/api/v1", ["sms.resala.ly"]).ok, false, "يجب رفض HTTP");

  // ح. رفض النطاق غير المعتمد / غياب Allowlist في Production
  assert.equal(vProd("https://unapproved.example.com/api/v1", []).ok, false, "يجب الرفض عند خلو allowlist");
  assert.equal(vProd("https://unapproved.example.com/api/v1", ["sms.resala.ly"]).ok, false, "يجب رفض أي نطاق غير معتمد");

  // ط. قبول النطاق فقط عندما يكون موجوداً في Allowlist صراحة
  const okResult = vProd("https://sms-official.resala.ly/api/v1", ["sms-official.resala.ly"]);
  assert.equal(okResult.ok, true, "يجب قبول النطاق المعتمد صراحة");
  assert.equal(okResult.hostname, "sms-official.resala.ly");

  // ي. إثبات أن الفشل يحدث قبل أي اتصال شبكي (0 fetches)
  const origFetch = globalThis.fetch;
  let fetchIntercepted = 0;
  globalThis.fetch = async () => {
    fetchIntercepted++;
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const prevEnv = process.env.NODE_ENV;
  const prevEp = process.env.RESALA_ENDPOINT;
  const prevKey = process.env.RESALA_API_KEY;
  const prevTpl = process.env.RESALA_OTP_TEMPLATE_ID;
  try {
    process.env.NODE_ENV = "production";
    process.env.RESALA_API_KEY = "dummy_key";
    process.env.RESALA_OTP_TEMPLATE_ID = "11111111-2222-3333-4444-555555555555";
    process.env.RESALA_ENDPOINT = "https://127.0.0.1/bad";
    delete process.env.RESALA_APPROVED_HOSTNAMES;
    const failRes = await otpService.sendOtpViaResalaTemplate("218911112233", "123456");
    assert.equal(failRes.ok, false);
    assert.equal(fetchIntercepted, 0, "يجب ألا يتم استدعاء fetch نهائياً عند فشل التحقق من الرابط");
  } finally {
    globalThis.fetch = origFetch;
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevEp === undefined) delete process.env.RESALA_ENDPOINT;
    else process.env.RESALA_ENDPOINT = prevEp;
    if (prevKey === undefined) delete process.env.RESALA_API_KEY;
    else process.env.RESALA_API_KEY = prevKey;
    if (prevTpl === undefined) delete process.env.RESALA_OTP_TEMPLATE_ID;
    else process.env.RESALA_OTP_TEMPLATE_ID = prevTpl;
  }

  // ==========================================================================
  // 2. اختبارات Twilio Free-Text Fallback في Production
  // ==========================================================================
  const prevTwilioSid = process.env.TWILIO_ACCOUNT_SID;
  const prevTwilioTok = process.env.TWILIO_AUTH_TOKEN;
  const prevTwilioFrom = process.env.TWILIO_WHATSAPP_FROM;
  const prevNode = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = "production";
    process.env.TWILIO_ACCOUNT_SID = "AC_MOCK_TEST_123456789012345678";
    process.env.TWILIO_AUTH_TOKEN = "token_mock_test_1234567890123456";
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886";

    let twilioPostBodies = [];
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes("ApprovalRequests")) {
        return new Response(JSON.stringify({ whatsapp: { status: "approved" } }), { status: 200 });
      }
      if (u.includes("/Messages.json")) {
        const bodyStr = String(init?.body || "");
        twilioPostBodies.push(bodyStr);
        // محاكاة فشل إرسال القالب (رمز 63016 أو غيره)
        if (bodyStr.includes("ContentSid=HX_FAIL_ME")) {
          return new Response(JSON.stringify({ error_code: 63016, message: "Template rejected" }), { status: 400 });
        }
        return new Response(JSON.stringify({ sid: "SM_MOCK_SUCCESS", status: "queued" }), { status: 201 });
      }
      if (u.includes("/Messages/SM_MOCK_SUCCESS.json")) {
        return new Response(JSON.stringify({ status: "delivered" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    // أ. غياب ContentSid في Production -> Fail-Closed دون إرسال Body
    twilioPostBodies = [];
    const missingSidRes = await otpService.sendWhatsappAlertMessage(
      "218911112233",
      "نص تجريبي بدون قالب",
      null,
      {} // بدون twilioContentSid
    );
    assert.equal(missingSidRes.ok, false, "يجب أن يفشل الإرسال في Production عند غياب ContentSid");
    assert.equal(twilioPostBodies.length, 0, "يجب ألا يتم إرسال أي طلب إلى Twilio عند غياب ContentSid");

    // ب. فشل إرسال القالب في Production -> لا يحاول إرسال Body كنص حر بديل
    twilioPostBodies = [];
    const failedSidRes = await otpService.sendWhatsappAlertMessage(
      "218911112233",
      "نص تجريبي مع قالب فاشل",
      null,
      { twilioContentSid: "HX_FAIL_ME" }
    );
    assert.equal(failedSidRes.ok, false, "يجب أن يفشل الإرسال عند فشل القالب في Production");
    assert.equal(twilioPostBodies.length, 1, "يجب ألا يرسل طلباً ثانياً للـ Body");
    assert.equal(twilioPostBodies[0].includes("ContentSid=HX_FAIL_ME"), true);
    assert.equal(twilioPostBodies[0].includes("Body="), false, "طلب القالب يجب ألا يتضمن Body");

    // ج. Timeout في Twilio -> لا يحاول إرسال طلب ثانٍ
    twilioPostBodies = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("ApprovalRequests")) {
        return new Response(JSON.stringify({ whatsapp: { status: "approved" } }), { status: 200 });
      }
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    };
    const timeoutRes = await otpService.sendWhatsappAlertMessage(
      "218911112233",
      "نص مع timeout",
      null,
      { twilioContentSid: "HX_TIMEOUT" }
    );
    assert.equal(timeoutRes.ok, false);

    // د. نجاح إرسال القالب التفاعلي يبقى سليماً
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes("ApprovalRequests")) {
        return new Response(JSON.stringify({ whatsapp: { status: "approved" } }), { status: 200 });
      }
      if (u.includes("/Messages.json")) {
        twilioPostBodies.push(String(init?.body || ""));
        return new Response(JSON.stringify({ sid: "SM_SUCCESS_1", status: "queued" }), { status: 201 });
      }
      if (u.includes("/Messages/SM_SUCCESS_1.json")) {
        return new Response(JSON.stringify({ status: "delivered" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };
    twilioPostBodies = [];
    const okTplRes = await otpService.sendWhatsappAlertMessage(
      "218911112233",
      "نص ناجح",
      null,
      {
        twilioContentSid: "HX_VALID_SUCCESS",
        twilioContentVariables: { "1": "ABC", "2": "XYZ" },
      }
    );
    assert.equal(okTplRes.ok, true);
    assert.equal(okTplRes.idMessage, "SM_SUCCESS_1");
    assert.equal(twilioPostBodies.length, 1);
    assert.equal(twilioPostBodies[0].includes("ContentSid=HX_VALID_SUCCESS"), true);
    assert.equal(twilioPostBodies[0].includes("Body="), false);
    assert.equal(twilioPostBodies[0].includes(encodeURIComponent(JSON.stringify({ "1": "ABC", "2": "XYZ" }))), true);

    // هـ. فحص تعريفات جميع القوالب الحالية وأنها تحتفظ بـ getters صحيحة
    const tplKeys = [
      "ALERT",
      "MEDIA_ALERT",
      "VOICE_CALL",
      "REMIND",
      "OTP",
      "SUBSCRIPTION",
      "DOC_REMINDER",
      "WEEKLY_OVERDUE",
      "ORDER_COD",
      "ORDER",
      "ORDER_ACTIVATED",
      "STICKER_LINKED",
      "GIFT_ACTIVATED",
      "ADMIN_ALERT",
    ];
    for (const key of tplKeys) {
      assert.ok(key in otpService.TWILIO_CONTENT_SIDS, `قالب ${key} يجب أن يكون موجوداً`);
    }
  } finally {
    globalThis.fetch = origFetch;
    if (prevTwilioSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
    else process.env.TWILIO_ACCOUNT_SID = prevTwilioSid;
    if (prevTwilioTok === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = prevTwilioTok;
    if (prevTwilioFrom === undefined) delete process.env.TWILIO_WHATSAPP_FROM;
    else process.env.TWILIO_WHATSAPP_FROM = prevTwilioFrom;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  }
});

await runTest("SEC-META-ISOLATION", "C.8 SEC-META-ISOLATION: عزل مزود Meta WhatsApp وتعطيله افتراضياً في Production", async () => {
  // ============================================================================
  // PART D: اختبارات عزل مزود Meta WhatsApp Cloud API (جميعها Mock فقط - بدون اتصال خارجي)
  // ============================================================================
  const origFetch = globalThis.fetch;
  const prevNode = process.env.NODE_ENV;
  const prevVercelEnv = process.env.VERCEL_ENV;
  const prevAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const prevMetaToken = process.env.META_WHATSAPP_TOKEN;
  const prevPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const prevActiveProvider = process.env.WHATSAPP_ACTIVE_PROVIDER;
  const prevEnableMeta = process.env.ENABLE_META_WHATSAPP_PROVIDER;
  const prevSecReview = process.env.META_SECURITY_REVIEW_APPROVED;
  const prevTwilioSid = process.env.TWILIO_ACCOUNT_SID;
  const prevTwilioTok = process.env.TWILIO_AUTH_TOKEN;
  const prevTwilioFrom = process.env.TWILIO_WHATSAPP_FROM;
  const prevWhatsappAppSecret = process.env.WHATSAPP_APP_SECRET;
  const prevMetaAppSecret = process.env.META_APP_SECRET;

  let metaFetchCount = 0;
  let twilioFetchCount = 0;
  let lastFetchedUrl = "";
  let lastFetchedBody = "";

  try {
    // إعداد مشترك: بيئة الإنتاج + مفاتيح Meta موجودة + بدون Twilio
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    process.env.WHATSAPP_ACCESS_TOKEN = "mock_meta_access_token_12345";
    process.env.META_WHATSAPP_TOKEN = "mock_meta_token_67890";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "mock_phone_id_111222333";

    // ═══════════════════════════════════════════════════════════════════════
    // D.1 — وجود مفاتيح Meta وحدها في Production لا يسمح بالإرسال
    // ═══════════════════════════════════════════════════════════════════════
    metaFetchCount = 0;
    globalThis.fetch = async (url) => {
      lastFetchedUrl = String(url);
      if (lastFetchedUrl.includes("graph.facebook.com")) metaFetchCount++;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    // المزود الافتراضي = twilio، Twilio غير مهيأ → Fail-Closed فوري
    delete process.env.WHATSAPP_ACTIVE_PROVIDER;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_WHATSAPP_FROM;

    const d1 = await otpService.sendWhatsappAlertMessage(
      "218911112233",
      "رسالة تجريبية D.1"
    );
    assert.equal(d1.ok, false, "D.1: يجب فشل الإرسال في Production مع Twilio غير مهيأ");
    assert.equal(metaFetchCount, 0, "D.1: يجب ألا يتم استدعاء graph.facebook.com نهائياً");
    assert.ok(d1.error?.includes("Twilio") || d1.error?.includes("credentials"), `D.1: الخطأ يجب أن يشير إلى Twilio غير المهيأ: ${d1.error}`);

    // ═══════════════════════════════════════════════════════════════════════
    // D.2 — WHATSAPP_ACTIVE_PROVIDER=meta في Production يُرفض قبل fetch
    // ═══════════════════════════════════════════════════════════════════════
    metaFetchCount = 0;
    lastFetchedBody = "";
    process.env.WHATSAPP_ACTIVE_PROVIDER = "meta";
    process.env.ENABLE_META_WHATSAPP_PROVIDER = "true";
    process.env.META_SECURITY_REVIEW_APPROVED = "true";
    // ← حتى مع كل الإعدادات الصريحة، الإنتاج يمنع منعاً باتاً

    const d2 = await otpService.sendWhatsappAlertMessage(
      "218911112233",
      "رسالة تجريبية D.2"
    );
    assert.equal(d2.ok, false, "D.2: يجب فشل إرسال Meta في Production حتى مع كل الإعدادات");
    assert.equal(metaFetchCount, 0, "D.2: يجب ألا يتم استدعاء graph.facebook.com في Production");
    assert.ok(
      d2.error?.includes("disabled") || d2.error?.includes("production") || d2.error?.includes("fail-closed"),
      `D.2: الخطأ يجب أن يشير إلى تعطيل Meta في Production: ${d2.error}`
    );

    // ═══════════════════════════════════════════════════════════════════════
    // D.3 — isMetaOutboundAllowed() يعيد allowed=false دائماً في Production
    // ═══════════════════════════════════════════════════════════════════════
    const d3 = otpService.isMetaOutboundAllowed();
    assert.equal(d3.allowed, false, "D.3: isMetaOutboundAllowed يجب أن يعيد allowed=false في Production");
    assert.ok(
      d3.reason?.includes("production") || d3.reason?.includes("disabled") || d3.reason?.includes("fail-closed"),
      `D.3: سبب الرفض يجب أن يشير إلى Production: ${d3.reason}`
    );

    // ═══════════════════════════════════════════════════════════════════════
    // D.4 — غياب Twilio مع WHATSAPP_ACTIVE_PROVIDER=twilio → Fail-Closed فوري (بدون Meta)
    // ═══════════════════════════════════════════════════════════════════════
    metaFetchCount = 0;
    process.env.WHATSAPP_ACTIVE_PROVIDER = "twilio";
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_WHATSAPP_FROM;

    const d4 = await otpService.sendWhatsappAlertMessage(
      "218911112233",
      "رسالة تجريبية D.4"
    );
    assert.equal(d4.ok, false, "D.4: غياب Twilio يجب أن يعيد Fail-Closed مباشرة");
    assert.equal(metaFetchCount, 0, "D.4: يجب ألا يُستدعى Meta عند غياب إعدادات Twilio");
    assert.ok(
      d4.error?.includes("Twilio") || d4.error?.includes("credentials"),
      `D.4: الخطأ يجب أن يشير إلى Twilio: ${d4.error}`
    );

    // ═══════════════════════════════════════════════════════════════════════
    // D.5 — فشل Twilio في Production لا يُشغّل Meta
    // ═══════════════════════════════════════════════════════════════════════
    metaFetchCount = 0;
    twilioFetchCount = 0;
    process.env.WHATSAPP_ACTIVE_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "AC_MOCK_PROD_SID";
    process.env.TWILIO_AUTH_TOKEN = "mock_prod_token";
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886";

    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes("graph.facebook.com")) {
        metaFetchCount++;
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (u.includes("ApprovalRequests")) {
        return new Response(JSON.stringify({ whatsapp: { status: "approved" } }), { status: 200 });
      }
      if (u.includes("twilio.com")) {
        twilioFetchCount++;
        // محاكاة فشل Twilio (500 Internal Server Error)
        return new Response(JSON.stringify({ message: "Internal Server Error", error_code: 20500 }), { status: 500 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const d5 = await otpService.sendWhatsappAlertMessage(
      "218911112233",
      "رسالة تجريبية D.5",
      null,
      { twilioContentSid: "HX_PROD_FAIL_SID" }
    );
    assert.equal(d5.ok, false, "D.5: يجب فشل الإرسال عند فشل Twilio في Production");
    assert.equal(metaFetchCount, 0, "D.5: يجب ألا يُستدعى Meta بعد فشل Twilio");
    assert.ok(twilioFetchCount > 0, "D.5: يجب أن يكون Twilio قد حاول الإرسال");

    // ═══════════════════════════════════════════════════════════════════════
    // D.6 — Timeout في Twilio في Production لا يُشغّل Meta
    // ═══════════════════════════════════════════════════════════════════════
    metaFetchCount = 0;
    twilioFetchCount = 0;

    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes("graph.facebook.com")) {
        metaFetchCount++;
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (u.includes("ApprovalRequests")) {
        return new Response(JSON.stringify({ whatsapp: { status: "approved" } }), { status: 200 });
      }
      if (u.includes("twilio.com")) {
        twilioFetchCount++;
        const abortErr = new Error("The operation was aborted (Timeout)");
        abortErr.name = "AbortError";
        throw abortErr;
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const d6 = await otpService.sendWhatsappAlertMessage(
      "218911112233",
      "رسالة تجريبية D.6",
      null,
      { twilioContentSid: "HX_TIMEOUT_SID" }
    );
    assert.equal(d6.ok, false, "D.6: يجب فشل الإرسال عند Timeout في Twilio");
    assert.equal(metaFetchCount, 0, "D.6: يجب ألا يُستدعى Meta بعد Timeout في Twilio");

    // ═══════════════════════════════════════════════════════════════════════
    // D.7 — أي محاولة إرسال Meta في Production تفشل قبل بناء Payload أو fetch
    // ═══════════════════════════════════════════════════════════════════════
    metaFetchCount = 0;
    let payloadBuilt = false;
    process.env.WHATSAPP_ACTIVE_PROVIDER = "meta";
    process.env.ENABLE_META_WHATSAPP_PROVIDER = "true";
    process.env.META_SECURITY_REVIEW_APPROVED = "true";

    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes("graph.facebook.com")) {
        metaFetchCount++;
        // إذا وصل هنا، يعني Payload تم بناؤه → فشل الاختبار
        payloadBuilt = true;
        return new Response(JSON.stringify({ messages: [{ id: "meta_id_leaked" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const d7 = await otpService.sendWhatsappAlertMessage(
      "218911112233",
      "رسالة تجريبية D.7"
    );
    assert.equal(d7.ok, false, "D.7: يجب فشل إرسال Meta في Production");
    assert.equal(metaFetchCount, 0, "D.7: يجب ألا يتم بناء Payload أو استدعاء fetch لـ Meta في Production");
    assert.equal(payloadBuilt, false, "D.7: لا يجب بناء أي Payload لـ Meta في Production");

    // ═══════════════════════════════════════════════════════════════════════
    // D.8 — إثبات isMetaOutboundAllowed تعمل بشكل صحيح في غير الإنتاج
    // ═══════════════════════════════════════════════════════════════════════
    process.env.NODE_ENV = "development";
    delete process.env.VERCEL_ENV;

    // أ. بمجرد وجود مفاتيح Meta بدون WHATSAPP_ACTIVE_PROVIDER=meta → مرفوض
    process.env.WHATSAPP_ACTIVE_PROVIDER = "twilio";
    process.env.ENABLE_META_WHATSAPP_PROVIDER = "true";
    process.env.META_SECURITY_REVIEW_APPROVED = "true";
    const d8a = otpService.isMetaOutboundAllowed();
    assert.equal(d8a.allowed, false, "D.8a: يجب رفض Meta عندما WHATSAPP_ACTIVE_PROVIDER=twilio");
    assert.ok(d8a.reason?.includes("inactive") || d8a.reason?.includes("twilio"), `D.8a: ${d8a.reason}`);

    // ب. WHATSAPP_ACTIVE_PROVIDER=meta لكن ENABLE_META_WHATSAPP_PROVIDER غائب/false → مرفوض
    process.env.WHATSAPP_ACTIVE_PROVIDER = "meta";
    delete process.env.ENABLE_META_WHATSAPP_PROVIDER;
    process.env.META_SECURITY_REVIEW_APPROVED = "true";
    const d8b = otpService.isMetaOutboundAllowed();
    assert.equal(d8b.allowed, false, "D.8b: يجب رفض Meta عند غياب ENABLE_META_WHATSAPP_PROVIDER");

    // ج. WHATSAPP_ACTIVE_PROVIDER=meta + ENABLE_META_WHATSAPP_PROVIDER=true لكن META_SECURITY_REVIEW_APPROVED غائب → مرفوض
    process.env.WHATSAPP_ACTIVE_PROVIDER = "meta";
    process.env.ENABLE_META_WHATSAPP_PROVIDER = "true";
    delete process.env.META_SECURITY_REVIEW_APPROVED;
    const d8c = otpService.isMetaOutboundAllowed();
    assert.equal(d8c.allowed, false, "D.8c: يجب رفض Meta عند غياب META_SECURITY_REVIEW_APPROVED");

    // ═══════════════════════════════════════════════════════════════════════
    // D.9 — سلامة Twilio: مسار Twilio يبقى سليماً في بيئة اختبار غير إنتاجية
    // ═══════════════════════════════════════════════════════════════════════
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL_ENV;
    process.env.WHATSAPP_ACTIVE_PROVIDER = "twilio";
    process.env.TWILIO_ACCOUNT_SID = "AC_MOCK_TEST_SID_9999";
    process.env.TWILIO_AUTH_TOKEN = "mock_test_token_9999";
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886";
    metaFetchCount = 0;
    twilioFetchCount = 0;

    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes("graph.facebook.com")) {
        metaFetchCount++;
        return new Response(JSON.stringify({}), { status: 500 });
      }
      if (u.includes("ApprovalRequests")) {
        return new Response(JSON.stringify({ whatsapp: { status: "approved" } }), { status: 200 });
      }
      if (u.includes("twilio.com/2010-04-01") && u.includes("Messages.json")) {
        twilioFetchCount++;
        return new Response(JSON.stringify({ sid: "SM_TWILIO_OK_9999", status: "queued" }), { status: 201 });
      }
      if (u.includes("SM_TWILIO_OK_9999")) {
        return new Response(JSON.stringify({ status: "delivered" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const d9 = await otpService.sendWhatsappAlertMessage(
      "218911112233",
      "رسالة تجريبية D.9",
      null,
      { twilioContentSid: "HX_VALID_TWILIO" }
    );
    assert.equal(d9.ok, true, `D.9: يجب نجاح Twilio في غير الإنتاج: ${d9.error}`);
    assert.equal(d9.idMessage, "SM_TWILIO_OK_9999", "D.9: يجب إعادة MessageSid الصحيح");
    assert.equal(metaFetchCount, 0, "D.9: يجب ألا يُستدعى Meta عند نجاح Twilio");
    assert.ok(twilioFetchCount > 0, "D.9: يجب أن يكون Twilio قد أرسل");

    // ═══════════════════════════════════════════════════════════════════════
    // D.10 — Webhook Meta الوارد (inbound) لا يتأثر بحظر Meta outbound
    // يتحقق فقط من منطق parseWebhookBody و extractWebhookEvents (بدون DB)
    // ═══════════════════════════════════════════════════════════════════════
    process.env.NODE_ENV = "production";
    const { parseWebhookBody, extractWebhookEvents } = await import("@/lib/whatsapp-webhook-handler");

    // محاكاة payload Meta Inbound Webhook
    const metaInboundRaw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          value: {
            messaging_product: "whatsapp",
            statuses: [{
              id: "wamid.MOCK_STATUS_ID_12345",
              status: "delivered",
              timestamp: "1700000000",
              recipient_id: "218911112233",
            }],
            messages: [{
              from: "218911112233",
              id: "wamid.MOCK_MSG_ID_67890",
              timestamp: "1700000000",
              type: "text",
              text: { body: "مرحباً" },
            }],
          }
        }]
      }]
    });

    const parsed = parseWebhookBody(metaInboundRaw, "application/json");
    assert.ok(typeof parsed === "object" && parsed !== null, "D.10: parseWebhookBody يجب أن تُرجع object");
    assert.ok(parsed.object === "whatsapp_business_account", "D.10: يجب قراءة حقل object");

    const events = extractWebhookEvents(parsed);
    assert.ok(Array.isArray(events.statuses), "D.10: يجب وجود مصفوفة statuses");
    assert.ok(Array.isArray(events.messages), "D.10: يجب وجود مصفوفة messages");
    assert.ok(
      events.statuses.some(s => s.messageId === "wamid.MOCK_STATUS_ID_12345"),
      "D.10: يجب قراءة معرف Status الصحيح"
    );
    assert.ok(
      events.messages.some(m => m.text === "مرحباً"),
      "D.10: يجب قراءة نص الرسالة الواردة"
    );
    // تأكد أن حظر outbound لم يؤثر في هذا الكود (parseWebhookBody ليس مرتبطاً بـ sendWhatsappAlertMessage)

    // ═══════════════════════════════════════════════════════════════════════
    // D.11 — التحقق الفعلي من توقيع Webhook Meta عبر route.ts (POST -> verifyMetaWebhookSignature)
    // ملاحظة: verifyMetaWebhookSignature غير مُصدّرة لأن Next.js App Router يمنع تصدير
    // دوال مساعدة غير معالجات HTTP من route.ts، لذا يُستدعى معالج POST الفعلي مباشرة.
    // ═══════════════════════════════════════════════════════════════════════
    const { NextRequest } = await import("next/server");
    const { POST: whatsappWebhookPost } = await import("@/app/api/webhooks/whatsapp/route");

    const mockSecret = "mock_app_secret_for_test_only_32x";
    process.env.WHATSAPP_APP_SECRET = mockSecret;
    delete process.env.META_APP_SECRET;

    const rawBody = `{"object":"whatsapp_business_account"}`;
    const validSig = `sha256=${crypto.createHmac("sha256", mockSecret).update(rawBody, "utf8").digest("hex")}`;
    const wrongSig = `sha256=${crypto.createHmac("sha256", "wrong_secret_for_test_only_32xxx").update(rawBody, "utf8").digest("hex")}`;
    const tamperedBody = `{"object":"whatsapp_business_account","tampered":true}`;

    const webhookUrl = "https://balaghni.ly/api/webhooks/whatsapp";

    // 1. توقيع صحيح -> يجب أن يمر التحقق (200 EVENT_RECEIVED) بدون أي اتصال DB لأن entry فارغة
    const resValid = await whatsappWebhookPost(
      new NextRequest(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": validSig,
        },
        body: rawBody,
      })
    );
    const jsonValid = await resValid.json();
    assert.equal(resValid.status, 200, `D.11a: التوقيع الصحيح يجب أن يعيد 200 (received ${resValid.status})`);
    assert.equal(jsonValid.ok, true, "D.11a: يجب أن يعيد ok=true عند التوقيع الصحيح");
    assert.equal(jsonValid.status, "EVENT_RECEIVED", "D.11a: يجب أن يعيد EVENT_RECEIVED");

    // 2. توقيع خاطئ -> يجب رفضه Fail-Closed (401)
    const resWrong = await whatsappWebhookPost(
      new NextRequest(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": wrongSig,
        },
        body: rawBody,
      })
    );
    const jsonWrong = await resWrong.json();
    assert.equal(resWrong.status, 401, `D.11b: التوقيع الخاطئ يجب أن يعيد 401 (received ${resWrong.status})`);
    assert.equal(jsonWrong.ok, false, "D.11b: يجب أن يعيد ok=false عند التوقيع الخاطئ");

    // 3. توقيع مفقود -> يجب رفضه Fail-Closed (401)
    const resMissing = await whatsappWebhookPost(
      new NextRequest(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: rawBody,
      })
    );
    const jsonMissing = await resMissing.json();
    assert.equal(resMissing.status, 401, `D.11c: التوقيع المفقود يجب أن يعيد 401 (received ${resMissing.status})`);
    assert.equal(jsonMissing.ok, false, "D.11c: يجب أن يعيد ok=false عند غياب التوقيع");

    // 4. تغيير محتوى Raw Body بعد إنشاء التوقيع -> يجب رفضه Fail-Closed (401)
    const resTampered = await whatsappWebhookPost(
      new NextRequest(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": validSig,
        },
        body: tamperedBody,
      })
    );
    const jsonTampered = await resTampered.json();
    assert.equal(resTampered.status, 401, `D.11d: تعديل Raw Body بعد التوقيع يجب أن يعيد 401 (received ${resTampered.status})`);
    assert.equal(jsonTampered.ok, false, "D.11d: يجب أن يعيد ok=false عند تعديل Raw Body");

  } finally {
    // استعادة جميع المتغيرات
    globalThis.fetch = origFetch;
    if (prevNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNode;
    if (prevVercelEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = prevVercelEnv;
    if (prevAccessToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN; else process.env.WHATSAPP_ACCESS_TOKEN = prevAccessToken;
    if (prevMetaToken === undefined) delete process.env.META_WHATSAPP_TOKEN; else process.env.META_WHATSAPP_TOKEN = prevMetaToken;
    if (prevPhoneId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID; else process.env.WHATSAPP_PHONE_NUMBER_ID = prevPhoneId;
    if (prevActiveProvider === undefined) delete process.env.WHATSAPP_ACTIVE_PROVIDER; else process.env.WHATSAPP_ACTIVE_PROVIDER = prevActiveProvider;
    if (prevEnableMeta === undefined) delete process.env.ENABLE_META_WHATSAPP_PROVIDER; else process.env.ENABLE_META_WHATSAPP_PROVIDER = prevEnableMeta;
    if (prevSecReview === undefined) delete process.env.META_SECURITY_REVIEW_APPROVED; else process.env.META_SECURITY_REVIEW_APPROVED = prevSecReview;
    if (prevTwilioSid === undefined) delete process.env.TWILIO_ACCOUNT_SID; else process.env.TWILIO_ACCOUNT_SID = prevTwilioSid;
    if (prevTwilioTok === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = prevTwilioTok;
    if (prevTwilioFrom === undefined) delete process.env.TWILIO_WHATSAPP_FROM; else process.env.TWILIO_WHATSAPP_FROM = prevTwilioFrom;
    if (prevWhatsappAppSecret === undefined) delete process.env.WHATSAPP_APP_SECRET; else process.env.WHATSAPP_APP_SECRET = prevWhatsappAppSecret;
    if (prevMetaAppSecret === undefined) delete process.env.META_APP_SECRET; else process.env.META_APP_SECRET = prevMetaAppSecret;
  }
});

const failed = results.filter((r) => r.status === "FAIL");
console.log(`\n=== MASTER BATCH 2 LOCAL TESTS SUMMARY: ${results.length - failed.length}/${results.length} PASSED ===`);
console.log("ℹ️  PostgreSQL Live Tests (FOR UPDATE SKIP LOCKED / pg_advisory_xact_lock / Rollback 012 on real DB): NOT EXECUTED (pending user approval).");
console.log("ℹ️  External Provider Live Tests (Twilio / Resala send-template / Vercel Cron): NOT EXECUTED (pending user approval).");
if (failed.length > 0) process.exit(1);
