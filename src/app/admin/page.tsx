"use client";

import * as React from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  AlertOctagon,
  QrCode,
  Search,
  Edit3,
  RotateCcw,
  Upload,
  Plus,
  Users,
  History,
  Trash2,
  CheckCircle2,
  X,
  LogOut,
  LoaderCircle,
  AlertTriangle,
  Flame,
  Eye,
  Clock,
  Activity,
  Ban,
  Copy,
  Store,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { AdminLifecyclePanel } from "@/components/admin/admin-lifecycle-panel";
import { Button } from "@/components/ui/button";
import {
  arrayBufferToBase64Url,
  base64UrlToUint8Array,
  cn,
  formatBalaghniTagCode,
} from "@/lib/utils";

type TagStatus = "LOCKED" | "ACTIVE" | "REVOKED";
type AlertChannel = "SMS" | "WHATSAPP" | "BOTH";
type AdminPermission =
  | "manage_reports"
  | "manage_tags"
  | "import_batches"
  | "manage_admins"
  | "danger_zone"
  | "can_live_edit";

interface AdminProfileSession {
  id: string;
  fullName: string;
  username: string;
  phone: string;
  role: string;
  permissions: AdminPermission[];
  mustChangePassword?: boolean;
  passkeyCredentialId: string | null;
  isActive: boolean;
  lastLogin: string | null;
  sessionToken?: string;
  sessionCreatedAt?: number;
  lastActivityAt?: number;
}

// المهل الزمنية الصارمة لجلسات المديرين
const ADMIN_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 دقيقة خمول
const ADMIN_ABSOLUTE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // ساعتان كحد أقصى للجلسة
const ADMIN_COOKIE_MAX_AGE_SECONDS = 2 * 60 * 60; // 7200 ثانية

interface AdminTagRecord {
  tagCode: string;
  status: TagStatus;
  ownerPhone?: string | null;
  vehicleInfo?: string;
  vehicleBrand: string;
  vehicleModel: string;
  city?: string;
  alertChannel: AlertChannel;
  hasSecuritySetup?: boolean;
  hasPasskey?: boolean;
  activatedAt?: string | null;
}

interface AdminAuditLog {
  id: string;
  adminId?: string | null;
  adminName: string;
  actionType: string;
  actionDetails: string;
  tagCode?: string | null;
  createdAt: string;
}

interface AdminTeamMember {
  id: string;
  fullName: string;
  username?: string;
  roleTitle: string;
  phone: string;
  permissions: AdminPermission[];
  mustChangePassword?: boolean;
  passkeyCredentialId?: string | null;
  status: "ACTIVE" | "FROZEN";
  lastLogin?: string | null;
  createdAt: string;
}

const PERMISSION_LABELS: Record<AdminPermission, string> = {
  manage_reports: "إدارة البلاغات",
  manage_tags: "إدارة الملصقات",
  import_batches: "استيراد الدفعات",
  manage_admins: "إدارة المشرفين",
  danger_zone: "العمليات الخطرة",
  can_live_edit: "السماح بتعديل الموقع المباشر (can_live_edit)",
};

const ALL_PERMISSIONS: AdminPermission[] = [
  "manage_reports",
  "manage_tags",
  "import_batches",
  "manage_admins",
  "danger_zone",
  "can_live_edit",
];

const ADMIN_SESSION_STORAGE_KEY = "balaghni_enterprise_admin_session";

function formatDateTimeAr(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ar-LY", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function ExecutiveAdminDashboardPage() {
  // حالة الجلسة الإدارية المؤسسية (Identity-First Enterprise Admin Auth)
  const [adminSession, setAdminSession] =
    React.useState<AdminProfileSession | null>(null);
  const [identifierInput, setIdentifierInput] = React.useState("");
  const [passwordInput, setPasswordInput] = React.useState("");
  const [authLoading, setAuthLoading] = React.useState(false);
  const [passkeyLoading, setPasskeyLoading] = React.useState(false);
  const [passkeyEnrollLoading, setPasskeyEnrollLoading] =
    React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = React.useState<number>(4);
  const [lockedUntilIso, setLockedUntilIso] = React.useState<string | null>(
    null
  );
  const [countdownSec, setCountdownSec] = React.useState<number>(0);

  const isAuthenticated = Boolean(adminSession);
  const adminName = adminSession?.fullName || "مدير النظام الرئيسي";
  const adminId = adminSession?.id || null;

  // بيانات لوحة الإدارة التنفيذية
  const [activeTab, setActiveTab] = React.useState<
    "tags" | "lifecycle" | "import" | "audit" | "team" | "danger"
  >("tags");
  const [tags, setTags] = React.useState<AdminTagRecord[]>([]);
  const [auditLogs, setAuditLogs] = React.useState<AdminAuditLog[]>([]);
  const [teamMembers, setTeamMembers] = React.useState<AdminTeamMember[]>([]);
  const [reportsCount, setReportsCount] = React.useState(0);
  const [loadingData, setLoadingData] = React.useState(true);
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);

  // البحث والفلترة اللحظية في جدول الملصقات
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | TagStatus>(
    "ALL"
  );

  // نافذة تعديل المركبة والباقة
  const [editingTag, setEditingTag] = React.useState<AdminTagRecord | null>(
    null
  );
  const [editVehicleInfo, setEditVehicleInfo] = React.useState("");
  const [editCity, setEditCity] = React.useState("طرابلس");
  const [editOwnerPhone, setEditOwnerPhone] = React.useState("");
  const [editAlertChannel, setEditAlertChannel] =
    React.useState<AlertChannel>("BOTH");

  // نافذة إعادة تعيين أمان المالك
  const [securityModalTag, setSecurityModalTag] =
    React.useState<AdminTagRecord | null>(null);
  const [newClientPin, setNewClientPin] = React.useState("");

  // نافذة استعراض وتأكيد إعادة ضبط المصنع
  const [factoryResetModalTag, setFactoryResetModalTag] =
    React.useState<AdminTagRecord | null>(null);
  const [factoryResetLoading, setFactoryResetLoading] = React.useState(false);

  // تبويب استيراد الدفعات (CSV / JSON) وإدخال ملصق مطبوع مفرد
  const [singleTagCode, setSingleTagCode] = React.useState("");
  const [singleScratchPin, setSingleScratchPin] = React.useState("");
  const [importing, setImporting] = React.useState(false);

  // تبويب إدارة فريق المشرفين (Team & RBAC - admin_profiles)
  const [newMemberName, setNewMemberName] = React.useState("");
  const [newMemberUsername, setNewMemberUsername] = React.useState("");
  const [newMemberRole, setNewMemberRole] = React.useState("OPERATOR");
  const [newMemberPhone, setNewMemberPhone] = React.useState("");
  const [newMemberPerms, setNewMemberPerms] = React.useState<
    AdminPermission[]
  >(["manage_reports", "manage_tags"]);

  // بطاقة بيانات الدخول المولدة تلقائياً (إنشاء / إعادة تعيين)
  const [issuedCredentials, setIssuedCredentials] = React.useState<{
    title: string;
    fullName: string;
    username: string;
    phone: string;
    password: string;
  } | null>(null);

  // تعديل وحذف حسابات المشرفين
  const [editingMember, setEditingMember] =
    React.useState<AdminTeamMember | null>(null);
  const [editMemberName, setEditMemberName] = React.useState("");
  const [editMemberUsername, setEditMemberUsername] = React.useState("");
  const [editMemberPhone, setEditMemberPhone] = React.useState("");
  const [editMemberRole, setEditMemberRole] = React.useState("");
  const [editMemberPerms, setEditMemberPerms] = React.useState<
    AdminPermission[]
  >([]);
  const [deletingMember, setDeletingMember] =
    React.useState<AdminTeamMember | null>(null);

  // تغيير كلمة المرور الذاتية / الإلزامية
  const [showChangePassModal, setShowChangePassModal] = React.useState(false);
  const [currentPassInput, setCurrentPassInput] = React.useState("");
  const [newPassInput, setNewPassInput] = React.useState("");
  const [confirmPassInput, setConfirmPassInput] = React.useState("");
  const [changePassError, setChangePassError] = React.useState<string | null>(
    null
  );
  const [changePassLoading, setChangePassLoading] = React.useState(false);

  const isSuperAdmin = adminSession?.role === "SUPER_ADMIN";
  const canManageAdmins =
    isSuperAdmin ||
    Boolean(adminSession?.permissions?.includes("manage_admins"));

  // نافذة تأكيد مسح الملصق نهائياً (للأدمن الرئيسي فقط)
  const [deleteModalTag, setDeleteModalTag] =
    React.useState<AdminTagRecord | null>(null);
  const [deleteTagLoading, setDeleteTagLoading] = React.useState(false);

  // منطقة الطوارئ وتصفير النظام (Danger Zone)
  const [showDangerModal, setShowDangerModal] = React.useState(false);
  const [dangerConfirmText, setDangerConfirmText] = React.useState("");

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleAdminLogout = React.useCallback((reason?: string) => {
    try {
      window.sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      document.cookie =
        "balaghni_admin_session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT; max-age=0;";
    } catch {
      // ignore
    }
    setAdminSession(null);
    setPasswordInput("");
    if (reason) {
      setAuthError(reason);
      showToast(reason);
    }
  }, []);

  const adminSessionRef = React.useRef<AdminProfileSession | null>(adminSession);
  adminSessionRef.current = adminSession;

  const isInitialLoadRef = React.useRef(true);

  // ترويسات الصلاحية الإدارية المحمية (مفصولة عن الحالة لمنع إعادة توليد الدوال وحلقات التحديث)
  const getAdminHeaders = React.useCallback(() => {
    const s = adminSessionRef.current;
    return {
      "Content-Type": "application/json",
      ...(s?.sessionToken ? { Authorization: `Bearer ${s.sessionToken}` } : {}),
      ...(s?.id ? { "x-admin-id": s.id } : {}),
    };
  }, []);

  const fetchAdminData = React.useCallback(
    async (idQuery?: string, isBackground = false) => {
      // مؤشر التحميل يعمل لمرة واحدة فقط عند فتح الصفحة لأول مرة (Initial Mount)
      // أي تحديث تالي يتم بسلاسة وصمت في الخلفية دون وميض أو إخفاء صفوف الجدول
      if (isInitialLoadRef.current && !isBackground) {
        setLoadingData(true);
      }
      try {
        const qs = idQuery
          ? `?identifier=${encodeURIComponent(idQuery.trim())}`
          : "";
        const res = await fetch(`/api/admin${qs}`, {
          cache: "no-store",
          headers: getAdminHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 || data.sessionExpired) {
          handleAdminLogout(
            "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
          );
          return;
        }
        if (res.ok && data.ok) {
          setTags(Array.isArray(data.tags) ? data.tags : []);
          setAuditLogs(Array.isArray(data.auditLogs) ? data.auditLogs : []);
          setTeamMembers(
            Array.isArray(data.teamMembers) ? data.teamMembers : []
          );
          setReportsCount(Number(data.reportsCount || 0));
          if (data.authStatus) {
            setLockedUntilIso(data.authStatus.lockedUntilIso || null);
            setRemainingAttempts(
              typeof data.authStatus.remainingAttempts === "number"
                ? data.authStatus.remainingAttempts
                : 4
            );
          }
        }
      } finally {
        isInitialLoadRef.current = false;
        setLoadingData(false);
      }
    },
    [getAdminHeaders, handleAdminLogout]
  );

  // 1. التحويل التلقائي من 127.0.0.1 إلى localhost (إلزامي لعمل WebAuthn وبصمة الجهاز)
  React.useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.location.hostname === "127.0.0.1"
    ) {
      window.location.href = window.location.href.replace(
        "127.0.0.1",
        "localhost"
      );
    }
  }, []);

  // استعادة جلسة المدير مع التحقق من انتهاء الصلاحية فور فتح الصفحة (Mount لمرة واحدة فقط)
  React.useEffect(() => {
    // 1. تنظيف أي تخزين مؤقت قديم للملصقات من المتصفح (localStorage / sessionStorage)
    try {
      window.localStorage.removeItem("balaghni_cached_tags");
      window.sessionStorage.removeItem("balaghni_cached_tags");
      window.localStorage.removeItem("balaghni_tags_cache");
      window.sessionStorage.removeItem("balaghni_tags_cache");
      window.localStorage.removeItem("tags");
      window.sessionStorage.removeItem("tags");
    } catch {
      // ignore
    }

    // 2. فحص جلسة المدير المحفوظة
    try {
      const raw =
        window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) ||
        window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AdminProfileSession;
        if (parsed && parsed.id && parsed.username) {
          const now = Date.now();
          const createdAt = parsed.sessionCreatedAt || now;
          const lastActive = parsed.lastActivityAt || createdAt;

          if (
            now - createdAt >= ADMIN_ABSOLUTE_TIMEOUT_MS ||
            now - lastActive >= ADMIN_IDLE_TIMEOUT_MS
          ) {
            handleAdminLogout(
              "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
            );
          } else {
            setAdminSession(parsed);
          }
        }
      }
    } catch {
      // ignore
    }
    void fetchAdminData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // مراقب جلسة المدير التلقائي (Admin Session Watcher):
  // 15 دقيقة خمول من عدم النشاط أو ساعتان كحد أقصى منذ تسجيل الدخول
  React.useEffect(() => {
    if (!isAuthenticated) return;

    const checkSessionExpiry = () => {
      const current = adminSessionRef.current;
      if (!current) return;
      const now = Date.now();
      const createdAt = current.sessionCreatedAt || now;
      const lastActive = current.lastActivityAt || createdAt;

      const idleElapsed = now - lastActive;
      const totalElapsed = now - createdAt;

      if (
        idleElapsed >= ADMIN_IDLE_TIMEOUT_MS ||
        totalElapsed >= ADMIN_ABSOLUTE_TIMEOUT_MS
      ) {
        handleAdminLogout(
          "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
        );
      }
    };

    // فحص دوري كل 10 ثوانٍ
    const intervalId = window.setInterval(checkSessionExpiry, 10000);

    // تحديث وقت النشاط عند تفاعل المشرف (مع Throttle كل 15 ثانية لتجنب كثرة التحديث)
    let lastRecordTime = Date.now();
    const handleUserActivity = () => {
      const current = adminSessionRef.current;
      if (!current) return;
      const now = Date.now();
      const createdAt = current.sessionCreatedAt || now;
      const lastActive = current.lastActivityAt || createdAt;

      if (
        now - lastActive >= ADMIN_IDLE_TIMEOUT_MS ||
        now - createdAt >= ADMIN_ABSOLUTE_TIMEOUT_MS
      ) {
        handleAdminLogout(
          "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
        );
        return;
      }

      if (now - lastRecordTime >= 15000) {
        lastRecordTime = now;
        setAdminSession((prev) => {
          if (!prev) return null;
          const updated: AdminProfileSession = {
            ...prev,
            lastActivityAt: now,
          };
          try {
            window.sessionStorage.setItem(
              ADMIN_SESSION_STORAGE_KEY,
              JSON.stringify(updated)
            );
            window.localStorage.setItem(
              ADMIN_SESSION_STORAGE_KEY,
              JSON.stringify(updated)
            );
          } catch {
            // ignore
          }
          return updated;
        });
      }
    };

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "click",
    ];
    events.forEach((evt) => {
      window.addEventListener(evt, handleUserActivity, { passive: true });
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkSessionExpiry();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      events.forEach((evt) => {
        window.removeEventListener(evt, handleUserActivity);
      });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isAuthenticated, handleAdminLogout]);

  // فحص حالة القفل الزمني (Rate Limit) عند تغيير اسم المستخدم المدخل
  React.useEffect(() => {
    if (!identifierInput.trim() || isAuthenticated) return;
    const timer = window.setTimeout(() => {
      void fetchAdminData(identifierInput, true);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [identifierInput, isAuthenticated, fetchAdminData]);

  // عداد تنازلي حي لمدة القفل الأمني (15 دقيقة بعد 4 محاولات خاطئة متتالية)
  React.useEffect(() => {
    if (!lockedUntilIso) {
      setCountdownSec(0);
      return;
    }

    const updateTimer = () => {
      const diff = Math.max(
        0,
        Math.ceil((new Date(lockedUntilIso).getTime() - Date.now()) / 1000)
      );
      setCountdownSec(diff);
      if (diff <= 0) {
        setLockedUntilIso(null);
        setRemainingAttempts(4);
      }
    };

    updateTimer();
    const timer = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(timer);
  }, [lockedUntilIso]);

  const persistAdminSession = (
    profile: AdminProfileSession,
    token?: string
  ) => {
    const now = Date.now();
    const sessionObj: AdminProfileSession = {
      ...profile,
      sessionToken: token || profile.sessionToken,
      sessionCreatedAt: profile.sessionCreatedAt || now,
      lastActivityAt: now,
    };
    setAdminSession(sessionObj);
    try {
      window.sessionStorage.setItem(
        ADMIN_SESSION_STORAGE_KEY,
        JSON.stringify(sessionObj)
      );
      window.localStorage.setItem(
        ADMIN_SESSION_STORAGE_KEY,
        JSON.stringify(sessionObj)
      );
      document.cookie = `balaghni_admin_session=${encodeURIComponent(
        sessionObj.sessionToken || ""
      )}; path=/; max-age=7200; SameSite=Lax`;
    } catch {
      // ignore
    }
  };

  // 1. المصادقة الفورية بالبصمة الحيوية بنقرة واحدة (Zero-Phone 1-Tap Passkey Flow)
  const handlePasskeyAuth = async () => {
    if (authLoading || passkeyLoading || countdownSec > 0) return;
    setAuthError(null);

    setPasskeyLoading(true);
    try {
      // الخطوة أ: جلب قائمة بجميع passkey_credential_id المسجلة والنشطة (بدون إرسال رقم هاتف)
      const lookupRes = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auth",
          mode: "lookup_passkey",
        }),
      });
      const lookupData = await lookupRes.json().catch(() => ({}));

      const credIds: string[] =
        Array.isArray(lookupData.passkeyCredentialIds)
          ? lookupData.passkeyCredentialIds
          : Array.isArray(lookupData.credentialIds)
          ? lookupData.credentialIds
          : lookupData.passkeyCredentialId
          ? [lookupData.passkeyCredentialId]
          : [];

      // الخطوة ب: استدعاء navigator.credentials.get فوراً (مع allowCredentials: [] إذا كانت فارغة)
      if (typeof window === "undefined" || !navigator.credentials?.get) {
        setAuthError("المتصفح الحالي لا يدعم المصادقة بالبصمة الحيوية (WebAuthn).");
        return;
      }

      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      const allowCredentials =
        credIds.length > 0
          ? credIds.map((cid: string) => ({
              id: base64UrlToUint8Array(cid),
              type: "public-key" as const,
            }))
          : [];

      let assertion: PublicKeyCredential | null = null;
      try {
        assertion = (await navigator.credentials.get({
          publicKey: {
            challenge,
            rpId: window.location.hostname,
            allowCredentials,
            userVerification: "required",
            timeout: 60000,
          },
        })) as PublicKeyCredential | null;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[Real WebAuthn get error]:", msg);
        if (err instanceof Error && err.name === "NotAllowedError") {
          setAuthError("تم إلغاء نافذة البصمة من قِبل المستخدم أو لم يتم التعرف عليها.");
        } else {
          setAuthError(`تعذر التحقق من البصمة: ${msg}`);
        }
        return;
      }

      if (!assertion || !assertion.rawId) {
        setAuthError("تعذر التحقق من البصمة أو لم تكتمل العملية.");
        return;
      }

      // الخطوة ج: إرسال credential_id الناتج فقط إلى /api/admin
      const verifiedId = arrayBufferToBase64Url(assertion.rawId);
      const loginRes = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auth",
          mode: "passkey_login",
          credential_id: verifiedId,
        }),
      });
      const loginData = await loginRes.json().catch(() => ({}));

      if (!loginRes.ok || !loginData.ok || !loginData.adminProfile) {
        setAuthError(
          loginData.error || "فشل اعتماد تسجيل الدخول بالبصمة الحيوية."
        );
        if (loginData.lockedUntilIso) {
          setLockedUntilIso(loginData.lockedUntilIso);
        }
        if (typeof loginData.remainingAttempts === "number") {
          setRemainingAttempts(loginData.remainingAttempts);
        }
        return;
      }

      persistAdminSession(loginData.adminProfile, loginData.sessionToken);
      setIdentifierInput(
        loginData.adminProfile.phone || loginData.adminProfile.username || ""
      );
      setPasswordInput("");
      await fetchAdminData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء المصادقة.";
      setAuthError(msg);
    } finally {
      setPasskeyLoading(false);
    }
  };


  // 2. تسجيل الدخول برقم الهاتف وكلمة المرور من جدول admin_profiles
  const handlePasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authLoading || passkeyLoading || countdownSec > 0) return;
    setAuthError(null);

    const cleanId = identifierInput.trim();
    if (!cleanId) {
      setAuthError("يرجى إدخال رقم الهاتف.");
      return;
    }
    if (!passwordInput.trim()) {
      setAuthError("يرجى إدخال كلمة المرور.");
      return;
    }

    setAuthLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auth",
          mode: "password_login",
          identifier: cleanId,
          password: passwordInput.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok || !data.adminProfile) {
        setAuthError(
          data.error || "بيانات الاعتماد غير صحيحة أو الحساب غير مفعل"
        );
        if (data.lockedUntilIso) setLockedUntilIso(data.lockedUntilIso);
        if (typeof data.remainingAttempts === "number") {
          setRemainingAttempts(data.remainingAttempts);
        }
        await fetchAdminData(cleanId);
        return;
      }

      persistAdminSession(data.adminProfile, data.sessionToken);
      setPasswordInput("");
      await fetchAdminData();
    } finally {
      setAuthLoading(false);
    }
  };

  // 2. التفعيل الحقيقي لحسّاس بصمة الجهاز عند الربط (Real WebAuthn Registration)
  const handleRegisterAdminPasskey = async () => {
    if (!adminSession) return;
    if (passkeyEnrollLoading) return;

    if (
      typeof window === "undefined" ||
      !window.PublicKeyCredential ||
      !navigator.credentials?.create
    ) {
      showToast("المتصفح الحالي لا يدعم تفعيل البصمة الحيوية (WebAuthn).");
      return;
    }

    setPasskeyEnrollLoading(true);
    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const userIdentifier = adminSession.phone || adminSession.username;

      // استدعاء navigator.credentials.create بإعدادات حقيقية تجبر الجهاز على فتح قارئ البصمة/الوجه
      let credential: PublicKeyCredential | null = null;
      try {
        credential = (await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: {
              name: "Balaghni Admin",
              id: window.location.hostname,
            },
            user: {
              id: new TextEncoder().encode(userIdentifier),
              name: userIdentifier,
              displayName: adminSession.fullName || userIdentifier,
            },
            pubKeyCredParams: [
              { type: "public-key", alg: -7 },  // ES256
              { type: "public-key", alg: -257 }, // RS256
            ],
            authenticatorSelection: {
              authenticatorAttachment: "platform",
              userVerification: "required",
              residentKey: "preferred",
            },
            timeout: 60000,
          },
        })) as PublicKeyCredential | null;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[Real WebAuthn create error]:", msg);
        if (err instanceof Error && err.name === "NotAllowedError") {
          showToast("تم إلغاء نافذة البصمة من قِبل المستخدم.");
        } else {
          showToast(`خطأ في قراءة البصمة: ${msg}`);
        }
        return;
      }

      if (!credential || !credential.rawId) {
        showToast("لم يتم إتمام قراءة البصمة من الجهاز.");
        return;
      }

      // تحويل credential.rawId إلى نص Base64URL
      const credId = arrayBufferToBase64Url(credential.rawId);

      // إرسال المعرف إلى مسار /api/admin ليتم حفظه فعلياً في عمود passkey_credential_id داخل جدول public.admin_profiles
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auth",
          mode: "enroll_passkey",
          adminId: adminSession.id,
          identifier: userIdentifier,
          passkeyCredentialId: credId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const updatedSession: AdminProfileSession = {
          ...adminSession,
          passkeyCredentialId: credId,
        };
        persistAdminSession(updatedSession, adminSession.sessionToken);
        showToast("تم ربط بصمة هذا الجهاز (Passkey) وحفظها في قاعدة البيانات بنجاح ✓");
        await fetchAdminData();
      } else {
        showToast(data.error || "فشل تأكيد حفظ البصمة في قاعدة البيانات.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ أثناء تفعيل البصمة.";
      showToast(`تعذر تفعيل البصمة: ${msg}`);
    } finally {
      setPasskeyEnrollLoading(false);
    }
  };

  // 4. معالج مسح وفك ارتباط البصمة الحيوية
  const handleUnlinkAdminPasskey = async () => {
    if (!adminSession?.passkeyCredentialId) return;
    if (
      !window.confirm(
        "هل تريد بالتأكيد إلغاء ومسح ربط البصمة الحيوية من هذا الحساب؟"
      )
    ) {
      return;
    }
    setPasskeyEnrollLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auth",
          mode: "unlink_passkey",
          adminId: adminSession.id,
          identifier: adminSession.phone || adminSession.username,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const updatedSession: AdminProfileSession = {
          ...adminSession,
          passkeyCredentialId: null,
        };
        persistAdminSession(updatedSession, adminSession.sessionToken);
        showToast("تم مسح وفك ارتباط البصمة بنجاح ✓ يمكنك الآن إعادة تعيينها.");
        await fetchAdminData();
      } else {
        showToast(data.error || "تعذر مسح البصمة.");
      }
    } catch {
      showToast("تعذر مسح البصمة.");
    } finally {
      setPasskeyEnrollLoading(false);
    }
  };

  // إدارة دورة حياة الملصقات مع تحديث فوري لحظي (Optimistic UI) وتطبيق على قاعدة البيانات
  const handleQuickStatusChange = async (
    tagCode: string,
    status: TagStatus
  ) => {
    const prevTags = [...tags];
    setTags((current) =>
      current.map((t) => (t.tagCode === tagCode ? { ...t, status } : t))
    );

    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: getAdminHeaders(),
        body: JSON.stringify({
          action: "set_status",
          tagCode,
          status,
          adminId,
          adminName,
          sessionToken: adminSession?.sessionToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || data.sessionExpired) {
        setTags(prevTags);
        handleAdminLogout(
          "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
        );
        return;
      }
      if (res.ok && data.ok) {
        setTags(data.tags || []);
        setAuditLogs(data.auditLogs || []);
        showToast(`تم تغيير حالة الملصق (${tagCode}) إلى ${status} بنجاح ✓`);
      } else {
        setTags(prevTags);
        showToast(data.error || "تعذر تغيير حالة الملصق.");
      }
    } catch {
      setTags(prevTags);
      showToast("تعذر تغيير حالة الملصق نتيجة خطأ في الاتصال.");
    }
  };

  // إعادة ضبط المصنع الشاملة للملصق وإعادته نظيفاً لحالة LOCKED
  const handleFactoryResetTag = async (tagCode: string) => {
    setFactoryResetLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: getAdminHeaders(),
        body: JSON.stringify({
          action: "factory_reset",
          tagCode,
          adminId,
          adminName,
          sessionToken: adminSession?.sessionToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || data.sessionExpired) {
        handleAdminLogout(
          "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
        );
        return;
      }
      if (res.ok && data.ok) {
        setTags(data.tags || []);
        setAuditLogs(data.auditLogs || []);
        setFactoryResetModalTag(null);
        showToast(
          `تمت إعادة ضبط المصنع للملصق (${tagCode}) وإرجاعه لحالة LOCKED بنجاح ✓`
        );
      } else {
        showToast(data.error || "تعذر إعادة ضبط المصنع للملصق.");
      }
    } catch {
      showToast("تعذر إعادة ضبط المصنع نتيجة خطأ في الاتصال.");
    } finally {
      setFactoryResetLoading(false);
    }
  };

  // مسح الملصق نهائياً من قاعدة البيانات (خاصية مقصورة على الأدمن الرئيسي فقط)
  const handleDeleteTag = async (tagCode: string) => {
    if (!isSuperAdmin) return;
    setDeleteTagLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: getAdminHeaders(),
        body: JSON.stringify({
          action: "delete_tag",
          tagCode,
          adminId,
          adminName,
          sessionToken: adminSession?.sessionToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || data.sessionExpired) {
        handleAdminLogout(
          "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
        );
        return;
      }
      if (res.ok && data.ok) {
        setTags(data.tags || []);
        setAuditLogs(data.auditLogs || []);
        setDeleteModalTag(null);
        showToast(`تم مسح الملصق (${tagCode}) نهائياً بنجاح ✓`);
      } else {
        showToast(data.error || "تعذر مسح الملصق.");
      }
    } catch {
      showToast("تعذر مسح الملصق نتيجة خطأ في الاتصال.");
    } finally {
      setDeleteTagLoading(false);
    }
  };

  const handleSaveVehicleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTag) return;

    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: getAdminHeaders(),
        body: JSON.stringify({
          action: "update_vehicle",
          tagCode: editingTag.tagCode,
          vehicleInfo: editVehicleInfo,
          city: editCity,
          ownerPhone: editOwnerPhone,
          alertChannel: editAlertChannel,
          adminId,
          adminName,
          sessionToken: adminSession?.sessionToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || data.sessionExpired) {
        handleAdminLogout(
          "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
        );
        return;
      }
      if (res.ok && data.ok) {
        setTags(data.tags || []);
        setAuditLogs(data.auditLogs || []);
        setEditingTag(null);
        showToast(`تم تحديث بيانات المركبة للملصق (${editingTag.tagCode}) ✓`);
      } else {
        showToast(data.error || "تعذر تحديث بيانات المركبة.");
      }
    } catch {
      showToast("تعذر تحديث بيانات المركبة نتيجة خطأ في الاتصال.");
    }
  };

  const handleResetOwnerSecuritySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!securityModalTag) return;

    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: getAdminHeaders(),
        body: JSON.stringify({
          action: "reset_owner_security",
          tagCode: securityModalTag.tagCode,
          newOwnerPin: newClientPin.trim() || undefined,
          adminId,
          adminName,
          sessionToken: adminSession?.sessionToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || data.sessionExpired) {
        handleAdminLogout(
          "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
        );
        return;
      }
      if (res.ok && data.ok) {
        setTags(data.tags || []);
        setAuditLogs(data.auditLogs || []);
        setSecurityModalTag(null);
        setNewClientPin("");
        showToast(
          `تمت إعادة تعيين أمان المالك وفك ربط البصمة للملصق (${securityModalTag.tagCode}) ✓`
        );
      } else {
        showToast(data.error || "تعذر إعادة تعيين أمان المالك.");
      }
    } catch {
      showToast("تعذر إعادة تعيين أمان المالك نتيجة خطأ في الاتصال.");
    }
  };

  // إدخال ملصق مطبوع مفرد مع حساب SHA-256 وحفظه مشفراً
  const handleSingleTagInsert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleTagCode.trim() || !singleScratchPin.trim() || importing) return;

    setImporting(true);
    try {
      const formatted = formatBalaghniTagCode(singleTagCode);
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: getAdminHeaders(),
        body: JSON.stringify({
          action: "import_tags",
          adminId,
          adminName,
          sessionToken: adminSession?.sessionToken,
          items: [
            {
              tagCode: formatted,
              scratchPin: singleScratchPin.trim(),
            },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || data.sessionExpired) {
        handleAdminLogout(
          "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
        );
        return;
      }
      if (res.ok && data.ok) {
        setTags(data.tags || []);
        setAuditLogs(data.auditLogs || []);
        setSingleTagCode("");
        setSingleScratchPin("");
        showToast(
          `تم تشفير رمز الخدش (SHA-256) وإدراج الملصق (${formatted}) بحالة LOCKED ✓`
        );
      }
    } finally {
      setImporting(false);
    }
  };

  // رفع ملف دفعات المطبعة (CSV / JSON)
  const handleBatchFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImporting(true);
    try {
      const content = await file.text();
      const parsedItems: Array<{
        tagCode: string;
        scratchPin?: string;
        activationPinHash?: string;
      }> = [];

      if (file.name.endsWith(".json")) {
        const json = JSON.parse(content);
        const arr = Array.isArray(json) ? json : json.tags || [];
        for (const row of arr) {
          parsedItems.push({
            tagCode: formatBalaghniTagCode(
              row.tag_code || row.tagCode || ""
            ),
            scratchPin: row.scratch_pin || row.scratchPin,
            activationPinHash:
              row.activation_pin_hash || row.activationPinHash,
          });
        }
      } else {
        const lines = content
          .split(/\r?\n/)
          .map((l) => l.trim().replace(/^\uFEFF/, ""))
          .filter(Boolean);

        if (lines.length > 0) {
          const firstLine = lines[0].toLowerCase();
          const isHeader =
            firstLine.includes("code") ||
            firstLine.includes("qr_url") ||
            firstLine.includes("كود") ||
            firstLine.includes("tag");

          const dataLines = isHeader ? lines.slice(1) : lines;

          for (const line of dataLines) {
            const cols = line
              .split(",")
              .map((c) => c.replace(/^"|"$/g, "").trim());
            if (cols.length === 0 || !cols.some(Boolean)) continue;

            let tagCode = "";
            let scratchPin: string | undefined = undefined;
            let activationPinHash: string | undefined = undefined;
            let batchName: string | undefined = undefined;
            let status: string | undefined = undefined;

            // الحالة الأولى: code, qr_url, batch_name, status, (activation_pin_hash | scratch_pin)
            if (cols[0] && cols[0].toUpperCase().startsWith("LY-")) {
              tagCode = cols[0];
              if (cols[2] && !cols[2].toUpperCase().startsWith("LOCKED") && !cols[2].toUpperCase().startsWith("ACTIVE")) {
                batchName = cols[2];
              }
              if (cols[3]) {
                status = cols[3].toUpperCase();
              }
              if (cols[4]) {
                if (/^[a-f0-9]{64}$/i.test(cols[4])) {
                  activationPinHash = cols[4].toLowerCase();
                } else if (/^\d{4,8}$/.test(cols[4])) {
                  scratchPin = cols[4];
                }
              }
            }
            // الحالة الثانية: qr_url, tag_code, scratch_pin
            else if (cols[1] && cols[1].toUpperCase().startsWith("LY-")) {
              tagCode = cols[1];
              if (cols[2]) scratchPin = cols[2];
            }
            // الحالة العامة: البحث عن أي عمود يحتوي كود LY-XXXX-XXXX
            else {
              const matched = cols.find((c) => /^LY-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(c));
              if (matched) tagCode = matched;
            }

            if (tagCode) {
              parsedItems.push({
                tagCode: formatBalaghniTagCode(tagCode),
                scratchPin,
                activationPinHash,
              });
            }
          }
        }
      }

      if (parsedItems.length === 0) {
        showToast("لم يتم العثور على أكواد صالحة داخل الملف.");
        setImporting(false);
        return;
      }

      const res = await fetch("/api/admin", {
        method: "POST",
        headers: getAdminHeaders(),
        body: JSON.stringify({
          action: "import_tags",
          adminId,
          adminName,
          sessionToken: adminSession?.sessionToken,
          items: parsedItems,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || data.sessionExpired) {
        handleAdminLogout(
          "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
        );
        return;
      }
      if (res.ok && data.ok) {
        setTags(data.tags || []);
        setAuditLogs(data.auditLogs || []);
        showToast(
          `تم استيراد ${data.importedCount} ملصق بنجاح وتشفيرها بحالة LOCKED ✓`
        );
      }
    } catch {
      showToast("تعذر قراءة الملف المرفوع. تأكد من صيغة CSV أو JSON.");
    } finally {
      setImporting(false);
    }
  };

  // إدارة فريق المشرفين في جدول admin_profiles
  const postTeamAction = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: getAdminHeaders(),
      body: JSON.stringify({
        adminId,
        adminName,
        sessionToken: adminSession?.sessionToken,
        ...payload,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || data.sessionExpired) {
      handleAdminLogout(
        "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
      );
      return { ok: false, data };
    }
    if (Array.isArray(data.teamMembers)) setTeamMembers(data.teamMembers);
    if (Array.isArray(data.auditLogs)) setAuditLogs(data.auditLogs);
    return { ok: Boolean(res.ok && data.ok), data };
  };

  const handleAddTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageAdmins) {
      showToast("ليست لديك صلاحية إدارة المشرفين.");
      return;
    }
    if (!newMemberName.trim() || !newMemberPhone.trim()) return;

    const { ok, data } = await postTeamAction({
      action: "team_add",
      fullName: newMemberName.trim(),
      username: newMemberUsername.trim() || undefined,
      roleTitle: newMemberRole.trim(),
      phone: newMemberPhone.trim(),
      permissions: newMemberPerms,
    });
    if (ok && data.generatedPassword) {
      setIssuedCredentials({
        title: "تم إنشاء حساب المشرف بنجاح",
        fullName: newMemberName.trim(),
        username: newMemberUsername.trim() || newMemberPhone.trim(),
        phone: newMemberPhone.trim(),
        password: String(data.generatedPassword),
      });
      setNewMemberName("");
      setNewMemberUsername("");
      setNewMemberPhone("");
    } else if (data.error) {
      showToast(data.error);
    }
  };

  const handleToggleMemberStatus = async (memberId: string) => {
    const { ok, data } = await postTeamAction({ action: "team_toggle", memberId });
    showToast(ok ? "تم تحديث حالة حساب المشرف ✓" : data.error || "تعذر تحديث الحالة.");
  };

  const handleResetMemberPassword = async (member: AdminTeamMember) => {
    if (
      !window.confirm(
        `إعادة تعيين كلمة مرور ${member.fullName}؟ سيتم توليد كلمة مؤقتة جديدة وفك ربط بصمته وإلزامه بتغييرها.`
      )
    )
      return;
    const { ok, data } = await postTeamAction({
      action: "team_reset_password",
      memberId: member.id,
    });
    if (ok && data.generatedPassword) {
      setIssuedCredentials({
        title: "تمت إعادة تعيين كلمة المرور",
        fullName: member.fullName,
        username: member.username || member.phone,
        phone: member.phone,
        password: String(data.generatedPassword),
      });
    } else {
      showToast(data.error || "تعذر إعادة تعيين كلمة المرور.");
    }
  };

  const openEditMember = (member: AdminTeamMember) => {
    setEditingMember(member);
    setEditMemberName(member.fullName);
    setEditMemberUsername(member.username || "");
    setEditMemberPhone(member.phone || "");
    setEditMemberRole(member.roleTitle);
    setEditMemberPerms(member.permissions);
  };

  const handleSaveMemberEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    const { ok, data } = await postTeamAction({
      action: "team_update_member",
      memberId: editingMember.id,
      fullName: editMemberName.trim(),
      username: editMemberUsername.trim() || undefined,
      phone: editMemberPhone.trim() || undefined,
      roleTitle: editMemberRole.trim(),
      permissions: editMemberPerms,
    });
    if (ok) {
      if (adminSession && editingMember.id === adminSession.id) {
        const updated = {
          ...adminSession,
          fullName: editMemberName.trim() || adminSession.fullName,
          phone: editMemberPhone.trim() || adminSession.phone,
          username: editMemberUsername.trim() || adminSession.username,
        };
        persistAdminSession(updated, adminSession.sessionToken);
      }
      setEditingMember(null);
      showToast("تم تحديث حساب المشرف وصلاحياته ✓");
      await fetchAdminData();
    } else {
      showToast(data.error || "تعذر حفظ التعديلات.");
    }
  };

  const handleDeleteMember = async () => {
    if (!deletingMember) return;
    const { ok, data } = await postTeamAction({
      action: "team_delete",
      memberId: deletingMember.id,
    });
    setDeletingMember(null);
    showToast(ok ? "تم حذف حساب المشرف نهائياً ✓" : data.error || "تعذر حذف الحساب.");
  };

  // تغيير كلمة المرور الذاتية (اختياري من اللوحة، أو إلزامي عند أول دخول)
  const openChangePassModal = () => {
    setCurrentPassInput("");
    setNewPassInput("");
    setConfirmPassInput("");
    setChangePassError(null);
    setShowChangePassModal(true);
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminSession || changePassLoading) return;
    setChangePassError(null);

    const isForced = Boolean(adminSession.mustChangePassword);
    if (!isForced && !currentPassInput.trim()) {
      setChangePassError("يرجى إدخال كلمة المرور الحالية.");
      return;
    }
    if (newPassInput.trim().length < 6) {
      setChangePassError("يجب أن تتكون كلمة المرور الجديدة من 6 خانات على الأقل.");
      return;
    }
    if (newPassInput !== confirmPassInput) {
      setChangePassError("تأكيد كلمة المرور غير مطابق.");
      return;
    }
    if (isForced && currentPassInput && currentPassInput === newPassInput) {
      setChangePassError("يجب أن تختلف كلمة المرور الجديدة عن المؤقتة.");
      return;
    }

    setChangePassLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auth",
          mode: "change_own_password",
          adminId: adminSession.id,
          identifier: adminSession.phone,
          currentPassword: currentPassInput.trim() || undefined,
          newPassword: newPassInput.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setChangePassError(data.error || "تعذر تغيير كلمة المرور.");
        return;
      }
      persistAdminSession(
        { ...adminSession, mustChangePassword: false },
        adminSession.sessionToken
      );
      setShowChangePassModal(false);
      setCurrentPassInput("");
      setNewPassInput("");
      setConfirmPassInput("");
      showToast("تم تحديث كلمة المرور بنجاح ✓");
      await fetchAdminData();
    } finally {
      setChangePassLoading(false);
    }
  };

  const renderPasswordFields = (requireCurrent: boolean) => (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-bold text-white/80">
          {requireCurrent ? "كلمة المرور الحالية" : "كلمة المرور المؤقتة (اختياري للتحقق)"}
        </label>
        <input
          type="password"
          dir="ltr"
          autoComplete="current-password"
          required={requireCurrent}
          value={currentPassInput}
          onChange={(e) => setCurrentPassInput(e.target.value)}
          className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 font-mono text-sm font-bold text-white focus:border-primary focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-white/80">
          كلمة المرور الجديدة (6 خانات على الأقل)
        </label>
        <input
          type="password"
          dir="ltr"
          autoComplete="new-password"
          required
          minLength={6}
          value={newPassInput}
          onChange={(e) => setNewPassInput(e.target.value)}
          className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 font-mono text-sm font-bold text-white focus:border-primary focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-white/80">
          تأكيد كلمة المرور الجديدة
        </label>
        <input
          type="password"
          dir="ltr"
          autoComplete="new-password"
          required
          value={confirmPassInput}
          onChange={(e) => setConfirmPassInput(e.target.value)}
          className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 font-mono text-sm font-bold text-white focus:border-primary focus:outline-none"
        />
      </div>
      {changePassError && (
        <div className="flex items-start gap-2 rounded-xl border border-primary/50 bg-primary/15 p-3 text-xs font-bold text-[#FF6B72]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{changePassError}</span>
        </div>
      )}
    </div>
  );

  // تصفير بيانات الاختبار (Danger Zone)
  const handleDangerZoneReset = async () => {
    if (dangerConfirmText.trim() !== "تصفير") return;

    const res = await fetch("/api/admin", {
      method: "POST",
      headers: getAdminHeaders(),
      body: JSON.stringify({
        action: "danger_reset",
        adminId,
        adminName,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || data.sessionExpired) {
      handleAdminLogout(
        data.error || "انتهت جلسة المدير تلقائياً لأسباب أمنية، يرجى تسجيل الدخول مجدداً."
      );
      return;
    }
    if (res.ok && data.ok) {
      setTags(data.tags || []);
      setAuditLogs(data.auditLogs || []);
      setReportsCount(0);
      setShowDangerModal(false);
      setDangerConfirmText("");
      showToast("تم تصفير بيانات الاختبار وإعادة ضبط النظام بنجاح ✓");
    }
  };

  const filteredTags = React.useMemo(() => {
    return tags.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      return (
        t.tagCode.toLowerCase().includes(q) ||
        (t.ownerPhone || "").toLowerCase().includes(q) ||
        (t.city || "").toLowerCase().includes(q) ||
        (t.vehicleInfo || "").toLowerCase().includes(q) ||
        t.status.toLowerCase().includes(q)
      );
    });
  }, [tags, statusFilter, searchQuery]);

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  // ============================================================================
  // 1. شاشة تسجيل الدخول المؤسسي العالمي (Identity-First Enterprise Admin Login UI)
  // ============================================================================
  if (!isAuthenticated) {
    return (
      <div className="min-h-dvh bg-[#06080D] text-white flex flex-col justify-between relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 -right-40 h-[420px] w-[420px] rounded-full bg-primary/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -left-40 h-[420px] w-[420px] rounded-full bg-primary/10 blur-3xl"
        />

        <header className="relative z-10 border-b border-white/10 bg-[#0A0D14]/90 backdrop-blur-md">
          <div className="shell flex items-center justify-between py-4">
            <Link href="/">
              <BalaghniLogo variant="dark" size="md" showTagline />
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-3.5 py-1 text-xs font-bold text-primary">
              <ShieldCheck className="h-4 w-4" />
              مركز قيادة منصة «بَلِّغْنِي»
            </span>
          </div>
        </header>

        <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
          <div className="rounded-[32px] border border-white/12 bg-[#10141F]/95 p-6 shadow-[0_32px_96px_rgba(0,0,0,0.75)] sm:p-8 space-y-6">
            <div className="text-center space-y-2">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-primary shadow-primary-glow">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
                بوابة الإدارة المؤسسية
              </h1>
              <p className="text-xs leading-relaxed text-white/65">
                سجل الدخول برقم الهاتف وكلمة المرور أو عبر البصمة الحيوية
              </p>
            </div>

            {/* شاشة التجميد الأمني (15 دقيقة) بعد 4 محاولات خاطئة متتالية لنفس اسم المستخدم */}
            {countdownSec > 0 ? (
              <div className="rounded-3xl border-2 border-primary bg-primary/15 p-5 text-center space-y-3">
                <AlertOctagon className="mx-auto h-10 w-10 text-primary animate-pulse" />
                <h2 className="text-base font-black text-white">
                  تم تجميد المحاولة لهذا الحساب مؤقتاً
                </h2>
                <p className="text-xs leading-relaxed text-white/80">
                  تم رصد 4 محاولات خاطئة متتالية لهذا المعرّف. تم قفل المحاولة
                  لمدة 15 دقيقة لحماية المنظومة:
                </p>
                <div
                  dir="ltr"
                  className="mx-auto inline-flex items-center gap-2 rounded-2xl bg-[#07090E] px-5 py-2.5 font-mono text-2xl font-black tracking-widest text-primary"
                >
                  <Clock className="h-5 w-5" />
                  <span>{formatCountdown(countdownSec)}</span>
                </div>
              </div>
            ) : (
              <>
                {/* 1. نموذج تسجيل الدخول المباشر (رقم الهاتف + كلمة المرور معاً) */}
                <form onSubmit={handlePasswordAuth} className="space-y-4">
                  {/* أ) الحقل الأول: رقم الهاتف (كمعرّف موحد للأدمن الرئيسي وجميع المشرفين) */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="admin-phone"
                      className="flex items-center justify-between text-xs font-bold text-white/90"
                    >
                      <span>رقم الهاتف</span>
                      <span
                        dir="ltr"
                        className="font-mono text-[11px] font-normal text-white/45"
                      >
                        Phone Number
                      </span>
                    </label>
                    <input
                      id="admin-phone"
                      type="text"
                      dir="ltr"
                      inputMode="tel"
                      autoComplete="username tel"
                      disabled={authLoading || passkeyLoading}
                      value={identifierInput}
                      onChange={(e) => {
                        setIdentifierInput(e.target.value);
                        if (authError) setAuthError(null);
                      }}
                      placeholder="0910000000"
                      className="h-12 w-full rounded-2xl border border-white/15 bg-[#07090E] px-4 text-left font-mono text-sm font-bold text-white placeholder:text-white/30 focus:border-primary focus:outline-none"
                    />
                  </div>

                  {/* ب) الحقل الثاني: كلمة المرور تحته مباشرة */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <label
                        htmlFor="admin-password"
                        className="font-bold text-white/90"
                      >
                        كلمة المرور
                      </label>
                      {remainingAttempts < 4 && (
                        <span className="font-mono text-[11px] text-amber-400">
                          المحاولات المتبقية: {remainingAttempts}/4
                        </span>
                      )}
                    </div>
                    <input
                      id="admin-password"
                      type="password"
                      dir="ltr"
                      autoComplete="current-password"
                      required
                      disabled={authLoading || passkeyLoading}
                      value={passwordInput}
                      onChange={(e) => {
                        setPasswordInput(e.target.value);
                        if (authError) setAuthError(null);
                      }}
                      placeholder="••••••••"
                      className="h-12 w-full rounded-2xl border border-white/15 bg-[#07090E] px-4 text-left font-mono text-base font-bold text-white placeholder:text-white/30 focus:border-primary focus:outline-none"
                    />
                  </div>

                  {/* ج) زر رئيسي: تسجيل الدخول */}
                  <Button
                    type="submit"
                    size="xl"
                    disabled={authLoading || passkeyLoading}
                    className="w-full rounded-2xl font-black shadow-primary-glow"
                  >
                    {authLoading ? (
                      <>
                        <LoaderCircle className="h-5 w-5 animate-spin" />
                        <span>جاري التحقق من بيانات الدخول...</span>
                      </>
                    ) : (
                      <>
                        <LockKeyhole className="h-5 w-5" />
                        <span>تسجيل الدخول</span>
                      </>
                    )}
                  </Button>
                </form>

                {/* فاصل أنيق: تسجيل دخول سريع */}
                <div className="relative flex items-center py-0.5">
                  <div className="flex-grow border-t border-white/10" />
                  <span className="mx-3 shrink-0 text-[11px] font-bold text-white/45">
                    تسجيل دخول سريع
                  </span>
                  <div className="flex-grow border-t border-white/10" />
                </div>

                {/* زر بارز يحمل شعار/أيقونة البصمة للمصادقة عبر Passkey / WebAuthn */}
                <button
                  type="button"
                  onClick={handlePasskeyAuth}
                  disabled={authLoading || passkeyLoading}
                  className="flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl border border-primary/40 bg-gradient-to-r from-primary/10 via-primary/20 to-primary/10 px-4 text-xs font-black text-white shadow-lg transition hover:border-primary hover:bg-primary/25 disabled:opacity-50"
                >
                  {passkeyLoading ? (
                    <>
                      <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
                      <span>جاري فحص البصمة المعتمدة...</span>
                    </>
                  ) : (
                    <>
                      <Fingerprint className="h-5 w-5 text-primary" />
                      <span>المصادقة بالبصمة الحيوية (Passkey / WebAuthn)</span>
                    </>
                  )}
                </button>

                {authError && (
                  <div className="flex items-start gap-2 rounded-2xl border border-primary/50 bg-primary/15 p-3.5 text-xs font-bold text-[#FF6B72]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{authError}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ============================================================================
  // شاشة الإلزام بتغيير كلمة المرور المؤقتة عند أول دخول مع تفعيل البصمة
  // ============================================================================
  if (adminSession?.mustChangePassword) {
    return (
      <div className="min-h-dvh bg-[#06080D] text-white flex flex-col justify-center px-4 py-10 relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 -right-40 h-[420px] w-[420px] rounded-full bg-primary/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -left-40 h-[420px] w-[420px] rounded-full bg-primary/10 blur-3xl"
        />

        <form
          onSubmit={handleChangeOwnPassword}
          className="relative z-10 mx-auto w-full max-w-md rounded-[32px] border border-amber-500/40 bg-[#10141F]/95 p-6 shadow-[0_32px_96px_rgba(0,0,0,0.75)] sm:p-8 space-y-5"
        >
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/40 bg-amber-500/15 text-amber-300">
              <LockKeyhole className="h-7 w-7" />
            </div>
            <h1 className="text-xl font-black sm:text-2xl">
              إعداد أمان الحساب لأول دخول
            </h1>
            <p className="text-xs leading-relaxed text-white/65">
              مرحباً <strong className="text-white">{adminSession.fullName}</strong>، أنت مسجل برقم الهاتف (
              <span dir="ltr" className="font-mono text-primary font-bold">{adminSession.phone}</span>
              ). يرجى تعيين كلمة مرور جديدة خاصة بك، ويمكنك أيضاً تفعيل بصمة هذا الجهاز لتسجيل الدخول السريع في المرات القادمة.
            </p>
          </div>

          {/* حقول كلمة المرور الجديدة */}
          {renderPasswordFields(false)}

          {/* بطاقة تفعيل البصمة الحيوية (Passkey) للدخول السريع */}
          <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20 text-primary shadow-sm">
                  <Fingerprint className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-xs font-black text-white">
                    تفعيل البصمة الحيوية (Passkey)
                  </h3>
                  <p className="text-[10px] text-white/60">
                    لتسجيل الدخول السريع بلمسة واحدة
                  </p>
                </div>
              </div>
              {adminSession.passkeyCredentialId ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-bold text-emerald-400 border border-emerald-500/30">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  مفعّلة بنجاح ✓
                </span>
              ) : (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-mono text-white/60">
                  اختياري
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleRegisterAdminPasskey}
              disabled={passkeyEnrollLoading}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-black transition",
                adminSession.passkeyCredentialId
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                  : "border-primary/50 bg-primary text-white hover:bg-primary/90 shadow-primary-glow"
              )}
            >
              {passkeyEnrollLoading ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  <span>جاري قراءة وتوثيق البصمة...</span>
                </>
              ) : (
                <>
                  <Fingerprint className="h-4 w-4" />
                  <span>
                    {adminSession.passkeyCredentialId
                      ? "تم ربط بصمة الجهاز بنجاح ✓ (اضغط لإعادة الربط)"
                      : "تفعيل البصمة الحيوية (Passkey) للدخول السريع"}
                  </span>
                </>
              )}
            </button>
          </div>

          <Button
            type="submit"
            size="lg"
            disabled={changePassLoading}
            className="w-full rounded-2xl shadow-primary-glow font-black"
          >
            {changePassLoading ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                <span>جاري الحفظ والدخول...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                <span>حفظ كلمة المرور والدخول للوحة</span>
              </>
            )}
          </Button>

          <button
            type="button"
            onClick={() => handleAdminLogout()}
            className="w-full text-center text-xs font-bold text-white/50 hover:text-white"
          >
            تسجيل الخروج
          </button>
        </form>
      </div>
    );
  }

  // ============================================================================
  // الواجهة الرئيسية للوحة تحكم الإدارة التنفيذية بعد فتح الجلسة المشفرة
  // ============================================================================
  const activeCount = tags.filter((t) => t.status === "ACTIVE").length;
  const lockedCount = tags.filter((t) => t.status === "LOCKED").length;
  const revokedCount = tags.filter((t) => t.status === "REVOKED").length;

  return (
    <div className="min-h-dvh bg-[#07090E] text-white flex flex-col">
      {/* شريط إشعارات علوي عائم */}
      {toastMessage && (
        <div className="fixed bottom-5 left-5 z-50 flex items-center gap-2.5 rounded-2xl border border-emerald-500/40 bg-[#12151F] px-5 py-3.5 text-xs font-bold text-emerald-300 shadow-2xl">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ترويسة لوحة الإدارة التنفيذية */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0D13]/95 backdrop-blur-md">
        <div className="shell flex flex-wrap items-center justify-between gap-3 py-3.5">
          <div className="flex items-center gap-3">
            <Link href="/">
              <BalaghniLogo variant="dark" size="sm" showTagline />
            </Link>
            <div className="hidden sm:flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="font-bold text-white">
                {adminSession?.fullName}
              </span>
              <span dir="ltr" className="font-mono text-[11px] text-white/55">
                (@{adminSession?.username})
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {adminSession?.passkeyCredentialId ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleRegisterAdminPasskey}
                  disabled={passkeyEnrollLoading}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/20"
                  title="البصمة الحيوية مفعلة - انقر لإعادة التعيين"
                >
                  <Fingerprint className="h-4 w-4 text-emerald-400" />
                  <span>البصمة مفعلة ✓ (إعادة ربط)</span>
                </button>
                <button
                  type="button"
                  onClick={handleUnlinkAdminPasskey}
                  disabled={passkeyEnrollLoading}
                  className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-xs font-bold text-white/55 hover:border-red-500/40 hover:text-red-400"
                  title="مسح وفك ارتباط البصمة الحيوية"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>مسح البصمة</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleRegisterAdminPasskey}
                disabled={passkeyEnrollLoading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/20 px-3 py-2 text-xs font-black text-white shadow-primary-glow transition hover:bg-primary/30"
              >
                <Fingerprint className="h-4 w-4 text-primary" />
                <span>تفعيل البصمة الآن</span>
              </button>
            )}

            <button
              type="button"
              onClick={openChangePassModal}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-white/85 transition hover:border-primary hover:text-white"
            >
              <KeyRound className="h-4 w-4 text-primary" />
              <span>تغيير كلمة المرور</span>
            </button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleAdminLogout()}
              className="rounded-xl text-white/70 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4 text-primary" />
              <span>خروج آمن</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="shell flex-1 py-7 space-y-7">
        {/* 3. معالج ربط البصمة من داخل الحساب (Admin Passkey Enrollment Banner) */}
        {!adminSession?.passkeyCredentialId && (
          <div className="flex flex-col items-start justify-between gap-4 rounded-3xl border border-primary/40 bg-gradient-to-l from-primary/20 via-[#12151F] to-[#12151F] p-5 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-primary-glow">
                <Fingerprint className="h-6 w-6" />
              </span>
              <div className="space-y-1">
                <h2 className="text-sm font-black text-white sm:text-base">
                  قم بربط بصمة هذا الجهاز (Passkey) للدخول بلمسة واحدة في المرات
                  القادمة
                </h2>
                <p className="text-xs text-white/70">
                  سيتم حفظ معرّف البصمة الحيوية مباشرة في حسابك (
                  <span dir="ltr" className="font-mono text-white">
                    @{adminSession?.username}
                  </span>
                  ) داخل جدول <code className="text-primary">admin_profiles</code>.
                </p>
              </div>
            </div>

            <Button
              type="button"
              size="lg"
              onClick={handleRegisterAdminPasskey}
              className="shrink-0 rounded-2xl shadow-primary-glow"
            >
              <Fingerprint className="h-4 w-4" />
              <span>تفعيل البصمة الآن</span>
            </Button>
          </div>
        )}

        {/* مؤشرات الأداء الفورية */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-3xl border border-white/10 bg-[#12151F] p-5">
            <span className="text-xs text-white/60">إجمالي الملصقات</span>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="font-mono text-2xl font-black text-white">
                {tags.length}
              </span>
              <QrCode className="h-5 w-5 text-primary" />
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-500/25 bg-[#12151F] p-5">
            <span className="text-xs text-emerald-400">ملصقات مفعّلة (ACTIVE)</span>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="font-mono text-2xl font-black text-emerald-400">
                {activeCount}
              </span>
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </div>
          </div>

          <div className="rounded-3xl border border-amber-500/25 bg-[#12151F] p-5">
            <span className="text-xs text-amber-400">بانتظار التفعيل (LOCKED)</span>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="font-mono text-2xl font-black text-amber-400">
                {lockedCount}
              </span>
              <LockKeyhole className="h-5 w-5 text-amber-400" />
            </div>
          </div>

          <div className="rounded-3xl border border-primary/30 bg-[#12151F] p-5">
            <span className="text-xs text-[#FF6B72]">ملغاة ومسحوبة (REVOKED)</span>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="font-mono text-2xl font-black text-[#FF6B72]">
                {revokedCount}
              </span>
              <AlertOctagon className="h-5 w-5 text-primary" />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#12151F] p-5">
            <span className="text-xs text-white/60">سجل الرقابة والبلاغات</span>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="font-mono text-2xl font-black text-white">
                {auditLogs.length} / {reportsCount}
              </span>
              <Activity className="h-5 w-5 text-primary" />
            </div>
          </div>
        </section>

        {/* شريط التبويبات التنفيذية */}
        <nav className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#12151F] p-2">
          <button
            type="button"
            onClick={() => setActiveTab("tags")}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition",
              activeTab === "tags"
                ? "bg-primary text-white shadow-primary-glow"
                : "text-white/70 hover:bg-white/5 hover:text-white"
            )}
          >
            <QrCode className="h-4 w-4" />
            <span>إدارة دورة حياة الملصقات ({tags.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("lifecycle")}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition",
              activeTab === "lifecycle"
                ? "bg-primary text-white shadow-primary-glow"
                : "text-white/70 hover:bg-white/5 hover:text-white"
            )}
          >
            <Store className="h-4 w-4" />
            <span>الباقات والتجار والهدايا والشركات</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("import")}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition",
              activeTab === "import"
                ? "bg-primary text-white shadow-primary-glow"
                : "text-white/70 hover:bg-white/5 hover:text-white"
            )}
          >
            <Upload className="h-4 w-4" />
            <span>استيراد دفعات المطبعة (Offline Batch)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("audit")}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition",
              activeTab === "audit"
                ? "bg-primary text-white shadow-primary-glow"
                : "text-white/70 hover:bg-white/5 hover:text-white"
            )}
          >
            <History className="h-4 w-4" />
            <span>سجل الرقابة المشدد ({auditLogs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("team")}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition",
              activeTab === "team"
                ? "bg-primary text-white shadow-primary-glow"
                : "text-white/70 hover:bg-white/5 hover:text-white"
            )}
          >
            <Users className="h-4 w-4" />
            <span>فريق المشرفين والصلاحيات ({teamMembers.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("danger")}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition",
              activeTab === "danger"
                ? "bg-primary text-white shadow-primary-glow"
                : "text-[#FF6B72] hover:bg-primary/15"
            )}
          >
            <Trash2 className="h-4 w-4" />
            <span>منطقة الطوارئ (Danger Zone)</span>
          </button>
        </nav>

        {/* ==================================================================== */}
        {/* التبويب 1: إدارة دورة حياة الملصقات (Tags Lifecycle & Data Safety) */}
        {/* ==================================================================== */}
        {activeTab === "tags" && (
          <section className="space-y-4">
            <div className="flex flex-col justify-between gap-3 rounded-3xl border border-white/10 bg-[#12151F] p-5 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث بكود الملصق، رقم الهاتف، المدينة، نوع السيارة، أو الحالة..."
                  className="h-11 w-full rounded-2xl border border-white/15 bg-[#07090E] pr-10 pl-4 text-xs font-bold text-white placeholder:text-white/35 focus:border-primary focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(["ALL", "ACTIVE", "LOCKED", "REVOKED"] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={cn(
                      "rounded-xl px-3.5 py-2 text-xs font-bold transition",
                      statusFilter === st
                        ? "bg-primary text-white"
                        : "border border-white/10 bg-[#07090E] text-white/70 hover:text-white"
                    )}
                  >
                    {st === "ALL" ? "الكل" : st}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#12151F]">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-white/10 bg-[#0B0D13] font-black text-white/65">
                    <tr>
                      <th className="px-4 py-3.5">كود الملصق</th>
                      <th className="px-4 py-3.5">الحالة (تبديل فوري)</th>
                      <th className="px-4 py-3.5">المركبة والمدينة</th>
                      <th className="px-4 py-3.5">هاتف المالك</th>
                      <th className="px-4 py-3.5">قناة التنبيه</th>
                      <th className="px-4 py-3.5">الأمان</th>
                      <th className="px-4 py-3.5">العمليات الإدارية</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {loadingData ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-white/60">
                          جاري تحميل الملصقات...
                        </td>
                      </tr>
                    ) : filteredTags.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-white/60">
                          {tags.length === 0
                            ? "لا توجد ملصقات مسجلة حالياً"
                            : "لا توجد ملصقات مطابقة للبحث."}
                        </td>
                      </tr>
                    ) : (
                      filteredTags.map((tag) => (
                        <tr
                          key={tag.tagCode}
                          className="transition hover:bg-white/[0.02]"
                        >
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <span
                                dir="ltr"
                                className="font-mono text-sm font-black text-white"
                              >
                                {tag.tagCode}
                              </span>
                              <Link
                                href={`/s/${encodeURIComponent(tag.tagCode)}`}
                                target="_blank"
                                title="معاينة صفحة المسح"
                                className="text-white/40 hover:text-primary"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Link>
                            </div>
                          </td>

                          {/* التبديل السريع بلمسة واحدة بين ACTIVE / LOCKED / REVOKED */}
                          <td className="px-4 py-3.5">
                            <div className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-[#07090E] p-1">
                              {(["ACTIVE", "LOCKED", "REVOKED"] as const).map(
                                (st) => (
                                  <button
                                    key={st}
                                    type="button"
                                    onClick={() =>
                                      handleQuickStatusChange(tag.tagCode, st)
                                    }
                                    className={cn(
                                      "rounded-lg px-2 py-1 font-mono text-[10px] font-black transition",
                                      tag.status === st
                                        ? st === "ACTIVE"
                                          ? "bg-emerald-500 text-black"
                                          : st === "LOCKED"
                                          ? "bg-amber-500 text-black"
                                          : "bg-primary text-white"
                                        : "text-white/45 hover:text-white"
                                    )}
                                  >
                                    {st}
                                  </button>
                                )
                              )}
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            <span className="block font-bold text-white">
                              {tag.vehicleInfo || "غير مرتبط بمركبة"}
                            </span>
                            <span className="text-[11px] text-white/55">
                              {tag.city || "—"}
                            </span>
                          </td>

                          <td className="px-4 py-3.5">
                            <span
                              dir="ltr"
                              className="font-mono font-bold text-white/90"
                            >
                              {tag.ownerPhone || "—"}
                            </span>
                          </td>

                          <td className="px-4 py-3.5">
                            <span className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-[11px] font-bold text-white">
                              {tag.alertChannel || "BOTH"}
                            </span>
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="flex flex-wrap gap-1">
                              <span
                                className={cn(
                                  "rounded-md px-2 py-0.5 text-[10px] font-bold",
                                  tag.hasSecuritySetup
                                    ? "bg-emerald-500/15 text-emerald-400"
                                    : "bg-white/5 text-white/40"
                                )}
                              >
                                PIN: {tag.hasSecuritySetup ? "مفعّل" : "—"}
                              </span>
                              <span
                                className={cn(
                                  "rounded-md px-2 py-0.5 text-[10px] font-bold",
                                  tag.hasPasskey
                                    ? "bg-emerald-500/15 text-emerald-400"
                                    : "bg-white/5 text-white/40"
                                )}
                              >
                                بصمة: {tag.hasPasskey ? "مفعّلة" : "—"}
                              </span>
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {/* 1. تعديل المركبة */}
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTag(tag);
                                  setEditVehicleInfo(tag.vehicleInfo || "");
                                  setEditCity(tag.city || "طرابلس");
                                  setEditOwnerPhone(tag.ownerPhone || "");
                                  setEditAlertChannel(
                                    tag.alertChannel || "BOTH"
                                  );
                                }}
                                className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold text-white hover:border-primary"
                              >
                                <Edit3 className="h-3.5 w-3.5 text-primary" />
                                <span>تعديل المركبة</span>
                              </button>

                              {/* 2. إعادة تعيين أمان المالك */}
                              <button
                                type="button"
                                onClick={() => {
                                  setSecurityModalTag(tag);
                                  setNewClientPin("");
                                }}
                                className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold text-white hover:border-amber-400"
                              >
                                <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                                <span>أمان المالك</span>
                              </button>

                              {/* 3. إعادة ضبط المصنع (Factory Reset) مع نافذة تأكيد تحذيرية */}
                              <button
                                type="button"
                                onClick={() => setFactoryResetModalTag(tag)}
                                className="inline-flex items-center gap-1 rounded-xl border border-primary/35 bg-primary/10 px-2.5 py-1.5 text-[11px] font-bold text-[#FF6B72] hover:bg-primary hover:text-white transition active:scale-95"
                                title="إعادة ضبط المصنع وفك ارتباط المركبة"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span>ضبط مصنع</span>
                              </button>

                              {/* 4. مسح الملصق نهائياً (خاص بالأدمن الرئيسي SUPER_ADMIN فقط) */}
                              {isSuperAdmin && (
                                <button
                                  type="button"
                                  onClick={() => setDeleteModalTag(tag)}
                                  className="inline-flex items-center gap-1 rounded-xl border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-bold text-red-400 hover:bg-red-600 hover:text-white transition active:scale-95"
                                  title="مسح الملصق نهائياً (للأدمن الرئيسي فقط)"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>مسح</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ==================================================================== */}
        {/* التبويب 2: استيراد دفعات الملصقات المطبوعة (Offline Batch & Single) */}
        {/* ==================================================================== */}
        {activeTab === "import" && (
          <section className="grid gap-6 lg:grid-cols-2">
            {/* رفع ملف دفعات المطبعة (CSV / JSON) */}
            <div className="rounded-3xl border border-white/10 bg-[#12151F] p-6 space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <Upload className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-black text-white sm:text-lg">
                    رفع ملف دفعات المطبعة (CSV / JSON)
                  </h2>
                  <p className="text-xs text-white/60">
                    متوافق مع مخرجات أداة التوليد المحلية (print_batch.csv) —
                    يحسب SHA-256 ويدرجها بحالة LOCKED
                  </p>
                </div>
              </div>

              <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/20 bg-[#07090E] p-8 text-center transition hover:border-primary">
                <Upload className="h-8 w-8 text-primary" />
                <span className="mt-3 text-sm font-black text-white">
                  {importing
                    ? "جاري تشفير واستيراد الدفعة..."
                    : "اضغط لاختيار ملف الدفعة (CSV أو JSON)"}
                </span>
                <span className="mt-1 text-xs text-white/55">
                  يدعم صيغة: code, qr_url, batch_name, status (أو qr_url, tag_code, scratch_pin)
                </span>
                <input
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={handleBatchFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* إدخال يدوي لملصق مطبوع مفرد */}
            <div className="rounded-3xl border border-white/10 bg-[#12151F] p-6 space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
                  <Plus className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-base font-black text-white sm:text-lg">
                    إدخال يدوي لملصق مطبوع مفرد
                  </h2>
                  <p className="text-xs text-white/60">
                    أدخل كود الملصق لإدراجه فوراً بحالة غير مفعل
                  </p>
                </div>
              </div>

              <form onSubmit={handleSingleTagInsert} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-white/85">
                    كود الملصق (مثال: LY-M8P2-X9K4)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    value={singleTagCode}
                    onChange={(e) =>
                      setSingleTagCode(e.target.value.toUpperCase())
                    }
                    placeholder="LY-XXXX-XXXX"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3.5 font-mono text-sm font-black text-white"
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={importing}
                  className="w-full rounded-2xl"
                >
                  <Plus className="h-4 w-4" />
                  <span>تشفير SHA-256 وإدراج في جدول tags</span>
                </Button>
              </form>
            </div>
          </section>
        )}

        {/* ==================================================================== */}
        {/* التبويب 3: سجل الرقابة وتوثيق العمليات المشدد (Audit Trail Feed) */}
        {/* ==================================================================== */}
        {activeTab === "audit" && (
          <section className="rounded-3xl border border-white/10 bg-[#12151F] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-white">
                  سجل الرقابة الإدارية المشدد (admin_audit_logs)
                </h2>
                <p className="text-xs text-white/60">
                  توثيق آلي فوري لكل عملية إدارية: اسم المشرف، نوع الحركة، كود
                  الملصق المتأثر، والتوقيت الدقيق
                </p>
              </div>
              <span className="rounded-full bg-primary/15 px-3.5 py-1 font-mono text-xs font-bold text-primary">
                {auditLogs.length} حركة مسجلة
              </span>
            </div>

            {auditLogs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-xs text-white/55">
                لا توجد حركات مسجلة بعد.
              </div>
            ) : (
              <div className="space-y-2.5">
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex flex-col justify-between gap-2 rounded-2xl border border-white/10 bg-[#07090E] p-4 sm:flex-row sm:items-center"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-primary/20 px-2.5 py-0.5 text-xs font-black text-primary">
                          {log.actionType}
                        </span>
                        <span className="text-xs font-bold text-white">
                          المشرف: {log.adminName}
                        </span>
                        {log.tagCode && (
                          <span
                            dir="ltr"
                            className="rounded-md border border-white/15 bg-white/5 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-400"
                          >
                            {log.tagCode}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/75">
                        {log.actionDetails}
                      </p>
                    </div>

                    <span className="shrink-0 font-mono text-[11px] text-white/50">
                      {formatDateTimeAr(log.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ==================================================================== */}
        {/* التبويب 4: إدارة فريق المشرفين والصلاحيات (Team & RBAC) */}
        {/* ==================================================================== */}
        {activeTab === "team" && (
          <section className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <form
              onSubmit={handleAddTeamMember}
              className="rounded-3xl border border-white/10 bg-[#12151F] p-6 space-y-4"
            >
              <h2 className="text-base font-black text-white sm:text-lg">
                إضافة مشرف فرعي في admin_profiles (RBAC)
              </h2>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-white/80">
                    الاسم الكامل للمشرف
                  </label>
                  <input
                    type="text"
                    required
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    placeholder="مثال: م. أحمد الورفلي"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 text-xs font-bold text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-white/80">
                    رقم الهاتف الإداري (معرّف الدخول الأساسي)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    required
                    value={newMemberPhone}
                    onChange={(e) => setNewMemberPhone(e.target.value)}
                    placeholder="091XXXXXXX"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 font-mono text-xs font-bold text-white"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-white/80">
                    الدور الوظيفي (role)
                  </label>
                  <select
                    value={newMemberRole}
                    onChange={(e) => setNewMemberRole(e.target.value)}
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 text-xs font-bold text-white focus:border-primary focus:outline-none"
                  >
                    <option value="OPERATOR">مشرف عمليات (OPERATOR)</option>
                    <option value="SUPPORT">دعم فني (SUPPORT)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-white/80">
                    اسم المستخدم (اختياري / معرّف إضافي)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={newMemberUsername}
                    onChange={(e) =>
                      setNewMemberUsername(
                        e.target.value.toLowerCase().replace(/\s+/g, "")
                      )
                    }
                    placeholder="ahmed_ops (تلقائي إن تُرِك فارغاً)"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 font-mono text-xs font-bold text-white"
                  />
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-[11px] leading-relaxed text-emerald-200">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>
                  سيولّد النظام كلمة مرور مؤقتة عشوائية (8 أرقام) تلقائياً وتظهر لك
                  لنسخها وتسليمها للموظف، وسيُلزَم بتغييرها عند أول تسجيل دخول.
                </span>
              </div>

              <div>
                <span className="mb-2 block text-xs font-bold text-white/80">
                  الصلاحيات الممنوحة:
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_PERMISSIONS.map((perm) => {
                    const checked = newMemberPerms.includes(perm);
                    return (
                      <button
                        key={perm}
                        type="button"
                        onClick={() =>
                          setNewMemberPerms((prev) =>
                            checked
                              ? prev.filter((p) => p !== perm)
                              : [...prev, perm]
                          )
                        }
                        className={cn(
                          "rounded-xl border px-3 py-2 text-right text-xs font-bold transition",
                          checked
                            ? "border-primary bg-primary/20 text-white"
                            : "border-white/10 bg-[#07090E] text-white/55"
                        )}
                      >
                        {checked ? "✓ " : ""}
                        {PERMISSION_LABELS[perm]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button type="submit" size="lg" className="w-full rounded-2xl">
                <Plus className="h-4 w-4" />
                <span>إضافة المشرف وتفعيل الصلاحيات</span>
              </Button>
            </form>

            <div className="rounded-3xl border border-white/10 bg-[#12151F] p-6 space-y-4">
              <h2 className="text-base font-black text-white sm:text-lg">
                قائمة المشرفين المسجلين في admin_profiles
              </h2>
              <div className="space-y-3">
                {teamMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-white/10 bg-[#07090E] p-4 sm:flex-row sm:items-center"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-black text-white">
                          {member.fullName}
                        </span>
                        {member.username && (
                          <span
                            dir="ltr"
                            className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[11px] font-bold text-primary"
                          >
                            @{member.username}
                          </span>
                        )}
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[10px] font-bold",
                            member.status === "ACTIVE"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-primary/20 text-[#FF6B72]"
                          )}
                        >
                          {member.status === "ACTIVE"
                            ? "نشط (is_active = true)"
                            : "مجمّد (is_active = false)"}
                        </span>
                        {member.passkeyCredentialId && (
                          <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-bold text-primary">
                            Passkey مرتبط ✓
                          </span>
                        )}
                        {member.mustChangePassword && (
                          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold text-amber-300">
                            بانتظار تغيير كلمة المرور المؤقتة
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/60">
                        {member.roleTitle} •{" "}
                        <span dir="ltr" className="font-mono">
                          {member.phone || "—"}
                        </span>
                        {member.lastLogin && (
                          <>
                            {" "}
                            • آخر دخول: {formatDateTimeAr(member.lastLogin)}
                          </>
                        )}
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {member.permissions.map((p) => (
                          <span
                            key={p}
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-white/80"
                          >
                            {PERMISSION_LABELS[p]}
                          </span>
                        ))}
                      </div>
                    </div>

                    {member.roleTitle.includes("SUPER_ADMIN") ||
                    member.id === adminSession?.id ? (
                      <div className="flex shrink-0 items-center gap-1.5 sm:justify-end">
                        <span className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/60">
                          {member.id === adminSession?.id ? "حسابك الحالي" : "المدير الرئيسي"}
                        </span>
                        {member.id === adminSession?.id && (
                          <button
                            type="button"
                            onClick={() => openEditMember(member)}
                            className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white hover:border-primary"
                          >
                            <Edit3 className="h-3 w-3 text-primary" />
                            تعديل بياناتي
                          </button>
                        )}
                      </div>
                    ) : canManageAdmins ? (
                      <div className="flex shrink-0 flex-wrap gap-1.5 sm:max-w-[220px] sm:justify-end">
                        <button
                          type="button"
                          onClick={() => openEditMember(member)}
                          className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold text-white hover:border-primary"
                        >
                          <Edit3 className="h-3.5 w-3.5 text-primary" />
                          تعديل
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResetMemberPassword(member)}
                          className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold text-white hover:border-amber-400"
                        >
                          <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                          إعادة تعيين كلمة السر
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleMemberStatus(member.id)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold",
                            member.status === "ACTIVE"
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                          )}
                        >
                          {member.status === "ACTIVE" ? (
                            <>
                              <Ban className="h-3.5 w-3.5" />
                              تعطيل الحساب
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              إعادة التفعيل
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingMember(member)}
                          className="inline-flex items-center gap-1 rounded-xl border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-bold text-[#FF6B72] hover:bg-primary hover:text-white"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          حذف
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeTab === "lifecycle" && <AdminLifecyclePanel />}

        {/* ==================================================================== */}
        {/* التبويب 5: منطقة الطوارئ وتصفير النظام (Danger Zone) */}
        {/* ==================================================================== */}
        {activeTab === "danger" && (
          <section className="rounded-3xl border-2 border-primary/50 bg-primary/10 p-6 sm:p-8 space-y-4">
            <div className="flex items-start gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-primary-glow">
                <AlertOctagon className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-xl font-black text-white">
                  منطقة الطوارئ وتصفير بيانات الاختبار (Danger Zone)
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-white/80">
                  يقوم هذا الإجراء بتصفير كافة بيانات الاختبار (حسابات المركبات
                  التجريبية، الوثائق، البلاغات، والصيانات) وإعادة الملصقات
                  المولدة إلى حالة <strong className="text-white">LOCKED</strong>{" "}
                  النظيفة للبدء من الصفر دون المساس ببنية الجداول في قاعدة
                  البيانات.
                </p>
              </div>
            </div>

            <Button
              type="button"
              size="lg"
              onClick={() => setShowDangerModal(true)}
              className="rounded-2xl bg-primary text-white shadow-primary-glow hover:bg-primary/90"
            >
              <Trash2 className="h-4 w-4" />
              <span>تصفير بيانات الاختبار والبدء بسجلات نظيفة</span>
            </Button>
          </section>
        )}
      </main>

      {/* نافذة تعديل المركبة والباقة */}
      {editingTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveVehicleEdit}
            className="w-full max-w-md rounded-3xl border border-white/15 bg-[#12151F] p-6 text-white shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black">
                تعديل بيانات الملصق ({editingTag.tagCode})
              </h3>
              <button
                type="button"
                onClick={() => setEditingTag(null)}
                className="text-white/60 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-white/80">
                نوع وموديل ولون السيارة
              </label>
              <input
                type="text"
                value={editVehicleInfo}
                onChange={(e) => setEditVehicleInfo(e.target.value)}
                placeholder="مثال: هونداي سوناتا - أبيض"
                className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 text-xs font-bold text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-white/80">
                  المدينة
                </label>
                <input
                  type="text"
                  value={editCity}
                  onChange={(e) => setEditCity(e.target.value)}
                  className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 text-xs font-bold text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-white/80">
                  رقم هاتف المالك
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={editOwnerPhone}
                  onChange={(e) => setEditOwnerPhone(e.target.value)}
                  placeholder="+21891XXXXXXX"
                  className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 font-mono text-xs font-bold text-white"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-white/80">
                قناة التنبيه والباقة (SMS / WHATSAPP / BOTH)
              </label>
              <select
                value={editAlertChannel}
                onChange={(e) =>
                  setEditAlertChannel(e.target.value as AlertChannel)
                }
                className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 text-xs font-bold text-white"
              >
                <option value="BOTH">كلاهما (WHATSAPP + SMS)</option>
                <option value="WHATSAPP">واتساب فقط (WHATSAPP)</option>
                <option value="SMS">رسائل نصية فقط (SMS)</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingTag(null)}
                className="rounded-xl border-white/20 bg-white/5 text-white"
              >
                إلغاء
              </Button>
              <Button type="submit" className="rounded-xl">
                حفظ التعديلات
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* نافذة إعادة تعيين أمان المالك وفك ربط البصمة */}
      {securityModalTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleResetOwnerSecuritySubmit}
            className="w-full max-w-md rounded-3xl border border-white/15 bg-[#12151F] p-6 text-white shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black">
                إعادة تعيين أمان المالك ({securityModalTag.tagCode})
              </h3>
              <button
                type="button"
                onClick={() => setSecurityModalTag(null)}
                className="text-white/60 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs leading-relaxed text-white/70">
              يؤدي هذا الإجراء إلى فك ربط البصمة (Passkey) الخاصة بالعميل في حال
              فقدان جهازه، مع إمكانية تعيين رمز مرور (PIN من 6 أرقام) جديد له:
            </p>

            <div>
              <label className="mb-1 block text-xs font-bold text-white/80">
                رمز PIN جديد للعميل (اختياري - 6 أرقام)
              </label>
              <input
                type="text"
                inputMode="numeric"
                dir="ltr"
                maxLength={6}
                value={newClientPin}
                onChange={(e) =>
                  setNewClientPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="اتركه فارغاً لتصفير الرمز وفك البصمة فقط"
                className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 font-mono text-xs font-bold text-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSecurityModalTag(null)}
                className="rounded-xl border-white/20 bg-white/5 text-white"
              >
                إلغاء
              </Button>
              <Button type="submit" className="rounded-xl">
                تأكيد إعادة تعيين الأمان
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* نافذة تأكيد إعادة ضبط المصنع الشاملة للملصق */}
      {factoryResetModalTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border-2 border-primary/50 bg-[#12151F] p-6 text-white shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-3 py-1 text-xs font-black text-primary">
                <RotateCcw className="h-4 w-4" />
                تأكيد إعادة ضبط المصنع للملصق
              </span>
              <button
                type="button"
                onClick={() => {
                  if (!factoryResetLoading) setFactoryResetModalTag(null);
                }}
                className="text-white/60 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#07090E] p-4 text-center">
              <span className="text-xs text-white/50 block mb-1">كود الملصق المراد تصفيره</span>
              <span dir="ltr" className="font-mono text-xl font-black text-white">
                {factoryResetModalTag.tagCode}
              </span>
            </div>

            <div className="space-y-2 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-xs text-white/85">
              <p className="font-black text-primary flex items-center gap-1.5 text-sm">
                <AlertOctagon className="h-4 w-4 text-primary" />
                تحذير: سيترتب على هذا الإجراء ما يلي فوراً:
              </p>
              <ul className="list-disc list-inside space-y-1 text-white/70 pr-2 leading-relaxed">
                <li>
                  فك ارتباط المركبة (
                  <strong className="text-white font-bold">
                    {factoryResetModalTag.vehicleInfo || "غير مرتبط بمركبة"}
                  </strong>
                  ) وإلغاء المدينة وقناة التنبيه.
                </li>
                <li>
                  حذف رقم هاتف المالك (
                  <strong className="text-white font-mono font-bold" dir="ltr">
                    {factoryResetModalTag.ownerPhone || "—"}
                  </strong>
                  ) نهائياً من سجلات الملصق.
                </li>
                <li>إلغاء وإتلاف كافة إعدادات الأمان (رمز PIN وبصمة المالك Passkey).</li>
                <li>حذف ومسح كافة البلاغات والتنبيهات المرتبطة بهذا الملصق من قاعدة البيانات.</li>
                <li>
                  إرجاع حالة الملصق إلى{" "}
                  <span className="font-mono font-bold text-amber-400">LOCKED</span> كأنه
                  جديد ومطبوع للتو، ليصبح متاحاً للربط والتفعيل من الصفر.
                </li>
              </ul>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={factoryResetLoading}
                onClick={() => setFactoryResetModalTag(null)}
                className="rounded-xl border-white/20 bg-white/5 text-white"
              >
                إلغاء
              </Button>
              <Button
                type="button"
                disabled={factoryResetLoading}
                onClick={() => handleFactoryResetTag(factoryResetModalTag.tagCode)}
                className="rounded-xl bg-primary text-white hover:bg-primary/90 font-bold"
              >
                {factoryResetLoading ? "جاري إعادة الضبط..." : "تأكيد ضبط المصنع وفك الارتباط"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة تأكيد مسح الملصق نهائياً (خاصية الأدمن الرئيسي SUPER_ADMIN فقط) */}
      {isSuperAdmin && deleteModalTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border-2 border-red-500/60 bg-[#12151F] p-6 text-white shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full bg-red-500/15 px-3 py-1 text-xs font-black text-red-400">
                <Trash2 className="h-4 w-4" />
                مسح الملصق نهائياً (الأدمن الرئيسي)
              </span>
              <button
                type="button"
                onClick={() => !deleteTagLoading && setDeleteModalTag(null)}
                className="text-white/60 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0B0D14] p-4 text-center">
              <span className="text-xs text-white/50 block mb-1">
                كود الملصق المراد حذفه نهائياً
              </span>
              <span dir="ltr" className="font-mono text-xl font-black text-red-400">
                {deleteModalTag.tagCode}
              </span>
            </div>

            <p className="text-xs leading-relaxed text-white/75">
              سيتم حذف هذا الملصق وكافة البلاغات والوثائق المرتبطة به نهائياً من النظام، ولن يعود قابلاً للاستخدام أو المسح عبر QR.
            </p>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={deleteTagLoading}
                onClick={() => setDeleteModalTag(null)}
                className="flex-1 rounded-xl border-white/20 bg-white/5 text-white"
              >
                إلغاء
              </Button>
              <Button
                type="button"
                disabled={deleteTagLoading}
                onClick={() => handleDeleteTag(deleteModalTag.tagCode)}
                className="flex-1 rounded-xl bg-red-600 text-white hover:bg-red-700 font-bold"
              >
                {deleteTagLoading ? "جاري المسح..." : "تأكيد المسح النهائي"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة التأكيد الحمراء لمنطقة الطوارئ (Danger Zone) */}
      {showDangerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border-2 border-primary bg-[#12151F] p-6 text-white shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-3 py-1 text-xs font-black text-primary">
                <AlertOctagon className="h-4 w-4" />
                تأكيد العملية الخطرة
              </span>
              <button
                type="button"
                onClick={() => setShowDangerModal(false)}
                className="text-white/60 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <h3 className="text-lg font-black text-white">
              هل أنت متأكد من تصفير بيانات الاختبار؟
            </h3>
            <p className="text-xs leading-relaxed text-white/75">
              لتأكيد مسح سجلات الاختبار وإرجاع الملصقات إلى حالة LOCKED دون لمس
              بنية الجداول، اكتب كلمة{" "}
              <strong className="text-primary">تصفير</strong> في الحقل أدناه:
            </p>

            <input
              type="text"
              value={dangerConfirmText}
              onChange={(e) => setDangerConfirmText(e.target.value)}
              placeholder="اكتب: تصفير"
              className="h-11 w-full rounded-xl border border-primary/50 bg-[#07090E] px-3 text-center text-sm font-black text-white focus:outline-none"
            />

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDangerModal(false)}
                className="flex-1 rounded-xl border-white/20 bg-white/5 text-white"
              >
                تراجع
              </Button>
              <Button
                type="button"
                disabled={dangerConfirmText.trim() !== "تصفير"}
                onClick={handleDangerZoneReset}
                className="flex-1 rounded-xl bg-primary text-white"
              >
                تأكيد التصفير الآن
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة تغيير كلمة المرور الذاتية للمشرف الحالي */}
      {showChangePassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleChangeOwnPassword}
            className="w-full max-w-md rounded-3xl border border-white/15 bg-[#12151F] p-6 text-white shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="inline-flex items-center gap-2 text-base font-black">
                <KeyRound className="h-4 w-4 text-primary" />
                تغيير كلمة المرور الخاصة بي
              </h3>
              <button
                type="button"
                onClick={() => setShowChangePassModal(false)}
                className="text-white/60 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {renderPasswordFields(true)}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowChangePassModal(false)}
                className="rounded-xl border-white/20 bg-white/5 text-white"
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={changePassLoading} className="rounded-xl">
                {changePassLoading ? "جاري الحفظ..." : "حفظ كلمة المرور الجديدة"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* بطاقة بيانات الدخول المولدة (عند إنشاء مشرف أو إعادة تعيين كلمة مروره) */}
      {issuedCredentials && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border-2 border-emerald-500/60 bg-[#12151F] p-6 text-white shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
              <h3 className="text-base font-black">{issuedCredentials.title}</h3>
            </div>
            <p className="text-xs leading-relaxed text-white/70">
              انسخ بيانات الدخول وسلّمها للمشرف. لن تظهر كلمة المرور مرة أخرى،
              وسيُطلب منه تعيين كلمة مرور جديدة خاصة به عند أول دخول.
            </p>
            <div className="space-y-2 rounded-2xl border border-white/10 bg-[#07090E] p-4 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-white/60">الاسم</span>
                <span className="font-bold">{issuedCredentials.fullName}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-white/60">رقم الهاتف (معرّف الدخول الأساسي)</span>
                <span dir="ltr" className="font-mono font-bold text-primary">
                  {issuedCredentials.phone}
                </span>
              </div>
              {issuedCredentials.username && issuedCredentials.username !== issuedCredentials.phone && (
                <div className="flex justify-between gap-2">
                  <span className="text-white/60">اسم المستخدم (إضافي)</span>
                  <span dir="ltr" className="font-mono font-bold">
                    {issuedCredentials.username}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-white/60">كلمة المرور المؤقتة</span>
                <span
                  dir="ltr"
                  className="rounded-lg bg-emerald-500/15 px-3 py-1 font-mono text-lg font-black tracking-widest text-emerald-300"
                >
                  {issuedCredentials.password}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const text = `بوابة إدارة بَلِّغْنِي\nرقم الهاتف (معرّف الدخول الأساسي): ${issuedCredentials.phone}\nكلمة المرور المؤقتة: ${issuedCredentials.password}${issuedCredentials.username && issuedCredentials.username !== issuedCredentials.phone ? `\nاسم المستخدم: ${issuedCredentials.username}` : ""}\nالرابط: ${window.location.origin}/admin`;
                  void navigator.clipboard
                    ?.writeText(text)
                    .then(() => showToast("تم نسخ بيانات الدخول ✓"))
                    .catch(() => showToast("تعذر النسخ، انسخها يدوياً."));
                }}
                className="flex-1 rounded-xl border-white/20 bg-white/5 text-white"
              >
                <Copy className="h-4 w-4" />
                نسخ البيانات
              </Button>
              <Button
                type="button"
                onClick={() => setIssuedCredentials(null)}
                className="flex-1 rounded-xl"
              >
                تم
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة تعديل حساب المشرف وصلاحياته */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveMemberEdit}
            className="w-full max-w-md rounded-3xl border border-white/15 bg-[#12151F] p-6 text-white shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black">
                تعديل حساب المشرف ({editingMember.fullName})
              </h3>
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="text-white/60 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-white/80">الاسم</label>
                <input
                  type="text"
                  value={editMemberName}
                  onChange={(e) => setEditMemberName(e.target.value)}
                  className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 text-xs font-bold text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-white/80">اسم المستخدم</label>
                <input
                  type="text"
                  dir="ltr"
                  value={editMemberUsername}
                  onChange={(e) =>
                    setEditMemberUsername(e.target.value.toLowerCase().replace(/\s+/g, ""))
                  }
                  className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 font-mono text-xs font-bold text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-white/80">رقم الهاتف</label>
                <input
                  type="text"
                  dir="ltr"
                  value={editMemberPhone}
                  onChange={(e) => setEditMemberPhone(e.target.value)}
                  className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 font-mono text-xs font-bold text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-white/80">الدور الوظيفي</label>
                {editingMember.roleTitle.includes("SUPER_ADMIN") ? (
                  <input
                    type="text"
                    disabled
                    value="المدير التنفيذي الرئيسي (SUPER_ADMIN)"
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E]/50 px-3 text-xs font-bold text-white/50"
                  />
                ) : (
                  <select
                    value={
                      editMemberRole === "SUPPORT" || editMemberRole.includes("SUPPORT")
                        ? "SUPPORT"
                        : "OPERATOR"
                    }
                    onChange={(e) => setEditMemberRole(e.target.value)}
                    className="h-11 w-full rounded-xl border border-white/15 bg-[#07090E] px-3 text-xs font-bold text-white focus:border-primary focus:outline-none"
                  >
                    <option value="OPERATOR">مشرف عمليات (OPERATOR)</option>
                    <option value="SUPPORT">دعم فني (SUPPORT)</option>
                  </select>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ALL_PERMISSIONS.map((perm) => {
                const checked = editMemberPerms.includes(perm);
                return (
                  <button
                    key={perm}
                    type="button"
                    onClick={() =>
                      setEditMemberPerms((prev) =>
                        checked ? prev.filter((p) => p !== perm) : [...prev, perm]
                      )
                    }
                    className={cn(
                      "rounded-xl border px-3 py-2 text-right text-xs font-bold transition",
                      checked
                        ? "border-primary bg-primary/20 text-white"
                        : "border-white/10 bg-[#07090E] text-white/55"
                    )}
                  >
                    {checked ? "✓ " : ""}
                    {PERMISSION_LABELS[perm]}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingMember(null)}
                className="rounded-xl border-white/20 bg-white/5 text-white"
              >
                إلغاء
              </Button>
              <Button type="submit" className="rounded-xl">
                حفظ التعديلات
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* تأكيد حذف حساب المشرف نهائياً */}
      {deletingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border-2 border-primary bg-[#12151F] p-6 text-white shadow-2xl space-y-4">
            <h3 className="inline-flex items-center gap-2 text-base font-black">
              <Trash2 className="h-4 w-4 text-primary" />
              حذف حساب المشرف نهائياً
            </h3>
            <p className="text-xs leading-relaxed text-white/75">
              سيتم حذف حساب{" "}
              <strong className="text-white">{deletingMember.fullName}</strong> (
              <span dir="ltr" className="font-mono">{deletingMember.phone}</span>)
              وإلغاء جميع صلاحياته فوراً. لا يمكن التراجع عن هذا الإجراء — إذا
              أردت منعه مؤقتاً فقط استخدم «تعطيل الحساب».
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeletingMember(null)}
                className="flex-1 rounded-xl border-white/20 bg-white/5 text-white"
              >
                تراجع
              </Button>
              <Button
                type="button"
                onClick={handleDeleteMember}
                className="flex-1 rounded-xl bg-primary text-white"
              >
                تأكيد الحذف
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
