import { supabaseAdmin } from "@/lib/supabase/client";
import { verifyReportAccessToken } from "@/lib/security-tokens";

// ============================================================================
// إلغاء رموز الوصول للبلاغات بشكل موزّع عبر PostgreSQL (Multi-Instance Safe)
// لا يعتمد على الذاكرة المحلية (Map)؛ يتم التحقق من قاعدة البيانات في كل نسخة خادم
// ============================================================================

export type TokenRevocationRpcExecutor = (
  fnName: "revoke_report_token" | "is_report_token_revoked",
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: unknown }>;

let customRevocationRpcExecutor: TokenRevocationRpcExecutor | null = null;

/**
 * حقن منفّذ RPC للاختبارات المحلية متعددة النسخ فقط
 */
export function setTokenRevocationRpcExecutorForTest(
  executor: TokenRevocationRpcExecutor | null
): void {
  customRevocationRpcExecutor = executor;
}

async function runRevocationRpc(
  fnName: "revoke_report_token" | "is_report_token_revoked",
  args: Record<string, unknown>
): Promise<{ data: unknown; error: unknown }> {
  if (customRevocationRpcExecutor) {
    return customRevocationRpcExecutor(fnName, args);
  }
  return supabaseAdmin.rpc(fnName, args);
}

/**
 * تسجيل إلغاء التوكن في قاعدة البيانات (مربوط بـ jti وreportId ووقت الانتهاء)
 */
export async function revokeReportAccessTokenDistributed(
  token: string,
  expectedReportId: string,
  expectedTagCode?: string
): Promise<{ ok: boolean; jti?: string; error?: string }> {
  const check = verifyReportAccessToken(token, expectedReportId, expectedTagCode);
  if (!check.valid || !check.payload || !check.payload.jti) {
    return {
      ok: false,
      error: check.reason || "invalid_token",
    };
  }

  try {
    const { error } = await runRevocationRpc("revoke_report_token", {
      p_jti: check.payload.jti,
      p_report_id: check.payload.reportId,
      p_expires_at: new Date(check.payload.exp).toISOString(),
    });
    if (error) {
      return {
        ok: false,
        error: "db_revocation_failed",
      };
    }
    return { ok: true, jti: check.payload.jti };
  } catch {
    return { ok: false, error: "db_revocation_exception" };
  }
}

/**
 * التحقق الموزّع من إلغاء التوكن عبر قاعدة البيانات (Fail-Closed عند فشل التحقق)
 */
export async function verifyReportAccessTokenDistributed(
  token: string | null | undefined,
  expectedReportId: string,
  expectedTagCode?: string
): Promise<{
  valid: boolean;
  reason?: string;
  jti?: string;
}> {
  const check = verifyReportAccessToken(token, expectedReportId, expectedTagCode);
  if (!check.valid || !check.payload || !check.payload.jti) {
    return { valid: false, reason: check.reason || "invalid_token" };
  }

  try {
    const { data, error } = await runRevocationRpc("is_report_token_revoked", {
      p_jti: check.payload.jti,
      p_report_id: check.payload.reportId,
    });
    if (error) {
      // سياسة Fail-Closed: إذا تعذر التحقق من جدول الإلغاء، نرفض الوصول حفاظاً على الخصوصية
      return { valid: false, reason: "revocation_check_unavailable" };
    }
    if (data === true) {
      return { valid: false, reason: "revoked", jti: check.payload.jti };
    }
    return { valid: true, jti: check.payload.jti };
  } catch {
    return { valid: false, reason: "revocation_check_unavailable" };
  }
}
