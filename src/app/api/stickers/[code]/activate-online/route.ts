import { NextRequest, NextResponse } from "next/server";
import {
  activateStickerAtomic,
  redeemGiftSticker,
} from "@/lib/lifecycle-service";
import { normalizePackageType } from "@/lib/packages";
import { formatBalaghniTagCode, formatFullLibyaE164 } from "@/lib/utils";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await context.params;
    const normalizedCode = formatBalaghniTagCode(code);
    const body = await req.json();

    const mode = String(body.mode || "online");
    const rawPhone = String(body.phone || "").trim();
    const formattedPhone = formatFullLibyaE164(rawPhone);

    if (!formattedPhone) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "يرجى إدخال رقم هاتف ليبي صحيح مكون من 9 أرقام ويبدأ بـ 91 أو 92 أو 93 أو 94.",
        },
        { status: 400 }
      );
    }

    const ownerName = String(body.ownerName || "").trim();
    const vehicleInfo = String(body.vehicleInfo || "").trim();

    if (mode === "gift") {
      const giftRes = await redeemGiftSticker({
        code: normalizedCode,
        phone: formattedPhone,
        ownerName,
        vehicleInfo,
      });

      if (!giftRes.ok) {
        return NextResponse.json(
          {
            ok: false,
            alreadyRedeemed: Boolean(giftRes.alreadyRedeemed),
            error: giftRes.error,
          },
          { status: giftRes.alreadyRedeemed ? 409 : 400 }
        );
      }

      return NextResponse.json({
        ok: true,
        sticker: giftRes.sticker,
      });
    }

    const packageType = normalizePackageType(body.packageType);
    if (packageType !== "basic" && packageType !== "nabbihni") {
      return NextResponse.json(
        { ok: false, error: "يرجى اختيار الباقة الأساسية أو باقة نَبِّهْنِي." },
        { status: 400 }
      );
    }

    const allowExpiredRenewal = Boolean(body.allowExpiredRenewal);
    const res = await activateStickerAtomic({
      code: normalizedCode,
      packageType,
      ownerPhone: formattedPhone,
      ownerName,
      vehicleInfo,
      activationSource: "online",
      durationDays: 365,
      allowExpiredRenewal,
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          unassignedPaid: Boolean(res.unassignedPaid),
          orderId: res.orderId,
          error: res.error,
        },
        { status: res.unassignedPaid ? 409 : 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      sticker: res.sticker,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "حدث خطأ غير متوقع أثناء تفعيل الملصق." },
      { status: 500 }
    );
  }
}
