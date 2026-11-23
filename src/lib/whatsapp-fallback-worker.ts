import crypto from "crypto";
import type { NextRequest } from "next/server";
import { getVehicleTagByCode, supabaseAdmin } from "@/lib/supabase/client";
import {
  sendOtpViaResalaTemplate,
  sendSmsAlertMessage,
} from "@/lib/otp-service";
import { decryptOtpPayload } from "@/lib/otp-crypto";
import {
  SMS_CLAIM_LEASE_SECONDS,
  claimDueWhatsappFallbacks,
  classifyResalaDispatchOutcome,
  completeSmsFallbackAtomic,
  getOtpSessionForWorkerFallback,
  reconcileStaleWhatsappClaims,
  transitionSmsClaimToSendingAtomic,
  type SmsProviderDispatchResponse,
} from "@/lib/delivery-fallback";

// ============================================================================
// منطق الـ Worker المستقل لمعالجة تحويل رسائل WhatsApp غير المؤكدة إلى SMS بعد 60 ثانية
// - محمي إلزامياً بـ CRON_SECRET عبر crypto.timingSafeEqual (Fail-Closed)
// - لا يعتمد على بقاء صفحة المواطن مفتوحة أو وصول طلب من المتصفح
// - يستخدم الحجز الذري الموزّع (FOR UPDATE SKIP LOCKED + claim_token + lease 120s)
// - ينفّذ الانتقال الذري claimed -> sending قبل أي نداء خارجي لـ Resala
// - لا يطبع أي أرقام هواتف أو رموز OTP أو أسرار في السجلات
// ============================================================================

const DEFAULT_BATCH_LIMIT = 20;
const WORKER_TIME_BUDGET_MS = 45_000;

export function verifyWorkerCronAuthorization(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim() || "";
  if (!cronSecret) {
    return false;
  }
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!bearer) {
    return false;
  }
  const a = Buffer.from(bearer, "utf8");
  const b = Buffer.from(cronSecret, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export interface WorkerCycleStats {
  ok: boolean;
  reconciledAbandoned: number;
  purgedTracking: number;
  purgedOtp: number;
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  abandonedUnknown: number;
  lateCancelled: number;
  budgetStopped: boolean;
  error?: string;
}

export interface WorkerCycleDependencies {
  sendOtpSms?: (phone: string, otpCode: string) => Promise<SmsProviderDispatchResponse>;
  sendNotificationSms?: (params: {
    reportId: string | null;
    tagCode: string | null;
  }) => Promise<SmsProviderDispatchResponse | { skip: true; reason: string }>;
}

async function defaultSendNotificationSms(params: {
  reportId: string | null;
  tagCode: string | null;
}): Promise<SmsProviderDispatchResponse | { skip: true; reason: string }> {
  const tagCode = String(params.tagCode || "").trim().toUpperCase();
  const reportId = String(params.reportId || "").trim();
  if (!tagCode || !reportId) {
    return { skip: true, reason: "missing_report_or_tag" };
  }

  const tagRecord = await getVehicleTagByCode(tagCode);
  if (!tagRecord || !tagRecord.ownerPhone) {
    return { skip: true, reason: "missing_owner_phone" };
  }

  const isBasic =
    tagRecord.planType === "basic" ||
    tagRecord.packageType === "basic" ||
    tagRecord.alertChannel === "WHATSAPP";
  if (isBasic) {
    return { skip: true, reason: "basic_plan_no_sms_fallback" };
  }

  const { data: reportRow } = await supabaseAdmin
    .from("reports")
    .select("id, reason_title, message, reason_badge, owner_reply, created_at")
    .eq("id", reportId)
    .maybeSingle();

  if (!reportRow) {
    return { skip: true, reason: "report_not_found" };
  }

  const badge = String(reportRow.reason_badge || "");
  if (
    reportRow.owner_reply ||
    badge.includes("تم التسليم") ||
    badge.includes("تمت القراءة") ||
    badge.includes("SMS")
  ) {
    return { skip: true, reason: "report_already_delivered_or_sms_sent" };
  }

  const createdMs = reportRow.created_at
    ? new Date(String(reportRow.created_at)).getTime()
    : 0;
  if (!createdMs || Date.now() - createdMs > 24 * 60 * 60 * 1000) {
    return { skip: true, reason: "report_expired_24h" };
  }

  const vehicleLabel =
    [tagRecord.vehicleBrand, tagRecord.vehicleModel].filter(Boolean).join(" ") ||
    tagCode;
  const smsRes = await sendSmsAlertMessage(
    tagRecord.ownerPhone,
    vehicleLabel,
    String(reportRow.reason_title || "تنبيه عاجل بخصوص مركبتك"),
    String(
      reportRow.message ||
        "يرجى التوجه لمركبتك ومراجعة البلاغ الوارد عبر منصة بَلِّغْنِي."
    )
  );

  if (smsRes.ok && !reportId.startsWith("rep_")) {
    await supabaseAdmin
      .from("reports")
      .update({ reason_badge: "تم الإشعار عبر SMS (بديل تلقائي)" })
      .eq("id", reportId);
  }

  return {
    ok: smsRes.ok,
    id: smsRes.id,
    httpStatus: smsRes.status,
    timedOut: smsRes.timedOut,
    networkErrorCode: smsRes.networkErrorCode,
    error: smsRes.error,
  };
}

/**
 * دورة تشغيل واحدة للـ Worker المستقل (قابلة للاختبار المعزول دون خادم HTTP)
 */
export async function runWhatsappFallbackWorkerCycle(options?: {
  nowMs?: number;
  batchLimit?: number;
  timeBudgetMs?: number;
  cleanupExpired?: boolean;
  deps?: WorkerCycleDependencies;
}): Promise<WorkerCycleStats> {
  const startedAt = Date.now();
  const nowMs = options?.nowMs ?? startedAt;
  const batchLimit = Math.min(Math.max(options?.batchLimit ?? DEFAULT_BATCH_LIMIT, 1), 50);
  const timeBudgetMs = options?.timeBudgetMs ?? WORKER_TIME_BUDGET_MS;

  const stats: WorkerCycleStats = {
    ok: true,
    reconciledAbandoned: 0,
    purgedTracking: 0,
    purgedOtp: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    abandonedUnknown: 0,
    lateCancelled: 0,
    budgetStopped: false,
  };

  // 1. استعادة الحجوزات المنتهية (>120s) إلى abandoned_unknown وإبطال OTP المنتهية
  const reconciled = await reconcileStaleWhatsappClaims({
    nowMs,
    cleanupExpired: Boolean(options?.cleanupExpired),
  });
  if (!reconciled.ok) {
    return { ...stats, ok: false, error: reconciled.error || "reconcile_failed" };
  }
  stats.reconciledAbandoned = reconciled.abandonedCount;
  stats.purgedTracking = reconciled.purgedTrackingCount;
  stats.purgedOtp = reconciled.purgedOtpCount;

  // 2. الحجز الذري الدفعي للرسائل المستحقة (FOR UPDATE SKIP LOCKED)
  const claimedRes = await claimDueWhatsappFallbacks({
    nowMs,
    limit: batchLimit,
    leaseSeconds: SMS_CLAIM_LEASE_SECONDS,
  });
  if (!claimedRes.ok) {
    return { ...stats, ok: false, error: claimedRes.error || "claim_due_failed" };
  }

  stats.claimed = claimedRes.items.length;
  const sendOtpSms = options?.deps?.sendOtpSms ?? sendOtpViaResalaTemplate;
  const sendNotificationSms =
    options?.deps?.sendNotificationSms ?? defaultSendNotificationSms;

  // 3. معالجة كل رسالة محجوزة ضمن الميزانية الزمنية
  for (const item of claimedRes.items) {
    if (Date.now() - startedAt >= timeBudgetMs) {
      stats.budgetStopped = true;
      break;
    }

    // الانتقال الذري الإلزامي claimed -> sending قبل أي اتصال خارجي
    const gate = await transitionSmsClaimToSendingAtomic({
      messageSid: item.messageSid,
      claimToken: item.claimToken,
      nowMs: options?.nowMs ?? Date.now(),
    });

    if (!gate.canSend) {
      stats.skipped += 1;
      continue;
    }

    let smsOutcomeRes: SmsProviderDispatchResponse;

    if (item.messageKind === "otp") {
      if (!item.otpSessionId) {
        await completeSmsFallbackAtomic({
          messageSid: item.messageSid,
          claimToken: item.claimToken,
          finalState: "skipped",
          error: "missing_otp_session_id",
          nowMs: options?.nowMs ?? Date.now(),
        });
        stats.skipped += 1;
        continue;
      }

      const sessLookup = await getOtpSessionForWorkerFallback({
        otpSessionId: item.otpSessionId,
        nowIso: new Date(options?.nowMs ?? Date.now()).toISOString(),
      });

      const sess = sessLookup.session;
      const nowCheck = options?.nowMs ?? Date.now();
      if (
        !sessLookup.ok ||
        !sess ||
        (sess.status !== "pending" && sess.status !== "active") ||
        new Date(sess.expiresAt).getTime() <= nowCheck ||
        !sess.otpPayloadEnc
      ) {
        await completeSmsFallbackAtomic({
          messageSid: item.messageSid,
          claimToken: item.claimToken,
          finalState: "skipped",
          error: "otp_session_inactive_or_expired",
          nowMs: nowCheck,
        });
        stats.skipped += 1;
        continue;
      }

      let decrypted: { phone: string; otp: string };
      try {
        decrypted = decryptOtpPayload({
          ciphertext: sess.otpPayloadEnc,
          phoneHash: sess.phoneHash,
          sessionSalt: sess.sessionSalt,
          encKeyVersion: sess.encKeyVersion,
        });
      } catch {
        await completeSmsFallbackAtomic({
          messageSid: item.messageSid,
          claimToken: item.claimToken,
          finalState: "failed",
          error: "otp_payload_decrypt_failed",
          nowMs: nowCheck,
        });
        stats.failed += 1;
        continue;
      }

      try {
        smsOutcomeRes = await sendOtpSms(decrypted.phone, decrypted.otp);
      } catch (err) {
        const e = err as { name?: string; code?: string; message?: string };
        smsOutcomeRes = {
          ok: false,
          timedOut: e?.name === "AbortError",
          networkErrorCode: e?.code,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      let notifRes: SmsProviderDispatchResponse | { skip: true; reason: string };
      try {
        notifRes = await sendNotificationSms({
          reportId: item.reportId,
          tagCode: item.tagCode,
        });
      } catch (err) {
        const e = err as { name?: string; code?: string; message?: string };
        notifRes = {
          ok: false,
          timedOut: e?.name === "AbortError",
          networkErrorCode: e?.code,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      if ("skip" in notifRes && notifRes.skip) {
        await completeSmsFallbackAtomic({
          messageSid: item.messageSid,
          claimToken: item.claimToken,
          finalState: "skipped",
          error: notifRes.reason,
          nowMs: options?.nowMs ?? Date.now(),
        });
        stats.skipped += 1;
        continue;
      }
      smsOutcomeRes = notifRes as SmsProviderDispatchResponse;
    }

    const finalState = classifyResalaDispatchOutcome(smsOutcomeRes);
    const completed = await completeSmsFallbackAtomic({
      messageSid: item.messageSid,
      claimToken: item.claimToken,
      finalState,
      smsProviderId: smsOutcomeRes.id || null,
      error: smsOutcomeRes.ok ? null : smsOutcomeRes.error || finalState,
      nowMs: options?.nowMs ?? Date.now(),
    });

    if (completed.lateCancelled) {
      stats.lateCancelled += 1;
    }

    if (finalState === "sent") stats.sent += 1;
    else if (finalState === "failed") stats.failed += 1;
    else if (finalState === "abandoned_unknown") stats.abandonedUnknown += 1;
    else stats.skipped += 1;
  }

  return stats;
}
