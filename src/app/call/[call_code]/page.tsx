"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { AnonymousVoiceCall } from "@/components/scan/anonymous-voice-call";

export default function IncomingEncryptedCallPage() {
  const params = useParams<{ call_code: string }>();
  const callCode = String(params?.call_code || "")
    .trim()
    .toUpperCase();

  const [loading, setLoading] = React.useState(true);
  const [meta, setMeta] = React.useState<{
    tagCode: string;
    vehicleLabel: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!callCode) return;
    fetch(`/api/notify/call?callCode=${encodeURIComponent(callCode)}`, {
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok) {
          setMeta({
            tagCode: data.tagCode || callCode,
            vehicleLabel: data.vehicleLabel || data.tagCode || "مركبتك",
          });
        } else {
          setError(data?.error || "رابط المكالمة غير صالح أو منتهي الصلاحية.");
        }
      })
      .catch(() => {
        setError("تعذر تحميل جلسة المكالمة المشفرة.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [callCode]);

  const handleOwnerQuickReply = () => {
    void fetch("/api/notify/call", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callCode }),
    }).catch(() => {});
  };

  return (
    <div
      dir="rtl"
      className="flex min-h-screen flex-col items-center justify-center bg-[#0B141A] p-4 text-white"
    >
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3.5 py-1 text-xs font-black text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            منصة بَلِّغْنِي • اتصال صوتي مشفر (Zero-Leak)
          </span>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#111B21] p-8 text-center">
            <LoaderCircle className="h-8 w-8 animate-spin text-emerald-400" />
            <p className="mt-3 text-xs font-bold text-slate-300">
              جارٍ التحقق من جلسة المكالمة المشفرة...
            </p>
          </div>
        ) : error || !meta ? (
          <div className="rounded-2xl border border-red-500/30 bg-[#111B21] p-6 text-center">
            <p className="text-sm font-black text-red-400">
              {error || "رابط المكالمة غير موجود."}
            </p>
          </div>
        ) : (
          <AnonymousVoiceCall
            callCode={callCode}
            tagCode={meta.tagCode}
            vehicleLabel={meta.vehicleLabel}
            role="callee"
            onOwnerQuickReply={handleOwnerQuickReply}
          />
        )}
      </div>
    </div>
  );
}
