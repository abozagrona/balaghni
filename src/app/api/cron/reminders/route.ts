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
const SUBSCRIPTION_MILESTONES = new Set([14, 7, 3, 1, 0]);

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

function formatExpiryLabelArabic(daysLeft: number): string {
  if (daysLeft === 0) return "اليوم";
  if (daysLeft === 1) return "غداً";
  if (daysLeft <= 10) return `بعد ${daysLeft} أيام`;
  return `بعد ${daysLeft} يوم`;
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

  const forceAllUpcoming =
    request.nextUrl.searchParams.get("force") === "true";
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
      tagCode: string;
      ownerPhone: string;
      vehicleOrTag: string;
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

      const target: TagTarget = {
        tagCode: code,
        ownerPhone: phone,
        vehicleOrTag: String(row.vehicle_make_model || code).trim(),
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

    // 1. تذكيرات خدمة «نَبِّهْنِي» (4 مراحل: 30، 14، 3، 0 + متابعة أسبوعية واتساب فقط بعد الانتهاء)
    for (const rawDoc of docs || []) {
      const doc = rawDoc as Record<string, unknown>;
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
        !forceAllUpcoming &&
        (lastStage === stageKey || lastSentDate === todayIso)
      ) {
        continue;
      }

      const docCode = String(doc.tag_code || doc.tagCode || "")
        .toUpperCase()
        .trim();
      const docTagId = String(doc.tag_id || doc.tagId || "").trim();
      const target =
        (docCode ? tagByCode.get(docCode) : undefined) ||
        (docTagId ? tagById.get(docTagId) : undefined);
      if (!target) continue;

      const var2 = String(doc.title || "وثيقة المركبة").trim().slice(0, 25);
      const var3 = target.vehicleOrTag.trim().slice(0, 25);
      const var4 = formatSlashDate(expiryRaw);

      if (isWeeklyOverdue) {
        // المتابعة الأسبوعية بعد انتهاء الصلاحية: WhatsApp فقط (لا SMS نهائياً)
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

      // المراحل الأربع (30، 14، 3، 0): WhatsApp أولاً، ثم SMS احتياطي فقط عند فشل WhatsApp
      const phaseLabel = getNabehniPhaseLabel(daysRemaining, var2);
      if (!phaseLabel) continue;
      const var1 = phaseLabel.slice(0, 25);

      const whatsappText = `(منصة بَلِّغْنِي) خدمة نَبِّهْنِي: ${var1} ${var2} سيارتك (${var3}) تاريخ الانتهاء ${var4}`;
      const waRes = await sendWhatsappAlertMessage(
        target.ownerPhone,
        whatsappText
      );

      let smsAttempted = false;
      let smsOk = false;
      let smsError: string | undefined;

      if (!waRes.ok) {
        smsAttempted = true;
        const smsRes = await sendNabehniReminderSms(
          target.ownerPhone,
          var1,
          var2,
          var3,
          var4
        );
        smsOk = smsRes.ok;
        smsError = smsRes.error;
      }

      if ((waRes.ok || smsOk) && doc.id) {
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
        whatsappOk: waRes.ok,
        smsAttempted,
        smsOk,
        ...(smsError ? { smsError } : {}),
      });
    }

    // 2. تنبيهات قرب انتهاء اشتراك الملصق (RESALA_SUBSCRIPTION_TEMPLATE_ID)
    for (const target of tagByCode.values()) {
      const subExpiry = resolveSubscriptionExpiryIso(target.raw);
      if (!subExpiry) continue;
      const daysRemaining = computeDaysUntil(subExpiry);
      if (daysRemaining === null || daysRemaining < 0 || daysRemaining > 14) {
        continue;
      }
      if (!forceAllUpcoming && !SUBSCRIPTION_MILESTONES.has(daysRemaining)) {
        continue;
      }

      const expiryLabel = formatExpiryLabelArabic(daysRemaining);
      const whatsappMessage = [
        `⏳ تنبيه اشتراك بَلِّغْنِي`,
        `اشتراك ملصق (${target.vehicleOrTag}) ينتهي ${expiryLabel} (${formatSlashDate(subExpiry)}).`,
        `جدّد اشتراكك لاستمرار الخدمة.`,
      ].join("\n");

      const [waRes, smsRes] = await Promise.allSettled([
        sendWhatsappAlertMessage(target.ownerPhone, whatsappMessage),
        sendSubscriptionExpirySms(
          target.ownerPhone,
          target.vehicleOrTag,
          expiryLabel
        ),
      ]);

      const whatsappOk = waRes.status === "fulfilled" && waRes.value.ok;
      const smsOk = smsRes.status === "fulfilled" && smsRes.value.ok;
      const smsError =
        smsRes.status === "fulfilled"
          ? smsRes.value.error
          : String(smsRes.reason);

      results.push({
        kind: "subscription_expiry",
        tagCode: target.tagCode,
        stageKey: `sub_day_${daysRemaining}`,
        title: "اشتراك الملصق",
        expiryDate: formatSlashDate(subExpiry),
        daysRemaining,
        whatsappOk,
        smsAttempted: true,
        smsOk,
        ...(smsError ? { smsError } : {}),
      });
    }

    return NextResponse.json({
      ok: true,
      checkedDocuments: (docs || []).length,
      checkedTags: tagByCode.size,
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
