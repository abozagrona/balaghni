/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverMinification: false,
  },
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const staticScriptSrc = isProd
      ? "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com";

    // 1. سياسة الصفحات العامة الثابتة الخمس فقط (Static Public HTML Pages)
    const staticHtmlCspValue = [
      "default-src 'self'",
      staticScriptSrc,
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

    // 2. سياسة معالجات المسارات المنتجة لـ HTML ثابت بدون أي JavaScript (/r/:short_code و /api/notify/reply)
    const scriptlessHtmlRouteHandlerCspValue = [
      "default-src 'none'",
      "script-src 'none'",
      "style-src 'unsafe-inline'",
      "img-src 'self' data:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    // 3. سياسة مسارات الـ API التي تنتج application/json أو text/plain فقط
    const apiJsonCspValue = [
      "default-src 'none'",
      "script-src 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");

    // القائمة الصريحة للصفحات العامة الثابتة الخمس (Exact Match — لا تطابق /activate/security)
    const explicitStaticPublicPaths = [
      "/",
      "/order",
      "/privacy",
      "/terms",
      "/activate",
    ];

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(self), geolocation=(), publickey-credentials-get=(self), publickey-credentials-create=(self)",
          },
        ],
      },
      ...explicitStaticPublicPaths.map((staticPath) => ({
        source: staticPath,
        headers: [
          { key: "Content-Security-Policy", value: staticHtmlCspValue },
        ],
      })),
      {
        source: "/r/:short_code",
        headers: [
          {
            key: "Content-Security-Policy",
            value: scriptlessHtmlRouteHandlerCspValue,
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: apiJsonCspValue,
          },
          {
            key: "Access-Control-Allow-Origin",
            value: "https://balaghni.ly",
          },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value:
              "Content-Type, Authorization, X-Admin-Session, X-Admin-Token, X-Owner-Session, X-Otp-Proof, X-Report-Token, X-Call-Owner-Token",
          },
          {
            key: "Access-Control-Allow-Credentials",
            value: "true",
          },
        ],
      },
      {
        source: "/api/notify/reply",
        headers: [
          {
            key: "Content-Security-Policy",
            value: scriptlessHtmlRouteHandlerCspValue,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
