// =============================================================================
// بَلِّغْنِي | BALAGHNI — حارس بيئة الاختبار الخادمي (Server-Side Test Env Guard)
// يمنع الاتصال بأي مشروع Supabase غير مشروع الاختبار المعتمد عند تفعيل وضع الحماية.
// يعتمد حصراً على متغيرات بيئة الخادم ولا يمكن للعميل تجاوزه.
// =============================================================================

export const ALLOWED_TEST_SUPABASE_PROJECT_REF = "yemhfpfdinmixhbfszvq";
export const FORBIDDEN_PROD_SUPABASE_PROJECT_REF = "aivxhxnvgqxylugqrjei";

/**
 * استخراج معرّف مشروع Supabase (Project Ref) من رابط المشروع الفعلي.
 */
export function extractSupabaseProjectRef(rawUrl?: string | null): string | null {
  const value = String(rawUrl || "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const match = host.match(/^([a-z0-9]{12,32})\.supabase\.co$/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * يتحقق مما إذا كان حارس بيئة الاختبار الصارم مفعّلاً على الخادم.
 * يُقرأ من process.env فقط ولا يقبل أي تجاوز من العميل.
 */
export function isStrictTestSupabaseGuardEnabled(): boolean {
  return (
    String(process.env.BALAGHNI_STRICT_TEST_SUPABASE_GUARD || "")
      .trim()
      .toLowerCase() === "true"
  );
}

/**
 * يفحص رابط Supabase الفعلي ويمنع فوراً أي اتصال بغير مشروع الاختبار المحدد
 * عند تفعيل BALAGHNI_STRICT_TEST_SUPABASE_GUARD=true أو عند طلب الإنفاذ الصريح.
 */
export function assertTestSupabaseTarget(
  rawUrl: string | undefined | null,
  options?: {
    context?: string;
    forceEnforce?: boolean;
  }
): { guarded: boolean; projectRef: string | null } {
  const shouldEnforce =
    Boolean(options?.forceEnforce) || isStrictTestSupabaseGuardEnabled();
  const normalizedUrl = String(rawUrl || "").trim();
  const projectRef = extractSupabaseProjectRef(normalizedUrl);
  const ctx = options?.context || "supabase_connection";

  if (!shouldEnforce) {
    return { guarded: false, projectRef };
  }

  if (
    normalizedUrl
      .toLowerCase()
      .includes(FORBIDDEN_PROD_SUPABASE_PROJECT_REF)
  ) {
    throw new Error(
      `TEST_ENV_GUARD_BLOCKED [${ctx}]: تم رفض الاتصال فوراً لوجود معرّف مشروع الإنتاج المحظور.`
    );
  }

  if (!projectRef || projectRef !== ALLOWED_TEST_SUPABASE_PROJECT_REF) {
    throw new Error(
      `TEST_ENV_GUARD_BLOCKED [${ctx}]: يُسمح في وضع الاختبار بالاتصال حصراً بمشروع الاختبار (${ALLOWED_TEST_SUPABASE_PROJECT_REF})، بينما الرابط الحالي يشير إلى (${projectRef || "غير معروف"}).`
    );
  }

  return { guarded: true, projectRef };
}

/**
 * يتحقق من أن مزودي الرسائل الخارجيين معطلون في بيئة الاختبار.
 */
export function checkExternalMessagingDisabled(): {
  allDisabled: boolean;
  activeProviders: string[];
} {
  const activeProviders: string[] = [];

  const whatsappMode = String(process.env.WHATSAPP_ACTIVE_PROVIDER || "")
    .trim()
    .toLowerCase();
  if (whatsappMode && whatsappMode !== "disabled" && whatsappMode !== "none" && whatsappMode !== "off") {
    activeProviders.push(`WHATSAPP_ACTIVE_PROVIDER=${whatsappMode}`);
  }
  if ((process.env.TWILIO_ACCOUNT_SID || "").trim() || (process.env.TWILIO_AUTH_TOKEN || "").trim()) {
    activeProviders.push("TWILIO");
  }
  if ((process.env.RESALA_API_KEY || "").trim()) {
    activeProviders.push("RESALA");
  }
  if ((process.env.GREEN_API_TOKEN || "").trim() || (process.env.GREEN_API_INSTANCE_ID || "").trim()) {
    activeProviders.push("GREEN_API");
  }
  if ((process.env.META_WHATSAPP_ACCESS_TOKEN || "").trim()) {
    activeProviders.push("META_WHATSAPP");
  }

  return {
    allDisabled: activeProviders.length === 0,
    activeProviders,
  };
}
