import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import {
  sendNabehniReminderSms,
  sendSubscriptionExpirySms,
  sendWhatsappAlertMessage,
} from "@/lib/otp-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const REMINDER_DAY_MILESTONES = new Set([14, 7, 3, 1, 0]);

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

function formatExpiryLabelArabic(daysLeft: number): string {
  if (daysLeft === 0) return "اليوم";
  if (daysLeft === 1) return "غداً";
  if (daysLeft <= 10) return `بعد ${daysLeft} أيام`;
  return `بعد ${daysLeft} يوم`;
}

function resolveSubscriptionExpiryIso(tag: Record<string, unknown>): string | null {
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
      kind: "nabehni_document" | "subscription_expiry";
      tagCode: string;
      title: string;
      expiryDate: string;
      daysLeft: number;
      whatsappOk: boolean;
      smsOk: boolean;
      smsError?: string;
    }> = [];

    // 1. تذكيرات وثائق «نَبِّهْنِي»
    for (const rawDoc of docs || []) {
      const doc = rawDoc as Record<string, unknown>;
      const expiryDate = String(doc.expiry_date || doc.expiryDate || "").trim();
      const daysLeft = computeDaysUntil(expiryDate);
      if (daysLeft === null || daysLeft < 0 || daysLeft > 14) continue;
      if (!forceAllUpcoming && !REMINDER_DAY_MILESTONES.has(daysLeft)) continue;

      const docCode = String(doc.tag_code || doc.tagCode || "")
        .toUpperCase()
        .trim();
      const docTagId = String(doc.tag_id || doc.tagId || "").trim();
      const target =
        (docCode ? tagByCode.get(docCode) : undefined) ||
        (docTagId ? tagById.get(docTagId) : undefined);
      if (!target) continue;

      const reminderType = String(doc.title || "وثيقة المركبة").trim();
      const whatsappMessage = [
        `🔔 تذكير نَبِّهْنِي (بَلِّغْنِي)`,
        `الموعد: ${reminderType}`,
        `المركبة: ${target.vehicleOrTag}`,
        `التاريخ: ${expiryDate} (${formatExpiryLabelArabic(daysLeft)})`,
      ].join("\n");

      const [waRes, smsRes] = await Promise.allSettled([
        sendWhatsappAlertMessage(target.ownerPhone, whatsappMessage),
        sendNabehniReminderSms(
          target.ownerPhone,
          reminderType,
          target.vehicleOrTag,
          expiryDate
        ),
      ]);

      const whatsappOk = waRes.status === "fulfilled" && waRes.value.ok;
      const smsOk = smsRes.status === "fulfilled" && smsRes.value.ok;
      const smsError =
        smsRes.status === "fulfilled"
          ? smsRes.value.error
          : String(smsRes.reason);

      results.push({
        kind: "nabehni_document",
        tagCode: target.tagCode,
        title: reminderType,
        expiryDate,
        daysLeft,
        whatsappOk,
        smsOk,
        ...(smsError ? { smsError } : {}),
      });
    }

    // 2. تنبيهات قرب انتهاء اشتراك الملصق
    for (const target of tagByCode.values()) {
      const subExpiry = resolveSubscriptionExpiryIso(target.raw);
      if (!subExpiry) continue;
      const daysLeft = computeDaysUntil(subExpiry);
      if (daysLeft === null || daysLeft < 0 || daysLeft > 14) continue;
      if (!forceAllUpcoming && !REMINDER_DAY_MILESTONES.has(daysLeft)) continue;

      const expiryLabel = formatExpiryLabelArabic(daysLeft);
      const whatsappMessage = [
        `⏳ تنبيه اشتراك بَلِّغْنِي`,
        `اشتراك ملصق (${target.vehicleOrTag}) ينتهي ${expiryLabel} (${subExpiry}).`,
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
        title: "اشتراك الملصق",
        expiryDate: subExpiry,
        daysLeft,
        whatsappOk,
        smsOk,
        ...(smsError ? { smsError } : {}),
      });
    }

    return NextResponse.json({
      ok: true,
      checkedDocuments: (docs || []).length,
      checkedTags: tagByCode.size,
      remindersSent: results.filter((r) => r.kind === "nabehni_document").length,
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
