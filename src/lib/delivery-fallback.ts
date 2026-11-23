import { supabaseAdmin } from "@/lib/supabase/client";
import { computePhoneHmac } from "@/lib/otp-crypto";

// ============================================================================
// آلية تتبع تسليم واتساب وجلسات OTP الموزّعة والتحويل الذري إلى SMS (Migration 012)
// Distributed, Atomic, Serverless-Safe — بدون setTimeout كـ Worker أو Scheduler
//
// حالات sms_fallback_state المعتمدة:
//   queued -> claimed -> sending -> sent | failed | skipped | abandoned_unknown
//
// حالات otp_sessions.status المعتمدة:
//   pending | active | verified | expired | locked | superseded | failed
// ============================================================================

export const SMS_FALLBACK_TIMEOUT_MS = 60_000; // 60 ثانية
export const SMS_CLAIM_LEASE_SECONDS = 120; // دقيقتان (> maxDuration=60s)
export const RESALA_HTTP_TIMEOUT_MS = 10_000; // مهلة HTTP محددة 10 ثوانٍ

export type DeliveryMessageKind = "otp" | "notification";

export type OtpSessionStatus =
  | "pending"
  | "active"
  | "verified"
  | "expired"
  | "locked"
  | "superseded"
  | "failed";

export type WhatsappDeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "undelivered";

export type SmsFallbackState =
  | "queued"
  | "claimed"
  | "sending"
  | "sent"
  | "failed"
  | "skipped"
  | "abandoned_unknown";

export type SmsFinalState = "sent" | "failed" | "skipped" | "abandoned_unknown";

export type DeliveryRpcName =
  | "create_otp_session_pending"
  | "activate_otp_whatsapp_session"
  | "activate_otp_sms_session"
  | "cancel_pending_otp_session"
  | "get_open_otp_session_for_verify"
  | "get_otp_session_for_worker_fallback"
  | "commit_otp_verification_attempt"
  | "register_whatsapp_delivery"
  | "update_whatsapp_delivery_status"
  | "claim_sms_fallback_delivery"
  | "claim_due_whatsapp_fallbacks"
  | "transition_sms_claim_to_sending"
  | "complete_sms_fallback_delivery"
  | "reconcile_stale_whatsapp_claims"
  | "check_key_version_active_usage";

export type DeliveryRpcExecutor = (
  fnName: DeliveryRpcName,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: unknown }>;

let customDeliveryRpcExecutor: DeliveryRpcExecutor | null = null;

/**
 * حقن منفّذ RPC للاختبارات المحلية (Mocks فقط — لا يُعد إثباتاً لتزامن PostgreSQL الحي)
 */
export function setDeliveryFallbackRpcExecutorForTest(
  executor: DeliveryRpcExecutor | null
): void {
  customDeliveryRpcExecutor = executor;
}

async function executeDeliveryRpc(
  fnName: DeliveryRpcName,
  args: Record<string, unknown>
): Promise<{ data: unknown; error: unknown }> {
  if (customDeliveryRpcExecutor) {
    return customDeliveryRpcExecutor(fnName, args);
  }
  return supabaseAdmin.rpc(fnName, args);
}

function normalizeStatus(raw: string): WhatsappDeliveryStatus | null {
  const s = String(raw || "").trim().toLowerCase();
  if (
    s === "queued" ||
    s === "sent" ||
    s === "delivered" ||
    s === "read" ||
    s === "failed" ||
    s === "undelivered"
  ) {
    return s;
  }
  if (s === "accepted" || s === "sending") return "queued";
  if (s === "noaccount") return "undelivered";
  return null;
}

function unwrapSingleRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    return data.length > 0 && typeof data[0] === "object" && data[0] !== null
      ? (data[0] as Record<string, unknown>)
      : null;
  }
  if (typeof data === "object" && data !== null) {
    return data as Record<string, unknown>;
  }
  return null;
}

function unwrapRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    );
  }
  if (typeof data === "object" && data !== null) {
    return [data as Record<string, unknown>];
  }
  return [];
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message?: unknown }).message || "rpc_error");
  }
  return "rpc_error";
}

// ============================================================================
// تصنيف نتيجة نداء Resala (التمييز الصارم بين الرفض الصريح والنتيجة المجهولة)
// - HTTP 4xx أو ECONNREFUSED/ENOTFOUND (قبل خروج الطلب) => "failed"
// - HTTP 5xx أو Timeout (AbortError) أو انقطاع الاتصال بعد الإرسال => "abandoned_unknown"
//   (لا يُعامل 5xx كدليل على عدم الإرسال، ولا يُعاد الإرسال تلقائياً!)
// ============================================================================
export interface SmsProviderDispatchResponse {
  ok: boolean;
  id?: string;
  httpStatus?: number;
  error?: string;
  networkErrorCode?: string;
  timedOut?: boolean;
}

export function classifyResalaDispatchOutcome(
  res: SmsProviderDispatchResponse
): SmsFinalState {
  if (res.ok) return "sent";

  if (res.timedOut) {
    return "abandoned_unknown";
  }

  if (typeof res.httpStatus === "number") {
    if (res.httpStatus >= 400 && res.httpStatus < 500) {
      return "failed";
    }
    // HTTP 5xx أو أي حالة غير 2xx/4xx: نتيجة مجهولة (قد يكون المزود قبل الرسالة)
    return "abandoned_unknown";
  }

  const code = String(res.networkErrorCode || "").toUpperCase();
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "failed";
  }

  return "abandoned_unknown";
}

// ============================================================================
// 1. دوال جلسات OTP الموزعة (مطابقة حرفياً لـ Migration 012)
// ============================================================================

export async function createOtpSessionPending(params: {
  phoneHashCurrent: string;
  phoneHashPrevious: string | null;
  phoneHmacKeyVersion: number;
  otpHmacKeyVersion: number;
  encKeyVersion: number;
  otpPayloadEnc: string;
  sessionSalt: string;
  otpHash: string;
  expiresAtIso: string;
}): Promise<{
  ok: boolean;
  sessionId?: string;
  supersededSid?: string | null;
  error?: string;
}> {
  try {
    const { data, error } = await executeDeliveryRpc("create_otp_session_pending", {
      p_phone_hash_current: params.phoneHashCurrent,
      p_phone_hash_previous: params.phoneHashPrevious,
      p_phone_hmac_key_version: params.phoneHmacKeyVersion,
      p_otp_hmac_key_version: params.otpHmacKeyVersion,
      p_enc_key_version: params.encKeyVersion,
      p_otp_payload_enc: params.otpPayloadEnc,
      p_session_salt: params.sessionSalt,
      p_otp_hash: params.otpHash,
      p_expires_at: params.expiresAtIso,
    });
    if (error) {
      return { ok: false, error: extractErrorMessage(error) };
    }
    const row = unwrapSingleRow(data);
    if (!row || typeof row.session_id !== "string") {
      return { ok: false, error: "otp_session_create_failed" };
    }
    return {
      ok: true,
      sessionId: row.session_id,
      supersededSid:
        typeof row.superseded_sid === "string" ? row.superseded_sid : null,
    };
  } catch (err) {
    return { ok: false, error: extractErrorMessage(err) };
  }
}

export async function activateOtpWhatsappSession(params: {
  sessionId: string;
  twilioMessageSid: string;
  recipientPhoneHash: string;
  phoneHmacKeyVersion: number;
  fallbackAfterAtIso: string;
}): Promise<{
  ok: boolean;
  activated: boolean;
  trackingRegistered: boolean;
  error?: string;
}> {
  try {
    const { data, error } = await executeDeliveryRpc(
      "activate_otp_whatsapp_session",
      {
        p_session_id: params.sessionId,
        p_twilio_message_sid: params.twilioMessageSid,
        p_recipient_phone_hash: params.recipientPhoneHash,
        p_phone_hmac_key_version: params.phoneHmacKeyVersion,
        p_fallback_after_at: params.fallbackAfterAtIso,
      }
    );
    if (error) {
      return {
        ok: false,
        activated: false,
        trackingRegistered: false,
        error: extractErrorMessage(error),
      };
    }
    const row = unwrapSingleRow(data);
    if (!row) {
      return { ok: false, activated: false, trackingRegistered: false, error: "empty_rpc_result" };
    }
    return {
      ok: true,
      activated: Boolean(row.activated),
      trackingRegistered: Boolean(row.tracking_registered),
    };
  } catch (err) {
    return {
      ok: false,
      activated: false,
      trackingRegistered: false,
      error: extractErrorMessage(err),
    };
  }
}

export async function activateOtpSmsSession(params: {
  sessionId: string;
  resalaPinId?: string | null;
}): Promise<{ ok: boolean; activated: boolean; error?: string }> {
  try {
    const { data, error } = await executeDeliveryRpc("activate_otp_sms_session", {
      p_session_id: params.sessionId,
      p_resala_pin_id: params.resalaPinId ?? null,
    });
    if (error) return { ok: false, activated: false, error: extractErrorMessage(error) };
    const row = unwrapSingleRow(data);
    return { ok: true, activated: Boolean(row?.activated) };
  } catch (err) {
    return { ok: false, activated: false, error: extractErrorMessage(err) };
  }
}

export async function cancelPendingOtpSession(
  sessionId: string
): Promise<{ ok: boolean; cancelled: boolean; error?: string }> {
  try {
    const { data, error } = await executeDeliveryRpc("cancel_pending_otp_session", {
      p_session_id: sessionId,
    });
    if (error) return { ok: false, cancelled: false, error: extractErrorMessage(error) };
    const row = unwrapSingleRow(data);
    return { ok: true, cancelled: Boolean(row?.cancelled) };
  } catch (err) {
    return { ok: false, cancelled: false, error: extractErrorMessage(err) };
  }
}

export interface OpenOtpSessionRecord {
  sessionId: string;
  phoneHmacKeyVersion: number;
  otpHmacKeyVersion: number;
  encKeyVersion: number;
  sessionSalt: string;
  otpHash: string | null;
  otpPayloadEnc: string | null;
  channel: "WHATSAPP" | "SMS";
  twilioMessageSid: string | null;
  attempts: number;
  expiresAt: string;
  status: OtpSessionStatus;
}

export async function getOpenOtpSessionForVerify(params: {
  phoneHashCurrent: string;
  phoneHashPrevious: string | null;
  nowIso?: string;
}): Promise<{ ok: boolean; session: OpenOtpSessionRecord | null; error?: string }> {
  try {
    const { data, error } = await executeDeliveryRpc(
      "get_open_otp_session_for_verify",
      {
        p_phone_hash_current: params.phoneHashCurrent,
        p_phone_hash_previous: params.phoneHashPrevious,
        p_now: params.nowIso || new Date().toISOString(),
      }
    );
    if (error) return { ok: false, session: null, error: extractErrorMessage(error) };
    const row = unwrapSingleRow(data);
    if (!row || typeof row.session_id !== "string") {
      return { ok: true, session: null };
    }
    return {
      ok: true,
      session: {
        sessionId: row.session_id,
        phoneHmacKeyVersion: Number(row.phone_hmac_key_version),
        otpHmacKeyVersion: Number(row.otp_hmac_key_version),
        encKeyVersion: Number(row.enc_key_version),
        sessionSalt: String(row.session_salt || ""),
        otpHash: typeof row.otp_hash === "string" ? row.otp_hash : null,
        otpPayloadEnc:
          typeof row.otp_payload_enc === "string" ? row.otp_payload_enc : null,
        channel: row.channel === "SMS" ? "SMS" : "WHATSAPP",
        twilioMessageSid:
          typeof row.twilio_message_sid === "string" ? row.twilio_message_sid : null,
        attempts: Number(row.attempts ?? 0),
        expiresAt: String(row.expires_at || ""),
        status: (row.status as OtpSessionStatus) || "pending",
      },
    };
  } catch (err) {
    return { ok: false, session: null, error: extractErrorMessage(err) };
  }
}

export interface WorkerOtpFallbackSessionRecord {
  sessionId: string;
  phoneHash: string;
  encKeyVersion: number;
  sessionSalt: string;
  otpPayloadEnc: string | null;
  status: OtpSessionStatus;
  expiresAt: string;
}

export async function getOtpSessionForWorkerFallback(params: {
  otpSessionId: string;
  nowIso?: string;
}): Promise<{
  ok: boolean;
  session: WorkerOtpFallbackSessionRecord | null;
  error?: string;
}> {
  try {
    const { data, error } = await executeDeliveryRpc(
      "get_otp_session_for_worker_fallback",
      {
        p_otp_session_id: params.otpSessionId,
        p_now: params.nowIso || new Date().toISOString(),
      }
    );
    if (error) return { ok: false, session: null, error: extractErrorMessage(error) };
    const row = unwrapSingleRow(data);
    if (!row || typeof row.session_id !== "string") {
      return { ok: true, session: null };
    }
    return {
      ok: true,
      session: {
        sessionId: row.session_id,
        phoneHash: String(row.phone_hash || ""),
        encKeyVersion: Number(row.enc_key_version ?? 1),
        sessionSalt: String(row.session_salt || ""),
        otpPayloadEnc:
          typeof row.otp_payload_enc === "string" ? row.otp_payload_enc : null,
        status: (row.status as OtpSessionStatus) || "expired",
        expiresAt: String(row.expires_at || ""),
      },
    };
  } catch (err) {
    return { ok: false, session: null, error: extractErrorMessage(err) };
  }
}

export type OtpCommitOutcome =
  | "verified"
  | "already_verified"
  | "invalid"
  | "locked"
  | "expired"
  | "conflict_retry"
  | "not_found"
  | "superseded"
  | "failed"
  | "rpc_error";

export async function commitOtpVerificationAttempt(params: {
  sessionId: string;
  expectedAttempts: number;
  matched: boolean;
  nowIso?: string;
}): Promise<{
  ok: boolean;
  outcome: OtpCommitOutcome;
  attemptsRemaining: number;
  error?: string;
}> {
  try {
    const { data, error } = await executeDeliveryRpc(
      "commit_otp_verification_attempt",
      {
        p_session_id: params.sessionId,
        p_expected_attempts: params.expectedAttempts,
        p_matched: Boolean(params.matched),
        p_now: params.nowIso || new Date().toISOString(),
      }
    );
    if (error) {
      return {
        ok: false,
        outcome: "rpc_error",
        attemptsRemaining: 0,
        error: extractErrorMessage(error),
      };
    }
    const row = unwrapSingleRow(data);
    if (!row || typeof row.outcome !== "string") {
      return { ok: false, outcome: "rpc_error", attemptsRemaining: 0, error: "empty_rpc_result" };
    }
    return {
      ok: true,
      outcome: row.outcome as OtpCommitOutcome,
      attemptsRemaining: Number(row.attempts_remaining ?? 0),
    };
  } catch (err) {
    return {
      ok: false,
      outcome: "rpc_error",
      attemptsRemaining: 0,
      error: extractErrorMessage(err),
    };
  }
}

// ============================================================================
// 2. دوال تتبع تسليم واتساب وآلة حالات الـ Worker (مطابقة حرفياً لـ Migration 012)
// ============================================================================

export async function registerWhatsappDelivery(params: {
  messageSid: string;
  messageKind: DeliveryMessageKind;
  reportId?: string | null;
  tagCode?: string | null;
  otpSessionId?: string | null;
  recipientPhone?: string;
  recipientPhoneHash?: string;
  phoneHmacKeyVersion?: number;
  smsFallbackEnabled: boolean;
  createdAtMs?: number;
  timeoutMs?: number;
}): Promise<{ ok: boolean; registered?: boolean; fallbackAfterAt?: string; error?: string }> {
  const sid = String(params.messageSid || "").trim();
  if (!sid) {
    return { ok: false, error: "invalid_message_sid" };
  }

  let phoneHash = String(params.recipientPhoneHash || "").trim().toLowerCase();
  let phoneHmacKeyVersion = params.phoneHmacKeyVersion;

  if (!phoneHash) {
    if (!params.recipientPhone) {
      return { ok: false, error: "missing_recipient_phone_or_hash" };
    }
    try {
      const computed = computePhoneHmac(params.recipientPhone, phoneHmacKeyVersion);
      phoneHash = computed.phoneHash;
      phoneHmacKeyVersion = computed.phoneHmacKeyVersion;
    } catch (err) {
      return { ok: false, error: extractErrorMessage(err) };
    }
  }

  const createdAtMs = params.createdAtMs ?? Date.now();
  const timeoutMs = params.timeoutMs ?? SMS_FALLBACK_TIMEOUT_MS;
  const fallbackAfterAt = new Date(createdAtMs + timeoutMs).toISOString();

  try {
    const { data, error } = await executeDeliveryRpc("register_whatsapp_delivery", {
      p_message_sid: sid,
      p_message_kind: params.messageKind,
      p_report_id: params.reportId ? String(params.reportId).trim() : null,
      p_tag_code: params.tagCode ? String(params.tagCode).trim().toUpperCase() : null,
      p_otp_session_id: params.otpSessionId ?? null,
      p_recipient_phone_hash: phoneHash,
      p_phone_hmac_key_version: phoneHmacKeyVersion ?? 1,
      p_sms_fallback_enabled: Boolean(params.smsFallbackEnabled),
      p_fallback_after_at: fallbackAfterAt,
    });

    if (error) {
      return { ok: false, error: extractErrorMessage(error) };
    }

    const row = unwrapSingleRow(data);
    return {
      ok: true,
      registered: row ? Boolean(row.registered) : true,
      fallbackAfterAt,
    };
  } catch (err) {
    return { ok: false, error: extractErrorMessage(err) };
  }
}

export interface DeliveryStatusUpdateResult {
  ok: boolean;
  updated: boolean;
  duplicate: boolean;
  lateDelivered: boolean;
  status: WhatsappDeliveryStatus | null;
  smsFallbackState: SmsFallbackState | null;
  error?: string;
}

export async function recordWhatsappDeliveryStatusAtomic(params: {
  messageSid: string;
  status: string;
  occurredAtIso?: string;
}): Promise<DeliveryStatusUpdateResult> {
  const sid = String(params.messageSid || "").trim();
  const normalized = normalizeStatus(params.status);
  if (!sid || !normalized) {
    return {
      ok: false,
      updated: false,
      duplicate: false,
      lateDelivered: false,
      status: null,
      smsFallbackState: null,
      error: "invalid_status_event",
    };
  }

  try {
    const { data, error } = await executeDeliveryRpc(
      "update_whatsapp_delivery_status",
      {
        p_message_sid: sid,
        p_status: normalized,
        p_occurred_at: params.occurredAtIso || new Date().toISOString(),
      }
    );

    if (error) {
      return {
        ok: false,
        updated: false,
        duplicate: false,
        lateDelivered: false,
        status: null,
        smsFallbackState: null,
        error: extractErrorMessage(error),
      };
    }

    const row = unwrapSingleRow(data);
    if (!row) {
      return {
        ok: false,
        updated: false,
        duplicate: false,
        lateDelivered: false,
        status: null,
        smsFallbackState: null,
        error: "message_not_found",
      };
    }

    return {
      ok: true,
      updated: Boolean(row.updated),
      duplicate: Boolean(row.duplicate),
      lateDelivered: Boolean(row.late_delivered),
      status: (row.status as WhatsappDeliveryStatus) || normalized,
      smsFallbackState: (row.sms_fallback_state as SmsFallbackState) || null,
    };
  } catch (err) {
    return {
      ok: false,
      updated: false,
      duplicate: false,
      lateDelivered: false,
      status: null,
      smsFallbackState: null,
      error: extractErrorMessage(err),
    };
  }
}

export interface ClaimSmsFallbackResult {
  claimed: boolean;
  reason: string;
  claimToken: string | null;
  status?: WhatsappDeliveryStatus | null;
  smsFallbackState?: SmsFallbackState | null;
}

export async function claimSmsFallbackAtomic(params: {
  messageSid: string;
  nowMs?: number;
  reason: "timeout_60s" | "twilio_failed" | "user_requested_sms";
  leaseSeconds?: number;
}): Promise<ClaimSmsFallbackResult> {
  const sid = String(params.messageSid || "").trim();
  if (!sid) {
    return { claimed: false, reason: "invalid_message_sid", claimToken: null };
  }

  const nowIso = new Date(params.nowMs ?? Date.now()).toISOString();
  const leaseSeconds = params.leaseSeconds ?? SMS_CLAIM_LEASE_SECONDS;

  try {
    const { data, error } = await executeDeliveryRpc(
      "claim_sms_fallback_delivery",
      {
        p_message_sid: sid,
        p_now: nowIso,
        p_reason: params.reason,
        p_lease_seconds: leaseSeconds,
      }
    );

    if (error) {
      return { claimed: false, reason: "rpc_error_fail_closed", claimToken: null };
    }

    const row = unwrapSingleRow(data);
    if (!row) {
      return { claimed: false, reason: "not_found", claimToken: null };
    }

    return {
      claimed: Boolean(row.claimed),
      reason: String(row.reason || (row.claimed ? "claimed" : "not_eligible")),
      claimToken: typeof row.claim_token === "string" ? row.claim_token : null,
      status: (row.status as WhatsappDeliveryStatus) || null,
      smsFallbackState: (row.sms_fallback_state as SmsFallbackState) || null,
    };
  } catch {
    return { claimed: false, reason: "rpc_exception_fail_closed", claimToken: null };
  }
}

export interface ClaimedDueFallbackItem {
  messageSid: string;
  messageKind: DeliveryMessageKind;
  reportId: string | null;
  tagCode: string | null;
  otpSessionId: string | null;
  phoneHmacKeyVersion: number;
  claimToken: string;
  claimExpiresAt: string;
}

export async function claimDueWhatsappFallbacks(params?: {
  nowMs?: number;
  limit?: number;
  leaseSeconds?: number;
}): Promise<{ ok: boolean; items: ClaimedDueFallbackItem[]; error?: string }> {
  try {
    const { data, error } = await executeDeliveryRpc(
      "claim_due_whatsapp_fallbacks",
      {
        p_now: new Date(params?.nowMs ?? Date.now()).toISOString(),
        p_limit: params?.limit ?? 20,
        p_lease_seconds: params?.leaseSeconds ?? SMS_CLAIM_LEASE_SECONDS,
      }
    );
    if (error) return { ok: false, items: [], error: extractErrorMessage(error) };

    const items: ClaimedDueFallbackItem[] = unwrapRows(data)
      .filter(
        (r) => typeof r.message_sid === "string" && typeof r.claim_token === "string"
      )
      .map((r) => ({
        messageSid: String(r.message_sid),
        messageKind: r.message_kind === "otp" ? "otp" : "notification",
        reportId: typeof r.report_id === "string" ? r.report_id : null,
        tagCode: typeof r.tag_code === "string" ? r.tag_code : null,
        otpSessionId: typeof r.otp_session_id === "string" ? r.otp_session_id : null,
        phoneHmacKeyVersion: Number(r.phone_hmac_key_version ?? 1),
        claimToken: String(r.claim_token),
        claimExpiresAt: String(r.claim_expires_at || ""),
      }));

    return { ok: true, items };
  } catch (err) {
    return { ok: false, items: [], error: extractErrorMessage(err) };
  }
}

/**
 * الانتقال الذري الإلزامي: claimed -> sending قبل الاتصال بـ Resala مباشرة
 */
export async function transitionSmsClaimToSendingAtomic(params: {
  messageSid: string;
  claimToken: string;
  nowMs?: number;
}): Promise<{ canSend: boolean; reason: string }> {
  const sid = String(params.messageSid || "").trim();
  const token = String(params.claimToken || "").trim();
  if (!sid || !token) {
    return { canSend: false, reason: "invalid_claim_params" };
  }

  try {
    const { data, error } = await executeDeliveryRpc(
      "transition_sms_claim_to_sending",
      {
        p_message_sid: sid,
        p_claim_token: token,
        p_now: new Date(params.nowMs ?? Date.now()).toISOString(),
      }
    );
    if (error) return { canSend: false, reason: "rpc_error_fail_closed" };
    const row = unwrapSingleRow(data);
    if (!row) return { canSend: false, reason: "not_found" };
    return {
      canSend: Boolean(row.can_send),
      reason: String(row.reason || (row.can_send ? "sending" : "blocked")),
    };
  } catch {
    return { canSend: false, reason: "rpc_exception_fail_closed" };
  }
}

export async function completeSmsFallbackAtomic(params: {
  messageSid: string;
  claimToken: string;
  finalState: SmsFinalState;
  smsProviderId?: string | null;
  error?: string | null;
  nowMs?: number;
}): Promise<{
  ok: boolean;
  completed: boolean;
  smsFallbackState?: SmsFallbackState | null;
  lateCancelled?: boolean;
}> {
  const sid = String(params.messageSid || "").trim();
  const token = String(params.claimToken || "").trim();
  if (!sid || !token) return { ok: false, completed: false };

  try {
    const { data, error } = await executeDeliveryRpc(
      "complete_sms_fallback_delivery",
      {
        p_message_sid: sid,
        p_claim_token: token,
        p_final_state: params.finalState,
        p_sms_provider_id: params.smsProviderId ? String(params.smsProviderId).trim() : null,
        p_error: params.error ? String(params.error).slice(0, 300) : null,
        p_now: new Date(params.nowMs ?? Date.now()).toISOString(),
      }
    );
    if (error) return { ok: false, completed: false };
    const row = unwrapSingleRow(data);
    return {
      ok: true,
      completed: Boolean(row?.completed),
      smsFallbackState: (row?.sms_fallback_state as SmsFallbackState) || null,
      lateCancelled: Boolean(row?.late_cancelled),
    };
  } catch {
    return { ok: false, completed: false };
  }
}

export async function reconcileStaleWhatsappClaims(params?: {
  nowMs?: number;
  cleanupExpired?: boolean;
}): Promise<{
  ok: boolean;
  abandonedCount: number;
  purgedTrackingCount: number;
  purgedOtpCount: number;
  error?: string;
}> {
  try {
    const { data, error } = await executeDeliveryRpc(
      "reconcile_stale_whatsapp_claims",
      {
        p_now: new Date(params?.nowMs ?? Date.now()).toISOString(),
        p_cleanup_expired: Boolean(params?.cleanupExpired),
      }
    );
    if (error) {
      return {
        ok: false,
        abandonedCount: 0,
        purgedTrackingCount: 0,
        purgedOtpCount: 0,
        error: extractErrorMessage(error),
      };
    }
    const row = unwrapSingleRow(data);
    return {
      ok: true,
      abandonedCount: Number(row?.abandoned_count ?? 0),
      purgedTrackingCount: Number(row?.purged_tracking_count ?? 0),
      purgedOtpCount: Number(row?.purged_otp_count ?? 0),
    };
  } catch (err) {
    return {
      ok: false,
      abandonedCount: 0,
      purgedTrackingCount: 0,
      purgedOtpCount: 0,
      error: extractErrorMessage(err),
    };
  }
}

export async function checkKeyVersionActiveUsage(keyVersion: number): Promise<{
  ok: boolean;
  openOtpSessionsCount: number;
  activeDeliveriesCount: number;
  safeToRetire: boolean;
  error?: string;
}> {
  try {
    const { data, error } = await executeDeliveryRpc(
      "check_key_version_active_usage",
      { p_key_version: keyVersion }
    );
    if (error) {
      return {
        ok: false,
        openOtpSessionsCount: -1,
        activeDeliveriesCount: -1,
        safeToRetire: false,
        error: extractErrorMessage(error),
      };
    }
    const row = unwrapSingleRow(data);
    if (!row) {
      return {
        ok: false,
        openOtpSessionsCount: -1,
        activeDeliveriesCount: -1,
        safeToRetire: false,
        error: "empty_rpc_result",
      };
    }
    return {
      ok: true,
      openOtpSessionsCount: Number(row.open_otp_sessions_count ?? 0),
      activeDeliveriesCount: Number(row.active_deliveries_count ?? 0),
      safeToRetire: Boolean(row.safe_to_retire),
    };
  } catch (err) {
    return {
      ok: false,
      openOtpSessionsCount: -1,
      activeDeliveriesCount: -1,
      safeToRetire: false,
      error: extractErrorMessage(err),
    };
  }
}

/**
 * منسّق موحّد كامل لآلة الحالات:
 *   queued -> claimed (claimToken + lease 120s) -> sending -> Resala -> sent | failed | skipped | abandoned_unknown
 */
export async function dispatchSmsFallbackWithAtomicClaim(params: {
  messageSid: string;
  nowMs?: number;
  reason: "timeout_60s" | "twilio_failed" | "user_requested_sms";
  leaseSeconds?: number;
  sendSms: () => Promise<SmsProviderDispatchResponse>;
}): Promise<{
  claimed: boolean;
  claimToken: string | null;
  smsDispatched: boolean;
  smsOk: boolean;
  finalState: SmsFinalState | null;
  lateCancelled: boolean;
  reason: string;
  error?: string;
}> {
  const nowMs = params.nowMs ?? Date.now();
  const claim = await claimSmsFallbackAtomic({
    messageSid: params.messageSid,
    nowMs,
    reason: params.reason,
    leaseSeconds: params.leaseSeconds,
  });

  if (!claim.claimed || !claim.claimToken) {
    return {
      claimed: false,
      claimToken: null,
      smsDispatched: false,
      smsOk: false,
      finalState: null,
      lateCancelled: false,
      reason: claim.reason,
    };
  }

  // الانتقال الذري الإلزامي claimed -> sending مباشرة قبل استدعاء Resala
  const gate = await transitionSmsClaimToSendingAtomic({
    messageSid: params.messageSid,
    claimToken: claim.claimToken,
    nowMs,
  });

  if (!gate.canSend) {
    return {
      claimed: true,
      claimToken: claim.claimToken,
      smsDispatched: false,
      smsOk: false,
      finalState: gate.reason.includes("delivered") || gate.reason.includes("cancelled") ? "skipped" : null,
      lateCancelled: false,
      reason: gate.reason,
    };
  }

  let smsRes: SmsProviderDispatchResponse;
  try {
    smsRes = await params.sendSms();
  } catch (err) {
    const errObj = err as { name?: string; code?: string; message?: string };
    smsRes = {
      ok: false,
      timedOut: errObj?.name === "AbortError",
      networkErrorCode: errObj?.code,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const finalState = classifyResalaDispatchOutcome(smsRes);
  const comp = await completeSmsFallbackAtomic({
    messageSid: params.messageSid,
    claimToken: claim.claimToken,
    finalState,
    smsProviderId: smsRes.id || null,
    error: smsRes.ok ? null : smsRes.error || finalState,
    nowMs,
  });

  return {
    claimed: true,
    claimToken: claim.claimToken,
    smsDispatched: true,
    smsOk: smsRes.ok,
    finalState,
    lateCancelled: Boolean(comp.lateCancelled),
    reason: comp.completed ? finalState : "complete_rejected_stale_claim",
    ...(smsRes.error ? { error: smsRes.error } : {}),
  };
}
