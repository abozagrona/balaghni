import type { Metadata, Viewport } from "next";
import { LiveVisualEditor } from "@/components/editor/live-visual-editor";
import "./globals.css";

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
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans selection:bg-primary selection:text-white">
        {children}
        <LiveVisualEditor />
      </body>
    </html>
  );
}
