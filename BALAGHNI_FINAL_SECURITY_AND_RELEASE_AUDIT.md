# BALAGHNI — التقرير النهائي الشامل للأمن وجاهزية الإطلاق
**`BALAGHNI_FINAL_SECURITY_AND_RELEASE_AUDIT.md`**

- **النطاق:** مراجعة أمنية ومعمارية وتشغيلية شاملة محلياً (Local Only) لكامل مشروع `BALAGHNI`.
- **القيود المطبّقة:** صفر اتصال بـ Supabase/PostgreSQL (إنتاجي أو تجريبي)، صفر تنفيذ SQL/Migration/Rollback، صفر اتصال بـ Twilio أو Resala أو Meta، صفر Commit/Push/Deploy، صفر حذف ملفات أو كشف أسرار.
- **مرجع Git:** `HEAD` عند `b9e4ef7` (`43` ملفاً معدّلاً + ملفات جديدة غير متتبعة).

---

## 1. Executive Summary (الملخص التنفيذي)

أُنجزت مراجعة متعددة التخصصات (CTO / Senior Security / Full-Stack / DevOps / QA) لجميع التعديلات الأمنية والمعمارية في BALAGHNI. أظهر الكود المحلي نضجاً أمنياً مرتفعاً بعد معالجة الثغرات الحرجة والعالية السابقة (`VULN-01` إلى `VULN-09`، و`SEC-C1`، و`MED-01`، وعزل Meta Outbound).

وخلال هذه المراجعة النهائية، **اكتشفنا خطأ بناء إنتاجي حقيقي (`Build Blocker`)** في [`src/app/api/worker/whatsapp-fallback/route.ts`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/app/api/worker/whatsapp-fallback/route.ts) حيث كان يصدّر دوالاً مساعدة غير متوافقة مع قواعد Next.js 16 App Router (`verifyWorkerCronAuthorization` و`runWhatsappFallbackWorkerCycle`)، مما أدى إلى فشل `npm run build` بـ `TS2344`. تم إصلاحه محلياً بنقل الدوال المساعدة حرفياً دون أي تغيير سلوكي إلى [`src/lib/whatsapp-fallback-worker.ts`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/whatsapp-fallback-worker.ts)، فاجتاز المشروع كامل اختبارات البناء (`npm run build`) وTypeScript (`0` أخطاء) وجميع الاختبارات المحلية (`18/18` + `61/61`).

**الحكم النهائي:** **`NOT READY`** للإطلاق الإنتاجي الفوري حالياً؛ لأن متطلبات التكامل الخارجي (عنوان Resala الإنتاجي الرسمي المعتمد في `RESALA_APPROVED_HOSTNAMES`، والتحقق الحي من قوالب Twilio/Resala، وتطبيق Migrations `001–014` على قاعدة الإنتاج، وتحديد آلية جدولة Worker الفعلية خارج قيود Vercel Hobby) ما زالت **غير مُثبتة (`NOT VERIFIED`)**.

---

## 2. Overall Security Assessment (التقييم الأمني العام)

| المحور | الحالة المحلية (الكود) | الحالة الإنتاجية (التشغيل الحي) | الدليل الرئيسي |
|---|---|---|---|
| **OTP & OTP Cryptography** | **PASS** | **NOT VERIFIED** (بانتظار Migration 012–014 في الإنتاج) | [`src/lib/otp-crypto.ts:18-376`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-crypto.ts#L18-L376)، [`src/lib/otp-service.ts:1495-1615`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L1495-L1615) |
| **Twilio WhatsApp Primary & Templates** | **PASS** (Fail-Closed في Production) | **NOT VERIFIED** (لم تُختبر القوالب حياً) | [`src/lib/otp-service.ts:322-410, 654-832`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L654-L832) |
| **Resala SMS Fallback & Endpoint Policy** | **PASS** (Fail-Closed دون Allowlist) | **BLOCKED / NOT VERIFIED** (بانتظار نطاق الإنتاج الرسمي) | [`src/lib/otp-service.ts:60-237, 930-1025`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L60-L237) |
| **Meta Outbound Isolation** | **PASS** (معطّل قطعياً في Production) | **PASS** (بشرط `NODE_ENV=production` أو `VERCEL_ENV=production`) | [`src/lib/otp-service.ts:575-626, 835-911`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L575-L626) |
| **Inbound Webhooks (Meta & Twilio HMAC)** | **PASS** (Fail-Closed + `timingSafeEqual`) | **NOT VERIFIED** (بانتظار اختبار حي للمسارات) | [`whatsapp/route.ts:23-48, 202-245`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/app/api/webhooks/whatsapp/route.ts#L23-L48)، [`whatsapp-status/route.ts:23-48, 196-239`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/app/api/webhooks/whatsapp-status/route.ts#L23-L48) |
| **Worker & Cron Protection** | **PASS** (`CRON_SECRET` + `timingSafeEqual`) | **NOT VERIFIED** (الجدولة غير مُعدّة في الإنتاج) | [`src/lib/whatsapp-fallback-worker.ts:30-48`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/whatsapp-fallback-worker.ts#L30-L48)، [`vercel.json:1-9`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/vercel.json#L1-L9) |
| **Security Tokens, Sessions & Nonces** | **PASS** (Fail-Closed + DB Nonces) | **NOT VERIFIED** (بانتظار Migration 003/011 في الإنتاج) | [`src/lib/security-tokens.ts`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/security-tokens.ts)، [`src/lib/nonce-consumption.ts`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/nonce-consumption.ts) |
| **CSRF & Enforced Nonce CSP (`proxy.ts`)** | **PASS** | **PASS** (على مستوى الكود والترويسات) | [`src/proxy.ts:18-302`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/proxy.ts#L18-L302)، [`next.config.mjs:7-128`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/next.config.mjs#L7-L128) |
| **Rate Limiting (Distributed)** | **PASS** (Fail-Closed) | **NOT VERIFIED** (بانتظار RPC الإنتاج) | [`src/lib/rate-limiter.ts`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/rate-limiter.ts) |
| **Admin / SUPER_ADMIN & AI Office Guard** | **PASS** (Server-Side Allowlist + Audit Fail-Closed) | **NOT VERIFIED** (بانتظار Migration 006/008 في الإنتاج) | [`src/lib/ai-office/skill-guard.ts:22-120`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/ai-office/skill-guard.ts#L22-L120)، [`src/app/api/admin/lifecycle/route.ts:54-337`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/app/api/admin/lifecycle/route.ts#L54-L85) |
| **Local JSON Stores Guard (A-03)** | **PASS** (محظورة في Production/Preview) | **PASS** | [`src/lib/supabase/client.ts:365-377`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/supabase/client.ts#L365-L377)، [`src/lib/lifecycle-service.ts:223-254`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/lifecycle-service.ts#L223-L254) |
| **Supabase RLS & Migrations 001–014** | **PASS مع ملاحظة (غياب Rollback 014)** | **NOT VERIFIED** (لم تُطبّق على الإنتاج) | [`supabase/migrations/`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/supabase/migrations/) |

---

## 3. قائمة الثغرات والملاحظات حسب الخطورة (CRITICAL / HIGH / MEDIUM / LOW)

### أ. الثغرات الحساسة/المعمارية أو التشغيلية المفتوحة (لم يتم تعديلها تلقائياً وفق القيود)

#### CRITICAL
- **لا توجد ثغرات كود `CRITICAL` مفتوحة حالياً** (تم إغلاق `VULN-01`، `VULN-02`، `SEC-C1` محلياً وإثباتها بالاختبارات السلوكية).

#### HIGH
1. **[REL-H01] عدم توفر عنوان Resala الإنتاجي الرسمي واعتماد `RESALA_APPROVED_HOSTNAMES`:**
   - **الدليل:** [`src/lib/otp-service.ts:154-170`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L154-L170) و[`.env.example:66-68`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/.env.example#L66-L68).
   - **الأثر:** إرسال SMS عبر Resala محجوب تماماً (Fail-Closed) في الإنتاج إلى حين اعتماد النطاق الرسمي من مزود Resala وتعيينه في `RESALA_ENDPOINT` و`RESALA_APPROVED_HOSTNAMES`.
   - **الحل المقترح والمخاطر:** توثيق عنوان الإنتاج الرسمي من Resala وإضافته في متغيرات البيئة الإنتاجية فقط بعد اختبار حي محدود. المخاطرة عند التسرع: فشل كامل لآلية SMS Fallback أو إرسال OTP إلى نقطة غير موثوقة.
2. **[REL-H02] عدم جدولة Worker تحويل WhatsApp→SMS (`60s`) في بيئة الإنتاج:**
   - **الدليل:** [`vercel.json:1-9`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/vercel.json#L1-L9) يحتوي فقط على `/api/cron/reminders` يومياً (`0 9 * * *`) ولا يجدول `/api/worker/whatsapp-fallback`.
   - **الأثر:** بدون مُشغّل دوري (كل 1–2 دقيقة) يمرر `Authorization: Bearer <CRON_SECRET>`، لن تُعالج رسائل WhatsApp غير المؤكدة بعد 60 ثانية تلقائياً.
   - **الحل المقترح والمخاطر:** اختيار خطة تدعم الجدولة المتكررة (Vercel Pro أو مُجدوِل معتمد بقرار معماري مستقل). لم يُضف أي مُجدوِل خارجي أو خدمة جديدة التزاماً بالقيود.

#### MEDIUM
3. **[DB-M01] غياب ملف Rollback صريح لـ Migration 014 (`20261122_014_fix_whatsapp_delivery_registration.sql`):**
   - **الدليل:** مجلد [`supabase/migrations/`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/supabase/migrations/) يحتوي ملفات Rollback للترحيلات `001`–`013` فقط ولا يوجد ملف `20261122_014_*_rollback.sql`.
   - **الحل المقترح والمخاطر:** إنشاء ملف Rollback توثيقي (مثل نمط `013_rollback` الذي يرفض الرجوع إلى نسخة `012` المعطوبة بـ `SQLSTATE 42702` عبر `RAISE EXCEPTION` مع `ERRCODE = '0A000'`). لم يُنفّذ الآن التزاماً بمنع تغييرات قاعدة البيانات/Migrations.
4. **[SEC-M02] قابلية إعادة تفعيل JSON المحلي في Production عند ضبط `ALLOW_LOCAL_JSON_FALLBACK=true`:**
   - **الدليل:** [`src/lib/supabase/client.ts:370-372`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/supabase/client.ts#L370-L372).
   - **المخاطر:** رغم أنه معطّل افتراضياً في Production وPreview، وجود بوابة `ALLOW_LOCAL_JSON_FALLBACK === "true"` قد يسمح بـ Fallback محلي لو أُسيء ضبطه في بيئة الإنتاج.
   - **الحل المقترح:** منع `ALLOW_LOCAL_JSON_FALLBACK` قطعياً في الإنتاج (أو توثيق حظر تعيينه في قائمة فحص البيئة الإنتاجية).
5. **[SEC-M03] اعتماد حظر Meta Outbound في الإنتاج على متغيرات بيئة التشغيل (`NODE_ENV` / `VERCEL_ENV`):**
   - **الدليل:** [`src/lib/otp-service.ts:37-42, 593-599`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L37-L42).
   - **الأثر:** آمن تماماً في Next.js/Vercel الإنتاجي، لكنه يظل شرطاً تشغيلياً إلزامياً (عدم تشغيل الإنتاج بـ `NODE_ENV` غير `"production"` مع تعيين الأعلام الثلاثة ومفاتيح Meta).

#### LOW
6. **[OPS-L01] السطر `.env*` في [`.gitignore:41`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/.gitignore#L41):**
   - **الملاحظة:** يطابق `.env*` ملف `.env.example` تقنياً (لكن لأن `.env.example` متتبع مسبقاً في Git لا يتأثر حالياً). يُفضّل لاحقاً إضافة `!.env.example` بوضوح.
7. **[CODE-L02] دالة `hashPinSimple` (SHA-256) ما زالت مُصدّرة في [`src/lib/lifecycle-service.ts:263-265`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/lifecycle-service.ts#L263-L265):**
   - **الملاحظة:** تجزئة PIN المشرفين تم ترقيتها إلى `v2:scrypt` (مثبت في اختبار `13.1 A-01`)، ويجب مراجعة إزالة أي مسار قديم يعتمد على SHA-256 بسيط بعد انتهاء التوافق الانتقالي.

---

## 4. الإصلاحات التي أُنجزت محلياً في هذه المراجعة

تم تنفيذ **إصلاح بناء محلي وحيد** (بدون أي تغيير في الصلاحيات أو تدفق الأموال أو الرسائل أو OTP أو قاعدة البيانات):

- **المشكلة المكتشفة:** فشل `npm run build` بخطأ TypeScript في توليد أنواع مسارات Next.js 16:
  - `.next/types/app/api/worker/whatsapp-fallback/route.ts(14,13): error TS2344 ... Property 'verifyWorkerCronAuthorization' is incompatible with index signature.`
- **الإصلاح المنفّذ:**
  1. إنشاء [`src/lib/whatsapp-fallback-worker.ts`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/whatsapp-fallback-worker.ts) ونقل `verifyWorkerCronAuthorization` و`WorkerCycleStats` و`WorkerCycleDependencies` و`runWhatsappFallbackWorkerCycle` و`defaultSendNotificationSms` حرفياً دون أي تعديل في المنطق.
  2. تحديث [`src/app/api/worker/whatsapp-fallback/route.ts`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/app/api/worker/whatsapp-fallback/route.ts) ليصدّر فقط معالجات Next.js App Router الصالحة (`dynamic`, `runtime`, `maxDuration`, `GET`, `POST`).
  3. تحديث سطر الاستيراد [`scripts/batch-2a-tests.mjs:786`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/scripts/batch-2a-tests.mjs#L786) لاستيراد `workerMod` من `@/lib/whatsapp-fallback-worker` مع الإبقاء على فحص إعدادات المسار في السطر `1159` من `route.ts`.

---

## 5. نتائج جميع الاختبارات بالأرقام (مصنّفة إلى 6 فئات)

### 1) Unit Tests (اختبارات وحدة مباشرة)
- من [`scripts/batch-2a-tests.mjs`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/scripts/batch-2a-tests.mjs): **5/5 PASSED** (`A.1` HKDF-SHA256، `A.2` OTP+AES-256-GCM AAD، `A.3` `timingSafeEqual`، `A.4` تصنيف Resala، `A.5` تدوير المفاتيح) + أجزاء الوحدة في `C.8` (`D.3`, `D.8a/b/c`, `D.10`).
- من [`scripts/security-audit-tests.mjs`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/scripts/security-audit-tests.mjs): اختبارات التوقيع و`v2:scrypt` وIP canonicalization وCSP Nonce و`assertAgentToolAllowed` (`5.1–5.2`, `7.1–7.4`, `7.15–7.17`, `8.1–8.3`, `12.1–12.3`, `13.1`, `15.1–15.2`) — **جميعها PASSED**.

### 2) Mock Behavioral Tests (اختبارات سلوكية محلية مع Mock `fetch` / Mock RPC)
- من [`scripts/batch-2a-tests.mjs`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/scripts/batch-2a-tests.mjs): **10/10 PASSED** (`B.1–B.4`, `C.1–C.2`, `C.4 SEC-C1`, `C.6`, `C.7`, `C.8 SEC-META-ISOLATION` بما فيها `D.11a–D.11d` عبر استدعاء `POST` الفعلي في `whatsapp/route.ts`).
- من [`scripts/security-audit-tests.mjs`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/scripts/security-audit-tests.mjs): اختبارات استهلاك Nonce المتزامن (`7.5–7.14`, `7.18–7.21`), Rate Limiter (`8.4`, `10.1`), مسح البيانات والتدقيق (`9.1–9.3`, `14.1`), JSON Guard (`15.1 A-03`), ومسار Twilio/Resala/Late-Delivery/Idempotency (`15.3–15.10`) — **جميعها PASSED**.
- **الإجمالي المحلي:**
  - `node scripts/batch-2a-tests.mjs` → **18/18 PASSED** (Exit `0`).
  - `node scripts/security-audit-tests.mjs` → **61/61 PASSED** (Exit `0`).
  - *(تنبيه إلزامي: نجاح Mock Tests لا يُعد دليلاً على نجاح التكامل الخارجي أو قاعدة البيانات الحية).*

### 3) Static Security Checks (فحوصات أمنية ساكنة)
- `B.5` (تدقيق Migration 012 & Rollback 012)، `C.3` (خلو `src/` من الرقم الوهمي `218910000000` وخلو `.env.example` من `GREEN_API_`)، `C.5` (تدقيق Migration 013 & Rollback 013) → **3/3 PASSED**.
- فحص شامل في `src/` عن `GREEN_API` و`dangerouslySetInnerHTML` و`eval(` و`new Function(` و`218910000000` → **0 مخالفات**.
- `git diff --check` → **CLEAN (Exit 0)**.
- `git diff --no-index --check /dev/null scripts/batch-2a-tests.mjs` → **0 أخطاء تنسيق أو Conflict markers**.
- `node --check` على `scripts/batch-2a-tests.mjs`, `scripts/security-audit-tests.mjs`, `next.config.mjs` → **3/3 OK**.

### 4) Build and TypeScript
- `node node_modules/typescript/bin/tsc --noEmit` → **0 أخطاء (Exit 0)**.
- `npm run build` (بعد إصلاح تصدير Worker route) → **Compiled successfully in 22.9s + Finished TypeScript in 7.6s + Generating static pages (20/20)** — **PASS** *(لا يُعد نجاح البناء وحده دليلاً على الأمان)*.

### 5) PostgreSQL Live Tests السابقة المثبتة في التقارير (لم تُعد تشغيلها الآن)
- وفق تقرير المرحلة 11 ([`phase_11_security_audit_report.md`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/brain/f5ba7a2a-35e0-4dcb-9cea-3e9d7af475c1/phase_11_security_audit_report.md)) على مشروع الاختبار المعزول `BALAGHNI-SECURITY-TEST` (`yemhfpfdinmixhbfszvq`):
  - تم التحقق سابقاً من تفعيل RLS على الجداول الـ 27 في `public` مع `0` سياسات عامة (للمراحل `001–009`).
  - **مهم:** اختبارات التزامن الحية لـ Migration `012` / `013` / `014` (`FOR UPDATE SKIP LOCKED`, `pg_advisory_xact_lock`, وRollback 012) على قاعدة الإنتاج **لم تُنفّذ بعد (`NOT VERIFIED` في الإنتاج)**، ولا يُعد تطبيق أي Migration على قاعدة اختبار دليلاً على جاهزية الإنتاج.

### 6) External Provider Tests غير المنفذة (`NOT EXECUTED / NOT VERIFIED`)
- **Twilio Live WhatsApp Template Delivery & StatusCallback:** غير منفّذ.
- **Resala Live `/messages/send-template` على عنوان الإنتاج الرسمي:** غير منفّذ (النطاق الإنتاجي الرسمي غير معتمد بعد).
- **Meta Inbound Webhook Live Delivery:** غير منفّذ.
- **Production Cron / Worker Live Triggering:** غير منفّذ.

---

## 6. تقييم OTP وWhatsApp وTwilio وResala وMeta

1. **Twilio هو المزود الأساسي:** **PASS** — `WHATSAPP_ACTIVE_PROVIDER` افتراضياً `"twilio"` ([`otp-service.ts:648`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L648)، [`.env.example:39`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/.env.example#L39))، ومسار OTP ([`sendOtpViaWhatsapp`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L322-L410)) مقتصر حصراً على Twilio `ContentSid`. كما يمنع `sendWhatsappAlertMessage` السقوط إلى نص حر (`Body`) في الإنتاج ([`otp-service.ts:767-786`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L767-L786)).
2. **Meta Outbound معطّل ولا يعمل بمجرد وجود مفاتيح البيئة:** **PASS** — [`isMetaOutboundAllowed()`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L575-L626) ترفض الإنتاج قطعياً قبل قراءة المفاتيح أو بناء Payload أو `fetch`، مع فحص ثانٍ في السطر [`860`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L860).
3. **لا يوجد انتقال تلقائي من فشل Twilio إلى Meta:** **PASS** — جميع مسارات الخطأ والـ Timeout في فرع Twilio تنتهي بـ `return` صريح ([`otp-service.ts:666-671, 767-786, 823-831`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L823-L831)).
4. **Resala يستخدم قالب `send-template` ورمز OTP المولّد من التطبيق:** **PASS** — [`sendResalaTemplateMessage`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L930-L1025) ترسل إلى `/messages/send-template?sms_template_id=...` بنفس رمز OTP المولّد عبر `generateSecure6DigitOtp()`.
5. **منع إرسال Resala قبل تحديد عنوان الإنتاج الرسمي واعتماده:** **PASS** — [`validateResalaEndpointUrl`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L60-L195) ترفض `http:`، وبيانات الاعتماد في URL، و`localhost`، وعناوين IP، و`dev.resala.ly` ونطاقاتها الفرعية في الإنتاج، وتفرض قائمة `RESALA_APPROVED_HOSTNAMES` (تكون فارغة افتراضياً في الإنتاج → Fail-Closed).
6. **حالات Timeout والنتائج المجهولة لا تعيد إرسال OTP مختلف تلقائياً:** **PASS** — `classifyResalaDispatchOutcome` تصنّف Timeout و`5xx` كـ `abandoned_unknown` وتُبقي جلسة OTP `pending` قابلة للتحقق دون إلغائها أو توليد رمز مختلف ([`otp-service.ts:1477-1485`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/otp-service.ts#L1477-L1485)، [`whatsapp-fallback-worker.ts:336-353`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/whatsapp-fallback-worker.ts#L336-L353)).

---

## 7. تقييم قاعدة البيانات وRLS وMigrations (`001–014`) وRollback `012`

- **مراجعة Migrations `001–014` (قراءة فقط):**
  - جميع الترحيلات (`001` إلى `014`) تطبّق مبدأ Least Privilege (`REVOKE ALL FROM PUBLIC, anon, authenticated`، و`RLS + FORCE RLS`، و`SECURITY DEFINER SET search_path = pg_catalog, public` على الدوال).
  - لا يوجد أي استخدام خطير لـ `DROP ... CASCADE` في أي ملف Rollback. (الظهور الوحيد لـ `CASCADE` هو قيود `ON DELETE CASCADE` طبيعية في تعريف مفاتيح خارجية داخل `002_command_center_additive.sql:74,101,132`).
  - Migration `013` يُغلق ثغرة إعادة الاستخدام المتزامن `SEC-C1` في `commit_otp_verification_attempt`، وMigration `014` يُصلح تعارض العمود `SQLSTATE 42702` في `register_whatsapp_delivery`.
  - **ملاحظة:** ينقص Migration `014` ملف Rollback توثيقي (مُدرج ضمن `DB-M01`).
- **مراجعة Rollback 012 ومخاطر البيانات ([`20261121_012_whatsapp_delivery_and_otp_sessions_rollback.sql`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/supabase/migrations/20261121_012_whatsapp_delivery_and_otp_sessions_rollback.sql)):**
  - **مصمم كـ Non-Destructive (بدون `DROP TABLE` وبدون `CASCADE`):** يحوّل الحجوزات الجارية (`claimed`/`sending`) إلى `abandoned_unknown`، يسقط الدوال الـ 14 بتوقيعاتها الكاملة، يبطل جلسات OTP المفتوحة ويطهّر `otp_hash` و`otp_payload_enc`، ويؤرشف الجدولين إلى `*_archive_012` مع `RLS + FORCE RLS + REVOKE ALL`.
  - **مخاطر البيانات والتشغيل عند تنفيذه:**
    1. جميع رموز OTP النشطة وقت Rollback ستُبطَل فوراً (يضطر المستخدمون لطلب رمز جديد).
    2. إذا لم يُوقف Worker قبل التنفيذ وتُنتظر مدة Lease (`120s`)، قد تقع محاولات إرسال SMS قيد الطيران في حالة غير متسقة (`abandoned_unknown`).
    3. إذا أُعيد تشغيل Rollback 012 لاحقاً بعد إعادة تطبيق 012 مع وجود جداول `*_archive_012` مسبقاً، لن تُعاد تسمية الجدولين الجديدين (بسبب شرط `to_regclass('..._archive_012') IS NULL` في السطرين `69` و`75`)، مما يتطلب تخطيطاً يدوياً قبل أي Rollback ثانٍ.

---

## 8. تقييم Worker والجدولة

- **الحماية:** [`verifyWorkerCronAuthorization`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/src/lib/whatsapp-fallback-worker.ts#L30-L48) تتحقق من `Authorization: Bearer <CRON_SECRET>` عبر `crypto.timingSafeEqual` (Fail-Closed عند غياب `CRON_SECRET` أو عدم التطابق → `401`).
- **أمان التنفيذ:** يدعم `maxDuration = 60` وميزانية زمنية داخلية `45_000ms` ودفعة `batchLimit <= 50` وحجزاً ذرياً `FOR UPDATE SKIP LOCKED` مع Lease `120s` وانتقالاً إلزامياً `claimed -> sending` قبل أي نداء لـ Resala.
- **قيد الجدولة (Vercel Hobby):** لا يدعم Vercel Hobby تشغيل Cron كل دقيقة (يدعم تشغيلاً يومياً فقط). ملف [`vercel.json`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/vercel.json) لم يُعدّل ولم تُضف أي جدولة خارجية أو خدمة جديدة؛ تبقى جدولة `/api/worker/whatsapp-fallback` متطلباً تشغيلياً معلقاً قبل الإطلاق.

---

## 9. تقييم Environment والأسرار

- [`.env.example`](file:///data/user/0/com.agy/files/.gemini/antigravity-app/scratch/balaghni/.env.example) مُحدّث ومنظّم بـ 7 أقسام واضحة:
  - يفرض `SESSION_HMAC_SECRET` (>= 32 بايت، دون بدائل من `SUPABASE_SERVICE_ROLE_KEY` أو `CRON_SECRET` في الإنتاج).
  - يحدد `WHATSAPP_ACTIVE_PROVIDER=twilio` كمزود أساسي، ويُعلّق جميع متغيرات Meta Outbound مع توثيق شروط التفعيل المستقبلية، ويُبقي `WHATSAPP_APP_SECRET` و`WHATSAPP_VERIFY_TOKEN` للـ Webhooks الواردة.
  - يوثّق `RESALA_ENDPOINT` و`RESALA_APPROVED_HOSTNAMES` و`RESALA_OTP_TEMPLATE_ID` كمتطلبات إنتاجية إلزامية.
- لم يتم طباعة أو كشف أي قيمة سرية حقيقية في أي ملف أو سجل.

---

## 10. مراجعة Git والملفات غير المتتبعة (بدون `git add` أو `commit`)

### ملخص `git diff --stat`
- **43 ملفاً معدّلاً** (`+5983 / -1795` سطراً مقابل `HEAD` عند `b9e4ef7`).

### أ. الملفات المعدّلة (43 ملفاً) — يجب تضمينها في الإصدار بعد الاعتماد
- الإعدادات: `.env.example`, `.gitignore`, `next.config.mjs`
- واجهات API (`25` ملفاً): `admin/lifecycle`, `admin`, `agents/command`, `agents/skills`, `auth/login`, `auth/otp`, `auth/passkey`, `auth/reset-pin`, `corporate-leads`, `cron/reminders`, `dashboard`, `notify/call`, `notify/remind`, `notify`, `orders`, `stickers/[code]/activate-online`, `tags/[tagCode]/activate`, `tags/[tagCode]/check-note`, `tags/[tagCode]/notify`, `tags/[tagCode]/verify-pin`, `vendor`, `visual-overrides`, `webhooks/whatsapp-status`, `webhooks/whatsapp`
- الصفحات والمكونات (`6` ملفات): `admin/page.tsx`, `call/[call_code]/page.tsx`, `login/page.tsx`, `admin-lifecycle-panel.tsx`, `site-footer.tsx`, `scan-form.tsx`
- المكتبات الأساسية (`9` ملفات): `ai-office/agents-service.ts`, `lifecycle-service.ts`, `otp-service.ts`, `rate-limiter.ts`, `security-tokens.ts`, `supabase/client.ts`, `supabase/realtime.ts`, `twilio-template-manager.ts`, `whatsapp-webhook-handler.ts`
- قاعدة البيانات: `supabase/security_hardening_rls.sql`

### ب. الملفات غير المتتبعة (`??` Untracked) وتصنيفها للـ Commit
1. **يجب تضمينها في الإصدار (Production Code + Migrations + Tests):**
   - `src/proxy.ts`
   - `src/app/activate/security/layout.tsx`, `src/app/admin/layout.tsx`, `src/app/dashboard/layout.tsx`, `src/app/login/layout.tsx`, `src/app/vendor/layout.tsx`, `src/app/verify/layout.tsx`
   - `src/app/api/worker/whatsapp-fallback/route.ts`
   - `src/lib/whatsapp-fallback-worker.ts` *(جديد — إصلاح بناء Next.js 16)*
   - `src/lib/ai-office/skill-guard.ts`, `src/lib/delivery-fallback.ts`, `src/lib/nonce-consumption.ts`, `src/lib/otp-crypto.ts`, `src/lib/report-token-revocation.ts`
   - `supabase/migrations/` (ملفات `000`–`014` والـ Rollbacks)
   - `supabase/RLS_REVIEW_MATRIX.md`
   - `scripts/batch-2a-tests.mjs`, `scripts/security-audit-tests.mjs`
2. **ملفات تقارير محلية (يُراجع تضمينها أو استبعادها حسب سياسة المستودع؛ يُنصح باستبعادها من Commit الإنتاج):**
   - `BALAGHNI_FINAL_SECURITY_AND_RELEASE_AUDIT.md` (هذا التقرير)
3. **تغييرات غير مرتبطة بالمهمة:** لم تُرصد أي تغييرات دخيلة أو ملفات أسرار (`.env.local` محمية بـ `.gitignore` وغير ظاهرة في `git status`).

---

## 11. المتطلبات التي تمنع الإطلاق (Release Blockers)

1. **اعتماد عنوان Resala الإنتاجي الرسمي** وتعيين `RESALA_ENDPOINT` و`RESALA_APPROVED_HOSTNAMES` و`RESALA_OTP_TEMPLATE_ID` في بيئة الإنتاج.
2. **إثبات التكامل الحي (Live Verification)** مع Twilio (قوالب `ContentSid` المعتمدة + `StatusCallback` بتوقيع `X-Twilio-Signature`) ومع Resala (`/messages/send-template`).
3. **تطبيق والتحقق الحي من Migrations `001–014`** على قاعدة الإنتاج (أو Staging مطابق) بما يشمل تزامن `012`/`013`/`014` وصلاحيات `RLS + FORCE RLS`، مع إعداد ملف Rollback توثيقي لـ `014`.
4. **تحديد وتفعيل آلية جدولة Worker** (`/api/worker/whatsapp-fallback`) بتردد مناسب (مع `CRON_SECRET`) خارج قيود Vercel Hobby اليومية.
5. **مراجعة وضبط جميع متغيرات البيئة الإنتاجية** (`SESSION_HMAC_SECRET`, `CRON_SECRET`, `TWILIO_*`, `WHATSAPP_ACTIVE_PROVIDER=twilio`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, وعدم تفعيل `ALLOW_LOCAL_JSON_FALLBACK` أو متغيرات Meta Outbound).

---

## 12. خطة الإغلاق النهائية (Go-Live Closure Plan)

1. اعتماد قائمة الملفات وتنفيذ Commit/PR منظّم (مع استبعاد أي تقارير محلية غير مطلوبة في الكود).
2. إضافة ملف Rollback توثيقي لـ Migration `014` قبل تنفيذ ترحيلات قاعدة البيانات.
3. تطبيق Migrations `001–014` بالترتيب على قاعدة الإنتاج بعد أخذ Backup، وتنفيذ فحص تحقق `READ-ONLY` للصلاحيات وRLS.
4. ضبط متغيرات البيئة الإنتاجية (بما فيها `RESALA_ENDPOINT` و`RESALA_APPROVED_HOSTNAMES` الرسمية من Resala و`WHATSAPP_ACTIVE_PROVIDER=twilio`).
5. إجراء اختبار تكامل حي محدود ومُراقَب (Canary): OTP عبر Twilio، ثم محاكاة Fallback عبر Resala `send-template`، ثم التحقق من `StatusCallback` وWorker.
6. تفعيل جدولة Worker المعتمدة ومراقبة السجلات ومعدل الأخطاء خلال أول 24 ساعة.

---

## 13. القرار النهائي

> **القرار:** **`NOT READY`**
>
> **التعليل:** الكود المحلي نظيف ومحكَم أمنياً ويجتاز `tsc --noEmit` و`npm run build` و`79/79` اختباراً محلياً (`18/18` + `61/61`)، لكن قواعد الحكم الصارمة تمنع منح `READY` أو `READY WITH CONDITIONS` ما دامت 4 متطلبات إطلاق جوهرية غير مُثبتة حياً (عنوان Resala الإنتاجي، واختبارات Twilio/Resala الحية، وتطبيق Migrations `001–014` على الإنتاج، وجدولة Worker الإنتاجية).
