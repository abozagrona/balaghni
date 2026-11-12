"use client";

import * as React from "react";

export interface OwnerSession {
  tagCode: string;
  vehicleInfo?: string;
  city?: string;
  ownerPhone?: string;
  activatedAt?: string;
  sessionCreatedAt?: number; // وقت إنشاء الجلسة (بالمللي ثانية)
  lastActivityAt?: number;   // وقت آخر نشاط (بالمللي ثانية)
}

export const OWNER_SESSION_KEY = "balaghni_owner_active_tag";
export const OWNER_USER_KEY = "balaghni_user";
export const OWNER_SESSION_COOKIE = "balaghni_session";
export const AUTH_CHANGE_EVENT = "balaghni_auth_changed";

// الحدود الزمنية الصارمة للجلسة
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 دقيقة من عدم النشاط
export const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000; // 24 ساعة كحد أقصى لعمر الجلسة
export const ACTIVITY_THROTTLE_MS = 15 * 1000; // تحديث النشاط كل 15 ثانية كحد أقصى لتخفيف العبء على التخزين

/**
 * فحص صلاحية جلسة المالك الزمنية (خمول أو تجاوز 24 ساعة)
 */
export function isSessionExpired(session: OwnerSession): {
  expired: boolean;
  reason?: "idle" | "absolute";
} {
  const now = Date.now();
  const createdAt = session.sessionCreatedAt || now;
  const lastActivity = session.lastActivityAt || now;

  // 1. تجاوز الحد الأقصى لعمر الجلسة (24 ساعة)
  if (now - createdAt >= MAX_SESSION_AGE_MS) {
    return { expired: true, reason: "absolute" };
  }

  // 2. تجاوز مهلة الخمول (30 دقيقة)
  if (now - lastActivity >= IDLE_TIMEOUT_MS) {
    return { expired: true, reason: "idle" };
  }

  return { expired: false };
}

/**
 * جلب بيانات جلسة مالك المركبة النشطة من التخزين المحلي
 */
export function getOwnerSession(): OwnerSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw =
      window.localStorage.getItem(OWNER_SESSION_KEY) ||
      window.sessionStorage.getItem(OWNER_SESSION_KEY) ||
      window.localStorage.getItem(OWNER_USER_KEY);

    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.tagCode === "string" && parsed.tagCode.trim()) {
      const now = Date.now();
      const sessionObj: OwnerSession = {
        tagCode: parsed.tagCode.trim().toUpperCase(),
        vehicleInfo: parsed.vehicleInfo || "",
        city: parsed.city || "طرابلس",
        ownerPhone: parsed.ownerPhone || "",
        activatedAt: parsed.activatedAt,
        sessionCreatedAt: typeof parsed.sessionCreatedAt === "number" ? parsed.sessionCreatedAt : now,
        lastActivityAt: typeof parsed.lastActivityAt === "number" ? parsed.lastActivityAt : now,
      };

      // التحقق مما إذا كانت الجلسة منتهية الصلاحية
      const { expired } = isSessionExpired(sessionObj);
      if (expired) {
        clearOwnerSession();
        return null;
      }

      return sessionObj;
    }
  } catch {
    // ignore json parse errors
  }

  return null;
}

/**
 * حفظ جلسة المالك ومزامنتها في LocalStorage و SessionStorage والـ Cookies مع تسجيل التوقيتات
 */
export function saveOwnerSession(session: OwnerSession): void {
  if (typeof window === "undefined") return;

  try {
    const now = Date.now();
    const normalized: OwnerSession = {
      tagCode: session.tagCode.trim().toUpperCase(),
      vehicleInfo: session.vehicleInfo?.trim() || "",
      city: session.city?.trim() || "طرابلس",
      ownerPhone: session.ownerPhone?.trim() || "",
      activatedAt: session.activatedAt || new Date().toISOString(),
      sessionCreatedAt: session.sessionCreatedAt || now,
      lastActivityAt: session.lastActivityAt || now,
    };

    const serialized = JSON.stringify(normalized);
    window.localStorage.setItem(OWNER_SESSION_KEY, serialized);
    window.localStorage.setItem(OWNER_USER_KEY, serialized);
    window.sessionStorage.setItem(OWNER_SESSION_KEY, serialized);

    // تعيين الكوكي لضمان استمرار الجلسة بما لا يتجاوز 24 ساعة (86400 ثانية)
    document.cookie = `${OWNER_SESSION_COOKIE}=${encodeURIComponent(
      normalized.tagCode
    )}; path=/; max-age=86400; SameSite=Lax`;

    // إشعار كافة المكونات في الصفحة بتحديث الجلسة فورياً
    window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT, { detail: normalized }));
  } catch {
    // ignore storage quota errors
  }
}

/**
 * تحديث توقيت آخر نشاط للمستخدم تلقائياً عند التفاعل
 */
let lastTouchTime = 0;
export function touchSessionActivity(): void {
  if (typeof window === "undefined") return;

  const now = Date.now();
  if (now - lastTouchTime < ACTIVITY_THROTTLE_MS) {
    return;
  }
  lastTouchTime = now;

  try {
    const raw =
      window.localStorage.getItem(OWNER_SESSION_KEY) ||
      window.sessionStorage.getItem(OWNER_SESSION_KEY) ||
      window.localStorage.getItem(OWNER_USER_KEY);

    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.tagCode) return;

    parsed.lastActivityAt = now;
    if (!parsed.sessionCreatedAt) {
      parsed.sessionCreatedAt = now;
    }

    const serialized = JSON.stringify(parsed);
    window.localStorage.setItem(OWNER_SESSION_KEY, serialized);
    window.localStorage.setItem(OWNER_USER_KEY, serialized);
    window.sessionStorage.setItem(OWNER_SESSION_KEY, serialized);
  } catch {
    // ignore
  }
}

/**
 * إنهاء الجلسة وتسجيل الخروج ومسح كافة البيانات
 */
export function clearOwnerSession(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(OWNER_SESSION_KEY);
    window.localStorage.removeItem(OWNER_USER_KEY);
    window.sessionStorage.removeItem(OWNER_SESSION_KEY);
    window.sessionStorage.removeItem(OWNER_USER_KEY);

    // انتهاء صلاحية الكوكي
    document.cookie = `${OWNER_SESSION_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;`;

    // إشعار كافة المكونات بالخروج
    window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT, { detail: null }));
  } catch {
    // ignore
  }
}

/**
 * Hook لمراقبة حالة جلسة المالك ومزامنتها لحظياً في أي مكان بالموقع
 */
export function useOwnerSession() {
  const [session, setSession] = React.useState<OwnerSession | null>(null);
  const [isMounted, setIsMounted] = React.useState(false);

  const refreshSession = React.useCallback(() => {
    const current = getOwnerSession();
    setSession(current);
  }, []);

  React.useEffect(() => {
    setIsMounted(true);
    refreshSession();

    const handleAuthChange = (e: Event) => {
      const customEvent = e as CustomEvent<OwnerSession | null>;
      if (customEvent.detail !== undefined) {
        setSession(customEvent.detail);
      } else {
        refreshSession();
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === OWNER_SESSION_KEY || e.key === OWNER_USER_KEY) {
        refreshSession();
      }
    };

    const handleFocus = () => {
      refreshSession();
    };

    window.addEventListener(AUTH_CHANGE_EVENT, handleAuthChange);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, handleAuthChange);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshSession]);

  const logout = React.useCallback(() => {
    clearOwnerSession();
    setSession(null);
  }, []);

  return {
    session,
    isLoggedIn: Boolean(session?.tagCode),
    isMounted,
    logout,
    refreshSession,
  };
}
