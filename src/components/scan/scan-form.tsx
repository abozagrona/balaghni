"use client";

import * as React from "react";
import Link from "next/link";
import {
  CarFront,
  Lightbulb,
  DoorOpen,
  AlertTriangle,
  Ellipsis,
  Camera,
  ImagePlus,
  X,
  BellRing,
  CheckCircle2,
  LoaderCircle,
  ShieldAlert,
  LockKeyhole,
  Sparkles,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LibyaPhoneInput } from "@/components/ui/libya-phone-input";
import {
  supabaseRealtime,
  parseReportStatusFromRow,
  type ReportRealtimePayload,
} from "@/lib/supabase/realtime";
import {
  FlaggedNotePreview,
  type FlaggedSpan,
} from "@/components/scan/flagged-note-preview";
import {
  loadScanDraft,
  saveScanDraft,
  clearScanDraft,
  saveDraftImage,
  loadDraftImage,
  deleteDraftImage,
} from "@/lib/scan-draft-storage";
import {
  compressImageFile,
  getBrowserFingerprint,
} from "@/lib/image-compression";
import { cn, formatFullLibyaE164 } from "@/lib/utils";

export interface ScanReasonOption {
  id: string;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CAR_REASONS: ScanReasonOption[] = [
  {
    id: "blocking",
    label: "مْسَكِّر عليا بسيارتك",
    subtitle: "لو سمحت تجي تحول سيارتك بسرعة",
    icon: CarFront,
  },
  {
    id: "lights_on",
    label: "ضي سيارتك والع",
    subtitle: "ناسي ضي سيارتك والع بتاريتك حتفضى",
    icon: Lightbulb,
  },
  {
    id: "car_open",
    label: "مرش/باب السيارة مفتوح",
    subtitle: "انزل سكر سيارتك",
    icon: DoorOpen,
  },
  {
    id: "hit",
    label: "خبطت سيارتك بالغلط",
    subtitle: "ياريت تتواصل معاي ونتفاهموا",
    icon: AlertTriangle,
  },
  {
    id: "other",
    label: "في مشكلة في سيارة",
    subtitle: "تنبيه عام لصاحب السيارة",
    icon: Ellipsis,
  },
];

type SendingStage = "checking_message" | "checking_image" | "sending";

interface ModerationModalState {
  title: string;
  message: string;
  flaggedNote?: string;
  flaggedSpans?: FlaggedSpan[];
  attemptsRemaining?: number | null;
  isBlocked?: boolean;
}

export interface ScanFormProps {
  tagCode: string;
  vehicleName: string;
  initialReason?: string;
  photoAttachmentsEnabled?: boolean;
  onCompactStateChange?: (compact: boolean) => void;
}

export function ScanForm({
  tagCode,
  vehicleName,
  initialReason,
  photoAttachmentsEnabled = true,
  onCompactStateChange,
}: ScanFormProps) {
  const [reason, setReason] = React.useState<string>(
    initialReason && CAR_REASONS.some((r) => r.id === initialReason)
      ? initialReason
      : "blocking"
  );
  const [senderPhone, setSenderPhone] = React.useState<string>("");
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(
    null
  );

  const [isSending, setIsSending] = React.useState<boolean>(false);
  const [sendingStage, setSendingStage] =
    React.useState<SendingStage>("sending");
  const [sendProgress, setSendProgress] = React.useState<number>(0);
  const [isSuccess, setIsSuccess] = React.useState<boolean>(false);
  const [reportId, setReportId] = React.useState<string | null>(null);
  const [sentAtLabel, setSentAtLabel] = React.useState<string>("");
  const [deliveryStatus, setDeliveryStatus] = React.useState<
    "sent" | "delivered" | "read" | "replied"
  >("sent");
  const [deliveredChannel, setDeliveredChannel] = React.useState<string>("BOTH");
  const [isSmsFallback, setIsSmsFallback] = React.useState<boolean>(false);
  const [ownerReply, setOwnerReply] = React.useState<string | null>(null);
  const [arrivalCountdown, setArrivalCountdown] = React.useState<number | null>(
    null
  );
  const [reminderStage, setReminderStage] = React.useState<0 | 1 | 2>(0);
  const [isSendingReminder, setIsSendingReminder] =
    React.useState<boolean>(false);
  const [reminderError, setReminderError] = React.useState<string | null>(null);

  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [moderationState, setModerationState] =
    React.useState<ModerationModalState | null>(null);

  const cameraInputRef = React.useRef<HTMLInputElement | null>(null);
  const galleryInputRef = React.useRef<HTMLInputElement | null>(null);
  const statusCardRef = React.useRef<HTMLDivElement | null>(null);
  const errorDialogRef = React.useRef<HTMLDialogElement | null>(null);
  const moderationDialogRef = React.useRef<HTMLDialogElement | null>(null);

  // استعادة المسودة المحفوظة تلقائياً عند فتح الصفحة
  React.useEffect(() => {
    const draft = loadScanDraft(tagCode);
    if (draft) {
      if (CAR_REASONS.some((r) => r.id === draft.reason)) {
        setReason(draft.reason);
      }
      setSenderPhone(draft.senderPhone);

      if (draft.hasImage) {
        loadDraftImage(tagCode).then((blob) => {
          if (blob) {
            const restoredFile = new File([blob], "restored-photo.jpg", {
              type: blob.type || "image/jpeg",
            });
            setImageFile(restoredFile);
            setImagePreviewUrl(URL.createObjectURL(restoredFile));
          }
        });
      }
    }
  }, [tagCode]);

  // حفظ المسودة تلقائياً عند أي تعديل
  React.useEffect(() => {
    if (isSuccess) return;
    saveScanDraft(tagCode, {
      reason,
      note: "",
      senderPhone,
      hasImage: Boolean(imageFile),
    });
  }, [tagCode, reason, senderPhone, imageFile, isSuccess]);

  // إبلاغ الحاوية الأم بتقليص الترويسة أثناء الإرسال أو النجاح
  React.useEffect(() => {
    onCompactStateChange?.(isSending || isSuccess);
    if (isSending || isSuccess) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      requestAnimationFrame(() => {
        statusCardRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }
  }, [isSending, isSuccess, onCompactStateChange]);

  // الاتصال الحي الفوري (Supabase Realtime WebSockets) لمراقبة حالة القراءة والرد فورياً دون Polling
  React.useEffect(() => {
    if (!isSuccess) return;

    const applyRealtimeState = (next: {
      deliveryStatus?: "sent" | "delivered" | "read" | "replied";
      ownerReply?: string | null;
      isSmsFallback?: boolean;
    }) => {
      if (next.isSmsFallback) {
        setIsSmsFallback(true);
      }
      if (next.deliveryStatus === "replied" || next.ownerReply) {
        setDeliveryStatus("replied");
        if (next.ownerReply) {
          setOwnerReply((prev) => {
            if (!prev) {
              setArrivalCountdown(300);
            }
            return next.ownerReply ?? null;
          });
        }
      } else if (next.deliveryStatus === "read") {
        setDeliveryStatus((prev) => (prev === "replied" ? prev : "read"));
      } else if (next.deliveryStatus === "delivered") {
        setDeliveryStatus((prev) => (prev === "sent" ? "delivered" : prev));
      }
    };

    const hasRealReportId = Boolean(reportId && !reportId.startsWith("rep_"));
    const normalizedTag = tagCode.trim().toUpperCase();
    const channelName = hasRealReportId
      ? `report-live:${reportId}`
      : `report-tag:${normalizedTag}`;
    const pgFilter = hasRealReportId
      ? `id=eq.${reportId}`
      : `tag_code=eq.${normalizedTag}`;

    const channel = supabaseRealtime
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "reports",
          filter: pgFilter,
        },
        (payload) => {
          const row = (payload.new || {}) as Record<string, unknown>;
          const parsed = parseReportStatusFromRow(
            typeof row.reason_badge === "string" ? row.reason_badge : null,
            typeof row.message === "string" ? row.message : null
          );
          applyRealtimeState(parsed);
        }
      )
      .on("broadcast", { event: "report_update" }, ({ payload }) => {
        const data = (payload || {}) as Partial<ReportRealtimePayload>;
        applyRealtimeState({
          deliveryStatus: data.deliveryStatus,
          ownerReply: data.ownerReply ?? null,
          isSmsFallback: Boolean(data.isSmsFallback),
        });
      })
      .subscribe();

    return () => {
      void supabaseRealtime.removeChannel(channel);
    };
  }, [isSuccess, tagCode, reportId]);

  // استعادة حالة القفل النهائي في الجلسة إن وجدت
  React.useEffect(() => {
    try {
      const lockKey = `balaghni_report_lock_${tagCode.trim().toUpperCase()}`;
      if (window.sessionStorage.getItem(lockKey) === "locked") {
        setReminderStage(2);
      }
    } catch {
      // ignore storage access issues
    }
  }, [tagCode]);

  // العداد التنازلي الحقيقي (5 دقائق = 300 ثانية) وقفل الجلسة بعد انتهاء التمديد الثاني
  React.useEffect(() => {
    if (arrivalCountdown === null) return;
    if (arrivalCountdown <= 0) {
      if (reminderStage === 1) {
        setReminderStage(2);
        try {
          const lockKey = `balaghni_report_lock_${tagCode.trim().toUpperCase()}`;
          window.sessionStorage.setItem(lockKey, "locked");
        } catch {
          // ignore
        }
      }
      return;
    }
    const timer = window.setInterval(() => {
      setArrivalCountdown((prev) => (prev && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [arrivalCountdown, reminderStage, tagCode]);

  const handleRequestReminder = async () => {
    if (isSendingReminder) return;
    if (reminderStage !== 0) {
      setReminderStage(2);
      return;
    }

    setIsSendingReminder(true);
    setReminderError(null);
    try {
      const res = await fetch("/api/notify/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagCode, reportId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429 || data.locked) {
        setReminderStage(2);
        try {
          const lockKey = `balaghni_report_lock_${tagCode.trim().toUpperCase()}`;
          window.sessionStorage.setItem(lockKey, "locked");
        } catch {
          // ignore
        }
        return;
      }
      if (!res.ok || !data.ok) {
        setReminderError(data.error || "تعذر إرسال التنبيه التذكيري حالياً.");
        return;
      }
      setReminderStage(1);
      setArrivalCountdown(300);
    } catch {
      setReminderError("حدث خطأ في الاتصال. حاول مرة أخرى.");
    } finally {
      setIsSendingReminder(false);
    }
  };

  // التحكم في نوافذ <dialog>
  React.useEffect(() => {
    const dialog = errorDialogRef.current;
    if (!dialog) return;
    if (errorMessage) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [errorMessage]);

  React.useEffect(() => {
    const dialog = moderationDialogRef.current;
    if (!dialog) return;
    if (moderationState) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [moderationState]);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    e.target.value = "";
    if (!selected) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type)) {
      setErrorMessage("يرجى اختيار صورة بصيغة JPG أو PNG أو WebP.");
      return;
    }

    try {
      const compressed = await compressImageFile(selected);
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      const nextUrl = URL.createObjectURL(compressed);
      setImageFile(compressed);
      setImagePreviewUrl(nextUrl);
      await saveDraftImage(tagCode, compressed);
    } catch {
      setErrorMessage("تعذر تجهيز الصورة، يرجى المحاولة بصورة أخرى.");
    }
  };

  const handleRemovePhoto = () => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImageFile(null);
    setImagePreviewUrl(null);
    void deleteDraftImage(tagCode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSending) return;
    if (reminderStage === 2) {
      setErrorMessage(
        "ملاحظة: يرجى التواصل مع خدمة العملاء إذا لم توجد استجابة من صاحب السيارة، حيث انتهت مهلة الانتظار ولا يمكن إرسال تنبيهات إضافية."
      );
      return;
    }

    const fullLibyaPhone = senderPhone.trim()
      ? formatFullLibyaE164(senderPhone)
      : null;

    if (senderPhone.trim() && !fullLibyaPhone) {
      setErrorMessage(
        "يرجى إدخال رقم هاتف ليبي صحيح يبدأ بـ 91 أو 92 أو 93 أو 94 (9 أرقام)."
      );
      return;
    }

    setErrorMessage(null);
    setModerationState(null);
    setIsSending(true);
    setSendProgress(8);

    const fingerprint = getBrowserFingerprint();

    try {
      // 1. تجهيز الصورة المرفقة إن وُجدت
      if (imageFile) {
        setSendingStage("checking_image");
        setSendProgress(48);
      }

      const formData = new FormData();
      formData.append("tag_code", tagCode);
      formData.append("reason", reason);
      if (fullLibyaPhone) formData.append("senderPhone", fullLibyaPhone);
      formData.append("fingerprint", fingerprint);
      if (imageFile) formData.append("image", imageFile);

      // 3. إرسال التنبيه الفوري لصاحب السيارة عبر المسار المعزول (/api/notify)
      setSendingStage("sending");
      setSendProgress(78);

      const notifyRes = await fetch("/api/notify", {
        method: "POST",
        body: formData,
      });

      const notifyData = await notifyRes.json().catch(() => ({}));
      if (!notifyRes.ok || !notifyData.ok) {
        setIsSending(false);
        setSendProgress(0);
        setErrorMessage(
          notifyData.error ||
            "تم إرسال بلاغ لصاحب السيارة بالفعل، يرجى الانتظار بضع دقائق"
        );
        return;
      }

      setSendProgress(100);
      await new Promise((r) => setTimeout(r, 220));
      clearScanDraft(tagCode);
      setReportId(notifyData.report_id || null);
      setDeliveredChannel(notifyData.delivered_channel || "BOTH");
      setSentAtLabel(
        new Date().toLocaleTimeString("ar-LY", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
      setDeliveryStatus("sent");
      setOwnerReply(null);
      setArrivalCountdown(null);
      setIsSending(false);
      setIsSuccess(true);
    } catch {
      setIsSending(false);
      setSendProgress(0);
      setErrorMessage("تأكد من اتصالك بالإنترنت وحاول مرة أخرى.");
    }
  };

  const stageCopy: Record<
    SendingStage,
    { title: string; subtitle: string }
  > = {
    checking_message: {
      title: "جاري مراجعة الملاحظة...",
      subtitle: "نتحقق من سلامة النص قبل الإرسال الفوري",
    },
    checking_image: {
      title: "جاري تجهيز الصورة المرفقة...",
      subtitle: "نضغط الصورة لضمان سرعة الوصول لصاحب السيارة",
    },
    sending: {
      title: "جاري إبلاغ صاحب السيارة الآن...",
      subtitle: `يتم إرسال إشعار فوري بخصوص (${vehicleName})`,
    },
  };

  return (
    <>
      {isSending ? (
        /* شاشة التحميل التفاعلية أثناء الإرسال */
        <div
          ref={statusCardRef}
          role="status"
          aria-live="polite"
          className="my-2 flex min-h-[19rem] flex-col items-center justify-center rounded-3xl border border-border bg-card px-6 py-10 text-center shadow-card-soft"
        >
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <span className="absolute inset-0 rounded-full bg-primary/20 animate-pulse-ring" />
            <LoaderCircle className="h-8 w-8 animate-spin" />
          </div>
          <p className="mt-4 rounded-full bg-secondary px-3 py-1 text-xs font-bold text-primary">
            لحظات من فضلك
          </p>
          <h2 className="mt-3 text-xl font-bold text-foreground">
            {stageCopy[sendingStage].title}
          </h2>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
            {stageCopy[sendingStage].subtitle}
          </p>

          <div className="mt-6 w-full max-w-xs">
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary-gradient transition-[width] duration-300 ease-out"
                style={{ width: `${Math.max(8, sendProgress)}%` }}
              />
            </div>
            <p
              dir="ltr"
              className="mt-2 font-mono text-xs font-bold text-primary"
            >
              {Math.round(sendProgress)}%
            </p>
          </div>
        </div>
      ) : isSuccess ? (
        /* شاشة نجاح الإبلاغ على شكل محادثة واتساب حقيقية مع علامات الصح الحية والعداد التنازلي */
        <div
          ref={statusCardRef}
          className="my-2 space-y-4 animate-in fade-in duration-300"
        >
          {(() => {
            const selectedReasonObj =
              CAR_REASONS.find((r) => r.id === reason) || CAR_REASONS[0];
            const isReadOrReplied =
              deliveryStatus === "read" || deliveryStatus === "replied";
            const isDeliveredOrAbove =
              deliveryStatus === "delivered" || isReadOrReplied;
            const mins = String(
              Math.floor((arrivalCountdown ?? 0) / 60)
            ).padStart(2, "0");
            const secs = String((arrivalCountdown ?? 0) % 60).padStart(2, "0");

            return (
              <div className="overflow-hidden rounded-3xl border border-emerald-600/25 shadow-card-soft">
                {/* ترويسة واتساب الرسمية */}
                <div className="flex items-center justify-between bg-[#075E54] px-4 py-3 text-white dark:bg-[#202C33]">
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white">
                      <CarFront className="h-5 w-5" />
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#075E54] bg-[#25D366] dark:border-[#202C33]" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-black text-white">
                          مالك {vehicleName}
                        </h2>
                        <span
                          dir="ltr"
                          className="rounded-md bg-white/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white/90"
                        >
                          {tagCode}
                        </span>
                      </div>
                      <p className="text-[11px] text-white/80">
                        {deliveryStatus === "replied"
                          ? "ردّ على رسالتك الآن"
                          : deliveryStatus === "read"
                          ? "قرأ الرسالة"
                          : deliveryStatus === "delivered"
                          ? isSmsFallback || deliveredChannel === "SMS"
                            ? "تم التسليم عبر SMS"
                            : "تم التسليم عبر واتساب"
                          : "جاري الإرسال..."}
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#25D366]/20 px-2.5 py-1 text-[10px] font-bold text-[#a7f3d0]">
                    <LockKeyhole className="h-3 w-3" />
                    مشفر وخصوصي
                  </span>
                </div>

                {/* خلفية محادثة واتساب */}
                <div
                  className="space-y-3 bg-[#EFEAE2] p-4 dark:bg-[#0B141A]"
                  style={{
                    backgroundImage:
                      "radial-gradient(rgba(0,0,0,0.04) 1px, transparent 0)",
                    backgroundSize: "16px 16px",
                  }}
                >
                  <div className="flex justify-center">
                    <span className="rounded-lg bg-white/85 px-3 py-1 text-[11px] font-bold text-slate-600 shadow-sm dark:bg-[#182229] dark:text-slate-300">
                      اليوم • بلاغ فوري عبر منصة بَلِّغْنِي
                    </span>
                  </div>

                  {/* فقاعة البلاغ الصادرة (يمين) */}
                  <div className="flex flex-col items-start">
                    <div className="relative max-w-[88%] rounded-2xl rounded-tr-sm bg-[#D9FDD3] px-3.5 py-2.5 text-slate-900 shadow-sm dark:bg-[#005C4B] dark:text-white">
                      <p className="text-xs font-black text-[#075E54] dark:text-emerald-200">
                        تنبيه بَلِّغْنِي: {selectedReasonObj.label}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed">
                        {selectedReasonObj.subtitle}
                      </p>
                      {imagePreviewUrl && (
                        <div className="mt-2 overflow-hidden rounded-xl border border-black/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imagePreviewUrl}
                            alt="صورة البلاغ المرفقة"
                            className="max-h-40 w-full object-cover"
                          />
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center justify-end gap-1.5">
                        <span
                          dir="ltr"
                          className="text-[10px] font-medium text-slate-500 dark:text-white/70"
                        >
                          {sentAtLabel || "الآن"}
                        </span>
                        {isReadOrReplied ? (
                          <CheckCheck
                            className="h-4 w-4 text-[#53BDEB]"
                            aria-label="تمت القراءة"
                          />
                        ) : isDeliveredOrAbove ? (
                          <CheckCheck
                            className="h-4 w-4 text-slate-500 dark:text-white/70"
                            aria-label="تم التسليم"
                          />
                        ) : (
                          <Check
                            className="h-4 w-4 text-slate-500 dark:text-white/70"
                            aria-label="تم الإرسال"
                          />
                        )}
                      </div>
                    </div>

                    {isReadOrReplied && (
                      <span className="mt-1 inline-flex items-center gap-1 px-1 text-[11px] font-bold text-[#0284c7] dark:text-[#53BDEB]">
                        <CheckCheck className="h-3.5 w-3.5" />
                        قُرئت بواسطة صاحب السيارة
                      </span>
                    )}
                  </div>

                  {/* فقاعة رد صاحب السيارة الواردة (يسار) + العداد التنازلي */}
                  {ownerReply ? (
                    <div className="flex flex-col items-end space-y-2 animate-in fade-in duration-300">
                      <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-slate-900 shadow-sm dark:bg-[#202C33] dark:text-white">
                        <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-700 dark:text-emerald-300">
                          <MessageCircle className="h-3 w-3" />
                          رد صاحب السيارة
                        </span>
                        <p className="mt-1 text-xs font-bold leading-relaxed">
                          {ownerReply}
                        </p>
                      </div>

                      {arrivalCountdown !== null && reminderStage < 2 && (
                        <div className="w-full rounded-2xl border border-emerald-500/40 bg-emerald-600 px-4 py-3 text-white shadow-md">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Clock className="h-5 w-5 animate-pulse text-emerald-100" />
                              <div>
                                <p className="text-xs font-black">
                                  {reminderStage === 1
                                    ? "تم إرسال التنبيه التذكيري (تمديد 5 دقائق أخيرة)"
                                    : "صاحب السيارة في طريقه إليك الآن!"}
                                </p>
                                <p className="text-[11px] text-emerald-100">
                                  {arrivalCountdown > 0
                                    ? "الوقت المتبقي المتوقع للوصول"
                                    : "انتهت المهلة ولم يصل صاحب السيارة بعد"}
                                </p>
                              </div>
                            </div>
                            <span
                              dir="ltr"
                              className="rounded-xl bg-black/25 px-3 py-1.5 font-mono text-lg font-black tracking-wider"
                            >
                              {mins}:{secs}
                            </span>
                          </div>
                        </div>
                      )}

                      {arrivalCountdown === 0 && reminderStage === 0 && (
                        <div className="w-full space-y-2">
                          <button
                            type="button"
                            onClick={handleRequestReminder}
                            disabled={isSendingReminder}
                            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-xs font-black text-slate-950 shadow-md transition hover:bg-amber-400 disabled:opacity-60"
                          >
                            {isSendingReminder ? (
                              <>
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                                جارٍ إرسال التنبيه التذكيري...
                              </>
                            ) : (
                              <>
                                <BellRing className="h-4 w-4" />
                                طلب تنبيه تذكيري (تمديد 5 دقائق أخيرة)
                              </>
                            )}
                          </button>
                          {reminderError && (
                            <p className="text-center text-[11px] font-bold text-red-600 dark:text-red-400">
                              {reminderError}
                            </p>
                          )}
                        </div>
                      )}

                      {reminderStage === 2 && (
                        <div className="w-full space-y-3 rounded-2xl border border-amber-500/40 bg-amber-50 p-4 text-slate-900 shadow-md dark:bg-amber-950/50 dark:text-amber-50">
                          <p className="text-xs font-bold leading-relaxed">
                            ملاحظة: يرجى التواصل مع خدمة العملاء إذا لم توجد استجابة من صاحب السيارة، حيث انتهت مهلة الانتظار ولا يمكن إرسال تنبيهات إضافية.
                          </p>
                          <a
                            href={`https://wa.me/${(
                              process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || "218910000000"
                            ).replace(/[^\d]/g, "")}?text=${encodeURIComponent(
                              `مرحباً خدمة عملاء بَلِّغْنِي، انتهت مهلة الانتظار (10 دقائق) ولم يستجب صاحب المركبة للملصق (${tagCode}).`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-xs font-black text-slate-950 shadow-sm transition hover:bg-[#1fb857]"
                          >
                            <MessageCircle className="h-4 w-4" />
                            التواصل مع خدمة العملاء
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl bg-white/75 px-3 py-2 text-center text-[11px] font-semibold text-slate-600 dark:bg-[#182229] dark:text-slate-300">
                      {isReadOrReplied
                        ? "بانتظار استجابة صاحب السيارة... سيتم إشعارك هنا فور رده."
                        : "اتصال حي مباشر • سيتم تحديث علامات الصح وظهور رد المالك فورياً دون كشف أرقام الهواتف."}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* بطاقة تسويقية داكنة بهوية #0B0D13 و #E51926 */}
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-dark-hero-gradient p-6 text-white shadow-card-dark">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-3 py-1 text-xs font-bold text-primary-accent">
                  <Sparkles className="h-3.5 w-3.5" />
                  احمِ سيارتك في كل مشوار
                </span>
                <h3 className="mt-2.5 text-lg font-bold text-white">
                  تبي ملصق «بَلِّغْنِي» لسيارتك؟
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-white/75">
                  خلي الناس توصلك في ثواني لو سيارتك قافلة الطريق أو نسيت الأضواء
                  شغالة — من غير ما رقمك يظهر لأي شخص.
                </p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-gradient text-white shadow-primary-glow">
                <BellRing className="h-6 w-6 animate-bell-ring" />
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <Button asChild size="lg" className="w-full rounded-2xl">
                <Link href="/order">
                  <span>اطلب ملصقك الآن</span>
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* النموذج الرئيسي السريع لإرسال التنبيه */
        <form onSubmit={handleSubmit} className="space-y-4 pb-24">
          {/* 1. اختيار سبب التنبيه (جاهز بلمسة واحدة) */}
          <section className="rounded-3xl border border-border bg-card p-4 sm:p-5 shadow-card-soft">
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground">
                شنو المشكلة في السيارة؟{" "}
                <span className="text-primary" aria-hidden="true">
                  *
                </span>
              </h2>
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-bold text-primary">
                اختار السبب
              </span>
            </div>

            <div className="space-y-2.5">
              {CAR_REASONS.map((item) => {
                const Icon = item.icon;
                const isSelected = reason === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setReason(item.id)}
                    className={cn(
                      "flex w-full items-center gap-3.5 rounded-2xl border px-3.5 py-3 text-start transition-all duration-150",
                      isSelected
                        ? "border-primary bg-secondary/75 shadow-[0_6px_20px_rgba(229,25,38,0.10)]"
                        : "border-border bg-card hover:border-primary/30 hover:bg-muted/50"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors",
                        isSelected
                          ? "bg-primary-gradient text-white shadow-primary-glow"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-foreground">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {item.subtitle}
                      </span>
                    </span>

                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        isSelected
                          ? "border-primary bg-primary"
                          : "border-muted-foreground/35 bg-transparent"
                      )}
                    >
                      {isSelected && (
                        <span className="h-2 w-2 rounded-full bg-white" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. إرفاق صورة توضيحية (كاميرا مباشرة أو معرض) */}
          {photoAttachmentsEnabled && (
            <section className="rounded-3xl border border-border bg-card p-4 sm:p-5 shadow-card-soft">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-foreground">
                  إرفاق صورة توضيحية
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  اختياري
                </span>
              </div>

              <input
                ref={cameraInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={handlePhotoSelect}
                className="hidden"
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handlePhotoSelect}
                className="hidden"
              />

              {imagePreviewUrl ? (
                <div className="relative overflow-hidden rounded-2xl border border-border bg-muted/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreviewUrl}
                    alt="معاينة الصورة المرفقة"
                    className="max-h-52 w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    aria-label="حذف الصورة"
                    className="absolute top-2.5 end-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-balaghni-obsidian/80 text-white backdrop-blur transition hover:bg-primary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-input bg-muted/40 px-3 py-4 text-xs font-bold text-foreground transition hover:border-primary hover:bg-secondary/50"
                  >
                    <Camera className="h-5 w-5 text-primary" />
                    <span>التقاط بالكاميرا</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-input bg-muted/40 px-3 py-4 text-xs font-bold text-foreground transition hover:border-primary hover:bg-secondary/50"
                  >
                    <ImagePlus className="h-5 w-5 text-primary" />
                    <span>اختيار من المعرض</span>
                  </button>
                </div>
              )}
            </section>
          )}

          {/* 3. رقم هاتف المبلِّغ (اختياري - مخصص لليبيا +218) */}
          <section className="rounded-3xl border border-border bg-card p-4 sm:p-5 shadow-card-soft">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="scanner-libya-phone"
                className="text-sm font-bold text-foreground"
              >
                رقم هاتفك كان تبي صاحب السيارة يتصل بيك
              </label>
              <span className="text-xs font-medium text-muted-foreground">
                اختياري
              </span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              دخل رقمك لو تبي يرد عليك صاحب السيارة بسرعة
            </p>
            <LibyaPhoneInput
              id="scanner-libya-phone"
              value={senderPhone}
              onValueChange={setSenderPhone}
            />
          </section>

          {/* شارة ضمان الخصوصية المطلقة */}
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-xs text-muted-foreground">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <LockKeyhole className="h-4 w-4" />
            </span>
            <p className="leading-relaxed">
              <strong className="text-foreground">خصوصية تامة 100%:</strong> يعمل
              نظام «بَلِّغْنِي» كوسيط فوري مشفر دون إظهار رقم هاتف صاحب السيارة.
            </p>
          </div>

          {/* شريط الإرسال السفلي الثابت (Sticky Action Bar) */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-md">
            <div className="mx-auto max-w-lg px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.85rem)]">
              <Button
                type="submit"
                size="xl"
                disabled={isSending}
                className="w-full rounded-2xl text-base shadow-primary-glow-lg"
              >
                <BellRing className="h-5 w-5" />
                <span>ابعث البلاغ لصاحب السيارة توّا</span>
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* نافذة التنبيهات والأخطاء العامة <dialog> */}
      <dialog
        ref={errorDialogRef}
        onCancel={(e) => {
          e.preventDefault();
          setErrorMessage(null);
        }}
        onClick={(e) => {
          if (e.target === errorDialogRef.current) setErrorMessage(null);
        }}
        className="confirm-dialog"
      >
        <div className="confirm-dialog__card">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/12 text-primary">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-lg font-bold text-foreground">تنبيه</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {errorMessage}
          </p>
          <Button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="mt-5 w-full rounded-2xl"
          >
            حسناً، فهمت
          </Button>
        </div>
      </dialog>

      {/* نافذة الرقابة الذكية على الملاحظات النصية <dialog> */}
      <dialog
        ref={moderationDialogRef}
        onCancel={(e) => {
          e.preventDefault();
          setModerationState(null);
        }}
        onClick={(e) => {
          if (e.target === moderationDialogRef.current)
            setModerationState(null);
        }}
        className="confirm-dialog"
      >
        {moderationState && (
          <div className="confirm-dialog__card">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/12 text-primary">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h3 className="mt-3 text-lg font-bold text-foreground">
              {moderationState.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {moderationState.message}
            </p>

            {moderationState.flaggedNote && (
              <FlaggedNotePreview
                note={moderationState.flaggedNote}
                spans={moderationState.flaggedSpans || []}
              />
            )}

            {typeof moderationState.attemptsRemaining === "number" &&
              !moderationState.isBlocked && (
                <p className="mt-3 rounded-full bg-primary/10 px-3.5 py-1 text-xs font-bold text-primary">
                  المحاولات المتبقية قبل الحظر:{" "}
                  {moderationState.attemptsRemaining}
                </p>
              )}

            <Button
              type="button"
              onClick={() => setModerationState(null)}
              className="mt-5 w-full rounded-2xl"
            >
              تعديل الرسالة
            </Button>
          </div>
        )}
      </dialog>
    </>
  );
}
