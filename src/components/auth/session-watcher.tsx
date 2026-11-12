"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  OWNER_SESSION_KEY,
  OWNER_USER_KEY,
  isSessionExpired,
  touchSessionActivity,
  clearOwnerSession,
} from "@/lib/auth-session";

export function SessionWatcher() {
  const router = useRouter();
  const pathname = usePathname();

  const handleAutoLogout = React.useCallback(
    (reason?: "idle" | "absolute") => {
      clearOwnerSession();

      // تجنب التوجيه الدائري إذا كان المستخدم موجوداً بالفعل في صفحة الدخول
      if (typeof window !== "undefined") {
        if (!window.location.pathname.startsWith("/login")) {
          router.push("/login?expired=1");
        } else {
          // إذا كان في صفحة الدخول، نقوم بتحديث معلمات الرابط فقط لإظهار التنبيه
          const url = new URL(window.location.href);
          if (url.searchParams.get("expired") !== "1") {
            url.searchParams.set("expired", "1");
            router.replace(url.pathname + url.search);
          }
        }
      }
    },
    [router]
  );

  const checkValidity = React.useCallback(() => {
    if (typeof window === "undefined") return;

    try {
      const raw =
        window.localStorage.getItem(OWNER_SESSION_KEY) ||
        window.sessionStorage.getItem(OWNER_SESSION_KEY) ||
        window.localStorage.getItem(OWNER_USER_KEY);

      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.tagCode) return;

      const { expired, reason } = isSessionExpired(parsed);
      if (expired) {
        handleAutoLogout(reason);
      }
    } catch {
      // ignore
    }
  }, [handleAutoLogout]);

  React.useEffect(() => {
    // 1. فحص أولي عند تحميل الصفحة أو التنقل
    checkValidity();

    // 2. تحديث وقت آخر نشاط عند تفاعل المستخدم
    const handleUserActivity = () => {
      touchSessionActivity();
    };

    const activityEvents = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "click",
    ];

    activityEvents.forEach((event) => {
      window.addEventListener(event, handleUserActivity, { passive: true });
    });

    // 3. فحص دوري كل 30 ثانية
    const intervalId = window.setInterval(() => {
      checkValidity();
    }, 30 * 1000);

    // 4. فحص فوري عند عودة المستخدم للتبويب أو التركيز على النافذة
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkValidity();
      }
    };

    const handleFocus = () => {
      checkValidity();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      activityEvents.forEach((event) => {
        window.removeEventListener(event, handleUserActivity);
      });
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [checkValidity, pathname]);

  return null;
}
