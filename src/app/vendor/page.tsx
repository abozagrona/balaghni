"use client";

import * as React from "react";
import Link from "next/link";
import {
  Store,
  LogOut,
  PackageCheck,
  Coins,
  QrCode,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { BalaghniLogo } from "@/components/brand/balaghni-logo";
import { Button } from "@/components/ui/button";
import { LibyaPhoneInput } from "@/components/ui/libya-phone-input";
import { PACKAGES, type PackageType } from "@/lib/packages";
import { cn } from "@/lib/utils";

interface VendorInfo {
  id: string;
  name: string;
  phone: string;
  city: string;
}

interface VendorInventory {
  assignedStickers: Array<{
    code: string;
    status: string;
    packageType: PackageType;
    ownerPhone?: string | null;
    ownerName?: string | null;
  }>;
  soldThisMonthCount: number;
  remainingUnactivatedCount: number;
  totalCashCollected: number;
  settlements: Array<{
    id: string;
    periodMonth: string;
    stickersSoldCount: number;
    totalCashCollected: number;
    status: string;
    settledAt?: string | null;
  }>;
}

export default function VendorPortalPage() {
  const [checking, setChecking] = React.useState(true);
  const [vendor, setVendor] = React.useState<VendorInfo | null>(null);
  const [inventory, setInventory] = React.useState<VendorInventory | null>(null);

  const [loginPhone, setLoginPhone] = React.useState("");
  const [loginPin, setLoginPin] = React.useState("");
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [loginLoading, setLoginLoading] = React.useState(false);

  const [stickerCode, setStickerCode] = React.useState("");
  const [selectedPkg, setSelectedPkg] = React.useState<PackageType>("nabbihni");
  const [customerPhone, setCustomerPhone] = React.useState("");
  const [customerName, setCustomerName] = React.useState("");
  const [activating, setActivating] = React.useState(false);
  const [activateError, setActivateError] = React.useState<string | null>(null);
  const [activateSuccess, setActivateSuccess] = React.useState<string | null>(
    null
  );

  const loadSession = React.useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/vendor");
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.vendor) {
        setVendor(data.vendor);
        setInventory(data.inventory);
      } else {
        setVendor(null);
      }
    } finally {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await fetch("/api/vendor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          phone: loginPhone,
          pin: loginPin,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setLoginError(data.error || "بيانات الدخول غير صحيحة.");
        setLoginLoading(false);
        return;
      }
      setVendor(data.vendor);
      setInventory(data.inventory);
    } catch {
      setLoginError("تعذر الاتصال بالخادم.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/vendor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setVendor(null);
    setInventory(null);
  };

  const handleCashActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setActivateError(null);
    setActivateSuccess(null);
    setActivating(true);

    try {
      const res = await fetch("/api/vendor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "activate_cash",
          code: stickerCode.trim(),
          packageType: selectedPkg,
          customerPhone,
          customerName: customerName.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setActivateError(data.error || "تعذر تفعيل الملصق.");
        setActivating(false);
        return;
      }
      setInventory(data.inventory);
      setActivateSuccess(
        `تم تفعيل الملصق ${stickerCode.toUpperCase()} كاش للزبون وإرسال إشعار واتساب له!`
      );
      setStickerCode("");
      setCustomerPhone("");
      setCustomerName("");
    } catch {
      setActivateError("تعذر الاتصال بالخادم.");
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white/95 backdrop-blur-md">
        <div className="shell flex h-16 items-center justify-between">
          <Link href="/">
            <BalaghniLogo size="sm" showTagline />
          </Link>
          {vendor && (
            <div className="flex items-center gap-3">
              <span className="hidden text-xs font-bold text-foreground sm:inline">
                {vendor.name} ({vendor.city})
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="rounded-xl"
              >
                <LogOut className="h-4 w-4" />
                <span>خروج</span>
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="shell py-10">
        {checking ? (
          <div className="flex justify-center py-20">
            <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !vendor ? (
          <div className="mx-auto max-w-md rounded-3xl border border-border bg-card p-6 shadow-card-soft sm:p-8">
            <div className="mb-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-primary">
                <Store className="h-7 w-7" />
              </div>
              <h1 className="mt-3 text-xl font-black text-foreground">
                بوابة التاجر والمندوب
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                سجّل دخولك لمتابعة عهدة الملصقات وتفعيل مبيعات الكاش فوراً
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-foreground">
                  رقم هاتف التاجر *
                </label>
                <LibyaPhoneInput
                  value={loginPhone}
                  onValueChange={setLoginPhone}
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-foreground">
                  رمز الدخول (PIN) *
                </label>
                <input
                  type="password"
                  required
                  value={loginPin}
                  onChange={(e) => setLoginPin(e.target.value)}
                  placeholder="••••••"
                  className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
              </div>
              {loginError && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                  {loginError}
                </p>
              )}
              <Button
                type="submit"
                size="lg"
                disabled={loginLoading}
                className="w-full rounded-2xl"
              >
                {loginLoading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Store className="h-4 w-4" />
                )}
                <span>دخول لبوابة التاجر</span>
              </Button>
            </form>
          </div>
        ) : (
          <div className="space-y-8">
            {/* جرد العهدة الشهرية */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-border bg-card p-5 shadow-card-soft">
                <p className="text-xs font-bold text-muted-foreground">
                  إجمالي الملصقات المستلمة
                </p>
                <p className="mt-2 font-mono text-2xl font-black text-foreground">
                  {inventory?.assignedStickers.length ?? 0}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-5 shadow-card-soft">
                <p className="text-xs font-bold text-muted-foreground">
                  المباعة والمفعّلة هذا الشهر
                </p>
                <p className="mt-2 font-mono text-2xl font-black text-emerald-600">
                  {inventory?.soldThisMonthCount ?? 0}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-5 shadow-card-soft">
                <p className="text-xs font-bold text-muted-foreground">
                  المتبقي غير المفعّل بالعهدة
                </p>
                <p className="mt-2 font-mono text-2xl font-black text-amber-600">
                  {inventory?.remainingUnactivatedCount ?? 0}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-5 shadow-card-soft">
                <p className="text-xs font-bold text-muted-foreground">
                  إجمالي الكاش المحصّل للشهر
                </p>
                <p className="mt-2 font-mono text-2xl font-black text-primary">
                  {inventory?.totalCashCollected ?? 0} د.ل
                </p>
              </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-2">
              {/* أداة تفعيل ملصق كاش لزبون */}
              <div className="rounded-3xl border border-border bg-card p-6 shadow-card-soft">
                <div className="mb-4 flex items-center gap-2.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-primary">
                    <Coins className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-foreground">
                      تفعيل ملصق كاش لزبون
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      تفعيل فوري لـ 365 يوماً وخصم من العهدة وإشعار الزبون
                    </p>
                  </div>
                </div>

                <form onSubmit={handleCashActivate} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-foreground">
                      كود الملصق من عهدتك *
                    </label>
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={stickerCode}
                      onChange={(e) => setStickerCode(e.target.value)}
                      placeholder="LY-XXXXXX"
                      className="w-full rounded-xl border border-border bg-white px-3 py-2.5 font-mono text-sm uppercase outline-none focus:border-primary"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    {([PACKAGES.basic, PACKAGES.nabbihni] as const).map(
                      (pkg) => (
                        <button
                          key={pkg.id}
                          type="button"
                          onClick={() => setSelectedPkg(pkg.id)}
                          className={cn(
                            "rounded-2xl border p-3 text-start transition-all",
                            selectedPkg === pkg.id
                              ? "border-2 border-primary bg-secondary/40"
                              : "border-border bg-white"
                          )}
                        >
                          <div className="text-xs font-black text-foreground">
                            {pkg.name}
                          </div>
                          <div className="mt-1 font-mono text-sm font-black text-primary">
                            {pkg.priceLyd} د.ل كاش
                          </div>
                        </button>
                      )
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-foreground">
                      رقم هاتف الزبون *
                    </label>
                    <LibyaPhoneInput
                      value={customerPhone}
                      onValueChange={setCustomerPhone}
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-bold text-foreground">
                      اسم الزبون *
                    </label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="أحمد محمد"
                      className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>

                  {activateError && (
                    <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{activateError}</span>
                    </div>
                  )}

                  {activateSuccess && (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>{activateSuccess}</span>
                    </div>
                  )}

                  <Button
                    type="submit"
                    size="lg"
                    disabled={activating}
                    className="w-full rounded-2xl"
                  >
                    {activating ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <PackageCheck className="h-4 w-4" />
                    )}
                    <span>
                      تفعيل كاش الآن ({PACKAGES[selectedPkg].priceLyd} د.ل)
                    </span>
                  </Button>
                </form>
              </div>

              {/* قائمة أكواد العهدة */}
              <div className="rounded-3xl border border-border bg-card p-6 shadow-card-soft">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-black text-foreground">
                  <QrCode className="h-5 w-5 text-primary" />
                  <span>ملصقات العهدة ({inventory?.assignedStickers.length ?? 0})</span>
                </h2>
                <div className="max-h-96 space-y-2 overflow-y-auto">
                  {(inventory?.assignedStickers || []).length === 0 ? (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      لا توجد ملصقات مسندة لعهدتك حالياً.
                    </p>
                  ) : (
                    inventory?.assignedStickers.map((s) => (
                      <div
                        key={s.code}
                        className="flex items-center justify-between rounded-xl border border-border bg-white px-3 py-2.5 text-xs"
                      >
                        <span className="font-mono font-bold text-foreground">
                          {s.code}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                            s.status === "unactivated"
                              ? "bg-amber-100 text-amber-800"
                              : s.status === "active"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-gray-100 text-gray-700"
                          )}
                        >
                          {s.status === "unactivated"
                            ? "غير مفعّل"
                            : s.status === "active"
                            ? "مفعّل"
                            : s.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
