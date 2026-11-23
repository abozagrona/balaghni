import { createClient } from "@supabase/supabase-js";

const UNCONFIGURED_SUPABASE_URL = "https://unconfigured.invalid";
const UNCONFIGURED_SUPABASE_KEY = "unconfigured";

const rawSupabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "")
  .replace(/\/+$/, "");

const rawSupabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "")
  .replace(/^["']|["']$/g, "")
  .trim()
  .replace(/^Sb_publishable_/, "sb_publishable_");

export type ReportDeliveryStatus = "sent" | "delivered" | "read" | "replied";

export interface ReportRealtimePayload {
  reportId?: string;
  tagCode?: string;
  deliveryStatus: ReportDeliveryStatus;
  ownerReply?: string | null;
  isSmsFallback?: boolean;
  reasonBadge?: string;
}

export const supabaseRealtime = createClient(
  rawSupabaseUrl || UNCONFIGURED_SUPABASE_URL,
  rawSupabaseAnonKey || UNCONFIGURED_SUPABASE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
);

export function parseReportStatusFromRow(
  badgeRaw?: string | null,
  messageRaw?: string | null
): {
  deliveryStatus: ReportDeliveryStatus;
  ownerReply: string | null;
  isSmsFallback: boolean;
} {
  const badge = String(badgeRaw || "").trim();
  const message = String(messageRaw || "").trim();
  const replyMarker = "[رد المالك عبر واتساب]:";

  let ownerReply: string | null = null;
  if (message.includes(replyMarker)) {
    const parts = message.split(replyMarker);
    ownerReply = parts[parts.length - 1]?.trim() || null;
  } else if (badge.startsWith("رد المالك:")) {
    ownerReply = badge.replace("رد المالك:", "").trim() || null;
  }

  let deliveryStatus: ReportDeliveryStatus = "sent";
  if (ownerReply) {
    deliveryStatus = "replied";
  } else if (badge.includes("تمت القراءة")) {
    deliveryStatus = "read";
  } else if (badge.includes("تم التسليم") || badge.includes("SMS")) {
    deliveryStatus = "delivered";
  }

  return {
    deliveryStatus,
    ownerReply,
    isSmsFallback: badge.includes("SMS"),
  };
}
