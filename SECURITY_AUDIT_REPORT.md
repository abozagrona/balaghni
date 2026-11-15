# التقرير الأمني الشامل النهائي — المراحل الأولى والثانية والثالثة (الفحص، التحصين، والاختبار النهائي)
**المشروع:** منصة «بَلِّغْنِي | BALAGHNI» (`balaghni.ly`)  
**التاريخ:** 15 نوفمبر 2026  
**نطاق التقرير:** الفحص الشامل (المرحلة 1) + تنفيذ التحصين البرمجي وتجهيز المتغيرات وسكربت قاعدة البيانات (المرحلة 2) + الحماية النهائية وترويسات الأمان والاختبارات غير المدمرة (المرحلة 3).  
**حالة المشروع الحالية:** ✅ **مكتمل وجاهز برمجياً (Build & Security Verification Passed — Exit Code 0)** — لم يتم النشر التلقائي للإنتاج التزاماً بتوجيهك، ويتبقى فقط لصق وتشغيل سكربت RLS المرفق في Supabase SQL Editor.

---

## 1. سجل تنفيذ متغيرات البيئة وتحصين قاعدة البيانات (المرحلة الأولى والثانية من المهمة المتكاملة)

### أولاً: متغيرات البيئة على Vercel وملف البيئة المحلي (`.env.local`)
1. **فحص `SUPABASE_SERVICE_ROLE_KEY`:**
   - تم التحقق عبر `vercel env ls` من وجود المتغير السري `SUPABASE_SERVICE_ROLE_KEY` في بيئة **Production** على مشروع `zagrona/balaghni` في Vercel (مخزن بنوع `Secret / Hidden`).
   - *ملاحظة هامة لبيئة المعاينة (Preview):* نظراً لأن Vercel يخزن `SUPABASE_SERVICE_ROLE_KEY` كـ `Secret` مشفر لا يسمح بقراءته خارجياً، يرجى التأكد من تفعيل خيار **Preview** بجانب **Production** لهذا المتغير من لوحة تحكم Vercel (`Settings -> Environment Variables`) إذا كنت تستخدم روابط المعاينة.
2. **توليد وإضافة `SESSION_HMAC_SECRET`:**
   - تم توليد مفتاح تشفيري عشوائي قوي بطول **64 حرفاً** عبر المولد التشفيري الآمن (`crypto.randomBytes(32)`).
   - تمت إضافته بنجاح إلى Vercel لبيئتي **Production** و **Preview** (بنوع `Secret / Hidden`)، وكذلك إلى ملف البيئة المحلي `.env.local` (المستثنى من Git عبر `.gitignore` بحيث لا يُرفع أبداً إلى مستودع الكود).

### ثانياً: حالة تطبيق سكربت تحصين قاعدة البيانات (`BALAGHNI_SUPABASE_RLS_HARDENING.sql`)
- نظراً لأن متغيرات الاتصال الإداري المباشر بقاعدة البيانات (`POSTGRES_URL` و `SUPABASE_SERVICE_ROLE_KEY`) مخزنة في Vercel بنوع `Secret (Hidden)` غير قابل للسحب النصي عبر الـ CLI إلى الطرفية المحلية، فإن **الاتصال الإداري المباشر لتنفيذ أوامر DDL تلقائياً غير مفعل محلياً**.
- لذلك، ووفق توجيهك في البند الثاني، تم تجهيز السكربت النهائي الكامل في نهاية هذا التقرير وفي الملف المستقل [BALAGHNI_SUPABASE_RLS_HARDENING.sql](file:///storage/emulated/0/Download/BALAGHNI_SUPABASE_RLS_HARDENING.sql) لتقوم بلصقه وتشغيله مباشرة في **Supabase SQL Editor**.

---

## 2. الجدول النهائي الشامل (البند | المشكلة | الخطورة | الإصلاح | نتيجة الاختبار | الحالة)

| البند | المشكلة | الخطورة | الإصلاح المنفّذ | نتيجة الاختبار غير المدمر | الحالة |
| :---: | :--- | :---: | :--- | :--- | :---: |
| **1** | كشف بيانات لوحة الإدارة التنفيذية وأرقام هواتف جميع المالكين بدون مصادقة في `GET /api/admin` (`CRIT-01`) | 🔴 **حرجة** | إلزام التحقق من جلسة مشرف موقّعة بـ `HMAC-SHA256` (`balaghni_admin_session`) في `GET` و`POST`، وقصر الاستعلام غير المصادق على فحص حالة القفل (`?mode=session`) فقط. | `GET /api/admin` بدون جلسة أعاد `HTTP 401 Unauthorized` مع `leaked tags: false` وعدم تسريب أي رقم هاتف. | ✅ **مغلق ومختبر** |
| **2** | كشف وتعديل بيانات أي ملصق ومالك عبر `/api/dashboard` بمجرد معرفة كود الملصق (`CRIT-02`) | 🔴 **حرجة** | فرض التحقق الإلزامي من جلسة مالك موقّعة (`balaghni_owner_token`) تطابق نفس الملصق/رقم هاتف المالك الفعلي في قاعدة البيانات (أو جلسة المدير العام) في `GET` و`POST`. | `GET /api/dashboard?tag=LY-TEST-0001` بدون جلسة أعاد `HTTP 401 Unauthorized` مع `leaked ownerPhone: false`. | ✅ **مغلق ومختبر** |
| **3** | تجاوز التحقق من رمز الـ OTP عبر إرسال `"otpVerified": true` من المتصفح في `/api/auth/login` و`/api/auth/reset-pin` (`CRIT-03`) | 🔴 **حرجة** | إلغاء الثقة بحقل `otpVerified` نهائياً، وإصدار تذكرة إثبات تحقق موقّعة تشفيرياً لمرة واحدة (`otpProofToken`) من `/api/auth/otp` بعد نجاح `verifyOtpCode` فقط. | محاولة إرسال `{"phone":"+218912345678","otpVerified":true}` إلى `POST /api/auth/login` بدون `otpProofToken` رُفضت بـ `HTTP 401`. | ✅ **مغلق ومختبر** |
| **4** | غياب التحقق التشفيري لمفاتيح المرور (WebAuthn Passkeys) وكشف قائمة `passkeyCredentialIds` للعامة (`CRIT-04`) | 🔴 **حرجة** | إيقاف إرجاع قوائم `passkeyCredentialIds` للعامة، وإصدار تحدي موقّع (`challengeToken`)، والتحقق التشفيري على الخادم من المفتاح العام (`SPKI`) والتوقيع الرقمي (`signature`)، وتطبيق Rate Limit (`10/10m`). | `GET /api/auth/passkey` أعاد `HTTP 200` مع `hasSignedChallenge: true` و`publicCredentialListCount: 0` (صفر معرفات مكشوفة). | ✅ **مغلق ومختبر** |
| **5** | سياسات RLS في Supabase مفتوحة للعامة (`USING (true)`) عبر مفتاح `anon` (`CRIT-05`) | 🔴 **حرجة** | تحويل عميل الخادم لاستخدام `SUPABASE_SERVICE_ROLE_KEY` حصرياً، وإعداد سكربت `BALAGHNI_SUPABASE_RLS_HARDENING.sql` لإغلاق `anon` وحصر الجداول بـ `service_role`. | تم التحقق من توافق الكود البرمجي مع `service_role`، والسكربت جاهز للتشغيل اليدوي في Supabase SQL Editor. | 🟡 **جاهز للتشغيل في Supabase** |
| **6** | سحب وتفعيل الملصقات بدون تحقق هاتف وإعادة ربط الملصقات المفعّلة (`ACTIVE`) بمالك آخر (`CRIT-06`) | 🔴 **حرجة** | إلزام `otpProofToken` الموقّع من الخادم قبل الطلب (`/api/orders`) أو التفعيل/التجديد، ومنع إعادة ربط أي ملصق `ACTIVE` أو تعديل أمانه (`/security`) إلا لمالكه الفعلي أو المدير العام. | تم التحقق من رفض طلبات الشراء والتفعيل وتعديل الأمان التي لا تحمل `otpProofToken` أو جلسة المالك الفعلي. | ✅ **مغلق ومختبر** |
| **7** | رموز جلسات المشرفين (`balaghni_admin_session`) غير موقعة (Base64 فقط) وقبول `adminId` الخام (`HIGH-01`) | 🟠 **عالية** | توقيع جلسات المشرفين بـ `HMAC-SHA256` مع `httpOnly: true` و`secure: true`، ورفض `adminId` أو `phone` الخام في كافة مسارات الإدارة و`visual-overrides`. | تم التحقق من رفض أي رمز جلسة غير موقّع بـ `HMAC-SHA256` في `/api/admin` و`/api/admin/lifecycle`. | ✅ **مغلق ومختبر** |
| **8** | كوكي جلسة التاجر غير موقع ورمز افتراضي `"123456"` بدون حماية تخمين (`HIGH-02`) | 🟠 **عالية** | توقيع كوكي جلسة التاجر (`balaghni_vendor_id`) بـ `HMAC-SHA256`، وتوليد رمز عشوائي بـ `crypto.randomInt` عند إنشاء التاجر، وتفعيل `checkPinRateLimit` على دخول التاجر. | تم التحقق من رفض الكوكي غير الموقع وتفعيل القفل بعد 5 محاولات PIN خاطئة. | ✅ **مغلق ومختبر** |
| **9** | وجود رابط ومفتاح Supabase احتياطي مكشوف في `/api/webhooks/whatsapp` (`HIGH-03`) | 🟠 **عالية** | إزالة جميع الروابط والمفاتيح الاحتياطية المكتوبة داخل الكود والاعتماد الحصري على متغيرات بيئة الخادم. | فحص الكود المصدري وبناء الإنتاج أثبت خلو المسار من أي مفاتيح أو روابط مكتوبة. | ✅ **مغلق ومختبر** |
| **10** | فشل التبريد في بيئة Serverless واستنزاف رصيد واتساب/SMS عبر مسار البلاغات والـ Webhook (`HIGH-04`) | 🟠 **عالية** | ربط فترة التبريد (5 دقائق لكل ملصق) مباشرة بجدول `reports` في Supabase، وإضافة حد أقصى كلي للبلاغات لكل IP (`5 بلاغات / 15 دقيقة`)، وتفعيل تحقق `X-Hub-Signature-256` في Webhook الواتساب. | اختبار `/api/notify` و`/api/webhooks/whatsapp` أثبت عمل الفاصل الزمني وحظر البلاغات الزائدة لنفس الـ IP (`429`) ورفض رمز التحقق الخاطئ للـ Webhook (`403`). | ✅ **مغلق ومختبر** |
| **11** | إمكانية استدعاء `/api/cron/reminders?force=true` بدون مصادقة (`HIGH-05`) | 🟠 **عالية** | إلزام الترويسة السرية `Authorization: Bearer <CRON_SECRET>` أو جلسة المدير العام الموقّعة قبل تشغيل التذكيرات. | استدعاء المسار بدون `CRON_SECRET` أو جلسة مشرف عام يُرفض فوراً بـ `HTTP 401`. | ✅ **مغلق ومختبر** |
| **12** | غياب Rate Limiting على مسارات التفعيل والدخول بـ PIN وكود الطوارئ (`MED-01`, `MED-02`) | 🟡 **متوسطة** | تطبيق `checkPinRateLimit` و`recordPinFailure` (قفل لمدة 15 دقيقة بعد 5 محاولات خاطئة) في `/activate` و`/login` و`/reset-pin` و`/vendor`. | تم التحقق من تفعيل القفل الزمني (`HTTP 429`) بعد استنفاد المحاولات المسموحة. | ✅ **مغلق ومختبر** |
| **13** | رفع الملفات في `uploadReportPhoto` قبل فحص التبريد وبدون فحص Magic Bytes (`MED-03`) | 🟡 **متوسطة** | نقل `uploadReportPhoto` ليتم فقط **بعد** نجاح `validateScanTargetAndCooldown`، وتقييد الحجم بـ 5MB، وفحص البايتات السحرية (`JPEG`, `PNG`, `WebP` فقط). | تم التحقق من عدم رفع أي ملف عند فشل فحص الملصق أو أثناء فترة التبريد، ورفض أي ملف غير مطابق لـ Magic Bytes الصور. | ✅ **مغلق ومختبر** |
| **14** | استخدام `Math.random()` في توليد `recoveryKey` وكلمات المرور (`MED-04`) | 🟡 **متوسطة** | استبدال `Math.random()` بـ `crypto.randomInt` على الخادم و`window.crypto.getRandomValues` في المتصفح. | فحص الكود المصدري أثبت استخدام المولدات التشفيرية الآمنة (CSPRNG) حصرياً. | ✅ **مغلق ومختبر** |
| **15** | غياب خصائص `httpOnly` و`secure` وترويسات الحماية القياسية وفحص المدخلات (`MED-05`, `LOW-01..03`) | 🔵 **منخفضة / متوسطة** | ضبط `httpOnly: true` و`secure: true` و`sameSite: "lax"` لجميع الكوكيز، وإضافة `Content-Security-Policy` و`HSTS` و`X-Frame-Options: DENY` و`Permissions-Policy` وقيود CORS لنطاق `https://balaghni.ly` في `next.config.mjs`، وتطهير نصوص البلاغات (`sanitizeUserText`)، وتقييد `/verify` للمدير العام. | فحص ترويسات الاستجابة لصفحة المسح `/s/LY-TEST-0001` أثبت وجود `Content-Security-Policy` و`X-Frame-Options: DENY` وعدم وجود أي `dangerouslySetInnerHTML` أو ثغرة XSS. | ✅ **مغلق ومختبر** |

---

## 3. سكربت تحصين قاعدة البيانات الجاهز للنسخ والتشغيل في Supabase SQL Editor

انسخ الكود التالي من هنا (أو من الملف المستقل [BALAGHNI_SUPABASE_RLS_HARDENING.sql](file:///storage/emulated/0/Download/BALAGHNI_SUPABASE_RLS_HARDENING.sql)) وشغّله في **Supabase Dashboard ⬅ SQL Editor**:

```sql
BEGIN;

-- 1. تفعيل RLS وإلغاء جميع السياسات المفتوحة (USING (true)) على كافة جداول المنصة
DO $$
DECLARE
  tbl text;
  pol record;
  target_tables text[] := ARRAY[
    'tags',
    'stickers',
    'orders',
    'reports',
    'vehicle_documents',
    'maintenance_records',
    'admin_profiles',
    'admin_audit_logs',
    'vendors',
    'vendor_settlements',
    'corporate_leads',
    'otp_verifications',
    'gift_redemptions',
    'visual_overrides'
  ];
BEGIN
  FOREACH tbl IN ARRAY target_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = tbl
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, tbl);
      END LOOP;

      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated;', tbl);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role;', tbl);

      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
        tbl || '_service_role_only',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- 2. تحصين حاوية صور البلاغات (Storage Bucket: report-photos)
DO $$
DECLARE
  pol record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    UPDATE storage.buckets
    SET
      public = true,
      file_size_limit = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
    WHERE id = 'report-photos';

    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND (
          policyname ILIKE '%report-photos%'
          OR policyname ILIKE '%report_photos%'
          OR policyname ILIKE '%Allow public uploads%'
        )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects;', pol.policyname);
    END LOOP;

    DROP POLICY IF EXISTS "report_photos_public_read" ON storage.objects;
    CREATE POLICY "report_photos_public_read"
      ON storage.objects
      FOR SELECT
      TO public
      USING (bucket_id = 'report-photos');

    DROP POLICY IF EXISTS "report_photos_service_role_write" ON storage.objects;
    CREATE POLICY "report_photos_service_role_write"
      ON storage.objects
      FOR ALL
      TO service_role
      USING (bucket_id = 'report-photos')
      WITH CHECK (bucket_id = 'report-photos');
  END IF;
END $$;

COMMIT;
```
