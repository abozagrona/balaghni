import { NextRequest, NextResponse } from "next/server";

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

// سجل مؤقت في الذاكرة لعدد محاولات الإساءة لكل بصمة جهاز
const attemptsMap = new Map<string, number>();

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tagCode: string }> }
) {
  try {
    await context.params;
    const body = await req.json().catch(() => ({}));
    const note = typeof body.note === "string" ? body.note : "";
    const fingerprint =
      typeof body.fingerprint === "string" ? body.fingerprint : "anon";

    if (!note.trim()) {
      return NextResponse.json({ ok: true });
    }

    const currentViolations = attemptsMap.get(fingerprint) || 0;
    if (currentViolations >= 3) {
      return NextResponse.json(
        {
          code: "spam_note_blocked",
          message:
            "تم إيقاف إرسال الملاحظات النصية من هذا الجهاز لمخالفة قواعد الاحترام 3 مرات. لا يزال بإمكانك إرسال تنبيه جاهز بدون ملاحظة.",
          flaggedNote: note,
          flaggedSpans: [],
          spamAttemptsRemaining: 0,
        },
        { status: 400 }
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
      const nextViolations = currentViolations + 1;
      attemptsMap.set(fingerprint, nextViolations);
      const remaining = Math.max(0, 3 - nextViolations);

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
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
