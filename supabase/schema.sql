-- مخطط قاعدة بيانات منصة «بَلِّغْنِي | BALAGHNI» على Supabase
-- منظومة الأمان والتفعيل الذاتي (Two-Step Flow) وتوليد الملصقات المشفرة

-- 1. تعريف نوع حالة الملصق (Tag Status Enum)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tag_status') then
    create type public.tag_status as enum ('LOCKED', 'ACTIVE', 'REVOKED');
  end if;
end $$;

-- 2. جدول الملصقات والمركبات (Tags)
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  -- كود عشوائي غير متسلسل (مثال: LY-K7W9-P2M4)
  tag_code text unique not null check (tag_code ~ '^LY-[A-Z0-9]{4}(-[A-Z0-9]{4})?$' or tag_code ~ '^LY-[A-Z0-9]{4,10}$'),
  -- تجزئة مشفرة لرمز الخدش السري عبر SHA-256 (Hex 64 chars)
  activation_pin_hash text not null,
  -- حالة الملصق: LOCKED (افتراضي عند الطباعة) | ACTIVE (مفعل) | REVOKED (ملغى/موقوف)
  status public.tag_status not null default 'LOCKED',
  -- رقم هاتف المالك الليبي (+2189XXXXXXXX) - يُحفظ عند التفعيل
  owner_phone text,
  -- تجزئة رمز مرور دخول المالك (PIN من 6 أرقام عبر SHA-256)
  owner_pin_hash text,
  -- تجزئة كود استرداد الطوارئ الرقمي (BK-XXXX-XXXX عبر SHA-256)
  recovery_key_hash text,
  -- معرف مفتاح الدخول بالبصمة (WebAuthn Passkey Credential ID)
  passkey_credential_id text,
  -- معلومات المركبة المجمعة أو المفصلة عند التفعيل
  vehicle_info text,
  vehicle_brand text default 'Hyundai',
  vehicle_model text default 'Elantra',
  vehicle_color text default 'أبيض',
  city text default 'طرابلس',
  tag_type text not null default 'car' check (tag_type in ('car', 'generic')),
  tier text not null default 'premium' check (tier in ('standard', 'premium', 'elite')),
  has_emergency_contacts boolean not null default false,
  emergency_phones text[] default '{}',
  -- تاريخ التفعيل الذاتي وتاريخ الإنشاء
  activated_at timestamptz,
  last_sub_reminder_stage text,
  last_sub_reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- إضافة الأعمدة الأمنية في حال كان الجدول منشأً مسبقاً
alter table public.tags add column if not exists owner_pin_hash text;
alter table public.tags add column if not exists recovery_key_hash text;
alter table public.tags add column if not exists passkey_credential_id text;
alter table public.tags add column if not exists vehicle_info text;
alter table public.tags add column if not exists activated_at timestamptz;

create index if not exists idx_tags_tag_code on public.tags (tag_code);
create index if not exists idx_tags_owner_phone on public.tags (owner_phone);
create index if not exists idx_tags_status on public.tags (status);

-- سياسات الأمان (RLS Policies) للسماح بالقراءة والتفعيل عبر مفتاح المنصة
alter table public.tags enable row level security;

drop policy if exists "Allow public read of tags" on public.tags;
create policy "Allow public read of tags"
  on public.tags for select
  using (true);

drop policy if exists "Allow tag activation and security setup" on public.tags;
create policy "Allow tag activation and security setup"
  on public.tags for update
  using (true)
  with check (true);

drop policy if exists "Allow seeding tags" on public.tags;
create policy "Allow seeding tags"
  on public.tags for insert
  with check (true);

-- 3. إدراج الملصق التجريبي للاختبار بحالة LOCKED
-- الكود: LY-K7W9-P2M4 | رمز الخدش التجريبي: 482915
-- SHA-256("482915") = 48290cf691c41cbc99b2396d2e5313ccfba91987b384e6d8f08b951fa5045e83
insert into public.tags (tag_code, activation_pin_hash, status)
values (
  'LY-K7W9-P2M4',
  '48290cf691c41cbc99b2396d2e5313ccfba91987b384e6d8f08b951fa5045e83',
  'LOCKED'
)
on conflict (tag_code) do update
set
  activation_pin_hash = excluded.activation_pin_hash,
  status = 'LOCKED',
  owner_phone = null,
  owner_pin_hash = null,
  recovery_key_hash = null,
  passkey_credential_id = null,
  vehicle_info = null,
  activated_at = null;

-- 4. جدول التنبيهات المرسلة عبر مسح الـ QR (Notifications)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tag_code text not null references public.tags(tag_code) on delete cascade,
  reason text not null,
  note text,
  sender_phone text,
  fingerprint text,
  latitude double precision,
  longitude double precision,
  image_url text,
  created_at timestamptz not null default now()
);

-- 5. جدول طلبات الملصقات في ليبيا (Orders)
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text unique not null,
  tier text not null,
  quantity integer not null default 1,
  full_name text not null,
  phone text not null,
  city text not null,
  address text not null,
  vehicle_model text,
  total_lyd numeric(10, 2) not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- 6. جدول وثائق المركبة لخدمة «نبّهني» (vehicle_documents)
create table if not exists public.vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  tag_code text not null references public.tags(tag_code) on delete cascade,
  title text not null,
  subtitle text,
  expiry_date date not null,
  last_reminder_stage text,
  last_reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicle_documents_tag_code on public.vehicle_documents (tag_code);

alter table public.vehicle_documents enable row level security;
drop policy if exists "Allow public access to vehicle_documents" on public.vehicle_documents;
create policy "Allow public access to vehicle_documents"
  on public.vehicle_documents for all
  using (true)
  with check (true);

-- 7. جدول البلاغات والتنبيهات الواردة للملصق (reports)
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  tag_code text not null references public.tags(tag_code) on delete cascade,
  reason_title text not null,
  reason_badge text,
  message text,
  location text,
  photo_url text,
  icon_type text default 'blocking',
  created_at timestamptz not null default now()
);

create index if not exists idx_reports_tag_code on public.reports (tag_code);

alter table public.reports enable row level security;
drop policy if exists "Allow public access to reports" on public.reports;
create policy "Allow public access to reports"
  on public.reports for all
  using (true)
  with check (true);

-- 8. جدول سجل الصيانة الدورية للمركبة (maintenance_records)
create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  tag_code text not null references public.tags(tag_code) on delete cascade,
  service_type text not null,
  service_date date not null,
  mileage_km text,
  cost_lyd numeric(10, 2) not null default 0,
  workshop text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_maintenance_records_tag_code on public.maintenance_records (tag_code);

alter table public.maintenance_records enable row level security;
drop policy if exists "Allow public access to maintenance_records" on public.maintenance_records;
create policy "Allow public access to maintenance_records"
  on public.maintenance_records for all
  using (true)
  with check (true);

-- 9. إضافة قناة التنبيه (SMS / WHATSAPP / BOTH) لجدول الملصقات
alter table public.tags add column if not exists alert_channel text default 'BOTH' check (alert_channel in ('SMS', 'WHATSAPP', 'BOTH'));

-- 10. جدول ملفات المشرفين والصلاحيات المؤسسية (admin_profiles)
create table if not exists public.admin_profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  username text unique not null,
  phone text unique not null,
  role text not null default 'SUPER_ADMIN',
  permissions jsonb not null default '{"danger_zone":true,"import_tags":true,"manage_tags":true,"manage_admins":true,"manage_reports":true}'::jsonb,
  pin_hash text not null,
  passkey_credential_id text,
  is_active boolean not null default true,
  last_login timestamptz,
  created_at timestamptz not null default now()
);

alter table public.admin_profiles add column if not exists last_login timestamptz;

alter table public.admin_profiles enable row level security;
drop policy if exists "Allow access to admin_profiles" on public.admin_profiles;
create policy "Allow access to admin_profiles"
  on public.admin_profiles for all
  using (true)
  with check (true);

-- 11. جدول سجل الرقابة وتوثيق العمليات الإدارية (admin_audit_logs)
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.admin_profiles(id) on delete set null,
  admin_name text not null,
  action_type text not null,
  target_item text,
  details text,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_logs_created_at on public.admin_audit_logs (created_at desc);

alter table public.admin_audit_logs enable row level security;
drop policy if exists "Allow access to admin_audit_logs" on public.admin_audit_logs;
create policy "Allow access to admin_audit_logs"
  on public.admin_audit_logs for all
  using (true)
  with check (true);

-- ============================================================================
-- 10. جدول التجار والمناديب (vendors)
-- ============================================================================
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique not null,
  city text not null default 'طرابلس',
  pin_hash text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 11. جدول تسويات العهدة الشهرية للتجار (vendor_settlements)
-- ============================================================================
create table if not exists public.vendor_settlements (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  period_month text not null,
  stickers_sold_count integer not null default 0,
  total_cash_collected numeric(10, 2) not null default 0,
  status text not null default 'open' check (status in ('open', 'settled')),
  settled_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 12. جدول ضبط أرقام الهدايا الترويجية (gift_redemptions)
-- ============================================================================
create table if not exists public.gift_redemptions (
  phone text primary key,
  sticker_code text not null,
  redeemed_at timestamptz not null default now()
);

-- ============================================================================
-- 13. جدول طلبات باقة إيليت للشركات (corporate_leads)
-- ============================================================================
create table if not exists public.corporate_leads (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  city text not null,
  fleet_count integer not null default 10,
  selected_features jsonb not null default '[]'::jsonb,
  contact_phone text,
  agreed_amount_lyd numeric(10, 2),
  status text not null default 'new',
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 14. جدول دورة حياة الملصقات (stickers) - 4 حالات فقط بدون أي حجز زمني
-- ============================================================================
create table if not exists public.stickers (
  code text primary key,
  status text not null default 'unactivated' check (status in ('unactivated', 'gift_ready', 'active', 'expired')),
  vendor_id uuid references public.vendors(id) on delete set null,
  activation_source text check (activation_source in ('online', 'vendor_cash', 'cod_delivered', 'gift_promo')),
  activated_by_vendor_id uuid references public.vendors(id) on delete set null,
  package_type text default 'nabbihni',
  features jsonb not null default '{"whatsapp":true,"sms_fallback":true,"nabbihni_reminders":true,"photo_attachments":true,"emergency_portal":true}'::jsonb,
  owner_phone text,
  owner_name text,
  vehicle_info text,
  company_account_id text,
  subscription_starts_at timestamptz,
  subscription_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 15. أعمدة الباقات والاشتراك في جدول tags و orders (بما فيها unassigned_paid)
-- ============================================================================
alter table public.tags add column if not exists package_type text default 'nabbihni';
alter table public.tags add column if not exists features jsonb default '{"whatsapp":true,"sms_fallback":true,"nabbihni_reminders":true,"photo_attachments":true,"emergency_portal":true}'::jsonb;
alter table public.tags add column if not exists subscription_starts_at timestamptz;
alter table public.tags add column if not exists subscription_expires_at timestamptz;
alter table public.tags add column if not exists vendor_id uuid;
alter table public.tags add column if not exists activation_source text;
alter table public.tags add column if not exists activated_by_vendor_id uuid;

alter table public.orders add column if not exists payment_method text default 'cod';
alter table public.orders add column if not exists payment_status text default 'pending';
alter table public.orders add column if not exists assigned_tag_code text;
alter table public.orders add column if not exists subscription_starts_at timestamptz;
alter table public.orders add column if not exists subscription_expires_at timestamptz;
