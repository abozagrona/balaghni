import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  broadcastReportRealtimeUpdate,
  getVehicleTagByCode,
  supabaseAdmin,
} from "@/lib/supabase/client";
import {
  sendWhatsappAlertMessage,
  TWILIO_CONTENT_SIDS,
} from "@/lib/otp-service";
import {
  checkDistributedKeyLimit,
  consumeDistributedRateLimit,
  getClientIp,
} from "@/lib/rate-limiter";
import { verifyReportAccessTokenDistributed } from "@/lib/report-token-revocation";
import {
  createCallOwnerReplyToken,
  hashCallOwnerCode,
  verifyCallOwnerReplyToken,
} from "@/lib/security-tokens";
import { formatBalaghniTagCode } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CALL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars = 5 bits/char
const OWNER_CALL_CODE_LENGTH = 16; // 16 * 5 = 80 bits entropy
const ROOM_CODE_LENGTH = 10; // 50 bits, distinct from ownerCallCode
const CALL_SESSION_TTL_MS = 30 * 60 * 1000; // 30 دقيقة
const REPORT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // ساعتان (مطابقة لصلاحية report_access)

function generateSecureCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes)
    .map((b) => CALL_ALPHABET[b & 31])
    .join("");
}

function safeTimingEqualHex(aStr: string, bStr: string): boolean {
  const a = Buffer.from(String(aStr || "").trim().toLowerCase(), "utf8");
  const b = Buffer.from(String(bStr || "").trim().toLowerCase(), "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface CallSessionMeta {
  callCodeHash?: string;
  roomCode?: string;
  reportId?: string;
  tagCode?: string;
  vehicleLabel?: string;
  createdAt?: string;
  expiresAt?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawTag = String(body?.tagCode || "").trim();
    const reportId = String(body?.reportId || "").trim();
    const tagCode = formatBalaghniTagCode(rawTag);
    const accessToken = String(req.headers.get("x-report-token") || "").trim();

    if (!tagCode || !reportId || reportId.startsWith("rep_")) {
      return NextResponse.json(
        { ok: false, error: "رمز الملصق ومعرّف البلاغ الصالح مطلوبان." },
        { status: 400 }
      );
    }

    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: "غير مصرح ببدء المكالمة دون رمز وصول صالح للبلاغ." },
        { status: 401 }
      );
    }

    // 1. التحقق الموزّع من صلاحية وتوقيع وعدم إلغاء رمز الوصول للبلاغ
    const tokenCheck = await verifyReportAccessTokenDistributed(
      accessToken,
      reportId,
      tagCode
    );
    if (!tokenCheck.valid) {
      return NextResponse.json(
        {
          ok: false,
          error: "رمز الوصول للبلاغ غير صالح أو منتهي الصلاحية أو ملغى.",
          reason: tokenCheck.reason || "unauthorized",
        },
        { status: 401 }
      );
    }

    // 2. التحقق من وجود البلاغ الفعلي وربطه بالمركبة وحداثته
    const { data: reportRow } = await supabaseAdmin
      .from("reports")
      .select("id, tag_code, created_at")
      .eq("id", reportId)
      .eq("tag_code", tagCode)
      .maybeSingle();

    if (!reportRow?.id) {
      return NextResponse.json(
        { ok: false, error: "تعذر العثور على بلاغ مطابق لهذا الملصق." },
        { status: 404 }
      );
    }

    if (reportRow.created_at) {
      const createdMs = new Date(String(reportRow.created_at)).getTime();
      if (Number.isFinite(createdMs) && Date.now() - createdMs > REPORT_MAX_AGE_MS) {
        return NextResponse.json(
          { ok: false, error: "انتهت مهلة بدء المكالمة لهذا البلاغ." },
          { status: 410 }
        );
      }
    }

    // 3. فحص قرائي مسبق لقفل البلاغ (rl_check دون استهلاك) لمنع النقرات المكررة على نفس البلاغ
    // من استنزاف حصة المركبة (call:tag) أو الـ IP، ودون حرق قفل البلاغ إذا رُفض الطلب لاحقاً
    const preReportCheck = await checkDistributedKeyLimit(
      `call:report:${reportId.trim().toLowerCase()}`,
      1,
      15 * 60 * 1000
    );
    if (!preReportCheck) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "خدمة التحقق الأمني غير متاحة مؤقتاً. يرجى المحاولة مجدداً بعد 30 ثانية.",
          retryAfterSeconds: 30,
        },
        { status: 503 }
      );
    }
    if (!preReportCheck.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "تم إرسال طلب مكالمة صوتية لهذا البلاغ بالفعل. يرجى الانتظار.",
          retryAfterSeconds: preReportCheck.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    // 4. حدود المعدل الموزّعة الذرية (fail_closed) قبل أي إرسال
    const clientIp = getClientIp(req);
    const ipLimit = await consumeDistributedRateLimit(
      "call:ip",
      clientIp,
      5,
      60 * 60 * 1000,
      "fail_closed"
    );
    if (!ipLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            ipLimit.reason ||
            "تم تجاوز الحد المسموح لطلبات المكالمات الصوتية. يرجى المحاولة لاحقاً.",
          retryAfterSeconds: ipLimit.retryAfterSeconds,
        },
        { status: ipLimit.source === "fail_closed" ? 503 : 429 }
      );
    }

    const tagLimit = await consumeDistributedRateLimit(
      "call:tag",
      tagCode,
      3,
      60 * 60 * 1000,
      "fail_closed"
    );
    if (!tagLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            tagLimit.reason ||
            "تم الوصول للحد الأقصى لطلبات الاتصال لهذه المركبة حالياً.",
          retryAfterSeconds: tagLimit.retryAfterSeconds,
        },
        { status: tagLimit.source === "fail_closed" ? 503 : 429 }
      );
    }

    const reportLimit = await consumeDistributedRateLimit(
      "call:report",
      reportId,
      1,
      15 * 60 * 1000,
      "fail_closed"
    );
    if (!reportLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            reportLimit.reason ||
            "تم إرسال طلب مكالمة صوتية لهذا البلاغ بالفعل. يرجى الانتظار.",
          retryAfterSeconds: reportLimit.retryAfterSeconds,
        },
        { status: reportLimit.source === "fail_closed" ? 503 : 429 }
      );
    }

    const tag = await getVehicleTagByCode(tagCode);
    if (!tag || tag.status !== "ACTIVE" || !tag.ownerPhone) {
      return NextResponse.json(
        { ok: false, error: "تعذر العثور على بيانات الملصق النشط." },
        { status: 404 }
      );
    }

    // 4. فصل رمز الغرفة (للمُبلّغ) عن رمز المالك السري (80-bit، يُرسل في واتساب فقط ولا يُعاد للمُبلّغ)
    const roomCode = generateSecureCode(ROOM_CODE_LENGTH);
    let ownerCallCode = generateSecureCode(OWNER_CALL_CODE_LENGTH);
    if (ownerCallCode === roomCode) {
      ownerCallCode = generateSecureCode(OWNER_CALL_CODE_LENGTH);
    }
    const ownerCallCodeHash = hashCallOwnerCode(ownerCallCode);

    const vehicleLabel = (tag.vehicleInfo || tag.vehicleBrand || tagCode)
      .trim()
      .slice(0, 25);

    const baseAppUrl = (
      process.env.NEXT_PUBLIC_SITE_URL || "https://balaghni.ly"
    )
      .replace(/\/+$/, "")
      .replace("://www.balaghni.ly", "://balaghni.ly");

    const callUrl = `${baseAppUrl}/call/${ownerCallCode}`;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresAtIso = new Date(nowMs + CALL_SESSION_TTL_MS).toISOString();

    // تخزين بصمة SHA-256 للرمز فقط (لا يُخزّن ownerCallCode كنص صريح أبداً)
    await supabaseAdmin.from("admin_audit_logs").insert({
      admin_name: "منظومة المكالمات المشفرة",
      action_type: "REPORT_CALL_SESSION",
      target_item: ownerCallCodeHash,
      details: JSON.stringify({
        callCodeHash: ownerCallCodeHash,
        roomCode,
        reportId,
        tagCode,
        vehicleLabel,
        createdAt: nowIso,
        expiresAt: expiresAtIso,
      }),
      created_at: nowIso,
    });

    const whatsappText = [
      `📞 (منصة بَلِّغْنِي) اتصال صوتي عاجل بخصوص سيارتك (${vehicleLabel})!`,
      `المُبلِّغ ينتظر عند المركبة ويتصل بك صوتياً الآن عبر المتصفح (مكالمة مشفرة دون كشف رقمك أو رقمه).`,
      `👉 اضغط هنا للرد والتحدث فوراً: ${callUrl}`,
    ].join("\n");

    const waResult = await sendWhatsappAlertMessage(
      tag.ownerPhone,
      whatsappText,
      null,
      {
        verifyDelivery: false,
        twilioContentSid: TWILIO_CONTENT_SIDS.VOICE_CALL,
        twilioContentVariables: {
          "1": ownerCallCode,
          "2": vehicleLabel,
        },
      }
    );

    if (!waResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "تعذر إرسال إشعار المكالمة لصاحب المركبة حالياً.",
        },
        { status: 502 }
      );
    }

    // إرجاع roomCode فقط للمُبلّغ (عدم كشف ownerCallCode أو ownerReplyToken أبداً)
    return NextResponse.json({
      ok: true,
      callCode: roomCode,
      tagCode,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر بدء المكالمة الصوتية المشفرة حالياً." },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    const getLimit = await consumeDistributedRateLimit(
      "call:get",
      clientIp,
      20,
      10 * 60 * 1000,
      "fail_closed"
    );
    if (!getLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            getLimit.reason ||
            "تم تجاوز الحد المسموح للتحقق من جلسات المكالمة. يرجى المحاولة لاحقاً.",
          retryAfterSeconds: getLimit.retryAfterSeconds,
        },
        { status: getLimit.source === "fail_closed" ? 503 : 429 }
      );
    }

    const rawCode = String(req.nextUrl.searchParams.get("callCode") || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    if (!rawCode || rawCode.length < OWNER_CALL_CODE_LENGTH) {
      return NextResponse.json(
        { ok: false, error: "رمز المكالمة غير صالح." },
        { status: 400 }
      );
    }

    const codeHash = hashCallOwnerCode(rawCode);

    const { data: row } = await supabaseAdmin
      .from("admin_audit_logs")
      .select("details")
      .eq("action_type", "REPORT_CALL_SESSION")
      .eq("target_item", codeHash)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row?.details) {
      return NextResponse.json(
        { ok: false, error: "المكالمة غير موجودة أو انتهت صلاحيتها." },
        { status: 404 }
      );
    }

    const meta = JSON.parse(String(row.details)) as CallSessionMeta;
    if (
      !meta.callCodeHash ||
      !safeTimingEqualHex(meta.callCodeHash, codeHash) ||
      !meta.roomCode ||
      !meta.reportId ||
      !meta.tagCode ||
      !meta.expiresAt
    ) {
      return NextResponse.json(
        { ok: false, error: "بيانات جلسة المكالمة غير صالحة." },
        { status: 404 }
      );
    }

    const expiresAtMs = new Date(meta.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
      return NextResponse.json(
        { ok: false, error: "انتهت صلاحية رابط المكالمة." },
        { status: 410 }
      );
    }

    const remainingMs = Math.max(1000, expiresAtMs - Date.now());
    const ownerReplyGrant = createCallOwnerReplyToken({
      callCodeHash: codeHash,
      reportId: String(meta.reportId),
      tagCode: String(meta.tagCode),
      ttlMs: remainingMs,
    });

    // إعادة بيانات الغرفة اللازمة فقط وتوكن الرد الموقّع (عدم كشف reportId أو أي بيانات داخلية)
    return NextResponse.json({
      ok: true,
      callCode: String(meta.roomCode),
      tagCode: String(meta.tagCode),
      vehicleLabel: String(meta.vehicleLabel || meta.tagCode || "مركبتك"),
      ownerReplyToken: ownerReplyGrant.token,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر جلب بيانات المكالمة." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    const patchLimit = await consumeDistributedRateLimit(
      "call:patch:ip",
      clientIp,
      15,
      10 * 60 * 1000,
      "fail_closed"
    );
    if (!patchLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            patchLimit.reason ||
            "تم تجاوز الحد المسموح لطلبات الاستجابة. يرجى المحاولة لاحقاً.",
          retryAfterSeconds: patchLimit.retryAfterSeconds,
        },
        { status: patchLimit.source === "fail_closed" ? 503 : 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawCode = String(body?.callCode || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    const ownerReplyToken = String(
      req.headers.get("x-call-owner-token") || body?.ownerReplyToken || ""
    ).trim();

    if (!rawCode || rawCode.length < OWNER_CALL_CODE_LENGTH || !ownerReplyToken) {
      return NextResponse.json(
        { ok: false, error: "غير مصرح بإرسال الرد دون رمز تحقق صالح." },
        { status: 401 }
      );
    }

    const codeHash = hashCallOwnerCode(rawCode);

    const { data: row } = await supabaseAdmin
      .from("admin_audit_logs")
      .select("details")
      .eq("action_type", "REPORT_CALL_SESSION")
      .eq("target_item", codeHash)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row?.details) {
      return NextResponse.json(
        { ok: false, error: "جلسة المكالمة غير موجودة." },
        { status: 404 }
      );
    }

    const meta = JSON.parse(String(row.details)) as CallSessionMeta;
    const reportId = String(meta.reportId || "").trim();
    const tagCode = formatBalaghniTagCode(String(meta.tagCode || ""));

    if (
      !meta.callCodeHash ||
      !safeTimingEqualHex(meta.callCodeHash, codeHash) ||
      !reportId ||
      reportId.startsWith("rep_") ||
      !tagCode ||
      !meta.expiresAt
    ) {
      return NextResponse.json(
        { ok: false, error: "بيانات جلسة المكالمة غير صالحة." },
        { status: 404 }
      );
    }

    const expiresAtMs = new Date(meta.expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
      return NextResponse.json(
        { ok: false, error: "انتهت صلاحية جلسة المكالمة." },
        { status: 410 }
      );
    }

    // التحقق التشفيري الصارم من ownerReplyToken وارتباطه ببصمة الجلسة + reportId + tagCode
    const tokenCheck = verifyCallOwnerReplyToken(
      ownerReplyToken,
      codeHash,
      reportId,
      tagCode
    );
    if (!tokenCheck.valid) {
      return NextResponse.json(
        {
          ok: false,
          error: "رمز التحقق لرد المالك غير صالح أو منتهي الصلاحية.",
          reason: tokenCheck.reason || "unauthorized",
        },
        { status: 401 }
      );
    }

    const replyText = "أنا قادم الآن";
    const reasonBadge = `رد المالك: ${replyText}`;

    const { data: rep, error: fetchError } = await supabaseAdmin
      .from("reports")
      .select("id, message")
      .eq("id", reportId)
      .eq("tag_code", tagCode)
      .maybeSingle();

    if (fetchError) {
      console.error("[Call PATCH] تعذر قراءة البلاغ قبل التحديث.");
      return NextResponse.json(
        { ok: false, error: "تعذر التحقق من البلاغ المرتبط بهذه المكالمة حالياً." },
        { status: 500 }
      );
    }

    if (!rep?.id) {
      return NextResponse.json(
        { ok: false, error: "تعذر العثور على البلاغ المرتبط بهذه المكالمة." },
        { status: 404 }
      );
    }

    // قفل الاستخدام الواحد الذري والموزّع (منع إعادة استخدام رد المكالمة)
    // لا نستدعي clearDistributedKey عند الفشل لأن rl_clear يحذف المفتاح بلا fencing token،
    // والأولوية لمنع الردود المكررة أو التلاعب بالتزامن إلى حين وجود جدول جلسات معاملاتي لاحقاً.
    const singleUseLock = await consumeDistributedRateLimit(
      "call:reply",
      codeHash,
      1,
      24 * 60 * 60 * 1000,
      "fail_closed"
    );
    if (!singleUseLock.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error:
            singleUseLock.source === "fail_closed"
              ? singleUseLock.reason || "خدمة التحقق غير متاحة مؤقتاً."
              : "تم تسجيل ردك لهذه المكالمة مسبقاً.",
        },
        { status: singleUseLock.source === "fail_closed" ? 503 : 409 }
      );
    }

    const prevMsg = String(rep.message || "").trim();
    const marker = `[رد المالك عبر واتساب]: ${replyText}`;
    const nextMsg = prevMsg.includes(marker)
      ? prevMsg
      : `${prevMsg}\n${marker}`.trim();

    const { data: updatedRows, error: updateError } = await supabaseAdmin
      .from("reports")
      .update({ reason_badge: reasonBadge, message: nextMsg })
      .eq("id", rep.id)
      .eq("tag_code", tagCode)
      .select("id");

    if (updateError) {
      console.error("[Call PATCH] فشل تحديث جدول البلاغات برد المالك.");
      return NextResponse.json(
        {
          ok: false,
          error: "تعذر حفظ رد المالك في قاعدة البيانات حالياً.",
        },
        { status: 500 }
      );
    }

    if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "لم يتم تحديث أي بلاغ مطابق لهذه المكالمة.",
        },
        { status: 404 }
      );
    }

    try {
      const repliedAtIso = new Date().toISOString();
      await supabaseAdmin.from("admin_audit_logs").insert({
        admin_name: "منظومة المكالمات المشفرة",
        action_type: "REPORT_CALL_OWNER_REPLIED",
        target_item: codeHash,
        details: JSON.stringify({
          callCodeHash: codeHash,
          reportId: String(rep.id),
          tagCode,
          repliedAt: repliedAtIso,
        }),
        created_at: repliedAtIso,
      });
    } catch {
      // لا نُفشل الرد المحفوظ في جدول البلاغات إذا تعذر إدراج السجل الثانوي
    }

    await broadcastReportRealtimeUpdate({
      reportId: String(rep.id),
      tagCode,
      deliveryStatus: "replied",
      ownerReply: replyText,
      isSmsFallback: false,
      reasonBadge,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر تسجيل رد المالك حالياً." },
      { status: 500 }
    );
  }
}
