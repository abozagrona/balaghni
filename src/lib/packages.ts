export type PackageType = "basic" | "nabbihni" | "elite";

export interface PackageFeatures {
  whatsapp: boolean;
  sms_fallback: boolean;
  nabbihni_reminders: boolean;
  photo_attachments: boolean;
  emergency_portal: boolean;
}

export interface PackageDefinition {
  id: PackageType;
  name: string;
  badge?: string;
  priceLyd: number | null;
  oldPriceLyd?: number | null;
  period: string;
  headerText?: string;
  subheaderText?: string;
  description: string;
  ctaLabel: string;
  featured?: boolean;
  featuresList: string[];
  permissions: PackageFeatures;
}

export const BASIC_FEATURES: PackageFeatures = {
  whatsapp: true,
  sms_fallback: false,
  nabbihni_reminders: false,
  photo_attachments: false,
  emergency_portal: false,
};

export const NABBIHNI_FEATURES: PackageFeatures = {
  whatsapp: true,
  sms_fallback: true,
  nabbihni_reminders: true,
  photo_attachments: true,
  emergency_portal: true,
};

export const PACKAGES: Record<PackageType, PackageDefinition> = {
  basic: {
    id: "basic",
    name: "الباقة الأساسية",
    priceLyd: 50,
    oldPriceLyd: 75,
    period: "سنوياً",
    description:
      "مثالية للاستخدام اليومي داخل المدينة مع حماية كاملة لخصوصية رقمك.",
    ctaLabel: "اطلب الباقة الأساسية",
    featured: false,
    featuresList: [
      "ملصق «بَلِّغْنِي» الأصلي المقاوم للشمس والماء",
      "استلام التنبيهات عبر واتساب",
      "إخفاء تام لرقم هاتفك عن الماسحين",
      "كود تعريفي ليبي خاص (مثال: LY-123456)",
    ],
    permissions: BASIC_FEATURES,
  },
  nabbihni: {
    id: "nabbihni",
    name: "باقة نَبِّهْنِي",
    badge: "الأكثر طلباً في ليبيا",
    priceLyd: 100,
    oldPriceLyd: 150,
    period: "سنوياً",
    description:
      "تغطية مزدوجة تضمن وصول التنبيه حتى بدون إنترنت، مع تذكير بمواعيد سيارتك وأمان لعائلتك.",
    ctaLabel: "اطلب باقة نَبِّهْنِي",
    featured: true,
    featuresList: [
      "استلام التنبيهات عبر SMS + واتساب",
      "خدمة «نَبِّهْنِي» الذكية: تذكير تلقائي بمواعيد التأمين، رخصة القيادة، الفحص الفني، وتغيير الزيت",
      "إرفاق صور توضيحية مع البلاغ",
      "حماية ذكية ضد الإزعاج والرسائل غير اللائقة",
      "بوابة طوارئ لإبلاغ 3 من أفراد عائلتك عند الحوادث",
      "أولوية قصوى في توصيل الإشعارات الفورية",
    ],
    permissions: NABBIHNI_FEATURES,
  },
  elite: {
    id: "elite",
    name: "باقة إيليت للشركات",
    priceLyd: null,
    oldPriceLyd: null,
    period: "سنوياً",
    headerText: "تسعير مخصص",
    subheaderText: "لأسطول 10 سيارات فأكثر",
    description:
      "صمّم باقتك حسب حجم أسطولك، واختر المزايا التي تحتاجها شركتك فقط بسعر تنافسي.",
    ctaLabel: "خصّص باقتك",
    featured: false,
    featuresList: [
      "إمكانية تفصيل المزايا حسب الطلب (واتساب فقط، أو SMS + واتساب، أو خدمة «نَبِّهْنِي»)",
      "إدارة جميع سيارات الشركة وملصقاتها من حساب واحد موحّد",
      "ربط تنبيهات كل سيارة بالسائق أو بمسؤول الحركة مباشرة",
      "خصومات خاصة على الكميات لأساطيل 10 سيارات فأكثر",
      "مدير حساب مخصص لمتابعة وتفعيل ونقل ملصقات الأسطول بسرعة",
    ],
    permissions: NABBIHNI_FEATURES,
  },
};

export const CORPORATE_FEATURE_OPTIONS = [
  { id: "whatsapp", label: "تنبيهات واتساب" },
  { id: "sms_and_whatsapp", label: "SMS + واتساب" },
  { id: "nabbihni_reminders", label: "خدمة نَبِّهْنِي" },
  { id: "emergency_portal", label: "بوابة طوارئ الحوادث" },
  { id: "central_reports", label: "تقارير دورية وإدارة مركزية" },
] as const;

export type PlanType = "basic" | "nabbihni" | "gift";

export function resolvePlanType(params: {
  planType?: string | null;
  packageType?: string | null;
  activationSource?: string | null;
  notificationChannel?: string | null;
  defaultPlan?: PlanType;
}): PlanType {
  const rawPlan = String(params.planType || "").trim().toLowerCase();
  if (rawPlan === "gift" || rawPlan === "gift_promo" || rawPlan === "free_month") {
    return "gift";
  }
  if (rawPlan === "basic" || rawPlan === "standard") {
    return "basic";
  }
  if (rawPlan === "nabbihni" || rawPlan === "premium" || rawPlan === "elite") {
    return "nabbihni";
  }

  const src = String(params.activationSource || "").trim().toLowerCase();
  if (src === "gift_promo" || src === "gift") {
    return "gift";
  }

  const rawPkg = String(params.packageType || "").trim().toLowerCase();
  if (rawPkg === "gift" || rawPkg === "gift_promo") {
    return "gift";
  }
  if (rawPkg === "basic" || rawPkg === "standard") {
    return "basic";
  }
  if (rawPkg === "nabbihni" || rawPkg === "premium" || rawPkg === "elite") {
    return "nabbihni";
  }

  const ch = String(params.notificationChannel || "").trim().toUpperCase();
  if (ch === "WHATSAPP") {
    return "basic";
  }
  if (ch === "SMS") {
    return "gift";
  }
  if (ch === "BOTH") {
    return "nabbihni";
  }

  return params.defaultPlan || "basic";
}

export function getPlanDisplayInfo(planType: PlanType): {
  planType: PlanType;
  badgeText: string;
  dashboardTitle: string;
  packageName: string;
} {
  if (planType === "gift") {
    return {
      planType: "gift",
      badgeText: "🎁 باقة هدية (شهر مجاني)",
      dashboardTitle: "لوحة تحكم مركبتي — الباقة التجريبية المجانية",
      packageName: "باقة الهدية (شهر مجاني)",
    };
  }
  if (planType === "nabbihni") {
    return {
      planType: "nabbihni",
      badgeText: "✨ باقة نَبِّهْنِي",
      dashboardTitle: "لوحة تحكم مركبتي وخدمة «نَبِّهْنِي»",
      packageName: "باقة نَبِّهْنِي",
    };
  }
  return {
    planType: "basic",
    badgeText: "الباقة الأساسية",
    dashboardTitle: "لوحة تحكم مركبتي — الباقة الأساسية",
    packageName: "الباقة الأساسية",
  };
}

export function normalizePackageType(raw?: string | null): PackageType {
  const val = String(raw || "").trim().toLowerCase();
  if (val === "basic" || val === "standard") return "basic";
  if (val === "elite" || val === "corporate") return "elite";
  if (val === "nabbihni" || val === "premium" || val === "gift" || val === "gift_promo") {
    return "nabbihni";
  }
  return "basic";
}

export function getPackageConfig(raw?: string | null): PackageDefinition {
  return PACKAGES[normalizePackageType(raw)];
}

export function getDefaultFeaturesForPackage(
  raw?: string | null
): PackageFeatures {
  const val = String(raw || "").trim().toLowerCase();
  if (val === "gift" || val === "gift_promo" || val === "nabbihni" || val === "elite" || val === "corporate") {
    return { ...NABBIHNI_FEATURES };
  }
  const pkg = normalizePackageType(raw);
  if (pkg === "basic") return { ...BASIC_FEATURES };
  return { ...NABBIHNI_FEATURES };
}

export function getPackagePriceLyd(raw?: string | null): number {
  const val = String(raw || "").trim().toLowerCase();
  if (val === "gift" || val === "gift_promo") return 0;
  const pkg = normalizePackageType(raw);
  if (pkg === "basic") return 50;
  if (pkg === "nabbihni") return 100;
  return 100;
}

export function computeCountdownDays(
  expiresAtIso?: string | null
): number | null {
  if (!expiresAtIso) return null;
  const target = new Date(expiresAtIso);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const startToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const startTarget = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate()
  );
  return Math.round((startTarget - startToday) / (1000 * 60 * 60 * 24));
}

export function formatSlashDateYmd(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

export function getAdminWhatsappNumber(): string {
  return (
    process.env.ADMIN_WHATSAPP_NUMBER?.trim() || "218919009899"
  ).replace(/[^\d]/g, "");
}
