"use client";

import * as React from "react";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Gift,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  Store,
  Trash2,
  Upload,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  computeCountdownDays,
  formatSlashDateYmd,
  getPackageConfig,
  type PackageFeatures,
} from "@/lib/packages";

interface VendorItem {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
  totalCustodyCount?: number;
  activatedByVendorCount?: number;
  unsettledAmountLyd?: number;
}

interface CorporateLeadItem {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  fleetSize: number;
  selectedFeatures: string[];
  notes?: string | null;
  status: string;
  createdAt: string;
}

interface UnassignedOrderItem {
  id: string;
  orderRef: string;
  customerName: string;
  customerPhone: string;
  packageType: string;
  totalLyd: number;
  createdAt: string;
}

interface AdminOrderItem {
  id: string;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  city: string;
  address: string;
  vehicleModel?: string | null;
  packageType: string;
  quantity: number;
  totalLyd: number;
  paymentMethod: "online" | "cod";
  paymentStatus: string;
  assignedTagCode?: string | null;
  status: string;
  subscriptionStartsAt?: string | null;
  subscriptionExpiresAt?: string | null;
  createdAt: string;
}

export function AdminLifecyclePanel() {
  const [loading, setLoading] = React.useState(true);
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const [vendors, setVendors] = React.useState<VendorItem[]>([]);
  const [corporateLeads, setCorporateLeads] = React.useState<
    CorporateLeadItem[]
  >([]);
  const [unassignedOrders, setUnassignedOrders] = React.useState<
    UnassignedOrderItem[]
  >([]);
  const [orders, setOrders] = React.useState<AdminOrderItem[]>([]);
  const [availableStickers, setAvailableStickers] = React.useState<string[]>(
    []
  );

  // CSV / TXT sticker import
  const [importCodesText, setImportCodesText] = React.useState("");
  const [importFileName, setImportFileName] = React.useState("");

  // Order sticker linking selection
  const [selectedOrderSticker, setSelectedOrderSticker] = React.useState<
    Record<string, string>
  >({});

  // Vendor creation & assignment
  const [vendorName, setVendorName] = React.useState("");
  const [vendorPhone, setVendorPhone] = React.useState("");
  const [vendorPin, setVendorPin] = React.useState("");
  const [assignVendorId, setAssignVendorId] = React.useState("");
  const [assignCodesText, setAssignCodesText] = React.useState("");

  // Gift batch
  const [giftCodesText, setGiftCodesText] = React.useState("");

  // Unassigned order assignment
  const [orderAssignCode, setOrderAssignCode] = React.useState<
    Record<string, string>
  >({});

  // Corporate customizer
  const [corpName, setCorpName] = React.useState("");
  const [corpPhone, setCorpPhone] = React.useState("");
  const [corpCodesText, setCorpCodesText] = React.useState("");
  const [corpFeatures, setCorpFeatures] = React.useState<PackageFeatures>({
    whatsapp: true,
    sms_fallback: true,
    photo_attachments: true,
    nabbihni_reminders: true,
    emergency_portal: true,
  });

  // Reset subscription start date
  const [resetOrderRef, setResetOrderRef] = React.useState("");

  const fetchLifecycle = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/lifecycle", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setVendors(Array.isArray(data.vendors) ? data.vendors : []);
        setCorporateLeads(
          Array.isArray(data.corporateLeads) ? data.corporateLeads : []
        );
        setUnassignedOrders(
          Array.isArray(data.unassignedPaidOrders)
            ? data.unassignedPaidOrders
            : []
        );
        setOrders(Array.isArray(data.orders) ? data.orders : []);
        setAvailableStickers(
          Array.isArray(data.availableStickers) ? data.availableStickers : []
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchLifecycle();
  }, [fetchLifecycle]);

  const runAction = async (
    actionKey: string,
    payload: Record<string, unknown>,
    onSuccess?: () => void
  ) => {
    setBusyAction(actionKey);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setMessage({
          type: "err",
          text: data.error || "تعذر تنفيذ العملية.",
        });
        return;
      }
      setMessage({
        type: "ok",
        text: data.message || "تم تنفيذ العملية بنجاح.",
      });
      onSuccess?.();
      await fetchLifecycle();
    } catch {
      setMessage({ type: "err", text: "خطأ في الاتصال بالخادم." });
    } finally {
      setBusyAction(null);
    }
  };

  const parseCodes = (raw: string) =>
    raw
      .split(/[\s,،]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white">
            إدارة الباقات، التجار، الهدايا، وطلبات الشركات
          </h2>
          <p className="text-xs text-white/60">
            تحكم كامل في دورة حياة الملصقات (4 حالات)، حسابات التجار، وباقة
            النخبة المخصصة.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fetchLifecycle}
            disabled={loading}
            className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span>تحديث البيانات</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busyAction === "wipe_all"}
            onClick={() => {
              if (
                window.confirm(
                  "تحذير: سيتم مسح جميع الطلبات والبلاغات وحسابات المستخدمين وكافة الملصقات القديمة من قاعدة البيانات مع الإبقاء على حساب الأدمن الرئيسي فقط. هل أنت متأكد؟"
                )
              ) {
                runAction("wipe_all", { action: "wipe_all_old_data" });
              }
            }}
            className="rounded-xl border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
          >
            <Trash2 className="h-4 w-4" />
            <span>مسح كافة البيانات القديمة</span>
          </Button>
        </div>
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-xs font-bold ${
            message.type === "ok"
              ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/35 bg-rose-500/10 text-rose-300"
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{message.text}</span>
        </div>
      )}

      {/* 0. أداة استيراد ملف أكواد ملصقات (.csv / .txt) بدون رمز خدش */}
      <section className="rounded-3xl border border-white/10 bg-[#10131C] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-black text-white">
            <Upload className="h-4 w-4 text-primary" />
            <span>استيراد ملف أكواد ملصقات (.csv أو .txt)</span>
          </h3>
          <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] font-bold text-white/70">
            متاح بالمخزن: {availableStickers.length} ملصق (unactivated)
          </span>
        </div>

        <p className="text-xs text-white/65">
          ارفع ملف CSV أو TXT يحتوي على أكواد بصيغة{" "}
          <span dir="ltr" className="font-mono text-white">
            LY-XXXX-XXXX
          </span>{" "}
          (بدون رمز خدش)، وسيتم إدراجها فوراً في جدول الملصقات بحالة{" "}
          <span dir="ltr" className="font-mono text-emerald-300">
            unactivated
          </span>
          .
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-xs font-bold text-white hover:bg-white/10">
            <Upload className="h-4 w-4 text-primary" />
            <span>
              {importFileName
                ? `الملف المحدد: ${importFileName}`
                : "اختر ملف (.csv أو .txt)"}
            </span>
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setImportFileName(file.name);
                const reader = new FileReader();
                reader.onload = () => {
                  const text = String(reader.result || "");
                  const lines = text
                    .split(/\r?\n/)
                    .map((l) => l.replace(/["']/g, "").trim())
                    .filter((l) => l && l.toLowerCase() !== "code");
                  setImportCodesText(lines.join("\n"));
                };
                reader.readAsText(file);
              }}
            />
          </label>

          <Button
            type="button"
            size="sm"
            disabled={!importCodesText.trim() || busyAction === "import_csv"}
            onClick={() =>
              runAction(
                "import_csv",
                {
                  action: "import_stickers",
                  codes: parseCodes(importCodesText),
                },
                () => {
                  setImportCodesText("");
                  setImportFileName("");
                }
              )
            }
            className="rounded-xl"
          >
            {busyAction === "import_csv" && (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            )}
            <span>استيراد الأكواد إلى المخزن</span>
          </Button>
        </div>

        <textarea
          rows={3}
          dir="ltr"
          placeholder="أو الصق الأكواد هنا مباشرة (كود في كل سطر):&#10;LY-XXXX-XXXX"
          value={importCodesText}
          onChange={(e) => setImportCodesText(e.target.value)}
          className="w-full rounded-xl border border-white/15 bg-black/40 p-2.5 font-mono text-xs text-white outline-none focus:border-primary"
        />
      </section>

      {/* 0.5. جدول جميع الطلبات (الأونلاين + الدفع عند الاستلام) مع ربط الملصقات */}
      <section className="rounded-3xl border border-white/10 bg-[#10131C] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-black text-white">
            <ShoppingBag className="h-4 w-4 text-primary" />
            <span>جميع طلبات المتجر والتفعيل ({orders.length})</span>
          </h3>
        </div>

        {orders.length === 0 ? (
          <p className="text-xs text-white/50">لا توجد طلبات مسجلة حالياً.</p>
        ) : (
          <div className="space-y-3">
            {orders.map((ord) => {
              const pkg = getPackageConfig(ord.packageType);
              const daysLeft = computeCountdownDays(ord.subscriptionExpiresAt);
              const isOnline = ord.paymentMethod === "online";
              const chosenSticker =
                selectedOrderSticker[ord.id] ?? availableStickers[0] ?? "";

              return (
                <div
                  key={ord.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        dir="ltr"
                        className="font-mono text-xs font-black text-primary"
                      >
                        {ord.orderCode}
                      </span>
                      <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-white">
                        {pkg.name} ({ord.totalLyd} د.ل)
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          isOnline
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {isOnline ? "دفع أونلاين ✅" : "دفع عند الاستلام 💵"}
                      </span>
                    </div>

                    {ord.assignedTagCode ? (
                      <span
                        dir="ltr"
                        className="rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3 py-1 font-mono text-xs font-bold text-emerald-300"
                      >
                        مرتبط بالملصق: {ord.assignedTagCode}
                      </span>
                    ) : (
                      <span className="rounded-full border border-amber-500/35 bg-amber-500/15 px-3 py-1 text-[11px] font-bold text-amber-300">
                        بانتظار ربط ملصق
                      </span>
                    )}
                  </div>

                  <div className="grid gap-2 text-xs text-white/80 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <span className="text-white/50">الزبون: </span>
                      <strong className="text-white">{ord.customerName}</strong>
                    </div>
                    <div>
                      <span className="text-white/50">الهاتف: </span>
                      <span dir="ltr" className="font-mono text-white">
                        {ord.customerPhone}
                      </span>
                    </div>
                    <div>
                      <span className="text-white/50">المدينة والعنوان: </span>
                      <span>
                        {ord.city} — {ord.address}
                      </span>
                    </div>
                    <div>
                      <span className="text-white/50">الاشتراك: </span>
                      <span>
                        {formatSlashDateYmd(ord.subscriptionStartsAt)} ⟵{" "}
                        {formatSlashDateYmd(ord.subscriptionExpiresAt)}
                      </span>
                      {daysLeft !== null && (
                        <span className="ms-1.5 font-bold text-sky-300">
                          (باقي {Math.max(0, daysLeft)} يوم)
                        </span>
                      )}
                    </div>
                  </div>

                  {!ord.assignedTagCode && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                      {availableStickers.length > 0 ? (
                        <select
                          dir="ltr"
                          value={chosenSticker}
                          onChange={(e) =>
                            setSelectedOrderSticker((prev) => ({
                              ...prev,
                              [ord.id]: e.target.value,
                            }))
                          }
                          className="h-9 rounded-xl border border-white/15 bg-black/40 px-3 font-mono text-xs text-white outline-none focus:border-primary"
                        >
                          {availableStickers.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          dir="ltr"
                          placeholder="LY-XXXX-XXXX"
                          value={chosenSticker}
                          onChange={(e) =>
                            setSelectedOrderSticker((prev) => ({
                              ...prev,
                              [ord.id]: e.target.value,
                            }))
                          }
                          className="h-9 w-40 rounded-xl border border-white/15 bg-black/40 px-3 font-mono text-xs text-white outline-none focus:border-primary"
                        />
                      )}

                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          !chosenSticker.trim() ||
                          busyAction === `link-${ord.id}`
                        }
                        onClick={() =>
                          runAction(`link-${ord.id}`, {
                            action: "assign_order_sticker",
                            orderId: ord.id,
                            orderCode: ord.orderCode,
                            stickerCode: chosenSticker,
                          })
                        }
                        className="rounded-xl"
                      >
                        ربط وتفعيل وإرسال واتساب
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 1. الطلبات الأونلاين المدفوعة بانتظار ربط ملصق (Race-condition / Unassigned Paid) */}
      <section className="rounded-3xl border border-white/10 bg-[#10131C] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-black text-white">
            <PackageCheck className="h-4 w-4 text-primary" />
            <span>طلبات أونلاين بانتظار تخصيص ملصق ({unassignedOrders.length})</span>
          </h3>
        </div>

        {unassignedOrders.length === 0 ? (
          <p className="text-xs text-white/50">
            لا توجد طلبات مدفوعة معلقة حالياً.
          </p>
        ) : (
          <div className="space-y-2.5">
            {unassignedOrders.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span dir="ltr" className="font-mono text-xs font-bold text-primary">
                      {order.orderRef}
                    </span>
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      {getPackageConfig(order.packageType).name}
                    </span>
                  </div>
                  <p className="text-xs text-white/80">
                    {order.customerName} —{" "}
                    <span dir="ltr" className="font-mono">
                      {order.customerPhone}
                    </span>{" "}
                    ({order.totalLyd} د.ل)
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    dir="ltr"
                    placeholder="BLG-XXXX"
                    value={orderAssignCode[order.orderRef] || ""}
                    onChange={(e) =>
                      setOrderAssignCode((prev) => ({
                        ...prev,
                        [order.orderRef]: e.target.value,
                      }))
                    }
                    className="h-9 w-36 rounded-xl border border-white/15 bg-black/40 px-3 font-mono text-xs text-white outline-none focus:border-primary"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyAction === `assign-${order.orderRef}`}
                    onClick={() =>
                      runAction(`assign-${order.orderRef}`, {
                        action: "assign_unassigned_paid",
                        orderRef: order.orderRef,
                        code: orderAssignCode[order.orderRef] || "",
                      })
                    }
                    className="rounded-xl"
                  >
                    ربط وتفعيل
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* إعادة ضبط بداية الاشتراك لطلب توصيل */}
        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
          <CalendarClock className="h-4 w-4 text-white/60" />
          <span className="text-xs text-white/70">
            إعادة ضبط بداية الاشتراك (365 يوماً من الآن) لطلب:
          </span>
          <input
            type="text"
            dir="ltr"
            placeholder="ORD-XXXX"
            value={resetOrderRef}
            onChange={(e) => setResetOrderRef(e.target.value)}
            className="h-8 w-36 rounded-xl border border-white/15 bg-black/40 px-2.5 font-mono text-xs text-white outline-none focus:border-primary"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!resetOrderRef.trim() || busyAction === "reset_sub"}
            onClick={() =>
              runAction(
                "reset_sub",
                {
                  action: "reset_order_subscription_start",
                  orderRef: resetOrderRef.trim(),
                },
                () => setResetOrderRef("")
              )
            }
            className="h-8 rounded-xl border-white/15 bg-white/5 text-xs text-white"
          >
            إعادة الضبط
          </Button>
        </div>
      </section>

      {/* 2. التجار ونقاط البيع + التسوية الشهرية */}
      <section className="rounded-3xl border border-white/10 bg-[#10131C] p-5 space-y-5">
        <h3 className="flex items-center gap-2 text-sm font-black text-white">
          <Store className="h-4 w-4 text-primary" />
          <span>حسابات التجار ونقاط البيع ({vendors.length})</span>
        </h3>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* إضافة تاجر */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <h4 className="flex items-center gap-1.5 text-xs font-bold text-white/90">
              <UserPlus className="h-3.5 w-3.5 text-primary" />
              <span>إضافة تاجر جديد</span>
            </h4>
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                type="text"
                placeholder="اسم المتجر / التاجر"
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
                className="h-9 rounded-xl border border-white/15 bg-black/40 px-3 text-xs text-white outline-none focus:border-primary"
              />
              <input
                type="tel"
                dir="ltr"
                placeholder="091XXXXXXX"
                value={vendorPhone}
                onChange={(e) => setVendorPhone(e.target.value)}
                className="h-9 rounded-xl border border-white/15 bg-black/40 px-3 font-mono text-xs text-white outline-none focus:border-primary"
              />
              <input
                type="text"
                dir="ltr"
                placeholder="PIN (مثال: 4455)"
                value={vendorPin}
                onChange={(e) => setVendorPin(e.target.value)}
                className="h-9 rounded-xl border border-white/15 bg-black/40 px-3 font-mono text-xs text-white outline-none focus:border-primary"
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={
                !vendorName.trim() ||
                !vendorPhone.trim() ||
                !vendorPin.trim() ||
                busyAction === "create_vendor"
              }
              onClick={() =>
                runAction(
                  "create_vendor",
                  {
                    action: "create_vendor",
                    name: vendorName.trim(),
                    phone: vendorPhone.trim(),
                    pin: vendorPin.trim(),
                  },
                  () => {
                    setVendorName("");
                    setVendorPhone("");
                    setVendorPin("");
                  }
                )
              }
              className="rounded-xl"
            >
              إنشاء حساب التاجر
            </Button>
          </div>

          {/* تخصيص ملصقات لعهدة تاجر */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <h4 className="text-xs font-bold text-white/90">
              تسليم دفعة ملصقات لعهدة تاجر
            </h4>
            <select
              value={assignVendorId}
              onChange={(e) => setAssignVendorId(e.target.value)}
              className="h-9 w-full rounded-xl border border-white/15 bg-black/40 px-3 text-xs text-white outline-none focus:border-primary"
            >
              <option value="">اختر التاجر...</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.phone})
                </option>
              ))}
            </select>
            <textarea
              rows={2}
              dir="ltr"
              placeholder="BLG-1001, BLG-1002 ..."
              value={assignCodesText}
              onChange={(e) => setAssignCodesText(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-black/40 p-2.5 font-mono text-xs text-white outline-none focus:border-primary"
            />
            <Button
              type="button"
              size="sm"
              disabled={
                !assignVendorId ||
                !assignCodesText.trim() ||
                busyAction === "assign_vendor"
              }
              onClick={() =>
                runAction(
                  "assign_vendor",
                  {
                    action: "assign_vendor_stickers",
                    vendorId: assignVendorId,
                    codes: parseCodes(assignCodesText),
                  },
                  () => setAssignCodesText("")
                )
              }
              className="rounded-xl"
            >
              تخصيص العهدة للتاجر
            </Button>
          </div>
        </div>

        {vendors.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.map((v) => (
              <div
                key={v.id}
                className="rounded-2xl border border-white/10 bg-black/30 p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-white">{v.name}</span>
                  <span dir="ltr" className="font-mono text-[11px] text-white/60">
                    {v.phone}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-white/75">
                  <span>في العهدة: {v.totalCustodyCount ?? 0}</span>
                  <span>•</span>
                  <span>مفعل كاش: {v.activatedByVendorCount ?? 0}</span>
                  <span>•</span>
                  <span className="font-bold text-amber-300">
                    مستحق: {v.unsettledAmountLyd ?? 0} د.ل
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busyAction === `settle-${v.id}`}
                  onClick={() =>
                    runAction(`settle-${v.id}`, {
                      action: "settle_vendor_month",
                      vendorId: v.id,
                    })
                  }
                  className="h-8 w-full rounded-xl border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-300 hover:bg-emerald-500/20"
                >
                  تصفية حساب الشهر وتأكيد التسوية
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. باقة الهدايا الترويجية (30 يوم) */}
      <section className="rounded-3xl border border-white/10 bg-[#10131C] p-5 space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-black text-white">
          <Gift className="h-4 w-4 text-primary" />
          <span>تحويل ملصقات إلى «جاهزة للإهداء الترويجي» (30 يوماً)</span>
        </h3>
        <textarea
          rows={2}
          dir="ltr"
          placeholder="أدخل الأكواد مفصولة بفاصلة أو سطر جديد (BLG-2001, BLG-2002)"
          value={giftCodesText}
          onChange={(e) => setGiftCodesText(e.target.value)}
          className="w-full rounded-xl border border-white/15 bg-black/40 p-2.5 font-mono text-xs text-white outline-none focus:border-primary"
        />
        <Button
          type="button"
          size="sm"
          disabled={!giftCodesText.trim() || busyAction === "gift_batch"}
          onClick={() =>
            runAction(
              "gift_batch",
              {
                action: "mark_gift_ready",
                codes: parseCodes(giftCodesText),
              },
              () => setGiftCodesText("")
            )
          }
          className="rounded-xl"
        >
          {busyAction === "gift_batch" && (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          )}
          <span>تجهيز كملصقات هدايا (gift_ready)</span>
        </Button>
      </section>

      {/* 4. باقة النخبة للشركات وطلبات التسعير */}
      <section className="rounded-3xl border border-white/10 bg-[#10131C] p-5 space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-black text-white">
          <Building2 className="h-4 w-4 text-primary" />
          <span>باقة النخبة للشركات والأساطيل ({corporateLeads.length} طلب)</span>
        </h3>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <h4 className="text-xs font-bold text-white/90">
            تفعيل باقة شركة مخصصة (Custom Feature Matrix)
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              placeholder="اسم الشركة / الأسطول"
              value={corpName}
              onChange={(e) => setCorpName(e.target.value)}
              className="h-9 rounded-xl border border-white/15 bg-black/40 px-3 text-xs text-white outline-none focus:border-primary"
            />
            <input
              type="tel"
              dir="ltr"
              placeholder="هاتف مسؤول الشركة (091XXXXXXX)"
              value={corpPhone}
              onChange={(e) => setCorpPhone(e.target.value)}
              className="h-9 rounded-xl border border-white/15 bg-black/40 px-3 font-mono text-xs text-white outline-none focus:border-primary"
            />
          </div>
          <textarea
            rows={2}
            dir="ltr"
            placeholder="أكواد ملصقات الأسطول: BLG-5001, BLG-5002 ..."
            value={corpCodesText}
            onChange={(e) => setCorpCodesText(e.target.value)}
            className="w-full rounded-xl border border-white/15 bg-black/40 p-2.5 font-mono text-xs text-white outline-none focus:border-primary"
          />
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                { key: "whatsapp", label: "تنبيهات واتساب" },
                { key: "sms_fallback", label: "تحويل تلقائي SMS" },
                { key: "photo_attachments", label: "إرفاق صور البلاغات" },
                { key: "nabbihni_reminders", label: "خدمة نَبِّهْنِي والوثائق" },
                { key: "emergency_portal", label: "بوابة طوارئ الحوادث" },
              ] as const
            ).map((opt) => {
              const checked = !!corpFeatures[opt.key];
              return (
                <label
                  key={opt.key}
                  className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/85"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setCorpFeatures((prev) => ({
                        ...prev,
                        [opt.key]: e.target.checked,
                      }))
                    }
                    className="accent-primary"
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={
              !corpName.trim() ||
              !corpPhone.trim() ||
              !corpCodesText.trim() ||
              busyAction === "corp_create"
            }
            onClick={() =>
              runAction(
                "corp_create",
                {
                  action: "create_corporate_account",
                  companyName: corpName.trim(),
                  phone: corpPhone.trim(),
                  codes: parseCodes(corpCodesText),
                  features: corpFeatures,
                },
                () => {
                  setCorpName("");
                  setCorpPhone("");
                  setCorpCodesText("");
                }
              )
            }
            className="rounded-xl"
          >
            تفعيل باقة الشركة والملصقات
          </Button>
        </div>

        {corporateLeads.length > 0 && (
          <div className="space-y-2">
            {corporateLeads.map((lead) => (
              <div
                key={lead.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/30 p-3 text-xs"
              >
                <div>
                  <span className="font-black text-white">
                    {lead.companyName}
                  </span>{" "}
                  <span className="text-white/60">
                    ({lead.contactName} •{" "}
                    <span dir="ltr" className="font-mono">
                      {lead.phone}
                    </span>
                    )
                  </span>
                  <p className="mt-0.5 text-[11px] text-white/60">
                    حجم الأسطول: {lead.fleetSize} مركبة • المزايا:{" "}
                    {lead.selectedFeatures.join("، ")}
                  </p>
                </div>
                <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                  {lead.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
