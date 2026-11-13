import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import {
  sendNabehniReminderSms,
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
    const { data: docs, error: docsError } = await supabaseAdmin
      .from("vehicle_documents")
      .select("id, tag_code, title, expiry_date");

    if (docsError) {
      return NextResponse.json(
        { ok: false, error: docsError.message },
        { status: 500 }
      );
    }

    const dueDocs = (docs || [])
      .map((doc) => ({
        ...doc,
        daysLeft: computeDaysUntil(String(doc.expiry_date || "")),
      }))
      .filter((doc) => {
        if (doc.daysLeft === null || doc.daysLeft < 0 || doc.daysLeft > 14) {
          return false;
        }
        return forceAllUpcoming || REMINDER_DAY_MILESTONES.has(doc.daysLeft);
      });

    if (dueDocs.length === 0) {
      return NextResponse.json({
        ok: true,
        checkedDocuments: (docs || []).length,
        remindersSent: 0,
        results: [],
      });
    }

    const tagCodes = Array.from(
      new Set(
        dueDocs.map((d) => String(d.tag_code || "").toUpperCase().trim())
      )
    ).filter(Boolean);

    const { data: tags } = await supabaseAdmin
      .from("tags")
      .select("tag_code, owner_phone, vehicle_make_model, status")
      .in("tag_code", tagCodes)
      .eq("status", "ACTIVE");

    const tagMap = new Map<
      string,
      { ownerPhone: string; vehicleOrTag: string }
    >();
    for (const t of tags || []) {
      const code = String(t.tag_code || "").toUpperCase().trim();
      const phone = String(t.owner_phone || "").trim();
      if (code && phone) {
        tagMap.set(code, {
          ownerPhone: phone,
          vehicleOrTag: String(t.vehicle_make_model || code).trim(),
        });
      }
    }

    const results: Array<{
      tagCode: string;
      title: string;
      expiryDate: string;
      daysLeft: number | null;
      whatsappOk: boolean;
      smsOk: boolean;
      smsError?: string;
    }> = [];

    for (const doc of dueDocs) {
      const code = String(doc.tag_code || "").toUpperCase().trim();
      const target = tagMap.get(code);
      if (!target) continue;

      const reminderType = String(doc.title || "وثيقة المركبة").trim();
      const expiryDate = String(doc.expiry_date || "").trim();

      const whatsappMessage = [
        `🔔 تذكير نَبِّهْنِي (بَلِّغْنِي)`,
        `الموعد: ${reminderType}`,
        `المركبة: ${target.vehicleOrTag}`,
        `التاريخ: ${expiryDate} (${
          doc.daysLeft === 0
            ? "اليوم"
            : `متبقي ${doc.daysLeft} يوم`
        })`,
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
        tagCode: code,
        title: reminderType,
        expiryDate,
        daysLeft: doc.daysLeft,
        whatsappOk,
        smsOk,
        ...(smsError ? { smsError } : {}),
      });
    }

    return NextResponse.json({
      ok: true,
      checkedDocuments: (docs || []).length,
      remindersSent: results.length,
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
