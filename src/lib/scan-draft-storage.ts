/**
 * إدارة حفظ واستعادة مسودة نموذج المسح (/s/[tagCode])
 * يحمي بيانات المستخدم (السبب، الملاحظة، رقم الهاتف، والصورة الملتقطة)
 * في حال قام متصفح الموبايل بإعادة تحميل الصفحة أثناء فتح الكاميرا الخلفية.
 */

export interface ScanDraftData {
  reason: string;
  note: string;
  senderPhone: string;
  hasImage: boolean;
}

const SESSION_KEY_PREFIX = "balaghni-scan-form:";
const IDB_NAME = "balaghni-scan-form-images";
const IDB_STORE = "images";

function getDraftKey(tagCode: string): string {
  return `${SESSION_KEY_PREFIX}${tagCode.toUpperCase()}`;
}

export function loadScanDraft(tagCode: string): ScanDraftData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(getDraftKey(tagCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      reason: typeof parsed.reason === "string" ? parsed.reason : "blocking",
      note: typeof parsed.note === "string" ? parsed.note : "",
      senderPhone: typeof parsed.senderPhone === "string" ? parsed.senderPhone : "",
      hasImage: Boolean(parsed.hasImage),
    };
  } catch {
    return null;
  }
}

export function saveScanDraft(tagCode: string, data: ScanDraftData): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(getDraftKey(tagCode), JSON.stringify(data));
  } catch {
    // Ignore quota errors
  }
}

export function clearScanDraft(tagCode: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(getDraftKey(tagCode));
  } catch {
    // Ignore
  }
  void deleteDraftImage(tagCode);
}

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB not supported"));
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IDB"));
  });
}

export async function saveDraftImage(tagCode: string, blob: Blob): Promise<void> {
  try {
    const db = await openImageDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(blob, getDraftKey(tagCode));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore IDB errors on private browsing
  }
}

export async function loadDraftImage(tagCode: string): Promise<Blob | null> {
  try {
    const db = await openImageDb();
    const result = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(getDraftKey(tagCode));
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function deleteDraftImage(tagCode: string): Promise<void> {
  try {
    const db = await openImageDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(getDraftKey(tagCode));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore
  }
}
