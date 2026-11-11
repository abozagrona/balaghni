"use client";

import * as React from "react";
import {
  Pencil,
  Check,
  RotateCcw,
  Type,
  Palette,
  Plus,
  Minus,
  AlignRight,
  AlignCenter,
  AlignLeft,
  Maximize2,
  X,
  Sparkles,
  MoveVertical,
} from "lucide-react";

interface ElementOverride {
  text?: string;
  fontSize?: string;
  fontFamily?: string;
  fontWeight?: string;
  color?: string;
  backgroundColor?: string;
  lineHeight?: string;
  textAlign?: string;
  marginTop?: string;
  marginBottom?: string;
  width?: string;
}

type OverridesMap = Record<string, ElementOverride>;

const STORAGE_KEY = "balaghni_visual_overrides_v2";
const TEXT_EDITABLE_TAGS = new Set([
  "SPAN",
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LABEL",
  "STRONG",
  "MARK",
  "B",
  "EM",
  "SMALL",
]);

const FONT_OPTIONS = [
  { label: "خط ثمانية (الأصلي)", value: '"thmanyahSans", sans-serif' },
  { label: "خط القاهرة (Cairo)", value: "var(--font-cairo), sans-serif" },
  { label: "خط IBM العربي", value: "var(--font-ibm-arabic), sans-serif" },
  { label: "خط النظام الافتراضي", value: "system-ui, sans-serif" },
];

const WEIGHT_OPTIONS = [
  { label: "خفيف (300)", value: "300" },
  { label: "عادي (400)", value: "400" },
  { label: "متوسط (500)", value: "500" },
  { label: "عريض (700)", value: "700" },
  { label: "أسود ثقيل (900)", value: "900" },
];

const PRESET_COLORS = [
  { label: "أحمر بلغني", value: "#E51926" },
  { label: "أحمر ساطع", value: "#EE1D23" },
  { label: "أسود داكن", value: "#0B0D13" },
  { label: "كحلي رمادي", value: "#2B3445" },
  { label: "رمادي هادئ", value: "#5A6072" },
  { label: "أبيض نقي", value: "#FFFFFF" },
];

function getElementPath(el: HTMLElement): string {
  const path: string[] = [];
  let current: HTMLElement | null = el;
  while (current && current !== document.body && current.id !== "visual-editor-root") {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break;
    } else {
      const parent: HTMLElement | null = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current!.tagName && child.id !== "visual-editor-root"
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path.unshift(selector);
      current = parent;
    }
  }
  return `${window.location.pathname}::${path.join(" > ")}`;
}

function rgbToHex(rgb: string): string {
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) return "#0B0D13";
  const [r, g, b] = match.slice(0, 3).map(Number);
  return (
    "#" +
    [r, g, b]
      .map((x) => {
        const hex = x.toString(16);
        return hex.length === 1 ? "0" + hex : hex;
      })
      .join("")
  );
}

const ADMIN_SESSION_STORAGE_KEY = "balaghni_enterprise_admin_session";

interface AdminSessionPayload {
  id?: string;
  fullName?: string;
  username?: string;
  phone?: string;
  role?: string;
  permissions?: string[];
  sessionToken?: string;
}

function getStoredAdminSession(): AdminSessionPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) ||
      window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as AdminSessionPayload;
    }
  } catch {
    // ignore
  }
  return null;
}

function checkLiveEditAccess(): boolean {
  const session = getStoredAdminSession();
  if (!session) return false;
  if (session.role === "SUPER_ADMIN") return true;
  if (Array.isArray(session.permissions) && session.permissions.includes("can_live_edit")) {
    return true;
  }
  return false;
}

export function LiveVisualEditor() {
  const [isAuthorized, setIsAuthorized] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [selectedEl, setSelectedEl] = React.useState<HTMLElement | null>(null);
  const [selectedKey, setSelectedKey] = React.useState<string>("");
  const [overrides, setOverrides] = React.useState<OverridesMap>({});
  const [saving, setSaving] = React.useState(false);
  const [savedNotice, setSavedNotice] = React.useState(false);

  // التحقق الفوري من الصلاحيات الإدارية وتحديث حالة الظهور (عزل تام للزوار والزبائن)
  React.useEffect(() => {
    const evaluateAccess = () => {
      const allowed = checkLiveEditAccess();
      setIsAuthorized(allowed);
      if (!allowed) {
        setIsEditing(false);
      }
    };

    evaluateAccess();
    window.addEventListener("storage", evaluateAccess);
    window.addEventListener("focus", evaluateAccess);
    return () => {
      window.removeEventListener("storage", evaluateAccess);
      window.removeEventListener("focus", evaluateAccess);
    };
  }, []);

  // Computed / active states for the currently selected element
  const [textValue, setTextValue] = React.useState("");
  const [fontSizePx, setFontSizePx] = React.useState(24);
  const [fontFamily, setFontFamily] = React.useState(FONT_OPTIONS[0].value);
  const [fontWeight, setFontWeight] = React.useState("700");
  const [textColor, setTextColor] = React.useState("#0B0D13");
  const [lineHeight, setLineHeight] = React.useState(1.2);
  const [textAlign, setTextAlign] = React.useState("right");
  const [marginTopPx, setMarginTopPx] = React.useState(0);
  const [marginBottomPx, setMarginBottomPx] = React.useState(0);
  const [widthPercent, setWidthPercent] = React.useState(100);

  const syncToServer = React.useCallback((nextOverrides: OverridesMap) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextOverrides));
    } catch {}
    const session = getStoredAdminSession();
    const token = session?.sessionToken || session?.id || "";
    fetch("/api/visual-overrides", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(session?.id ? { "x-admin-id": session.id } : {}),
      },
      body: JSON.stringify({
        elements: nextOverrides,
        sessionToken: token,
        adminId: session?.id,
      }),
    }).catch(() => {});
  }, []);

  // Apply stored overrides on load and route changes
  const applyOverridesToDOM = React.useCallback((map: OverridesMap) => {
    if (typeof document === "undefined") return;
    Object.entries(map).forEach(([key, data]) => {
      const [pathname, selector] = key.split("::");
      if (!selector || pathname !== window.location.pathname) return;
      try {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el || el.closest("#visual-editor-root")) return;
        if (
          data.text !== undefined &&
          (el.children.length === 0 || TEXT_EDITABLE_TAGS.has(el.tagName))
        ) {
          el.innerText = data.text;
        }
        if (data.fontSize) el.style.fontSize = data.fontSize;
        if (data.fontFamily) el.style.fontFamily = data.fontFamily;
        if (data.fontWeight) el.style.fontWeight = data.fontWeight;
        if (data.color) el.style.color = data.color;
        if (data.backgroundColor) el.style.backgroundColor = data.backgroundColor;
        if (data.lineHeight) el.style.lineHeight = data.lineHeight;
        if (data.textAlign) el.style.textAlign = data.textAlign;
        if (data.marginTop) el.style.marginTop = data.marginTop;
        if (data.marginBottom) el.style.marginBottom = data.marginBottom;
        if (data.width) el.style.width = data.width;
      } catch {
        // Ignore invalid selectors
      }
    });
  }, []);

  React.useEffect(() => {
    async function loadInitial() {
      let merged: OverridesMap = {};
      try {
        localStorage.removeItem("balaghni_visual_overrides_v1");
        const local = localStorage.getItem(STORAGE_KEY);
        if (local) merged = JSON.parse(local);
      } catch {}

      try {
        const res = await fetch("/api/visual-overrides");
        if (res.ok) {
          const serverData = await res.json();
          if (serverData?.elements) {
            merged = { ...merged, ...serverData.elements };
          }
        }
      } catch {}

      setOverrides(merged);
      applyOverridesToDOM(merged);
      setTimeout(() => applyOverridesToDOM(merged), 150);
    }
    loadInitial();
  }, [applyOverridesToDOM]);

  // Select element on page when in Edit Mode
  React.useEffect(() => {
    if (!isEditing) {
      if (selectedEl) {
        selectedEl.removeAttribute("contenteditable");
        selectedEl.style.outline = "";
        selectedEl.style.outlineOffset = "";
      }
      setSelectedEl(null);
      return;
    }

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || target.closest("#visual-editor-root")) return;

      e.preventDefault();
      e.stopPropagation();

      if (selectedEl && selectedEl !== target) {
        selectedEl.removeAttribute("contenteditable");
        selectedEl.style.outline = "";
        selectedEl.style.outlineOffset = "";
      }

      const key = getElementPath(target);
      setSelectedEl(target);
      setSelectedKey(key);

      // Highlight selected element
      target.style.outline = "2px dashed #E51926";
      target.style.outlineOffset = "4px";

      // Enable direct typing if it's a leaf text node or editable text tag
      if (
        target.tagName !== "IMG" &&
        (target.children.length === 0 || TEXT_EDITABLE_TAGS.has(target.tagName))
      ) {
        target.setAttribute("contenteditable", "true");
        target.focus();
      }

      const computed = window.getComputedStyle(target);
      setTextValue(target.innerText || "");
      setFontSizePx(Math.round(parseFloat(computed.fontSize) || 20));
      setFontWeight(computed.fontWeight || "700");
      setTextColor(rgbToHex(computed.color));
      const lh = parseFloat(computed.lineHeight) / (parseFloat(computed.fontSize) || 20);
      setLineHeight(Number.isFinite(lh) ? Number(lh.toFixed(2)) : 1.2);
      setTextAlign(computed.textAlign || "right");
      setMarginTopPx(Math.round(parseFloat(computed.marginTop) || 0));
      setMarginBottomPx(Math.round(parseFloat(computed.marginBottom) || 0));
      setWidthPercent(100);
    };

    const handleInput = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target || target !== selectedEl) return;
      const newText = target.innerText;
      setTextValue(newText);
      const key = getElementPath(target);
      setOverrides((prev) => {
        const updated = {
          ...prev,
          [key]: { ...(prev[key] || {}), text: newText },
        };
        syncToServer(updated);
        return updated;
      });
    };

    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", handleInput, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("input", handleInput, true);
    };
  }, [isEditing, selectedEl, syncToServer]);

  const updateSelectedStyle = (patch: Partial<ElementOverride>) => {
    if (!selectedEl || !selectedKey) return;

    if (
      patch.text !== undefined &&
      selectedEl.tagName !== "IMG" &&
      (selectedEl.children.length === 0 || TEXT_EDITABLE_TAGS.has(selectedEl.tagName))
    ) {
      selectedEl.innerText = patch.text;
    }
    if (patch.fontSize) selectedEl.style.fontSize = patch.fontSize;
    if (patch.fontFamily) selectedEl.style.fontFamily = patch.fontFamily;
    if (patch.fontWeight) selectedEl.style.fontWeight = patch.fontWeight;
    if (patch.color) selectedEl.style.color = patch.color;
    if (patch.backgroundColor) selectedEl.style.backgroundColor = patch.backgroundColor;
    if (patch.lineHeight) selectedEl.style.lineHeight = patch.lineHeight;
    if (patch.textAlign) selectedEl.style.textAlign = patch.textAlign;
    if (patch.marginTop) selectedEl.style.marginTop = patch.marginTop;
    if (patch.marginBottom) selectedEl.style.marginBottom = patch.marginBottom;
    if (patch.width) selectedEl.style.width = patch.width;

    setOverrides((prev) => {
      const next: OverridesMap = {
        ...prev,
        [selectedKey]: {
          ...(prev[selectedKey] || {}),
          ...patch,
        },
      };
      syncToServer(next);
      return next;
    });
  };

  const handleSavePermanently = async () => {
    setSaving(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
      const session = getStoredAdminSession();
      const token = session?.sessionToken || session?.id || "";
      const res = await fetch("/api/visual-overrides", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(session?.id ? { "x-admin-id": session.id } : {}),
        },
        body: JSON.stringify({
          elements: overrides,
          sessionToken: token,
          adminId: session?.id,
        }),
      });
      if (res.ok) {
        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 2500);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(
          data.error ||
            "تعذر حفظ التعديلات: تأكد من امتلاك صلاحية تعديل الموقع (can_live_edit) أو حساب الأدمن الرئيسي."
        );
      }
    } catch {
      alert("حدث خطأ أثناء الاتصال بالخادم لحفظ التعديلات.");
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = async () => {
    if (!confirm("هل أنت متأكد من رغبتك في استعادة التصميم الأصلي الافتراضي وإلغاء كافة التخصيصات؟")) {
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
    setOverrides({});
    const session = getStoredAdminSession();
    const token = session?.sessionToken || session?.id || "";
    await fetch("/api/visual-overrides", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(session?.id ? { "x-admin-id": session.id } : {}),
      },
      body: JSON.stringify({
        elements: {},
        sessionToken: token,
        adminId: session?.id,
      }),
    });
    window.location.reload();
  };

  // الإخفاء النهائي والتام عن الزوار والزبائن وأي مشرف لا يمتلك صلاحية can_live_edit
  if (!isAuthorized) {
    return null;
  }

  return (
    <div id="visual-editor-root" dir="rtl" className="fixed z-[9999] font-sans">
      {/* زر التفعيل العائم */}
      {!isEditing ? (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="fixed bottom-5 left-5 flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-white shadow-primary-glow-lg transition hover:scale-105 active:scale-95"
        >
          <Pencil className="h-4 w-4" />
          <span>تعديل الموقع مباشرة</span>
        </button>
      ) : (
        <>
          {/* شريط علوي عائم يوضح وضع التعديل */}
          <div className="fixed top-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-primary/30 bg-[#0B0D13]/95 px-5 py-2.5 text-xs font-bold text-white shadow-2xl backdrop-blur-md sm:text-sm">
            <span className="inline-flex items-center gap-1.5 text-primary">
              <Sparkles className="h-4 w-4" />
              وضع التعديل الحر مفعّل:
            </span>
            <span className="hidden text-slate-300 sm:inline">
              اضغط على أي نص أو عنوان أو صورة لتكبيرها أو تغيير خطها ولونها
            </span>
            <button
              type="button"
              onClick={handleSavePermanently}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-3.5 py-1 text-xs font-bold text-white transition hover:bg-primary-bright"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{saving ? "جاري الحفظ..." : savedNotice ? "تم الحفظ!" : "حفظ التعديلات"}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white hover:bg-white/20"
            >
              <X className="h-3.5 w-3.5" />
              <span>إغلاق</span>
            </button>
          </div>

          {/* لوحة التحكم الكاملة عند تحديد أي عنصر */}
          <div className="fixed bottom-4 left-4 right-4 mx-auto max-w-2xl rounded-3xl border border-white/15 bg-[#0B0D13]/95 p-4 text-white shadow-2xl backdrop-blur-xl sm:p-5">
            {!selectedEl ? (
              <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
                <div className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-primary">
                    <Pencil className="h-4 w-4" />
                  </span>
                  <span>
                    اضغط الآن على <strong>أي جملة أو عنوان أو زر أو صورة</strong> في الصفحة للتحكم الكامل بها.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleResetAll}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>استعادة التصميم الافتراضي</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* رأس اللوحة */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-primary/20 px-2.5 py-1 font-mono text-xs font-bold text-primary">
                      {selectedEl.tagName.toLowerCase()}
                    </span>
                    <span className="text-xs font-bold text-slate-300">
                      تحكم كامل في النص والخط والحجم واللون
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleResetAll}
                      className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-300 hover:bg-white/10"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>إعادة ضبط الكل</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSavePermanently}
                      className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-1 text-xs font-bold text-white hover:bg-primary-bright"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>{savedNotice ? "تم الحفظ بنجاح ✓" : "حفظ التعديلات"}</span>
                    </button>
                  </div>
                </div>

                {/* 1. تعديل النص مباشرة */}
                {selectedEl.tagName !== "IMG" && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-300">
                      النص (يمكنك الكتابة هنا أو الضغط مباشرة على النص في الصفحة):
                    </label>
                    <textarea
                      rows={2}
                      value={textValue}
                      onChange={(e) => {
                        setTextValue(e.target.value);
                        updateSelectedStyle({ text: e.target.value });
                      }}
                      className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-white placeholder-slate-400 focus:border-primary focus:outline-none"
                    />
                  </div>
                )}

                {/* 2. حجم الخط + نوع الخط + سُمك الخط */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {/* تكبير وتصغير الخط */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-300">
                      <span className="inline-flex items-center gap-1">
                        <Type className="h-3.5 w-3.5 text-primary" />
                        حجم الخط
                      </span>
                      <span className="font-mono text-primary">{fontSizePx}px</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const next = Math.max(10, fontSizePx - 2);
                          setFontSizePx(next);
                          updateSelectedStyle({ fontSize: `${next}px` });
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        type="range"
                        min={12}
                        max={92}
                        value={fontSizePx}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setFontSizePx(next);
                          updateSelectedStyle({ fontSize: `${next}px` });
                        }}
                        className="w-full accent-[#E51926]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = Math.min(110, fontSizePx + 2);
                          setFontSizePx(next);
                          updateSelectedStyle({ fontSize: `${next}px` });
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* نوع الخط */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <label className="mb-2 block text-xs font-bold text-slate-300">
                      نوع الخط (Font)
                    </label>
                    <select
                      value={fontFamily}
                      onChange={(e) => {
                        setFontFamily(e.target.value);
                        updateSelectedStyle({ fontFamily: e.target.value });
                      }}
                      className="w-full rounded-xl border border-white/15 bg-[#141721] px-2.5 py-2 text-xs font-bold text-white focus:border-primary focus:outline-none"
                    >
                      {FONT_OPTIONS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* سُمك الخط */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <label className="mb-2 block text-xs font-bold text-slate-300">
                      سُمك الخط (Weight)
                    </label>
                    <select
                      value={fontWeight}
                      onChange={(e) => {
                        setFontWeight(e.target.value);
                        updateSelectedStyle({ fontWeight: e.target.value });
                      }}
                      className="w-full rounded-xl border border-white/15 bg-[#141721] px-2.5 py-2 text-xs font-bold text-white focus:border-primary focus:outline-none"
                    >
                      {WEIGHT_OPTIONS.map((w) => (
                        <option key={w.value} value={w.value}>
                          {w.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 3. الألوان والمحاذاة والمسافات وحجم الصور */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {/* اختيار اللون */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-300">
                      <span className="inline-flex items-center gap-1">
                        <Palette className="h-3.5 w-3.5 text-primary" />
                        لون النص
                      </span>
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => {
                          setTextColor(e.target.value);
                          updateSelectedStyle({ color: e.target.value });
                        }}
                        className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          title={c.label}
                          onClick={() => {
                            setTextColor(c.value);
                            updateSelectedStyle({ color: c.value });
                          }}
                          className="h-6 w-6 rounded-full border border-white/30 transition hover:scale-110"
                          style={{ backgroundColor: c.value }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* تباعد الأسطر والمحاذاة */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-300">
                      <span className="inline-flex items-center gap-1">
                        <MoveVertical className="h-3.5 w-3.5 text-primary" />
                        تباعد الأسطر والمحاذاة
                      </span>
                      <span className="font-mono text-primary">{lineHeight}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0.9}
                        max={2.2}
                        step={0.05}
                        value={lineHeight}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setLineHeight(val);
                          updateSelectedStyle({ lineHeight: String(val) });
                        }}
                        className="w-full accent-[#E51926]"
                      />
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setTextAlign("right");
                            updateSelectedStyle({ textAlign: "right" });
                          }}
                          className={`rounded p-1 ${textAlign === "right" ? "bg-primary text-white" : "bg-white/10"}`}
                        >
                          <AlignRight className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTextAlign("center");
                            updateSelectedStyle({ textAlign: "center" });
                          }}
                          className={`rounded p-1 ${textAlign === "center" ? "bg-primary text-white" : "bg-white/10"}`}
                        >
                          <AlignCenter className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTextAlign("left");
                            updateSelectedStyle({ textAlign: "left" });
                          }}
                          className={`rounded p-1 ${textAlign === "left" ? "bg-primary text-white" : "bg-white/10"}`}
                        >
                          <AlignLeft className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* تكبير وتصغير عرض العنصر / الصورة والمسافة */}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-300">
                      <span className="inline-flex items-center gap-1">
                        <Maximize2 className="h-3.5 w-3.5 text-primary" />
                        حجم العنصر / المسافة
                      </span>
                      <span className="font-mono text-primary">{widthPercent}%</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <input
                        type="range"
                        min={30}
                        max={120}
                        value={widthPercent}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setWidthPercent(val);
                          updateSelectedStyle({ width: `${val}%` });
                        }}
                        className="w-full accent-[#E51926]"
                      />
                      <div className="flex items-center justify-between gap-1 text-[11px] text-slate-300">
                        <span>مسافة أعلى: {marginTopPx}px</span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const next = marginTopPx - 4;
                              setMarginTopPx(next);
                              updateSelectedStyle({ marginTop: `${next}px` });
                            }}
                            className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20"
                          >
                            -
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const next = marginTopPx + 4;
                              setMarginTopPx(next);
                              updateSelectedStyle({ marginTop: `${next}px` });
                            }}
                            className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
