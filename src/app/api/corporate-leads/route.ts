import { NextRequest, NextResponse } from "next/server";
import { createCorporateLead } from "@/lib/lifecycle-service";
import {
  checkOrderRateLimitAsync,
  recordOrderAttemptAsync,
  getClientIp,
} from "@/lib/rate-limiter";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const companyName = String(body.companyName || "").trim();
    const city = String(body.city || "").trim();
    const fleetCount = Number(body.fleetCount || 10);
    const selectedFeatures = Array.isArray(body.selectedFeatures)
      ? body.selectedFeatures.map((f: unknown) => String(f))
      : [];
    const contactPhone = String(body.contactPhone || "").trim();

    if (!companyName || !city) {
      return NextResponse.json(
        { ok: false, error: "يرجى إدخال اسم الشركة والمدينة." },
        { status: 400 }
      );
    }

    if (fleetCount < 10) {
      return NextResponse.json(
        { ok: false, error: "الحد الأدنى لباقة إيليت للشركات هو 10 سيارات." },
        { status: 400 }
      );
    }

    const ip = getClientIp(req);
    const rateKeyPhone = contactPhone || companyName;
    const rateLimit = await checkOrderRateLimitAsync(rateKeyPhone, ip);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: rateLimit.reason,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 }
      );
    }
    await recordOrderAttemptAsync(rateKeyPhone, ip);

    const res = await createCorporateLead({
      companyName,
      city,
      fleetCount,
      selectedFeatures,
      contactPhone,
    });

    return NextResponse.json({
      ok: true,
      lead: res.lead,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "تعذر حفظ طلب الشركة حالياً." },
      { status: 500 }
    );
  }
}

