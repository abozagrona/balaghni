"use client";

import * as React from "react";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  LockKeyhole,
  Volume2,
  LoaderCircle,
  CheckCircle2,
} from "lucide-react";
import { supabaseRealtime } from "@/lib/supabase/realtime";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

const MAX_CALL_DURATION_SECONDS = 120; // دقيقتان كحد أقصى للمكالمة لمنع الإزعاج

export interface AnonymousVoiceCallProps {
  callCode: string;
  tagCode: string;
  role: "caller" | "callee";
  vehicleLabel?: string;
  onClose?: () => void;
  onOwnerQuickReply?: () => void;
}

type CallState =
  | "idle"
  | "requesting_mic"
  | "ringing"
  | "connecting"
  | "connected"
  | "declined"
  | "ended"
  | "error";

export function AnonymousVoiceCall({
  callCode,
  tagCode,
  role,
  vehicleLabel,
  onClose,
  onOwnerQuickReply,
}: AnonymousVoiceCallProps) {
  const [callState, setCallState] = React.useState<CallState>(
    role === "caller" ? "requesting_mic" : "idle"
  );
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [isMuted, setIsMuted] = React.useState<boolean>(false);
  const [callSecondsLeft, setCallSecondsLeft] = React.useState<number>(
    MAX_CALL_DURATION_SECONDS
  );

  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const localStreamRef = React.useRef<MediaStream | null>(null);
  const remoteAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const channelRef = React.useRef<ReturnType<
    typeof supabaseRealtime.channel
  > | null>(null);
  const pendingCandidatesRef = React.useRef<RTCIceCandidateInit[]>([]);
  const readyIntervalRef = React.useRef<number | null>(null);
  const hasOfferedRef = React.useRef<boolean>(false);

  const cleanupMediaAndPeer = React.useCallback(() => {
    if (readyIntervalRef.current) {
      window.clearInterval(readyIntervalRef.current);
      readyIntervalRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // ignore
      }
      pcRef.current = null;
    }
    if (channelRef.current) {
      void supabaseRealtime.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  // نغمة رنين هادئة للمتصل عبر Web Audio API أثناء انتظار رد صاحب السيارة
  React.useEffect(() => {
    if (role !== "caller" || callState !== "ringing") return;
    let ctx: AudioContext | null = null;
    let timer: number | null = null;

    const playBeep = () => {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) return;
        if (!ctx) ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.8);
      } catch {
        // ignore audio context restrictions
      }
    };

    playBeep();
    timer = window.setInterval(playBeep, 3000);
    return () => {
      if (timer) window.clearInterval(timer);
      if (ctx) {
        void ctx.close().catch(() => {});
      }
    };
  }, [role, callState]);

  // عداد مدة المكالمة الفعلي (120 ثانية كحد أقصى)
  React.useEffect(() => {
    if (callState !== "connected") return;
    const timer = window.setInterval(() => {
      setCallSecondsLeft((prev) => {
        if (prev <= 1) {
          if (channelRef.current) {
            void channelRef.current.send({
              type: "broadcast",
              event: "call-ended",
              payload: { from: role },
            });
          }
          cleanupMediaAndPeer();
          setCallState("ended");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [callState, role, cleanupMediaAndPeer]);

  const startWebRtcSession = React.useCallback(async () => {
    setErrorMsg(null);
    setCallState("requesting_mic");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      localStreamRef.current = stream;
    } catch {
      setErrorMsg(
        "يرجى السماح بصلاحية الميكروفون في المتصفح لإجراء المكالمة الصوتية المشفرة."
      );
      setCallState("error");
      return;
    }

    setCallState(role === "caller" ? "ringing" : "connecting");

    const createPeerConnection = (
      channel: ReturnType<typeof supabaseRealtime.channel>
    ) => {
      if (pcRef.current) {
        try {
          pcRef.current.close();
        } catch {
          // ignore
        }
      }
      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          void channel.send({
            type: "broadcast",
            event: "ice-candidate",
            payload: {
              from: role,
              candidate: event.candidate.toJSON(),
            },
          });
        }
      };

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (remoteAudioRef.current && remoteStream) {
          remoteAudioRef.current.srcObject = remoteStream;
          void remoteAudioRef.current.play().catch(() => {});
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "connected"
        ) {
          if (readyIntervalRef.current) {
            window.clearInterval(readyIntervalRef.current);
            readyIntervalRef.current = null;
          }
          setCallState("connected");
        } else if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected"
        ) {
          cleanupMediaAndPeer();
          setCallState("ended");
        }
      };

      return pc;
    };

    const flushPendingCandidates = async (pc: RTCPeerConnection) => {
      if (!pc.remoteDescription) return;
      const queued = [...pendingCandidatesRef.current];
      pendingCandidatesRef.current = [];
      for (const cand of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {
          // ignore
        }
      }
    };

    const channelName = `webrtc-call:${callCode.trim().toUpperCase()}`;
    const channel = supabaseRealtime.channel(channelName, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "callee-ready" }, async () => {
        if (role !== "caller") return;
        if (hasOfferedRef.current && pcRef.current?.connectionState === "connected") {
          return;
        }
        hasOfferedRef.current = true;
        setCallState("connecting");
        const pc = createPeerConnection(channel);
        try {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
          });
          await pc.setLocalDescription(offer);
          await channel.send({
            type: "broadcast",
            event: "webrtc-offer",
            payload: { sdp: pc.localDescription },
          });
        } catch {
          // ignore
        }
      })
      .on("broadcast", { event: "webrtc-offer" }, async ({ payload }) => {
        if (role !== "callee" || !payload?.sdp) return;
        if (readyIntervalRef.current) {
          window.clearInterval(readyIntervalRef.current);
          readyIntervalRef.current = null;
        }
        setCallState("connecting");
        const pc = createPeerConnection(channel);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushPendingCandidates(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await channel.send({
            type: "broadcast",
            event: "webrtc-answer",
            payload: { sdp: pc.localDescription },
          });
          setCallState("connected");
        } catch {
          // ignore
        }
      })
      .on("broadcast", { event: "webrtc-answer" }, async ({ payload }) => {
        if (role !== "caller" || !payload?.sdp || !pcRef.current) return;
        try {
          if (!pcRef.current.currentRemoteDescription) {
            await pcRef.current.setRemoteDescription(
              new RTCSessionDescription(payload.sdp)
            );
            await flushPendingCandidates(pcRef.current);
            setCallState("connected");
          }
        } catch {
          // ignore
        }
      })
      .on("broadcast", { event: "ice-candidate" }, async ({ payload }) => {
        if (!payload?.candidate || payload.from === role) return;
        const pc = pcRef.current;
        if (!pc || !pc.remoteDescription) {
          pendingCandidatesRef.current.push(payload.candidate);
          return;
        }
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          // ignore
        }
      })
      .on("broadcast", { event: "call-declined" }, () => {
        cleanupMediaAndPeer();
        setCallState("declined");
      })
      .on("broadcast", { event: "call-ended" }, () => {
        cleanupMediaAndPeer();
        setCallState("ended");
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && role === "callee") {
          const announceReady = () => {
            void channel.send({
              type: "broadcast",
              event: "callee-ready",
              payload: { at: Date.now() },
            });
          };
          announceReady();
          readyIntervalRef.current = window.setInterval(announceReady, 2500);
        }
      });
  }, [callCode, role, cleanupMediaAndPeer]);

  // بالنسبة للمُبلِّغ (caller) تبدأ الجلسة تلقائياً عند فتح المكون
  React.useEffect(() => {
    if (role === "caller") {
      void startWebRtcSession();
    }
    return () => {
      cleanupMediaAndPeer();
    };
  }, [role, startWebRtcSession, cleanupMediaAndPeer]);

  const toggleMute = () => {
    if (!localStreamRef.current) return;
    const nextMuted = !isMuted;
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
  };

  const handleHangUp = () => {
    if (channelRef.current) {
      void channelRef.current.send({
        type: "broadcast",
        event: "call-ended",
        payload: { from: role },
      });
    }
    cleanupMediaAndPeer();
    setCallState("ended");
  };

  const handleCalleeDecline = () => {
    const channelName = `webrtc-call:${callCode.trim().toUpperCase()}`;
    const ch = supabaseRealtime.channel(channelName);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void ch
          .send({
            type: "broadcast",
            event: "call-declined",
            payload: { from: "callee" },
          })
          .finally(() => {
            void supabaseRealtime.removeChannel(ch);
          });
      }
    });
    cleanupMediaAndPeer();
    setCallState("declined");
    onOwnerQuickReply?.();
  };

  const mins = String(Math.floor(callSecondsLeft / 60)).padStart(2, "0");
  const secs = String(callSecondsLeft % 60).padStart(2, "0");

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-emerald-500/35 bg-[#111B21] p-4 text-white shadow-xl">
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* شارة الخصوصية */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-300">
          <LockKeyhole className="h-3.5 w-3.5" />
          مكالمة صوتية مشفرة • بدون كشف أي رقم
        </span>
        <span
          dir="ltr"
          className="font-mono text-[11px] font-bold text-slate-400"
        >
          {tagCode}
        </span>
      </div>

      {/* حالة شاشة صاحب السيارة قبل الرد (idle) */}
      {role === "callee" && callState === "idle" && (
        <div className="space-y-4 py-2 text-center">
          <div className="mx-auto flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 ring-4 ring-emerald-500/15">
            <Phone className="h-8 w-8" />
          </div>
          <div>
            <h3 className="text-base font-black text-white">
              اتصال صوتي وارد بخصوص سيارتك
            </h3>
            <p className="mt-1 text-xs text-slate-300">
              {vehicleLabel || tagCode} • رقم هاتفك مخفي تماماً عن الطرف الآخر
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={() => void startWebRtcSession()}
              className="flex items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 py-3.5 text-xs font-black text-slate-950 shadow-lg transition hover:bg-[#1fb857]"
            >
              <Phone className="h-4 w-4" />
              رد على المكالمة
            </button>
            <button
              type="button"
              onClick={handleCalleeDecline}
              className="flex items-center justify-center gap-2 rounded-2xl bg-red-600/90 px-4 py-3.5 text-xs font-black text-white shadow-lg transition hover:bg-red-500"
            >
              <PhoneOff className="h-4 w-4" />
              رفض (أنا قادم الآن)
            </button>
          </div>
        </div>
      )}

      {/* حالة طلب الميكروفون / الرنين / جاري الربط */}
      {(callState === "requesting_mic" ||
        callState === "ringing" ||
        callState === "connecting") && (
        <div className="space-y-3 py-2 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
            <LoaderCircle className="h-7 w-7 animate-spin" />
          </div>
          <div>
            <p className="text-sm font-black text-white">
              {callState === "requesting_mic"
                ? "يرجى السماح للميكروفون لبدء المكالمة..."
                : callState === "ringing"
                ? "جارٍ الرنين لدى صاحب السيارة..."
                : "جارٍ ربط الصوت المشفر بين الطرفين..."}
            </p>
            <p className="mt-1 text-[11px] text-slate-300">
              {callState === "ringing"
                ? "تم إرسال تنبيه واتساب عاجل لصاحب السيارة للرد على المكالمة الآن"
                : "لا يظهر رقم هاتفك أو رقم الطرف الآخر أثناء المكالمة"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleHangUp}
            className="mx-auto flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-xs font-black text-white transition hover:bg-red-500"
          >
            <PhoneOff className="h-4 w-4" />
            إلغاء الاتصال
          </button>
        </div>
      )}

      {/* حالة الاتصال النشط (connected) */}
      {callState === "connected" && (
        <div className="space-y-4 py-2 text-center">
          <div className="flex items-center justify-center gap-2 text-emerald-400">
            <Volume2 className="h-5 w-5 animate-pulse" />
            <span className="text-sm font-black">
              متصل الآن • مكالمة صوتية مشفرة
            </span>
          </div>
          <div
            dir="ltr"
            className="mx-auto inline-block rounded-xl bg-black/35 px-4 py-1.5 font-mono text-lg font-black tracking-wider text-emerald-300"
          >
            {mins}:{secs}
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={toggleMute}
              className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition ${
                isMuted
                  ? "bg-amber-500 text-slate-950"
                  : "bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              {isMuted ? (
                <>
                  <MicOff className="h-4 w-4" />
                  إلغاء الكتم
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  كتم الصوت
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleHangUp}
              className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-xs font-black text-white transition hover:bg-red-500"
            >
              <PhoneOff className="h-4 w-4" />
              إنهاء المكالمة
            </button>
          </div>
        </div>
      )}

      {/* حالة انتهاء المكالمة أو رفضها */}
      {(callState === "ended" || callState === "declined") && (
        <div className="space-y-3 py-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-emerald-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <p className="text-xs font-black text-white">
            {callState === "declined"
              ? "اعتذر صاحب السيارة عن المكالمة وأكد أنه قادم إليك الآن!"
              : "انتهت المكالمة الصوتية المشفرة."}
          </p>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20"
            >
              إغلاق نافذة المكالمة
            </button>
          )}
        </div>
      )}

      {/* حالة خطأ الميكروفون */}
      {callState === "error" && (
        <div className="space-y-3 py-2 text-center">
          <p className="text-xs font-bold text-red-400">{errorMsg}</p>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => void startWebRtcSession()}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white"
            >
              إعادة المحاولة
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-white/10 px-4 py-2 text-xs font-bold text-white"
              >
                إغلاق
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
