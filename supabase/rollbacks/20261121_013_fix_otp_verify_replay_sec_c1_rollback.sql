-- =============================================================================
-- Migration 013 (ROLLBACK): INTENTIONALLY BLOCKED — Security Downgrade Prevention
-- بَلِّغْنِي | BALAGHNI
--
-- سبب منع التراجع (SEC-C1):
--   Migration 013 أغلقت ثغرة أمنية حرجة (SEC-C1) في دالة
--   public.commit_otp_verification_attempt كانت تسمح بإعادة النتيجة 'verified'
--   للطلبات المتزامنة أو المعادة على جلسة OTP موثّقة بالفعل.
--
-- سياسة الأمان:
--   - يُمنع التراجع إلى نسخة Migration 012 الضعيفة من الدالة منعاً باتاً لأن ذلك
--     يعيد فتح ثغرة SEC-C1 (قبول متعدد لرمز OTP أحادي الاستخدام).
--   - يرفض هذا الملف التنفيذ صراحةً دون تعديل أي دالة أو جدول أو بيانات.
--   - عند الحاجة إلى إيقاف الميزة بالكامل في بيئة الاختبار أو الطوارئ، يُستخدم
--     ملف Rollback 012 المستقل:
--       supabase/migrations/20261121_012_whatsapp_delivery_and_otp_sessions_rollback.sql
--     الذي يسقط الدوال الـ 15 ويؤرشف الجدولين مع تطهير أسرار OTP دون إعادة
--     ثغرة SEC-C1.
-- =============================================================================

DO $$
BEGIN
  RAISE EXCEPTION
    'ROLLBACK 013 BLOCKED (SEC-C1): Downgrading public.commit_otp_verification_attempt to Migration 012 is prohibited because it re-introduces concurrent/replay OTP verification bypass (SEC-C1). Use Rollback 012 for safe full feature teardown.'
    USING ERRCODE = '0A000';
END;
$$;
