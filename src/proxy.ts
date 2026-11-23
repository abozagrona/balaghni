import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * توليد Nonce عشوائي تشفيري فريد لكل طلب (128-bit، بصيغة Base64) ولا يُعاد استخدامه أبداً.
 */
export function generateCspNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

/**
 * بناء سياسة Content-Security-Policy المبنية على Nonce في script-src لصفحات HTML الديناميكية الحساسة
 * (بدون 'unsafe-inline' في script-src، وبدون 'strict-dynamic'، ومع الإبقاء على 'unsafe-inline' في style-src لأنماط React،
 * والحفاظ على موارد Supabase و Vercel Analytics، دون أي اعتماد على Host أو X-Forwarded-Host).
 */
export function buildEnforcedNonceCspHeader(nonce: string): string {
  const safeNonce = String(nonce || "").replace(/[^A-Za-z0-9+/=_-]/g, "");
  const isProd = process.env.NODE_ENV === "production";
  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${safeNonce}' https://va.vercel-scripts.com`
    : `script-src 'self' 'nonce-${safeNonce}' 'unsafe-eval' https://va.vercel-scripts.com`;

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in",
    "media-src 'self' blob: mediastream:",
    "connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://va.vercel-scripts.com",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

// مرادف متوافق مع الاختبارات السابقة
export const buildNonceCspReportOnlyHeader = buildEnforcedNonceCspHeader;

/**
 * تصنيف صفحات المشروع المعتمد لـ VULN-06:
 * - staticMustRemain: الصفحات التسويقية والقانونية العامة الخمس التي تبقى Static (○).
 * - dynamicNoncePages: الصفحات التفاعلية والإدارية الـ 11 المحمية بـ Nonce إلزامي لكل طلب (ƒ).
 */
export const CSP_PAGE_RENDERING_CLASSIFICATION = {
  staticMustRemain: [
    "/",
    "/order",
    "/privacy",
    "/terms",
    "/activate",
  ] as const,
  dynamicNoncePages: [
    "/login",
    "/admin",
    "/admin/login",
    "/admin/office",
    "/s/[tagCode]",
    "/s/[tagCode]/emergency",
    "/call/[call_code]",
    "/dashboard",
    "/vendor",
    "/activate/security",
    "/verify",
  ] as const,
  candidateDynamicNoncePages: [
    "/admin",
    "/admin/login",
    "/admin/office",
    "/login",
    "/dashboard",
    "/vendor",
    "/activate/security",
    "/verify",
  ] as const,
  alreadyDynamicPages: [
    "/s/[tagCode]",
    "/s/[tagCode]/emergency",
    "/call/[call_code]",
  ] as const,
} as const;

/**
 * استخراج قيمة الـ Nonce من ترويسة Content-Security-Policy (أو Report-Only) للتحقق الآلي من التطابق
 * بين ترويسة الطلب (x-nonce)، ترويسة الاستجابة (x-nonce)، وتوجيه script-src ('nonce-...').
 */
export function extractCspHeaderNonce(cspHeaderValue?: string | null): string | null {
  const raw = String(cspHeaderValue || "");
  const match = raw.match(/'nonce-([A-Za-z0-9+/=_-]+)'/);
  return match?.[1] || null;
}

export function isProtectedApiPathname(pathname: string): boolean {
  return (
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/agents") ||
    pathname === "/api/visual-overrides" ||
    pathname.startsWith("/api/visual-overrides/")
  );
}

export function isDynamicNonceHtmlPathname(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return false;
  return (
    pathname === "/login" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/s/") ||
    pathname.startsWith("/call/") ||
    pathname === "/dashboard" ||
    pathname === "/vendor" ||
    pathname === "/activate/security" ||
    pathname.startsWith("/activate/security/") ||
    pathname === "/verify"
  );
}

/**
 * معالجة طلبات صفحات HTML الديناميكية الحساسة (الفئة B):
 * 1. تجاهل وتطهير أي x-nonce أو content-security-policy مرسلة من العميل لمنع التزوير.
 * 2. توليد Nonce عشوائي 128-bit فريد لكل طلب.
 * 3. تمرير Content-Security-Policy في requestHeaders ليقرأها getScriptNonceFromHeaders في Next.js 16.4.6
 *    ويحقن nonce="..." في جميع وسوم <script> وHydration.
 * 4. وضع Content-Security-Policy الإلزامية على الاستجابة.
 */
function attachEnforcedHtmlNonceHeaders(request: NextRequest): NextResponse {
  const nonce = generateCspNonce();
  const enforcedNonceCsp = buildEnforcedNonceCspHeader(nonce);
  const requestHeaders = new Headers(request.headers);

  // منع قبول أي Nonce أو سياسة CSP قادمة من العميل
  requestHeaders.delete("x-nonce");
  requestHeaders.delete("content-security-policy");
  requestHeaders.delete("content-security-policy-report-only");

  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", enforcedNonceCsp);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("x-nonce", nonce);
  response.headers.set("Content-Security-Policy", enforcedNonceCsp);
  return response;
}

/**
 * معالجة مسارات الـ API المحمية بعد اجتياز فحص CSRF/Origin:
 * لا تطبق سياسة HTML Nonce الإلزامية على استجابة JSON API (التي تتلقى default-src 'none' من next.config.mjs)،
 * مع الإبقاء على ترويسة x-nonce و Content-Security-Policy-Report-Only للتوافق مع اختبارات المراقبة.
 */
function attachProtectedApiHeaders(request: NextRequest): NextResponse {
  const nonce = generateCspNonce();
  const reportOnlyCsp = buildEnforcedNonceCspHeader(nonce);
  const requestHeaders = new Headers(request.headers);

  requestHeaders.delete("x-nonce");
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("x-nonce", nonce);
  response.headers.set("Content-Security-Policy-Report-Only", reportOnlyCsp);
  return response;
}

function buildTrustedOrigins(): Set<string> {
  const isProduction = process.env.NODE_ENV === "production";
  const origins = new Set<string>();

  const candidateUrls = [
    "https://balaghni.ly",
    "https://www.balaghni.ly",
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.APP_URL,
    ...(process.env.ALLOWED_ADMIN_ORIGINS || "").split(","),
  ];

  for (const raw of candidateUrls) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      const protocolAllowed = isProduction
        ? parsed.protocol === "https:"
        : parsed.protocol === "https:" || parsed.protocol === "http:";
      if (protocolAllowed) {
        origins.add(parsed.origin);
      }
    } catch {
      // ignore malformed config entry
    }
  }

  if (!isProduction) {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return origins;
}

/**
 * Next.js 16 Proxy الموحد:
 * - يفصل بين مسارات صفحات HTML الديناميكية الحساسة (تطبيق Enforced Nonce CSP لكل طلب)
 * - ومسارات الـ API الإدارية الحساسة (فحص CSRF/Origin الصارم على الطلبات المعدِّلة بدون تخفيف).
 */
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl?.pathname || new URL(request.url).pathname;

  // 1. إذا كان المسار صفحة HTML ديناميكية حساسة (وليس API) -> تطبيق Enforced Nonce CSP
  if (isDynamicNonceHtmlPathname(pathname)) {
    return attachEnforcedHtmlNonceHeaders(request);
  }

  // 2. مسارات الـ API المحمية: فحص CSRF / Origin على الطلبات المعدّلة (POST/PUT/PATCH/DELETE)
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) {
    return attachProtectedApiHeaders(request);
  }

  const secFetchSite = (request.headers.get("sec-fetch-site") || "")
    .trim()
    .toLowerCase();
  if (secFetchSite === "cross-site") {
    return NextResponse.json(
      { ok: false, error: "Forbidden: cross-site request rejected" },
      { status: 403 }
    );
  }

  const trustedOrigins = buildTrustedOrigins();
  const originHeader = (request.headers.get("origin") || "").trim();
  const refererHeader = (request.headers.get("referer") || "").trim();

  if (originHeader) {
    try {
      const parsedOrigin = new URL(originHeader).origin;
      if (!trustedOrigins.has(parsedOrigin)) {
        return NextResponse.json(
          { ok: false, error: "Forbidden: untrusted request origin" },
          { status: 403 }
        );
      }
    } catch {
      return NextResponse.json(
        { ok: false, error: "Forbidden: invalid request origin" },
        { status: 403 }
      );
    }
  } else if (refererHeader) {
    try {
      const parsedRefererOrigin = new URL(refererHeader).origin;
      if (!trustedOrigins.has(parsedRefererOrigin)) {
        return NextResponse.json(
          { ok: false, error: "Forbidden: untrusted request referer" },
          { status: 403 }
        );
      }
    } catch {
      return NextResponse.json(
        { ok: false, error: "Forbidden: invalid request referer" },
        { status: 403 }
      );
    }
  } else if (process.env.NODE_ENV === "production") {
    if (secFetchSite !== "same-origin") {
      return NextResponse.json(
        { ok: false, error: "Forbidden: missing trusted request origin" },
        { status: 403 }
      );
    }
  }

  return attachProtectedApiHeaders(request);
}

export const config = {
  matcher: [
    "/login",
    "/admin",
    "/admin/:path*",
    "/s/:path*",
    "/call/:path*",
    "/dashboard",
    "/vendor",
    "/activate/security",
    "/verify",
    "/api/admin/:path*",
    "/api/agents/:path*",
    "/api/visual-overrides",
    "/api/visual-overrides/:path*",
  ],
};
