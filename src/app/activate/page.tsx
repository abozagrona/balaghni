"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera,
  CameraOff,
  QrCode,
  Keyboard,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  LoaderCircle,
  CheckCircle2,
  ScanLine,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { Button } from "@/components/ui/button";
import { formatBalaghniTagCode } from "@/lib/utils";

interface BarcodeDetectorResult {
  rawValue: string;
}

interface BarcodeDetectorInstance {
  detect(
    image: ImageBitmapSource | HTMLVideoElement | HTMLCanvasElement
  ): Promise<BarcodeDetectorResult[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): BarcodeDetectorInstance;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

/**
 * استخراج كود الملصق من نص أو رابط QR تم مسحه
 * مثال: "https://balaghni.ly/s/LY-K7W9-P2M4" -> "LY-K7W9-P2M4"
 */
function extractTagCodeFromScan(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  // فحص إن كان رابطاً يحتوي على /s/[tagCode]
  const urlMatch = trimmed.match(/\/s\/([A-Za-z0-9-]+)/i);
  if (urlMatch && urlMatch[1]) {
    return formatBalaghniTagCode(urlMatch[1]);
  }

  // فحص إن كان كوداً يبدأ بـ LY- أو نصاً مشابهاً
  const codeMatch = trimmed.match(/\b(LY-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}|LY-[A-Za-z0-9-]{4,14})\b/i);
  if (codeMatch && codeMatch[1]) {
    return formatBalaghniTagCode(codeMatch[1]);
  }

  // إذا أدخل أو مسح كوداً خاماً مثل K7W9-P2M4
  const clean = trimmed.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (clean.length >= 4) {
    return formatBalaghniTagCode(clean);
  }

  return null;
}

export default function ActivateNewTagPage() {
  const router = useRouter();

  // حالة الكاميرا والمسح الضوئي
  const [cameraActive, setCameraActive] = React.useState(false);
  const [cameraStarting, setCameraStarting] = React.useState(false);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [scannedCode, setScannedCode] = React.useState<string | null>(null);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const scanIntervalRef = React.useRef<number | null>(null);

  // حالة الإدخال اليدوي للكود
  const [manualCode, setManualCode] = React.useState("");
  const [manualLoading, setManualLoading] = React.useState(false);
  const [manualError, setManualError] = React.useState<string | null>(null);

  const stopCamera = React.useCallback(() => {
    if (scanIntervalRef.current) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraStarting(false);
  }, []);

  React.useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const handleDetectedQr = React.useCallback(
    (rawValue: string) => {
      const code = extractTagCodeFromScan(rawValue);
      if (!code) return;

      setScannedCode(code);
      stopCamera();
      router.push(`/s/${encodeURIComponent(code)}?intent=activate`);
    },
    [router, stopCamera]
  );

  const startCamera = async () => {
    setCameraError(null);
    setScannedCode(null);

    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setCameraError(
        "متصفحك الحالي لا يدعم تشغيل الكاميرا مباشرة. يمكنك إدخال كود الملصق يدوياً بالأسفل."
      );
      return;
    }

    setCameraStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraActive(true);
      setCameraStarting(false);

      // ربط البث بعنصر الفيديو وتشغيل قارئ BarcodeDetector القياسي
      setTimeout(async () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        if (window.BarcodeDetector) {
          let detector: BarcodeDetectorInstance | null = null;
          try {
            detector = new window.BarcodeDetector({ formats: ["qr_code"] });
          } catch {
            detector = new window.BarcodeDetector();
          }

          scanIntervalRef.current = window.setInterval(async () => {
            if (
              !videoRef.current ||
              videoRef.current.readyState < 2 ||
              !detector
            ) {
              return;
            }
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                handleDetectedQr(barcodes[0].rawValue);
              }
            } catch {
              // ignore frame errors
            }
          }, 250);
        }
      }, 120);
    } catch {
      setCameraStarting(false);
      setCameraActive(false);
      setCameraError(
        "تعذر الوصول إلى الكاميرا. يرجى السماح بصلاحية الكاميرا في المتصفح أو إدخال الكود يدوياً بالأسفل."
      );
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (manualLoading) return;
    setManualError(null);

    const extracted = extractTagCodeFromScan(manualCode);
    if (!extracted || extracted === "LY-000000" || extracted.length < 6) {
      setManualError(
        "يرجى إدخال كود الملصق بشكل صحيح (مثال: LY-K7W9-P2M4)."
      );
      return;
    }

    setManualLoading(true);
    stopCamera();
    router.push(`/s/${encodeURIComponent(extracted)}?intent=activate`);
  };

  return (
    <div className="min-h-dvh bg-[#0B0D13] text-white flex flex-col justify-between relative overflow-hidden">
      {/* توهجات خلفية */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-primary/15 blur-3xl"
      />

      {/* الشريط العلوي */}
      <header className="relative z-10 border-b border-white/10 bg-[#0B0D13]/90 backdrop-blur-md">
        <div className="shell flex items-center justify-between py-3.5">
          <Link href="/">
            <BalaghniLogo variant="dark" size="md" showTagline />
          </Link>

          <div className="flex items-center gap-2.5">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white/85 transition hover:border-primary/50 hover:text-white"
            >
              <span>دخول المالك</span>
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white/75 transition hover:border-primary/50 hover:text-white"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              <span>الرئيسية</span>
            </Link>
          </div>
        </div>
      </header>

      {/* المحتوى الرئيسي */}
      <main className="relative z-10 mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:py-10 space-y-6">
        {/* الترويسة */}
        <div className="text-center space-y-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/35 bg-primary/15 px-3.5 py-1 text-xs font-bold text-primary">
            <ShieldCheck className="h-4 w-4" />
            منظومة التفعيل الذكي • بَلِّغْنِي
          </span>

          <h1 className="text-2xl font-black tracking-tight text-white sm:text-4xl">
            تفعيل ملصق جديد
          </h1>

          <p className="mx-auto max-w-md text-xs leading-relaxed text-white/70 sm:text-sm">
            امسح رمز الـ QR المطبوع على ملصق سيارتك بالكاميرا، أو أدخل كود
            الملصق يدوياً لربطه برقم هاتفك وتأمين حسابك
          </p>
        </div>

        {/* الخيار الأول: مسح رمز الـ QR بالكاميرا */}
        <section className="rounded-[28px] border border-white/12 bg-[#141721]/95 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)] sm:p-7 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Camera className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-black text-white sm:text-lg">
                  الخيار الأول: مسح الملصق بالكاميرا
                </h2>
                <p className="text-xs text-white/60">
                  وجّه كاميرا هاتفك نحو رمز الـ QR الموجود على الملصق
                </p>
              </div>
            </div>

            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400">
              تلقائي وسريع
            </span>
          </div>

          {/* إطار الفحص التفاعلي للكاميرا */}
          <div className="relative overflow-hidden rounded-3xl border-2 border-dashed border-white/20 bg-[#0B0D13] aspect-[4/3] flex flex-col items-center justify-center">
            {cameraActive ? (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
                {/* إطار التوجيه الضوئي فوق الفيديو */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                  <div className="relative h-52 w-52 sm:h-60 sm:w-60 rounded-3xl border-2 border-primary shadow-[0_0_0_9999px_rgba(11,13,19,0.55)]">
                    {/* زوايا الإطار */}
                    <span className="absolute -top-1 -right-1 h-7 w-7 rounded-tr-2xl border-t-4 border-r-4 border-primary" />
                    <span className="absolute -top-1 -left-1 h-7 w-7 rounded-tl-2xl border-t-4 border-l-4 border-primary" />
                    <span className="absolute -bottom-1 -right-1 h-7 w-7 rounded-br-2xl border-b-4 border-r-4 border-primary" />
                    <span className="absolute -bottom-1 -left-1 h-7 w-7 rounded-bl-2xl border-b-4 border-l-4 border-primary" />

                    {/* خط المسح المتحرك */}
                    <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 flex items-center justify-center">
                      <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-primary to-transparent shadow-[0_0_12px_#E51926] animate-pulse" />
                    </div>
                  </div>
                </div>

                <div className="absolute bottom-3 inset-x-0 flex justify-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/75 px-3.5 py-1 text-[11px] font-bold text-white backdrop-blur-md">
                    <ScanLine className="h-3.5 w-3.5 text-primary animate-pulse" />
                    جاري البحث عن رمز الـ QR تلقائياً...
                  </span>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-6 text-center">
                <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl border border-primary/30 bg-primary/10 text-primary shadow-primary-glow">
                  <QrCode className="h-10 w-10" />
                </div>
                <p className="mt-4 text-sm font-black text-white">
                  قارئ رمز الـ QR الذكي جاهز
                </p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-white/60">
                  اضغط على زر تشغيل الكاميرا بالأسفل ووجّه الهاتف نحو ملصق
                  «بَلِّغْنِي» ليتم فتح صفحة التفعيل فوراً
                </p>
              </div>
            )}
          </div>

          {scannedCode && (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/15 p-3.5 text-xs font-bold text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                تم التقاط الكود ({scannedCode}) بنجاح! جاري تحويلك لصفحة التفعيل...
              </span>
            </div>
          )}

          {cameraError && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-primary/50 bg-primary/15 p-3.5 text-xs font-bold text-[#FF6B72]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{cameraError}</span>
            </div>
          )}

          {/* زر تشغيل / إيقاف الكاميرا */}
          <div className="flex gap-3">
            {!cameraActive ? (
              <Button
                type="button"
                size="lg"
                onClick={startCamera}
                disabled={cameraStarting}
                className="w-full rounded-2xl shadow-primary-glow"
              >
                {cameraStarting ? (
                  <>
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                    <span>جاري تشغيل الكاميرا...</span>
                  </>
                ) : (
                  <>
                    <Camera className="h-5 w-5" />
                    <span>تشغيل الكاميرا لمسح الـ QR</span>
                  </>
                )}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={stopCamera}
                className="w-full rounded-2xl border-white/20 bg-white/5 text-white hover:bg-white/15"
              >
                <CameraOff className="h-5 w-5 text-primary" />
                <span>إيقاف الكاميرا</span>
              </Button>
            )}
          </div>
        </section>

        {/* فاصل */}
        <div className="relative flex items-center py-0.5">
          <div className="flex-grow border-t border-white/10" />
          <span className="mx-3 shrink-0 text-xs font-bold text-white/50">
            أو عبر الإدخال اليدوي المباشر
          </span>
          <div className="flex-grow border-t border-white/10" />
        </div>

        {/* الخيار الثاني: الإدخال اليدوي لكود الملصق */}
        <section className="rounded-[28px] border border-white/12 bg-[#141721]/95 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)] sm:p-7 space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-white">
              <Keyboard className="h-5 w-5 text-primary" />
            </span>
            <div>
              <h2 className="text-base font-black text-white sm:text-lg">
                الخيار الثاني: إدخال كود الملصق يدوياً
              </h2>
              <p className="text-xs text-white/60">
                اكتب الكود المطبوع أسفل مربع الـ QR على الملصق (LY-XXXX-XXXX)
              </p>
            </div>
          </div>

          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="manual-tag-code"
                className="mb-2 block text-xs font-bold text-white/85"
              >
                كود الملصق المطبوع
              </label>
              <input
                id="manual-tag-code"
                type="text"
                dir="ltr"
                required
                value={manualCode}
                onChange={(e) => {
                  setManualCode(e.target.value.toUpperCase());
                  if (manualError) setManualError(null);
                }}
                placeholder="LY-XXXX-XXXX"
                className="h-13 w-full rounded-2xl border border-white/15 bg-[#0B0D13] px-4 text-center font-mono text-lg font-black tracking-widest text-white placeholder:text-white/25 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/35"
              />
            </div>

            {manualError && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-primary/50 bg-primary/15 p-3.5 text-xs font-bold text-[#FF6B72]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{manualError}</span>
              </div>
            )}

            <Button
              type="submit"
              size="xl"
              disabled={manualLoading}
              className="w-full rounded-2xl"
            >
              {manualLoading ? (
                <>
                  <LoaderCircle className="h-5 w-5 animate-spin" />
                  <span>جاري فحص الكود والتوجيه...</span>
                </>
              ) : (
                <>
                  <QrCode className="h-5 w-5" />
                  <span>متابعة التفعيل</span>
                </>
              )}
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
