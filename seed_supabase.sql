-- ملف تغذية دفعة الملصقات في قاعدة بيانات Supabase لمنصة «بَلِّغْنِي | BALAGHNI»
-- تاريخ التوليد: 2026-11-09T23:45:48.035Z
-- إجمالي الملصقات: 5 ملصق بحالة LOCKED

insert into public.tags (tag_code, activation_pin_hash, status)
values
  ('LY-K7W9-P2M4', '48290cf691c41cbc99b2396d2e5313ccfba91987b384e6d8f08b951fa5045e83', 'LOCKED'),
  ('LY-A2Z8-CSUE', '3f1805615ba88904a1a963ea596cf1a8d0932f2fc19a648290e30b3d3ebd9f74', 'LOCKED'),
  ('LY-AF9C-Y4ST', 'd7470674d878e9150eb195ebe94c7832580396f362cb02ade28ae78ae2c042f7', 'LOCKED'),
  ('LY-8E79-534M', '8fc91e9b15d2e39576644efd12b45c4c8cace9564debecc1d5de8b754917b448', 'LOCKED'),
  ('LY-9MZF-2CYK', '1eb050371e90d872d029ef8aa40fdc31074da3954d13aad7f5608ca7787de7ed', 'LOCKED')
on conflict (tag_code) do nothing;

-- إضافة 5 ملصقات جديدة بحالة LOCKED (2026-11-12T00:53:59.615Z)
insert into public.tags (tag_code, activation_pin_hash, status)
values
  ('LY-VC6U-D8FZ', '5688d19b1e820965dfbf9e08a699f1719f8919ce82c8ab78473bf51d5ed68d7f', 'LOCKED'),
  ('LY-PCH4-UTM3', '5c9355d75bd31cfa4ecbbbdee20827ae09c8419ad040939fb9222cd6f766bd89', 'LOCKED'),
  ('LY-548X-3FQR', 'cec576b3ced48017980099421967fae1632be93005445e517f41fe285f3d8c2c', 'LOCKED'),
  ('LY-MJ4S-8V9K', 'd17606214c1c0242086685c3ac526884bcfbcc308ab1e190e4d57736eeaad67f', 'LOCKED'),
  ('LY-ED6R-XPF3', '8bd0f5833526981664093ad99753fad5153ea58f000ab8d2a7c7eba84b0dac5d', 'LOCKED')
on conflict (tag_code) do nothing;
