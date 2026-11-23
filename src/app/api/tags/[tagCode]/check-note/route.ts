import { NextRequest, NextResponse } from "next/server";
import {
  canonicalizeRateIp,
  checkDistributedKeyLimit,
  consumeDistributedRateLimit,
  getClientIp,
} from "@/lib/rate-limiter";

const BLOCKED_WORDS = [
  "شتيمة",
  "غبي",
  "احمق",
  "حيوان",
  "كلب",
  "تافه",
  "وسخ",
  "لعنة",
];

const NOTE_REQ_MAX = 30; // 30 فحص ملاحظة لكل IP خلال 10 دقائق
const NOTE_REQ_WINDOW_MS = 10 * 60 * 1000;
const NOTE_VIOLATIONS_MAX = 3; // 3 مخالفات لكل IP خلال 30 دقيقة (لا يمكن تجاوزها بتغيير fingerprint)
const NOTE_VIOLATIONS_WINDOW_MS = 30 * 60 * 1000;

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tagCode: string }> }
) {
  try {
    await context.params;
    const clientIp = canonicalizeRateIp(getClientIp(req)) || "127.0.0.1";

    // 1. حد معدل الطلبات الموزّع على أساس IP أولاً (fail_closed)
    const reqLimit = await consumeDistributedRateLimit(
      "note:req:ip",
      clientIp,
      NOTE_REQ_MAX,
      NOTE_REQ_WINDOW_MS,
      "fail_closed"
    );
    if (!reqLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            reqLimit.source === "fail_closed"
              ? reqLimit.reason || "خدمة التحقق غير متاحة مؤقتاً. يرجى المحاولة لاحقاً."
              : "تم تجاوز الحد المسموح لطلبات فحص الملاحظات. يرجى الانتظار قليلاً.",
          retryAfterSeconds: reqLimit.retryAfterSeconds,
        },
        { status: reqLimit.source === "fail_closed" ? 503 : 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const note = typeof body.note === "string" ? body.note : "";
    const rawFingerprint =
      typeof body.fingerprint === "string"
        ? body.fingerprint.trim().slice(0, 64)
        : "";

    if (!note.trim()) {
      return NextResponse.json({ ok: true });
    }

    // 2. فحص سجل المخالفات الموزّع المرتبط بـ IP (لا يمكن تجاوزه بتغيير fingerprint)
    const ipViolKey = `note:viol:ip:${clientIp}`;
    const ipViolStatus = await checkDistributedKeyLimit(
      ipViolKey,
      NOTE_VIOLATIONS_MAX,
      NOTE_VIOLATIONS_WINDOW_MS
    );
    if (!ipViolStatus) {
      return NextResponse.json(
        {
          ok: false,
          error: "خدمة التحقق الأمني غير متاحة مؤقتاً. يرجى المحاولة لاحقاً.",
        },
        { status: 503 }
      );
    }

    if (!ipViolStatus.allowed) {
      return NextResponse.json(
        {
          code: "spam_note_blocked",
          message:
            "تم إيقاف إرسال الملاحظات النصية من هذا الاتصال لمخالفة قواعد الاحترام 3 مرات. لا يزال بإمكانك إرسال تنبيه جاهز بدون ملاحظة.",
          flaggedNote: note,
          flaggedSpans: [],
          spamAttemptsRemaining: 0,
        },
        { status: 429 }
      );
    }

    const flaggedSpans: Array<{ start: number; end: number }> = [];
    for (const badWord of BLOCKED_WORDS) {
      let startIndex = 0;
      while (startIndex < note.length) {
        const idx = note.indexOf(badWord, startIndex);
        if (idx === -1) break;
        flaggedSpans.push({ start: idx, end: idx + badWord.length });
        startIndex = idx + badWord.length;
      }
    }

    if (flaggedSpans.length > 0) {
      // تسجيل المخالفة على IP كأساس (وعلى fingerprint كعامل مساعد فقط)
      const ipViolConsume = await consumeDistributedRateLimit(
        "note:viol:ip",
        clientIp,
        NOTE_VIOLATIONS_MAX,
        NOTE_VIOLATIONS_WINDOW_MS,
        "fail_closed"
      );
      if (ipViolConsume.source === "fail_closed") {
        return NextResponse.json(
          {
            ok: false,
            error: "خدمة التحقق الأمني غير متاحة مؤقتاً. يرجى المحاولة لاحقاً.",
          },
          { status: 503 }
        );
      }

      if (rawFingerprint && rawFingerprint !== "anon") {
        await consumeDistributedRateLimit(
          "note:viol:fp",
          `${clientIp}:${rawFingerprint}`,
          NOTE_VIOLATIONS_MAX,
          NOTE_VIOLATIONS_WINDOW_MS,
          "fail_closed"
        );
      }

      const remaining = Math.max(0, ipViolConsume.remaining);
      return NextResponse.json(
        {
          code: remaining === 0 ? "spam_note_blocked" : "spam_note",
          message:
            remaining === 0
              ? "تم حظر إرسال الملاحظات النصية لتكرار استخدام عبارات غير لائقة."
              : "نرجو الحفاظ على أسلوب لائق، يرجى تعديل الكلمات المظللة باللون الأحمر قبل الإرسال.",
          flaggedNote: note,
          flaggedSpans,
          spamAttemptsRemaining: remaining,
        },
        { status: remaining === 0 ? 429 : 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر فحص الملاحظة حالياً." },
      { status: 500 }
    );
  }
}
