-- =============================================================================
-- Migration 014 (ROLLBACK): INTENTIONALLY BLOCKED — Fail-Closed Downgrade Guard
-- بَلِّغْنِي | BALAGHNI
--
-- سبب منع التراجع (SQLSTATE 42702):
--   Migration 014 أصلحت خطأ SQLSTATE 42702 (column reference "message_sid" is ambiguous)
--   في دالة public.register_whatsapp_delivery عبر استخدام القيد الأساسي صراحةً
--   (ON CONFLICT ON CONSTRAINT whatsapp_delivery_tracking_pkey DO NOTHING).
--
-- سياسة الأمان والسلامة التشغيلية:
--   - يرفض هذا الملف التنفيذ صراحةً (Fail-Closed) دون حذف أو تعديل أي جدول أو دالة أو بيانات.
--   - يُمنع إعادة تعريف public.register_whatsapp_delivery بالنسخة القديمة من Migration 012
--     لأن ذلك يعيد كسر تسجيل تتبع رسائل WhatsApp ومسار SMS Fallback.
--   - أي تراجع عن هذا التغيير يتطلب خطة تشغيلية مستقلة ومراجعة أمنية معتمدة مسبقاً
--     (أو اتباع إجراء إيقاف الميزة الكامل الآمن عبر Rollback 012 بعد إيقاف الـ Worker).
-- =============================================================================

DO $$
BEGIN
  RAISE EXCEPTION
    'ROLLBACK 014 BLOCKED (FAIL-CLOSED): Reverting public.register_whatsapp_delivery to Migration 012 is prohibited because it re-introduces SQLSTATE 42702 (ambiguous message_sid). Any rollback requires an independent operational plan and explicit security review.'
    USING ERRCODE = '0A000';
END;
$$;
