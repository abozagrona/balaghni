import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import {
  sendNabehniReminderSms,
  sendSubscriptionExpirySms,
  sendWhatsappAlertMessage,
} from "@/lib/otp-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NABEHNI_STAGE_DAYS = new Set([30, 14, 3, 0]);
const SUBSCRIPTION_STAGE_DAYS = new Set([30, 14, 3, 0, -7]);

function computeDaysUntil(expiryDate: string): number | null {
  const target = new Date(expiryDate);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const startOfToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const startOfTarget = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate()
  );
  return Math.round((startOfTarget - startOfToday) / (1000 * 60 * 60 * 24));
}

function formatSlashDate(dateInput: string): string {
  const trimmed = String(dateInput || "").trim();
  const ymd = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return ymd.replace(/-/g, "/").slice(0, 15);
  }
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}/${m}/${day}`.slice(0, 15);
  }
  return trimmed.slice(0, 15);
}

function getNabehniPhaseLabel(
  daysRemaining: number,
  reminderType: string
): string | null {
  const isOilChange = /زيت|oil/i.test(reminderType);
  switch (daysRemaining) {
    case 30:
      return isOilChange ? "مزال شهر بس على" : "مزال شهر بس ويطيح";
    case 14:
      return isOilChange ? "مزال أسبوعين بس على" : "مزال أسبوعين بس ويطيح";
    case 3:
      return isOilChange ? "مزال 3 أيام بس على" : "مزال 3 أيام بس ويطيح";
    case 0:
      return isOilChange ? "اليوم موعد" : "اليوم يطيح";
    default:
      return null;
  }
}

function getSubscriptionStageVars(
  daysRemaining: number,
  slashExpiryDate: string
): { statusLabel: string; expiryDetail: string } | null {
  switch (daysRemaining) {
    case 30:
      return {
        statusLabel: "حيتم خلال شهر",
        expiryDetail: `تاريخ الانتهاء ${slashExpiryDate}`,
      };
    case 14:
      return {
        statusLabel: "حيتم خلال أسبوعين",
        expiryDetail: `تاريخ الانتهاء ${slashExpiryDate}`,
      };
    case 5:
      return {
        statusLabel: "حيتم خلال 5 أيام",
        expiryDetail: `تاريخ الانتهاء ${slashExpiryDate}`,
      };
    case 3:
      return {
        statusLabel: "حيتم خلال 3 أيام",
        expiryDetail: `تاريخ الانتهاء ${slashExpiryDate}`,
      };
    case 0:
      return {
        statusLabel: "حيتم اليوم",
        expiryDetail: `تاريخ الانتهاء ${slashExpiryDate}`,
      };
    case -7:
      return {
        statusLabel: "توقّف حالياً",
        expiryDetail: "تمّ من أسبوع فات",
      };
    default:
      return null;
  }
}

function resolveSubscriptionExpiryIso(
  tag: Record<string, unknown>
): string | null {
  const explicitExpiry = String(tag.subscription_expires_at || "").trim();
  if (explicitExpiry) return explicitExpiry;

  const activatedAt = String(tag.activated_at || "").trim();
  if (!activatedAt) return null;
  const activatedDate = new Date(activatedAt);
  if (Number.isNaN(activatedDate.getTime())) return null;

  const expiryDate = new Date(activatedDate.getTime());
  expiryDate.setUTCFullYear(expiryDate.getUTCFullYear() + 1);
  return expiryDate.toISOString().slice(0, 10);
}

function isSubscriptionActiveForTag(
  tag: Record<string, unknown>,
  subDaysRemaining: number | null
): boolean {
  const subStatus = String(tag.subscription_status || "")
    .trim()
    .toUpperCase();
  if (
    subStatus === "EXPIRED" ||
    subStatus === "INACTIVE" ||
    subStatus === "SUSPENDED" ||
    subStatus === "CANCELLED"
  ) {
    return false;
  }
  if (subDaysRemaining !== null && subDaysRemaining < 0) {
    return false;
  }
  return true;
}

async function sendWhatsappWithSmsFallback(
  phone: string,
  whatsappText: string,
  sendSmsFallback: () => Promise<{ ok: boolean; error?: string }>
): Promise<{
  whatsappOk: boolean;
  smsAttempted: boolean;
  smsOk: boolean;
  smsError?: string;
}> {
  const waRes = await sendWhatsappAlertMessage(phone, whatsappText);
  if (waRes.ok) {
    return { whatsappOk: true, smsAttempted: false, smsOk: false };
  }

  const smsRes = await sendSmsFallback();
  return {
    whatsappOk: false,
    smsAttempted: true,
    smsOk: smsRes.ok,
    ...(smsRes.error ? { smsError: smsRes.error } : {}),
  };
}

async function handleRemindersCron(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const auth = request.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
  }

  const forceAll = request.nextUrl.searchParams.get("force") === "true";
  const todayIso = new Date().toISOString().slice(0, 10);

  try {
    const [{ data: docs, error: docsError }, { data: tags, error: tagsError }] =
      await Promise.all([
        supabaseAdmin.from("vehicle_documents").select("*"),
        supabaseAdmin.from("tags").select("*").eq("status", "ACTIVE"),
      ]);

    if (docsError) {
      return NextResponse.json(
        { ok: false, error: docsError.message },
        { status: 500 }
      );
    }
    if (tagsError) {
      return NextResponse.json(
        { ok: false, error: tagsError.message },
        { status: 500 }
      );
    }

    type TagTarget = {
      tagId: string;
      tagCode: string;
      ownerPhone: string;
      vehicleOrTag: string;
      subExpiryIso: string | null;
      subDaysRemaining: number | null;
      subscriptionActive: boolean;
      nabbihniEnabled: boolean;
      isGiftPromo: boolean;
      raw: Record<string, unknown>;
    };

    const tagByCode = new Map<string, TagTarget>();
    const tagById = new Map<string, TagTarget>();

    for (const t of tags || []) {
      const row = t as Record<string, unknown>;
      const code = String(row.tag_code || "").toUpperCase().trim();
      const id = String(row.id || "").trim();
      const phone = String(row.owner_phone || "").trim();
      if (!code || !phone) continue;

      const subExpiryIso = resolveSubscriptionExpiryIso(row);
      const subDaysRemaining = subExpiryIso
        ? computeDaysUntil(subExpiryIso)
        : null;
      const subscriptionActive = isSubscriptionActiveForTag(
        row,
        subDaysRemaining
      );

      const rawFeatures = (row.features || {}) as Record<string, unknown>;
      const nabbihniEnabled =
        typeof rawFeatures.nabbihni_reminders === "boolean"
          ? rawFeatures.nabbihni_reminders
          : String(row.package_type || "").toLowerCase() !== "basic";
      const isGiftPromo = String(row.activation_source || "") === "gift_promo";

      const target: TagTarget & {
        nabbihniEnabled: boolean;
        isGiftPromo: boolean;
      } = {
        tagId: id,
        tagCode: code,
        ownerPhone: phone,
        vehicleOrTag: String(row.vehicle_make_model || code).trim(),
        subExpiryIso,
        subDaysRemaining,
        subscriptionActive,
        nabbihniEnabled,
        isGiftPromo,
        raw: row,
      };
      tagByCode.set(code, target);
      if (id) tagById.set(id, target);
    }

    const results: Array<{
      kind: "nabehni_document" | "nabehni_weekly_overdue" | "subscription_expiry";
      tagCode: string;
      stageKey: string;
      title: string;
      expiryDate: string;
      daysRemaining: number;
      whatsappOk: boolean;
      smsAttempted: boolean;
      smsOk: boolean;
      smsError?: string;
    }> = [];

    let suspendedDocumentsCount = 0;

    // 1. إشعارات تجديد اشتراك ملصق بَلِّغْنِي (5 مراحل للاشتراك السنوي + 5 و 0 أيام للهدايا الترويجية)
    for (const target of tagByCode.values()) {
      if (!target.subExpiryIso || target.subDaysRemaining === null) continue;
      const isGiftMilestone =
        target.isGiftPromo &&
        (target.subDaysRemaining === 5 || target.subDaysRemaining === 0);
      if (
        !SUBSCRIPTION_STAGE_DAYS.has(target.subDaysRemaining) &&
        !isGiftMilestone
      ) {
        continue;
      }

      const stageKey = `sub_day_${target.subDaysRemaining}`;
      const lastSubStage = String(
        target.raw.last_sub_reminder_stage || ""
      ).trim();
      const lastSubSentDate = String(
        target.raw.last_sub_reminder_sent_at || ""
      )
        .trim()
        .slice(0, 10);

      if (
        !forceAll &&
        (lastSubStage === stageKey || lastSubSentDate === todayIso)
      ) {
        continue;
      }

      const slashDate = formatSlashDate(target.subExpiryIso);
      const vars = getSubscriptionStageVars(target.subDaysRemaining, slashDate);
      if (!vars) continue;

      const var1 = vars.statusLabel.slice(0, 25);
      const var2 = vars.expiryDetail.slice(0, 30);
      const whatsappText = `(منصة بَلِّغْنِي): اشتراك ملصق بَلِّغْنِي ${var1} جدّد اشتراكك لاستمرار الخدمة (${var2})`;

      const delivery = await sendWhatsappWithSmsFallback(
        target.ownerPhone,
        whatsappText,
        () => sendSubscriptionExpirySms(target.ownerPhone, var1, var2)
      );

      if ((delivery.whatsappOk || delivery.smsOk) && target.tagCode) {
        try {
          await supabaseAdmin
            .from("tags")
            .update({
              last_sub_reminder_stage: stageKey,
              last_sub_reminder_sent_at: new Date().toISOString(),
            })
            .eq("tag_code", target.tagCode);
        } catch {
          // ignore if dedup columns are not yet present in remote tags table
        }
      }

      results.push({
        kind: "subscription_expiry",
        tagCode: target.tagCode,
        stageKey,
        title: "اشتراك ملصق بَلِّغْنِي",
        expiryDate: slashDate,
        daysRemaining: target.subDaysRemaining,
        ...delivery,
      });
    }

    // 2. تذكيرات خدمة «نَبِّهْنِي» (للمشتركين النشطين فقط — تتوقف فوراً إذا انتهى الاشتراك)
    for (const rawDoc of docs || []) {
      const doc = rawDoc as Record<string, unknown>;
      const docCode = String(doc.tag_code || doc.tagCode || "")
        .toUpperCase()
        .trim();
      const docTagId = String(doc.tag_id || doc.tagId || "").trim();
      const target =
        (docCode ? tagByCode.get(docCode) : undefined) ||
        (docTagId ? tagById.get(docTagId) : undefined);
      if (!target) continue;

      // الربط الشرطي: إذا انتهى اشتراك الملصق أو كانت الباقة لا تشمل «نَبِّهْنِي»، علّق التذكير
      if (!target.subscriptionActive || !target.nabbihniEnabled) {
        suspendedDocumentsCount += 1;
        continue;
      }

      const expiryRaw = String(doc.expiry_date || doc.expiryDate || "").trim();
      const daysRemaining = computeDaysUntil(expiryRaw);
      if (daysRemaining === null) continue;

      const isWeeklyOverdue =
        daysRemaining < 0 && Math.abs(daysRemaining) % 7 === 0;
      const isStageMilestone = NABEHNI_STAGE_DAYS.has(daysRemaining);

      if (!isStageMilestone && !isWeeklyOverdue) continue;

      const stageKey = isWeeklyOverdue
        ? `overdue_${Math.abs(daysRemaining)}`
        : `day_${daysRemaining}`;

      const lastStage = String(doc.last_reminder_stage || "").trim();
      const lastSentDate = String(doc.last_reminder_sent_at || "")
        .trim()
        .slice(0, 10);

      if (
        !forceAll &&
        (lastStage === stageKey || lastSentDate === todayIso)
      ) {
        continue;
      }

      const var2 = String(doc.title || "وثيقة المركبة").trim().slice(0, 25);
      const var3 = target.vehicleOrTag.trim().slice(0, 25);
      const var4 = formatSlashDate(expiryRaw);

      if (isWeeklyOverdue) {
        // المتابعة الأسبوعية بعد انتهاء وثيقة «نَبِّهْنِي» (طالما الاشتراك سارٍ): WhatsApp فقط بدون SMS
        const weeklyText = `(منصة بَلِّغْنِي) خدمة نَبِّهْنِي: تذكير أسبوعي — ${var2} سيارتك (${var3}) طاح من يوم ${var4} ومزال ما جددتاش، حدّث التاريخ في حسابك بعد التجديد باش نوقفو التذكير.`;
        const waRes = await sendWhatsappAlertMessage(
          target.ownerPhone,
          weeklyText
        );

        if (waRes.ok && doc.id) {
          try {
            await supabaseAdmin
              .from("vehicle_documents")
              .update({
                last_reminder_stage: stageKey,
                last_reminder_sent_at: new Date().toISOString(),
              })
              .eq("id", String(doc.id));
          } catch {
            // ignore if dedup columns are not yet present in remote table
          }
        }

        results.push({
          kind: "nabehni_weekly_overdue",
          tagCode: target.tagCode,
          stageKey,
          title: var2,
          expiryDate: var4,
          daysRemaining,
          whatsappOk: waRes.ok,
          smsAttempted: false,
          smsOk: false,
        });
        continue;
      }

      // المراحل الأربع (30، 14، 3، 0): WhatsApp أولاً، ثم SMS (f1416035-9b11-4699-8289-f4685428c7af) عند فشل WhatsApp فقط
      const phaseLabel = getNabehniPhaseLabel(daysRemaining, var2);
      if (!phaseLabel) continue;
      const var1 = phaseLabel.slice(0, 25);

      const whatsappText = `(منصة بَلِّغْنِي) خدمة نَبِّهْنِي: ${var1} ${var2} سيارتك (${var3}) تاريخ الانتهاء ${var4}`;
      const delivery = await sendWhatsappWithSmsFallback(
        target.ownerPhone,
        whatsappText,
        () => sendNabehniReminderSms(target.ownerPhone, var1, var2, var3, var4)
      );

      if ((delivery.whatsappOk || delivery.smsOk) && doc.id) {
        try {
          await supabaseAdmin
            .from("vehicle_documents")
            .update({
              last_reminder_stage: stageKey,
              last_reminder_sent_at: new Date().toISOString(),
            })
            .eq("id", String(doc.id));
        } catch {
          // ignore if dedup columns are not yet present in remote table
        }
      }

      results.push({
        kind: "nabehni_document",
        tagCode: target.tagCode,
        stageKey,
        title: var2,
        expiryDate: var4,
        daysRemaining,
        ...delivery,
      });
    }

    return NextResponse.json({
      ok: true,
      checkedDocuments: (docs || []).length,
      checkedTags: tagByCode.size,
      suspendedDocumentsCount,
      remindersSent: results.filter((r) => r.kind === "nabehni_document").length,
      weeklyOverdueSent: results.filter(
        (r) => r.kind === "nabehni_weekly_overdue"
      ).length,
      subscriptionAlertsSent: results.filter(
        (r) => r.kind === "subscription_expiry"
      ).length,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Cron execution failed",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleRemindersCron(request);
}

export async function POST(request: NextRequest) {
  return handleRemindersCron(request);
}
