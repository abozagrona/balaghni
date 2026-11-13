"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CarFront,
  QrCode,
  ShieldCheck,
  BellRing,
  MapPin,
  Share2,
  Eye,
  Plus,
  CheckCircle2,
  FileCheck2,
  Wrench,
  Clock,
  Camera,
  AlertTriangle,
  Lightbulb,
  DoorOpen,
  Check,
  X,
  LogOut,
  Phone,
  LoaderCircle,
  Fingerprint,
  Sparkles,
  Trash2,
} from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { Button } from "@/components/ui/button";
import {
  arrayBufferToBase64Url,
  cn,
  formatBalaghniTagCode,
} from "@/lib/utils";
import { clearOwnerSession } from "@/lib/auth-session";

interface TagRecordData {
  tagCode: string;
  status: "LOCKED" | "ACTIVE" | "REVOKED";
  ownerPhone?: string | null;
  vehicleInfo?: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicleColor?: string;
  city?: string;
  activatedAt?: string | null;
  hasPasskey?: boolean;
}

interface VehicleDocumentItem {
  id: string;
  tagCode: string;
  title: string;
  subtitle: string;
  expiryDate: string;
  createdAt: string;
}

interface ReportAlertItem {
  id: string;
  tagCode: string;
  reasonTitle: string;
  reasonBadge: string;
  message: string;
  location: string;
  photoUrl?: string | null;
  iconType: "blocking" | "lights" | "window" | "emergency";
  createdAt: string;
}

interface MaintenanceItem {
  id: string;
  tagCode: string;
  serviceType: string;
  date: string;
  mileageKm: string;
  costLyd: number;
  workshop: string;
  notes: string;
  createdAt: string;
}

function computeDocumentStatus(expiryDate: string): {
  daysLeft: number;
  status: "valid" | "warning" | "urgent";
  statusLabel: string;
} {
  const targetTime = new Date(expiryDate).getTime();
  const nowTime = Date.now();
  if (!Number.isFinite(targetTime)) {
    return { daysLeft: 0, status: "urgent", statusLabel: "يرجى تحديد التاريخ" };
  }
  const diffDays = Math.max(
    0,
    Math.ceil((targetTime - nowTime) / (1000 * 60 * 60 * 24))
  );
  const status: "valid" | "warning" | "urgent" =
    diffDays > 45 ? "valid" : diffDays > 14 ? "warning" : "urgent";
  const statusLabel =
    status === "valid"
      ? "ساري المفعول"
      : status === "warning"
      ? "يقترب الانتهاء"
      : "يتطلب التجديد العاجل";
  return { daysLeft: diffDays, status, statusLabel };
}

function formatArabicDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ar-LY", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const queryTag = searchParams.get("tag");

  const [loading, setLoading] = React.useState(true);
  const [tagData, setTagData] = React.useState<TagRecordData | null>(null);
  const [docs, setDocs] = React.useState<VehicleDocumentItem[]>([]);
  const [reports, setReports] = React.useState<ReportAlertItem[]>([]);
  const [maintenanceList, setMaintenanceList] = React.useState<
    MaintenanceItem[]
  >([]);

  const [sharedCopied, setSharedCopied] = React.useState(false);
  const [selectedPhotoAlert, setSelectedPhotoAlert] =
    React.useState<ReportAlertItem | null>(null);

  // نموذج إضافة أو تحديث وثيقة في جدول vehicle_documents
  const [showAddDocModal, setShowAddDocModal] = React.useState(false);
  const [docTitle, setDocTitle] = React.useState("التأمين الإجباري");
  const [docSubtitle, setDocSubtitle] = React.useState("");
  const [docExpiryDate, setDocExpiryDate] = React.useState("");
  const [savingDoc, setSavingDoc] = React.useState(false);

  const [editingDocId, setEditingDocId] = React.useState<string | null>(null);
  const [editingExpiryDate, setEditingExpiryDate] = React.useState("");

  // نموذج إضافة صيانة جديدة في جدول maintenance_records
  const [showAddMaintenance, setShowAddMaintenance] = React.useState(false);
  const [newServiceType, setNewServiceType] = React.useState(
    "تغيير زيت المحرك + فلتر"
  );
  const [newDate, setNewDate] = React.useState("");
  const [newMileage, setNewMileage] = React.useState("");
  const [newCostLyd, setNewCostLyd] = React.useState("");
  const [newWorkshop, setNewWorkshop] = React.useState("");
  const [newNotes, setNewNotes] = React.useState("");
  const [savingMaintenance, setSavingMaintenance] = React.useState(false);

  // حالة إدارة البصمة (Passkey) والتلميح الذكي في لوحة تحكم الزبون
  const [passkeyLoading, setPasskeyLoading] = React.useState(false);
  const [passkeyError, setPasskeyError] = React.useState<string | null>(null);
  const [passkeySuccess, setPasskeySuccess] = React.useState<string | null>(
    null
  );
  const [passkeyHintDismissed, setPasskeyHintDismissed] =
    React.useState(false);

  const handleLogout = React.useCallback(() => {
    clearOwnerSession();
    window.location.href = "/";
  }, []);

  // جلب بيانات الملصق، الوثائق، البلاغات، والصيانة الحقيقية من Supabase فقط
  React.useEffect(() => {
    let targetCode = queryTag ? formatBalaghniTagCode(queryTag) : "";

    if (!targetCode) {
      try {
        const savedRaw = window.localStorage.getItem(
          "balaghni_owner_active_tag"
        );
        if (savedRaw) {
          const parsed = JSON.parse(savedRaw);
          if (parsed?.tagCode) {
            targetCode = formatBalaghniTagCode(parsed.tagCode);
          }
        }
      } catch {
        // ignore
      }
    }

    if (!targetCode) {
      window.location.href = "/login";
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/dashboard?tag=${encodeURIComponent(targetCode)}`,
          { cache: "no-store" }
        );
        const data = await res.json().catch(() => ({}));

        if (cancelled) return;

        if (!res.ok || !data.ok || !data.tag) {
          setTagData(null);
          setLoading(false);
          return;
        }

        setTagData(data.tag);
        setDocs(Array.isArray(data.documents) ? data.documents : []);
        setReports(Array.isArray(data.reports) ? data.reports : []);
        setMaintenanceList(
          Array.isArray(data.maintenance) ? data.maintenance : []
        );

        try {
          const dismissed = window.sessionStorage.getItem(
            `balaghni_passkey_hint_dismissed_${data.tag.tagCode}`
          );
          setPasskeyHintDismissed(dismissed === "1");
        } catch {
          setPasskeyHintDismissed(false);
        }
      } catch {
        if (!cancelled) {
          setTagData(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [queryTag]);

  const handleDismissPasskeyHint = () => {
    setPasskeyHintDismissed(true);
    if (tagData?.tagCode) {
      try {
        window.sessionStorage.setItem(
          `balaghni_passkey_hint_dismissed_${tagData.tagCode}`,
          "1"
        );
      } catch {
        // ignore
      }
    }
  };

  const handleEnablePasskey = async () => {
    if (!tagData || passkeyLoading) return;
    setPasskeyError(null);
    setPasskeySuccess(null);
    setPasskeyLoading(true);

    try {
      if (
        typeof window === "undefined" ||
        !window.PublicKeyCredential ||
        !navigator.credentials?.create
      ) {
        setPasskeyError(
          "متصفحك الحالي لا يدعم المصادقة بالبصمة (WebAuthn). يمكنك الاستمرار باستخدام رمز الـ PIN."
        );
        return;
      }

      // جلب RP ID الموحد من الخادم (مع إزالة www. تلقائياً) لضمان التوافق على جميع المتصفحات والهواتف
      const configRes = await fetch("/api/auth/passkey", {
        cache: "no-store",
      }).catch(() => null);
      const configData = configRes
        ? await configRes.json().catch(() => ({}))
        : {};
      const rpId =
        String(configData.rpId || "").trim() ||
        window.location.hostname.replace(/^www\./, "");

      const phone = (tagData.ownerPhone || tagData.tagCode).trim();
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "بَلِّغْنِي", id: rpId },
          user: {
            id: new TextEncoder().encode(phone),
            name: phone,
            displayName: tagData.vehicleInfo || phone,
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "preferred",
            residentKey: "preferred",
          },
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;

      if (!credential || !credential.rawId) {
        setPasskeyError("تم إلغاء عملية تسجيل البصمة أو لم تكتمل.");
        return;
      }

      const base64UrlCredId = arrayBufferToBase64Url(credential.rawId);
      const saveRes = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tagCode: tagData.tagCode,
          passkeyCredentialId: base64UrlCredId,
          ownerPhone: tagData.ownerPhone || undefined,
        }),
      });

      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok || !saveData.ok) {
        setPasskeyError(
          saveData.error || "تعذر حفظ البصمة في قاعدة البيانات. حاول مرة أخرى."
        );
        return;
      }

      setTagData((prev) => (prev ? { ...prev, hasPasskey: true } : prev));
      setPasskeySuccess("تم تفعيل الدخول السريع بالبصمة (Passkey) بنجاح ✓");
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setPasskeyError(
          "تم إلغاء نافذة البصمة أو لم يتم التحقق منها على الجهاز."
        );
      } else {
        setPasskeyError(
          "تعذر تفعيل البصمة على هذا الجهاز حالياً. تأكد من تفعيل قفل الشاشة/البصمة في هاتفك."
        );
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleDisablePasskey = async () => {
    if (!tagData || passkeyLoading) return;
    setPasskeyError(null);
    setPasskeySuccess(null);
    setPasskeyLoading(true);

    try {
      const res = await fetch("/api/auth/passkey", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagCode: tagData.tagCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setPasskeyError(data.error || "تعذر إلغاء تفعيل البصمة.");
        return;
      }

      setTagData((prev) => (prev ? { ...prev, hasPasskey: false } : prev));
      setPasskeySuccess("تم إلغاء ربط البصمة عن هذا الملصق بنجاح.");
    } catch {
      setPasskeyError("تعذر الاتصال بالخادم أثناء إلغاء البصمة.");
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleShareQr = async () => {
    if (!tagData) return;
    const shareUrl = `${window.location.origin}/s/${encodeURIComponent(
      tagData.tagCode
    )}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `ملصق بَلِّغْنِي (${tagData.tagCode})`,
          text: `رابط التواصل السريع مع صاحب المركبة عبر منصة بَلِّغْنِي:`,
          url: shareUrl,
        });
        return;
      } catch {
        // fallback to clipboard
      }
    }
    navigator.clipboard?.writeText(shareUrl).catch(() => {});
    setSharedCopied(true);
    setTimeout(() => setSharedCopied(false), 2200);
  };

  const handleAddDocumentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagData || !docTitle.trim() || !docExpiryDate || savingDoc) return;

    setSavingDoc(true);
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_document",
          tagCode: tagData.tagCode,
          title: docTitle.trim(),
          subtitle: docSubtitle.trim(),
          expiryDate: docExpiryDate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.document) {
        setDocs((prev) => [...prev, data.document]);
        setShowAddDocModal(false);
        setDocSubtitle("");
        setDocExpiryDate("");
      }
    } finally {
      setSavingDoc(false);
    }
  };

  const handleUpdateDocExpiry = async (doc: VehicleDocumentItem) => {
    if (!tagData || !editingExpiryDate) return;

    const res = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsert_document",
        tagCode: tagData.tagCode,
        id: doc.id,
        title: doc.title,
        subtitle: doc.subtitle,
        expiryDate: editingExpiryDate,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok && data.document) {
      setDocs((prev) =>
        prev.map((d) => (d.id === doc.id ? data.document : d))
      );
    }
    setEditingDocId(null);
  };

  const handleAddMaintenanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagData || !newServiceType.trim() || !newDate || savingMaintenance) {
      return;
    }

    setSavingMaintenance(true);
    try {
      const costNum = parseFloat(newCostLyd) || 0;
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_maintenance",
          tagCode: tagData.tagCode,
          serviceType: newServiceType.trim(),
          date: newDate,
          mileageKm: newMileage.trim(),
          costLyd: costNum,
          workshop: newWorkshop.trim(),
          notes: newNotes.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.record) {
        setMaintenanceList((prev) => [data.record, ...prev]);
        setShowAddMaintenance(false);
        setNewDate("");
        setNewMileage("");
        setNewCostLyd("");
        setNewWorkshop("");
        setNewNotes("");
      }
    } finally {
      setSavingMaintenance(false);
    }
  };

  const totalMaintenanceCostLyd = maintenanceList.reduce(
    (sum, item) => sum + (Number(item.costLyd) || 0),
    0
  );

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <LoaderCircle className="h-9 w-9 animate-spin text-primary" />
            <p className="text-sm font-bold text-foreground">
              جاري جلب بيانات مركبتك من قاعدة البيانات...
            </p>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (!tagData) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-card-soft space-y-4">
            <h1 className="text-xl font-black text-foreground">
              لم يتم العثور على جلسة ملصق نشطة
            </h1>
            <p className="text-xs leading-relaxed text-muted-foreground">
              يرجى تسجيل الدخول برقم هاتفك ورمز المرور للوصول إلى لوحة تحكم
              مركبتك.
            </p>
            <Button onClick={handleLogout} size="lg" className="w-full rounded-2xl">
              الانتقال إلى صفحة تسجيل الدخول
            </Button>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const displayVehicleName =
    tagData.vehicleInfo ||
    `${tagData.vehicleBrand || ""} ${tagData.vehicleModel || ""}`.trim() ||
    "غير محدد";

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1 py-8 sm:py-12">
        <div className="shell space-y-10">
          {/* تلميح ذكي لتفعيل البصمة (يظهر فقط إذا لم تكن البصمة مفعلة ولم يتم تجاهله مؤقتاً) */}
          {!tagData.hasPasskey && !passkeyHintDismissed && (
            <div className="relative overflow-hidden rounded-3xl border border-primary/35 bg-gradient-to-l from-[#141721] via-[#171B28] to-[#1F1218] p-5 text-white shadow-card-soft sm:p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3.5">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/20 text-primary">
                    <Fingerprint className="h-6 w-6" />
                  </span>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/20 px-2.5 py-0.5 text-[11px] font-bold text-primary-accent">
                        <Sparkles className="h-3 w-3" />
                        تلميح أمان ذكي
                      </span>
                      <h2 className="text-base font-black text-white sm:text-lg">
                        فعّل الدخول السريع بالبصمة (Passkey)
                      </h2>
                    </div>
                    <p className="max-w-2xl text-xs leading-relaxed text-white/75 sm:text-sm">
                      ادخل إلى لوحة تحكم مركبتك فوراً ببصمة الوجه أو الإصبع بدون
                      الحاجة لكتابة رقم الهاتف أو رمز الـ PIN في كل مرة.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 sm:shrink-0">
                  <Button
                    type="button"
                    size="lg"
                    onClick={handleEnablePasskey}
                    disabled={passkeyLoading}
                    className="rounded-2xl shadow-primary-glow"
                  >
                    {passkeyLoading ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        <span>جاري التفعيل...</span>
                      </>
                    ) : (
                      <>
                        <Fingerprint className="h-4 w-4" />
                        <span>تفعيل البصمة الآن</span>
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    onClick={handleDismissPasskeyHint}
                    disabled={passkeyLoading}
                    className="rounded-2xl text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    <span>تجاهل مؤقتاً</span>
                  </Button>
                </div>
              </div>

              {passkeyError && (
                <p className="mt-3 rounded-xl border border-primary/40 bg-primary/15 px-3.5 py-2 text-xs font-bold text-primary-accent">
                  {passkeyError}
                </p>
              )}
            </div>
          )}

          {/* 1. قسم مركبتي والملصق النشط (مجلوب حصراً من سطر الملصق في جدول tags) */}
          <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#0B0D13] p-6 text-white shadow-[0_24px_60px_rgba(11,13,19,0.22)] sm:p-8 lg:p-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/25 blur-3xl"
            />

            <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-400">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    حالة الملصق: {tagData.status}
                  </span>
                  <span
                    dir="ltr"
                    className="rounded-full border border-primary/40 bg-primary/15 px-3.5 py-1 font-mono text-xs font-black text-white"
                  >
                    {tagData.tagCode}
                  </span>
                </div>

                <h1 className="text-2xl font-black tracking-tight text-white sm:text-4xl">
                  لوحة تحكم مركبتي وخدمة «نبّهني»
                </h1>

                <p className="max-w-xl text-xs leading-relaxed text-white/75 sm:text-sm">
                  تعرض هذه اللوحة البيانات الحقيقية المسجلة لملصق سيارتك فقط
                  بدون أي بيانات افتراضية.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={handleShareQr}
                  size="lg"
                  className="rounded-2xl"
                >
                  {sharedCopied ? (
                    <>
                      <Check className="h-4 w-4" />
                      <span>تم نسخ رابط الـ QR ✓</span>
                    </>
                  ) : (
                    <>
                      <Share2 className="h-4 w-4" />
                      <span>مشاركة الـ QR</span>
                    </>
                  )}
                </Button>

                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="rounded-2xl border-white/20 bg-white/5 text-white hover:bg-white/15"
                >
                  <Link href={`/s/${encodeURIComponent(tagData.tagCode)}`}>
                    <Eye className="h-4 w-4 text-primary" />
                    <span>معاينة صفحة البلاغات</span>
                  </Link>
                </Button>

                <Button
                  type="button"
                  onClick={handleLogout}
                  variant="ghost"
                  size="sm"
                  className="rounded-xl text-white/60 hover:bg-white/10 hover:text-white"
                >
                  <LogOut className="h-4 w-4" />
                  <span>تسجيل الخروج</span>
                </Button>
              </div>
            </div>

            {/* شبكة تفاصيل المركبة المجلوبة من جدول tags فقط */}
            <div className="relative z-10 mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <span className="text-xs text-white/60">كود الملصق المسجل</span>
                <div className="mt-1 flex items-center justify-between">
                  <span
                    dir="ltr"
                    className="font-mono text-lg font-black text-primary"
                  >
                    {tagData.tagCode}
                  </span>
                  <QrCode className="h-5 w-5 text-white/50" />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <span className="text-xs text-white/60">نوع السيارة</span>
                <div className="mt-1 flex items-center justify-between">
                  <span className="truncate text-base font-bold text-white">
                    {displayVehicleName}
                  </span>
                  <CarFront className="h-5 w-5 text-primary" />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <span className="text-xs text-white/60">المدينة</span>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-base font-bold text-white">
                    {tagData.city || "—"}
                  </span>
                  <MapPin className="h-5 w-5 text-primary" />
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <span className="text-xs text-white/60">رقم الهاتف المسجل</span>
                <div className="mt-1 flex items-center justify-between">
                  <span
                    dir="ltr"
                    className="font-mono text-sm font-bold text-white/90"
                  >
                    {tagData.ownerPhone || "—"}
                  </span>
                  <Phone className="h-5 w-5 text-primary" />
                </div>
              </div>
            </div>
          </section>

          {/* 2. سجل البلاغات الواردة من جدول reports الخاصة بهذا الملصق حصراً */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <BellRing className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-xl font-black text-foreground sm:text-2xl">
                    سجل التنبيهات والبلاغات المستلمة
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    البلاغات الحقيقية المرسلة عند مسح ملصق سيارتك ({tagData.tagCode})
                  </p>
                </div>
              </div>

              <span className="rounded-full bg-secondary px-3.5 py-1 text-xs font-bold text-primary">
                إجمالي البلاغات: {reports.length}
              </span>
            </div>

            {reports.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card p-8 text-center shadow-card-soft">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <BellRing className="h-6 w-6" />
                </span>
                <h3 className="mt-3 text-base font-black text-foreground">
                  لا توجد بلاغات واردة لهذا الملصق بعد
                </h3>
                <p className="mt-1 max-w-md text-xs text-muted-foreground">
                  ستظهر هنا فوراً أي تنبيهات يرسلها المارة عند مسح رمز الـ QR
                  الخاص بسيارتك.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                {reports.map((alert) => {
                  const Icon =
                    alert.iconType === "blocking"
                      ? CarFront
                      : alert.iconType === "lights"
                      ? Lightbulb
                      : alert.iconType === "window"
                      ? DoorOpen
                      : AlertTriangle;

                  return (
                    <div
                      key={alert.id}
                      className="flex flex-col justify-between rounded-3xl border border-border bg-card p-5 shadow-card-soft transition hover:border-primary/35"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-3">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                              <Icon className="h-5 w-5" />
                            </span>
                            <div>
                              <h3 className="text-base font-black text-foreground">
                                {alert.reasonTitle}
                              </h3>
                              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Clock className="h-3 w-3 text-primary" />
                                {formatArabicDateTime(alert.createdAt)}
                              </span>
                            </div>
                          </div>

                          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-bold text-primary">
                            {alert.reasonBadge}
                          </span>
                        </div>

                        {alert.message && (
                          <p className="mt-4 rounded-2xl bg-muted/60 p-3.5 text-xs font-bold leading-relaxed text-foreground sm:text-sm">
                            {alert.message}
                          </p>
                        )}
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 text-primary" />
                          {alert.location || "لم يُرفق موقع جغرافي"}
                        </span>

                        {alert.photoUrl ? (
                          <button
                            type="button"
                            onClick={() => setSelectedPhotoAlert(alert)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-1.5 font-bold text-primary transition hover:bg-primary hover:text-white"
                          >
                            <Camera className="h-3.5 w-3.5" />
                            <span>عرض صورة الحالة</span>
                          </button>
                        ) : (
                          <span className="text-muted-foreground/60">
                            بدون صورة مرفقة
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 3. خدمة «نبّهني» لمتابعة وثائق المركبة (جدول vehicle_documents) */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-white shadow-primary-glow">
                  <FileCheck2 className="h-5 w-5" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-black text-foreground sm:text-2xl">
                      خدمة «نبّهني» لمتابعة وثائق المركبة
                    </h2>
                    <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-bold text-primary">
                      تذكير تلقائي
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    أضف وثائق سيارتك (التأمين، الفحص الفني، الرخصة، الكتيب)
                    لمتابعة تاريخ انتهائها الفعلي
                  </p>
                </div>
              </div>

              {docs.length > 0 && (
                <Button
                  type="button"
                  onClick={() => setShowAddDocModal(!showAddDocModal)}
                  size="default"
                  className="rounded-2xl"
                >
                  <Plus className="h-4 w-4" />
                  <span>+ إضافة وثيقة لمتابعتها</span>
                </Button>
              )}
            </div>

            {/* نموذج إضافة وثيقة جديدة */}
            {showAddDocModal && (
              <form
                onSubmit={handleAddDocumentSubmit}
                className="rounded-3xl border-2 border-primary/30 bg-card p-6 shadow-primary-glow space-y-4"
              >
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <h3 className="text-base font-black text-foreground">
                    إضافة وثيقة جديدة لمتابعتها
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowAddDocModal(false)}
                    className="text-xs font-bold text-muted-foreground hover:text-foreground"
                  >
                    إلغاء ✕
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      نوع الوثيقة
                    </label>
                    <select
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-xs font-bold text-foreground"
                    >
                      <option value="التأمين الإجباري">التأمين الإجباري</option>
                      <option value="رخصة القيادة">رخصة القيادة</option>
                      <option value="الفحص الفني">الفحص الفني</option>
                      <option value="كتيب السيارة">كتيب السيارة</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      وصف أو ملاحظة (اختياري)
                    </label>
                    <input
                      type="text"
                      value={docSubtitle}
                      onChange={(e) => setDocSubtitle(e.target.value)}
                      placeholder="مثال: وثيقة تأمين سنوية"
                      className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-xs font-medium text-foreground"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      تاريخ الانتهاء الفعلي
                    </label>
                    <input
                      type="date"
                      required
                      value={docExpiryDate}
                      onChange={(e) => setDocExpiryDate(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-surface px-3 font-mono text-xs font-bold text-foreground"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    size="lg"
                    disabled={savingDoc}
                    className="rounded-xl px-6"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{savingDoc ? "جاري الحفظ..." : "حفظ الوثيقة"}</span>
                  </Button>
                </div>
              </form>
            )}

            {docs.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card p-10 text-center shadow-card-soft">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <FileCheck2 className="h-7 w-7" />
                </span>
                <h3 className="mt-3.5 text-lg font-black text-foreground">
                  لا توجد وثائق مسجلة بعد
                </h3>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                  لم تقم بإضافة أي وثائق لسيارتك حتى الآن. أضف تاريخ انتهاء
                  التأمين أو الرخصة أو الفحص الفني ليقوم نظام «نبّهني» بتذكيرك
                  قبل انتهائها.
                </p>
                <Button
                  type="button"
                  size="lg"
                  onClick={() => setShowAddDocModal(true)}
                  className="mt-5 rounded-2xl"
                >
                  <span>+ إضافة وثيقة لمتابعتها</span>
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {docs.map((doc) => {
                  const computed = computeDocumentStatus(doc.expiryDate);
                  const isValid = computed.status === "valid";
                  const isWarning = computed.status === "warning";
                  const progressPercent = Math.min(
                    100,
                    Math.max(8, Math.round((computed.daysLeft / 365) * 100))
                  );

                  return (
                    <div
                      key={doc.id}
                      className={cn(
                        "flex flex-col justify-between rounded-3xl border p-5 shadow-card-soft transition",
                        isValid
                          ? "border-emerald-500/30 bg-card"
                          : isWarning
                          ? "border-amber-500/40 bg-card"
                          : "border-primary/50 bg-secondary/35 shadow-primary-glow"
                      )}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                              isValid
                                ? "bg-emerald-500/15 text-emerald-700"
                                : isWarning
                                ? "bg-amber-500/15 text-amber-800"
                                : "bg-primary text-white"
                            )}
                          >
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full",
                                isValid
                                  ? "bg-emerald-500"
                                  : isWarning
                                  ? "bg-amber-500"
                                  : "bg-white animate-ping"
                              )}
                            />
                            {computed.statusLabel}
                          </span>

                          <span className="font-mono text-xs font-bold text-muted-foreground">
                            متبقي {computed.daysLeft} يوم
                          </span>
                        </div>

                        <h3 className="mt-3.5 text-lg font-black text-foreground">
                          {doc.title}
                        </h3>
                        {doc.subtitle && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {doc.subtitle}
                          </p>
                        )}

                        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            style={{ width: `${progressPercent}%` }}
                            className={cn(
                              "h-full rounded-full transition-all",
                              isValid
                                ? "bg-emerald-500"
                                : isWarning
                                ? "bg-amber-500"
                                : "bg-primary"
                            )}
                          />
                        </div>
                      </div>

                      <div className="mt-4 border-t border-border pt-3">
                        {editingDocId === doc.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="date"
                              value={editingExpiryDate}
                              onChange={(e) =>
                                setEditingExpiryDate(e.target.value)
                              }
                              className="h-9 flex-1 rounded-xl border border-input bg-surface px-2 font-mono text-xs font-bold text-foreground"
                            />
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleUpdateDocExpiry(doc)}
                              className="h-9 rounded-xl px-3 text-xs"
                            >
                              حفظ
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between text-xs">
                            <div>
                              <span className="block text-[10px] text-muted-foreground">
                                تاريخ الانتهاء:
                              </span>
                              <span
                                dir="ltr"
                                className="font-mono font-bold text-foreground"
                              >
                                {doc.expiryDate}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingDocId(doc.id);
                                setEditingExpiryDate(doc.expiryDate);
                              }}
                              className="rounded-xl border border-border bg-muted/60 px-2.5 py-1.5 text-[11px] font-bold text-foreground transition hover:border-primary hover:text-primary"
                            >
                              تحديث الموعد
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 4. سجل الصيانة الدورية بالدينار الليبي (د.ل) */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Wrench className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-xl font-black text-foreground sm:text-2xl">
                    سجل الصيانة الدورية للمركبة
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    سجل عمليات الصيانة الفعلية التي تقوم بإدخالها لسيارتك
                    بالدينار الليبي (د.ل)
                  </p>
                </div>
              </div>

              {maintenanceList.length > 0 && (
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl border border-border bg-card px-4 py-2 text-xs">
                    <span className="text-muted-foreground">
                      إجمالي الصيانات:{" "}
                    </span>
                    <span className="font-mono text-sm font-black text-primary">
                      {totalMaintenanceCostLyd.toLocaleString()} د.ل
                    </span>
                  </div>

                  <Button
                    type="button"
                    onClick={() => setShowAddMaintenance(!showAddMaintenance)}
                    size="default"
                    className="rounded-2xl"
                  >
                    <Plus className="h-4 w-4" />
                    <span>+ تسجيل صيانة جديدة</span>
                  </Button>
                </div>
              )}
            </div>

            {/* نموذج إضافة صيانة جديدة */}
            {showAddMaintenance && (
              <form
                onSubmit={handleAddMaintenanceSubmit}
                className="rounded-3xl border-2 border-primary/30 bg-card p-6 shadow-primary-glow space-y-4"
              >
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <h3 className="text-base font-black text-foreground">
                    تسجيل عملية صيانة جديدة
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowAddMaintenance(false)}
                    className="text-xs font-bold text-muted-foreground hover:text-foreground"
                  >
                    إلغاء ✕
                  </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      نوع الصيانة
                    </label>
                    <select
                      value={newServiceType}
                      onChange={(e) => setNewServiceType(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-xs font-bold text-foreground"
                    >
                      <option value="تغيير زيت المحرك + فلتر">
                        تغيير زيت المحرك + فلتر
                      </option>
                      <option value="تبديل إطارات وترصيص">
                        تبديل إطارات وترصيص
                      </option>
                      <option value="صيانة المكابح (الفرامل)">
                        صيانة المكابح (الفرامل)
                      </option>
                      <option value="تبديل بطارية السيارة">
                        تبديل بطارية السيارة
                      </option>
                      <option value="فحص كمبيوتر وصيانة عامة">
                        فحص كمبيوتر وصيانة عامة
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      التاريخ الفعلي
                    </label>
                    <input
                      type="date"
                      required
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-surface px-3 font-mono text-xs font-bold text-foreground"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      عداد المسافة (كم)
                    </label>
                    <input
                      type="text"
                      value={newMileage}
                      onChange={(e) => setNewMileage(e.target.value)}
                      placeholder="مثال: 66,000 كم"
                      className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-xs font-bold text-foreground"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      التكلفة بالدينار الليبي (د.ل)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="5"
                      required
                      value={newCostLyd}
                      onChange={(e) => setNewCostLyd(e.target.value)}
                      placeholder="0"
                      className="h-11 w-full rounded-xl border border-input bg-surface px-3 font-mono text-sm font-black text-primary"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      الورشة / المركز
                    </label>
                    <input
                      type="text"
                      value={newWorkshop}
                      onChange={(e) => setNewWorkshop(e.target.value)}
                      placeholder="اسم الورشة أو المركز"
                      className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-xs font-medium text-foreground"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-foreground">
                      ملاحظات إضافية
                    </label>
                    <input
                      type="text"
                      value={newNotes}
                      onChange={(e) => setNewNotes(e.target.value)}
                      placeholder="نوع الزيت أو قطع الغيار المركبة..."
                      className="h-11 w-full rounded-xl border border-input bg-surface px-3 text-xs font-medium text-foreground"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    size="lg"
                    disabled={savingMaintenance}
                    className="rounded-xl px-6"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      {savingMaintenance ? "جاري الحفظ..." : "حفظ سجل الصيانة"}
                    </span>
                  </Button>
                </div>
              </form>
            )}

            {maintenanceList.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-card p-10 text-center shadow-card-soft">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Wrench className="h-7 w-7" />
                </span>
                <h3 className="mt-3.5 text-lg font-black text-foreground">
                  سجل الصيانة فارغ
                </h3>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                  لم تقم بتسجيل أي عملية صيانة أو مصاريف لسيارتك حتى الآن. ابدأ
                  بإضافة أول سجل صيانة لحفظ تاريخ سيارتك.
                </p>
                <Button
                  type="button"
                  size="lg"
                  onClick={() => setShowAddMaintenance(true)}
                  className="mt-5 rounded-2xl"
                >
                  <span>+ تسجيل صيانة جديدة</span>
                </Button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-card-soft">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm">
                    <thead className="border-b border-border bg-muted/60 text-xs font-black text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3.5">نوع الصيانة</th>
                        <th className="px-5 py-3.5">التاريخ</th>
                        <th className="px-5 py-3.5">عداد المسافة</th>
                        <th className="px-5 py-3.5">الورشة / الملاحظات</th>
                        <th className="px-5 py-3.5">التكلفة (د.ل)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {maintenanceList.map((rec) => (
                        <tr
                          key={rec.id}
                          className="transition-colors hover:bg-muted/30"
                        >
                          <td className="px-5 py-4 font-bold text-foreground">
                            {rec.serviceType}
                          </td>
                          <td
                            dir="ltr"
                            className="px-5 py-4 text-right font-mono text-xs font-semibold text-muted-foreground"
                          >
                            {rec.date}
                          </td>
                          <td className="px-5 py-4 font-mono text-xs font-bold text-foreground">
                            {rec.mileageKm || "—"}
                          </td>
                          <td className="px-5 py-4 text-xs text-muted-foreground">
                            <span className="font-bold text-foreground/90">
                              {rec.workshop || "—"}
                            </span>
                            {rec.notes && (
                              <span className="block text-[11px] text-muted-foreground">
                                {rec.notes}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <span className="inline-flex items-center gap-1 rounded-xl bg-secondary px-3 py-1 font-mono text-sm font-black text-primary">
                              {Number(rec.costLyd || 0).toLocaleString()} د.ل
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* 5. قسم إعدادات الأمان والدخول السريع بالبصمة (Passkey) */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-xl font-black text-foreground sm:text-2xl">
                    إعدادات الأمان والدخول السريع
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    تفعيل وإدارة الدخول السريع ببصمة الوجه أو الإصبع (Passkey)
                    لحساب مركبتك
                  </p>
                </div>
              </div>

              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-bold",
                  tagData.hasPasskey
                    ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                    : "border border-amber-500/30 bg-amber-500/10 text-amber-600"
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    tagData.hasPasskey ? "bg-emerald-500" : "bg-amber-500"
                  )}
                />
                {tagData.hasPasskey
                  ? "البصمة مفعّلة ✓"
                  : "البصمة غير مفعّلة"}
              </span>
            </div>

            <div className="rounded-3xl border border-border bg-card p-6 shadow-card-soft sm:p-7">
              <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3.5">
                  <span
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                      tagData.hasPasskey
                        ? "bg-emerald-500/15 text-emerald-600"
                        : "bg-primary/10 text-primary"
                    )}
                  >
                    <Fingerprint className="h-6 w-6" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="text-base font-black text-foreground">
                      الدخول السريع بالبصمة (Passkey)
                    </h3>
                    <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                      {tagData.hasPasskey
                        ? "حسابك مرتبط ببصمة جهازك للدخول الفوري. يمكنك إعادة ربط جهاز جديد أو إلغاء التفعيل في أي وقت."
                        : "اربط بصمة الوجه أو الإصبع بهاتفك للدخول مباشرة إلى لوحة التحكم بدون كتابة رقم الهاتف أو رمز الـ PIN."}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 sm:shrink-0">
                  <Button
                    type="button"
                    size="lg"
                    onClick={handleEnablePasskey}
                    disabled={passkeyLoading}
                    variant={tagData.hasPasskey ? "outline" : "default"}
                    className="rounded-2xl"
                  >
                    {passkeyLoading ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        <span>جاري تسجيل البصمة...</span>
                      </>
                    ) : tagData.hasPasskey ? (
                      <>
                        <Fingerprint className="h-4 w-4 text-primary" />
                        <span>إعادة ربط بصمة جهاز</span>
                      </>
                    ) : (
                      <>
                        <Fingerprint className="h-4 w-4" />
                        <span>تفعيل الدخول بالبصمة (Passkey)</span>
                      </>
                    )}
                  </Button>

                  {tagData.hasPasskey && (
                    <Button
                      type="button"
                      size="lg"
                      variant="ghost"
                      onClick={handleDisablePasskey}
                      disabled={passkeyLoading}
                      className="rounded-2xl text-red-600 hover:bg-red-500/10 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>إلغاء البصمة</span>
                    </Button>
                  )}
                </div>
              </div>

              {passkeySuccess && (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{passkeySuccess}</span>
                </div>
              )}

              {passkeyError && (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3 text-xs font-bold text-primary">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{passkeyError}</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* نافذة معاينة صورة الحالة المرفقة في البلاغ */}
      {selectedPhotoAlert && selectedPhotoAlert.photoUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-white/15 bg-[#141721] p-5 text-white shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-white">
                  {selectedPhotoAlert.reasonTitle}
                </h3>
                <p className="text-xs text-white/60">
                  {formatArabicDateTime(selectedPhotoAlert.createdAt)} •{" "}
                  {selectedPhotoAlert.location}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPhotoAlert(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedPhotoAlert.photoUrl}
                alt={selectedPhotoAlert.reasonTitle}
                className="max-h-80 w-full object-cover"
              />
            </div>

            <p className="mt-3 text-xs text-white/80">
              {selectedPhotoAlert.message}
            </p>
          </div>
        </div>
      )}

      <SiteFooter />
    </div>
  );
}

export default function OwnerDashboardPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
          جاري تحميل لوحة التحكم...
        </div>
      }
    >
      <DashboardContent />
    </React.Suspense>
  );
}
