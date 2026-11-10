import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, IBM_Plex_Mono, Cairo } from "next/font/google";
import { LiveVisualEditor } from "@/components/editor/live-visual-editor";
import "./globals.css";

const ibmArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-ibm-arabic",
  display: "swap",
});

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-cairo",
  display: "swap",
});

const ibmMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "بَلِّغْنِي | BALAGHNI — امسح للتواصل مع صاحب السيارة",
    template: "%s | بَلِّغْنِي BALAGHNI",
  },
  description:
    "منصة بَلِّغْنِي (BALAGHNI) الذكية في ليبيا: امسح رمز QR للتواصل الفوري والآمن مع صاحب السيارة دون كشف رقم الهاتف.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#E51926" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0D13" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${ibmArabic.variable} ${cairo.variable} ${ibmMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans selection:bg-primary selection:text-white">
        {children}
        <LiveVisualEditor />
      </body>
    </html>
  );
}
