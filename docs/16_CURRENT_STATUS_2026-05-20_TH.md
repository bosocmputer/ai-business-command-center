# Current Status: SaaS Pilot Portal

## เป้าหมายของเอกสาร

บันทึกสถานะล่าสุดของ AI Business Command Center หลังจบรอบงานวันที่ `20/05/2026` ถึง `21/05/2026` เพื่อให้วันถัดไปเริ่มทำต่อได้โดยไม่ต้องไล่ reconstruct จาก chat history

เอกสารนี้เป็น operational snapshot ไม่ใช่ replacement ของ blueprint หลัก ถ้ามีข้อมูลขัดกัน ให้ถือไฟล์นี้เป็นสถานะล่าสุด ณ เวลาที่ระบุ

## Snapshot ล่าสุด

```text
วันที่บันทึก: 2026-05-20
อัปเดตล่าสุด: 2026-05-22
Timezone: Asia/Bangkok
Latest deployed code commit: 050b2a2
SaaS pilot owner/customer portals: ready
GitHub branch: main
Deploy target: 192.168.2.109
Compose project: ai-business-command-center
System store: PostgreSQL
Pilot tenants: DEMO SHOP (`tenant_demo_remote`), 248 SHOP (`tenant_office_sml1_2026`)
Current reports: sales_goods_services, purchase_goods_payables
PDF export layout: sml-row-v5
PDF cache volume: /app/.data/pdf-cache
```

## URL ที่ใช้ตรวจระบบ

LAN:

```text
Web Owner: http://192.168.2.109:3055/owner
Web Customer DEMO SHOP: http://192.168.2.109:3055/app/demo-shop
Web Customer 248 SHOP: http://192.168.2.109:3055/app/248-shop
API: http://192.168.2.109:4055
```

Public demo ผ่าน trycloudflare:

```text
Web Owner: https://relationship-code-others-challenging.trycloudflare.com/owner
Web Customer DEMO SHOP: https://relationship-code-others-challenging.trycloudflare.com/app/demo-shop
Web Customer 248 SHOP: https://relationship-code-others-challenging.trycloudflare.com/app/248-shop
API: https://bibliography-numbers-lite-motion.trycloudflare.com
```

หมายเหตุ:

- trycloudflare quick tunnel เป็น URL ชั่วคราว อาจเปลี่ยนเมื่อ process/server restart
- ห้ามบันทึก signed brief URL เต็มลง docs เพราะมี `token=...`
- LINE message ใช้ Flex Message พร้อมปุ่ม `เปิดรายงาน`; signed URL ต้องอยู่หลังปุ่มและสร้างจาก API เท่านั้น
- Web ใช้ same-origin `/api` rewrite ไป API service ภายใน Docker ได้แล้ว เพื่อลดปัญหา API quick tunnel URL หมดอายุหรือ DNS ไม่ทัน

## สิ่งที่สำเร็จแล้ว

### Report Platform

- ใช้ approved report contract `sales_goods_services`
- เพิ่ม approved report contract `purchase_goods_payables` สำหรับรายงานซื้อสินค้า/ตั้งหนี้
- Query ใช้ parameter binding ไม่ใช้ string replace
- Summary ใช้ `ic_trans.total_amount` เป็น financial truth
- Detail analytics ใช้ `ic_trans_detail.sum_amount`, `qty`, product fields
- Branch display ใช้ `erp_branch_list.name_1` ก่อน ถ้าไม่มีชื่อสาขาจึง fallback เป็น `detail.branch_code -> header.branch_code -> no_branch`
- Header query ใช้ SML sales report filter รุ่นใหม่: `trans_flag in (44)`, `last_status = 0`, date range, `(coalesce(doc_ref,'') = '' or is_pos = 0)`, `is_doc_copy <> 1`
- Detail query join ผ่านหัวบิลที่ผ่าน filter แล้วด้วย `doc_no + doc_date + trans_flag` และ enrich ด้วย `ic_inventory`, `ic_unit`
- Customer bill table ใช้ server-side pagination/search จาก SML ผ่าน approved SQL และ bill drilldown ดึงรายละเอียดสินค้าในบิลแบบ on-demand ไม่ยัด detail ทุกแถวของช่วงใหญ่ลง snapshot
- Customer viewer เพิ่ม section รายงานซื้อ/ตั้งหนี้:
  - DEMO SHOP ช่วง `2026-05-01` ถึง `2026-05-21` เคยตรวจได้ header 27, detail 57, header total 63,864.35 บาท
  - 248 SHOP ช่วงเดียวกันยังไม่มี purchase data และต้องแสดง empty state แบบธุรกิจ
  - เอกสารซื้อใช้ server-side pagination/search และ detail drilldown แบบเดียวกับรายงานขาย แต่ wording เป็น `ผู้จำหน่าย`, `ยอดซื้อเอกสารนี้`, `เอกสารซื้อ`
- Snapshot มี comparison สำหรับ single-day report:
  - เมื่อวานเทียบกับวันก่อนหน้า
  - เมื่อวานเทียบกับวันเดียวกันสัปดาห์ก่อน
- Server-side PDF export ใช้งานแล้วสำหรับรายงาน `sales_goods_services` และ `purchase_goods_payables`:
  - download endpoint เดิม: `GET /api/reports/:tenantId/:reportKey/pdf?...`
  - prepare endpoint สำหรับ progress UX: `GET /api/reports/:tenantId/:reportKey/pdf/prepare?...`
  - ใช้ signed token เดิมที่ผูกกับ `tenant_id + report_key + run_id` และ validate date range ภายใต้ run/token เดิม
  - layout version ล่าสุดคือ `sml-row-v5` เพื่อ invalidate cache รุ่นก่อนหน้า
  - render server-side ด้วย Chromium/Playwright เป็น A4 landscape, ฟอนต์ไทยอ่านได้, วันที่แบบพ.ศ. เช่น `05/5/2569`
  - header เป็น customer-facing: ชื่อร้าน, ชื่อรายงาน, ช่วงวันที่, Print Date, Page No. ไม่แสดง Run ID/Layout/Data source ใน PDF หลัก
  - row layout ลดความเป็น spreadsheet: ไม่มีเส้นแบ่งถี่ระหว่าง document/detail rows, คงเส้นเฉพาะหัวตารางและแถว `รวมทั้งหมด`
  - detail row ไม่ซ้ำวันที่/ชื่อลูกค้า และไม่แสดง barcode ใน PDF หลัก
  - multi-page guard v5: ไม่ force page-start ระหว่างเอกสารด้วย estimator แล้ว, keep-together เฉพาะเอกสารเล็กที่เตี้ยจริง, doc row พยายามติดกับ detail แถวแรก, เอกสารยาวมี continuation marker
  - cache ที่ `/app/.data/pdf-cache` ผ่าน Docker volume `ai_bcc_data`, key รวม tenant/report/run/date/layout, TTL 7 วัน, atomic write, single-flight, cache เสียหรือว่างจะ regenerate
  - limit guard pilot: ไม่เกิน 300 เอกสาร และ 5,000 detail rows พร้อม preflight reject 422 ก่อน fetch rows เต็ม

### SaaS Portal / Dashboard

- `/signin` เป็น Owner login สำหรับ admin surface:
  - ค่าเริ่มต้น pilot: `superadmin / superadmin`
  - ค่าเริ่มต้นนี้เก็บไว้หลังบ้านสำหรับ owner เท่านั้น ไม่แสดงเป็น hint บน UX/UI
  - เมื่อ login สำเร็จจะตั้ง signed HTTP-only cookie สำหรับ route protection
  - ระหว่าง MVP จะ bootstrap admin mutation token ใน `sessionStorage` เพื่อไม่ต้องกรอก token ซ้ำ
- `/`, `/owner`, `/command-center`, `/command-center/settings` ถูก gate ด้วย owner login
- TailAdmin sample routes เช่น `/signup`, `/profile`, `/calendar`, `/alerts`, `/basic-tables`, `/bar-chart` ถูก redirect กลับเข้า owner/admin flow เพื่อไม่ให้ product surface ดูเป็น template
- `/app`, `/app/:tenantSlug` และ `/command-center/brief` ยังเป็น public/read-only ตามหน้าที่ของ customer viewer และ signed LINE viewer
- Owner Admin แยกเป็น section/page ตามงานจริงเพื่อลด noise:
  - `/owner`: ภาพรวมเจ้าของ เห็น readiness ของทุกร้าน, งานที่ต้องทำต่อ, flow เปิดร้านใหม่
  - `/owner/tenants`: ร้านค้าและการใช้งาน เพิ่ม tenant, เปลี่ยน subscription status, ดู datasource/customer dashboard slug
  - `/owner/reports`: สถานะ report snapshot ล่าสุดต่อร้าน และ manual report runner สำหรับรายงานขายสินค้าและบริการกับรายงานซื้อสินค้า/ตั้งหนี้
  - `/owner/line`: LINE OA และผู้รับรายงาน, onboarding guide ให้ผู้บริหาร add OA เป็นเพื่อนแล้วพิมพ์ `test`, ดู LINE readiness ต่อร้าน; group ใช้เป็น optional สำหรับทีมงาน
  - `/owner/audit`: ประวัติระบบล่าสุด เช่น latest report run, latest LINE delivery, audit log, worker/scheduler status และ backup readiness
- `/owner` มี Pilot rollout board:
  - แสดง progress ต่อร้านจาก checklist subscription, SML datasource, snapshot, LINE OA, approved target, LINE delivery
  - บอก next action และพาไปหน้าที่เกี่ยวข้อง เช่น `/owner/tenants`, `/owner/reports`, `/owner/line`
  - ใช้สำหรับปิดงาน setup ก่อนส่งให้ลูกค้า ไม่ต้องเดาว่าร้านไหนติดขั้นตอนไหน
- `/owner/reports` มี validation sign-off:
  - owner กรอกยอดจากรายงาน SML เดิมและชื่อผู้รับรอง
  - ระบบเทียบกับยอด snapshot (`ic_trans.total_amount`) และบอก `ยอดตรง` หรือ `มีส่วนต่าง`
  - ผลการรับรองถูกบันทึกใน `audit_logs` ด้วย `report_validation_signed_off`
- `/owner/reports` รัน manual report ได้ 2 ตัว:
  - `sales_goods_services`
  - `purchase_goods_payables`
  - validation sign-off ยังผูกกับรายงานขายเท่านั้นในรอบนี้
- `/owner/tenants` datasource test ตรวจ branch master `erp_branch_list` เพิ่มจากตารางรายงานหลัก เพื่อให้ชื่อสาขาแสดงเป็นชื่อจริงใน dashboard/LINE viewer
- `/owner/tenants` มีฟอร์มตั้งค่า SML datasource จริง:
  - owner กรอก host/port/database/user/password
  - password ถูกเข้ารหัสด้วย `AI_BCC_SECRET_KEY` ก่อนเก็บใน system store
  - runtime ใช้ encrypted datasource ก่อน fallback ไป `.env.server`
  - audit log ไม่เก็บ password plaintext
- Owner card/table มีปุ่ม `Dashboard` ไปยังลิงก์ร้าน เช่น `/app/demo-shop` หรือ `/app/248-shop`
- `/app` เป็น neutral state:
  - ไม่โชว์ข้อมูลร้านใดอัตโนมัติ
  - บอกให้ใช้ลิงก์ร้านค้าที่ได้รับจากผู้ดูแล
- `/app/:tenantSlug` เป็น Customer Viewer portal:
  - read-only
  - ไม่มี config/admin token/manual mutation
  - derive tenant จาก slug ฝั่ง server เท่านั้น ไม่ใช้ `tenant_id` จาก query/header
  - ใช้ compact executive report layout:
    - ยอดขายสุทธิเป็นตัวเลขหลักใน first viewport
    - KPI รองอยู่ในแถบเดียว: บิลขาย, รายการขาย, จำนวนขายรวม
    - insight `วันนี้ควรรู้อะไร` อยู่คู่กับยอดขายหลัก ไม่แยกเป็น card dump
    - comparison และ data trust ใช้ภาษาธุรกิจ ไม่ใช้ wording แบบ debug
    - เลือกช่วงรายงานเองได้จาก customer viewer ด้วย date filter/quick range โดยจำกัดไม่เกิน 31 วันต่อครั้งใน pilot
    - รายการบิลมี server-side search และ pagination เพื่อค้นหาเลขบิล, ลูกค้า, วันที่ หรือยอดขาย โดยยังเป็น read-only
    - รายการบิลเป็น responsive UX: desktop แสดงเป็น TailAdmin-style table ส่วน mobile แสดงเป็น bill cards ที่แตะง่ายกว่าและไม่เกิด horizontal overflow
    - มี drilldown read-only สำหรับบิลขาย โดยรายการสินค้าในบิลดึงจาก SML แบบ on-demand ใน tenant scope เดิม
    - รายการสินค้าในบิลแสดงเป็น item cards ทุก viewport พร้อมยอดขาย, จำนวน, ราคา, ส่วนลด และ barcode แทนตารางแนวนอน
    - ตารางบิลใช้ endpoint read-only `/api/app/:tenantSlug/reports/sales_goods_services/documents`
    - รายการ detail ใช้ endpoint read-only `/api/app/:tenantSlug/reports/sales_goods_services/document-detail`
    - รายละเอียด source/run id อยู่ใน collapsed section
    - วันที่บน customer viewer ใช้ปี ค.ศ. เพื่อให้ตรงกับ LINE และข้อมูล SML
  - slug ที่ใช้งานจริงตอนนี้:
    - `demo-shop` -> DEMO SHOP
    - `248-shop` -> 248 SHOP
  - tenant `suspended`/`cancelled` ถูก block ด้วยข้อความติดต่อผู้ดูแล
- `/command-center` และ `/command-center/settings` ยังอยู่ชั่วคราวเป็น legacy/admin report surface พร้อม notice ให้ย้ายไป `/owner`
- First viewport เหลือ tenant selector, date range, run action, และ empty/latest state
- Advanced section เก็บ charts, run history, audit, reconciliation, preview และตาราง
- Sidebar ฝั่ง admin เปลี่ยนเป็น SaaS owner navigation:
  - ภาพรวม
  - ร้านค้า
  - รายงาน
  - LINE OA
  - ประวัติระบบ
- แก้ sidebar active state ให้ sync ตาม path ใหม่ เช่น `/owner/tenants`, `/owner/reports`, `/owner/line`, `/owner/audit`
- Legacy `/command-center` และ `/command-center/settings` ไม่อยู่ใน main sidebar แล้ว เพื่อลดความสับสนของ owner portal

### LINE Brief Viewer

- `/command-center/brief` เป็น customer-facing compact report viewer
- ไม่มี admin sidebar/header
- ใช้ signed link ผูกกับ `tenant_id + report_key + run_id + expires_at`
- Signed link TTL default = `72` ชั่วโมง
- ภาษาหน้า viewer เปลี่ยนเป็น business language:
  - `จำนวนรายการขาย`
  - `จำนวนขายรวม`
  - `ข้อมูลจากระบบขาย SML`
  - `สินค้าขายดี`
- มี section `วันนี้ควรรู้อะไร`
- Technical detail เช่น `run_id`, reconciliation, source อยู่ท้ายหน้าแบบ collapsed
- มี CTA เดียว: `ดูรายละเอียดบิล/สินค้า`
- ปุ่ม `ดาวน์โหลด PDF` ใช้ server-side PDF export ไม่ใช้ browser print:
  - กดแล้วเปิด progress modal แบบ stage-based: ตรวจสิทธิ์, เช็ก cache, ตรวจจำนวนเอกสาร/รายการ, ดึงข้อมูล SML, สร้าง PDF, บันทึก cache, พร้อมดาวน์โหลด
  - เมื่อ prepare สำเร็จจะเปิด URL `/pdf` เดิมเพื่อให้ LINE browser ได้ไฟล์ `application/pdf` จริง ไม่ใช่ blob URL
  - ถ้า error จะแสดงข้อความอ่านง่ายและมี fallback link `เปิด PDF โดยตรง`
  - ถ้าเปิด viewer เดิมค้างไว้ก่อน deploy อาจต้อง refresh หรือเปิด LINE link ใหม่เพื่อให้ web bundle ใช้ `sml-row-v5`
- ส่วน `รายละเอียดบิลขาย` ปรับเป็น mobile-first bill list สำหรับคนกดจาก LINE:
  - แตะบิลแล้วเปิด drawer/full-height panel เพื่อดูสินค้าในบิล
  - จัดลำดับข้อมูลแบบผู้บริหาร: สรุปยอดสั้น ๆ → `สินค้าในบิลนี้` → หมายเหตุยอด → `ข้อมูลบิล`
  - ซ่อนค่าแคชเชียร์ที่เป็น system account เช่น `SUPERADMIN` ไม่ให้ดูเหมือนชื่อผู้ขายจริง
  - ย้าย VAT/ส่วนลด/ยอดรวมสินค้าไว้ใน section collapsed `ข้อมูลภาษี/ส่วนลด`
  - แสดงสาขาเป็นชื่อจาก `erp_branch_list.name_1` ถ้ามี เช่น `สำนักงาน`; ถ้าไม่มี mapping จึงแสดง fallback เช่น `สาขาหลัก (0000)`, `ไม่ระบุสาขา`, หรือ `สาขา <code>`
  - Customer dashboard เพิ่ม panel `ความหมายยอดขาย` แยก `ยอดก่อนส่วนลด`, `ส่วนลดรวม`, `ยอดก่อน VAT`, `VAT`, และ `ยอดขายสุทธิ` จาก `financial_breakdown` ใน snapshot โดย fallback จากเอกสารเดิมได้สำหรับ snapshot เก่า
  - ไม่ใช้ตารางดิบแนวนอนในพื้นที่หลักของ brief viewer เพื่อลดความงงบนมือถือ

### LINE OA / Morning Brief

- LINE OA demo ส่งเข้า target ทดสอบได้จริง และ strategy ใหม่คือส่งส่วนตัวให้ผู้บริหารเป็น default
- Live send ใช้ LINE Flex Message เป็น default:
  - ไม่แสดง signed URL ยาวใน body
  - ไม่มีชื่อ `AI Business Center` ซ้ำในข้อความ เพราะ LINE แสดงชื่อ OA อยู่แล้ว
  - มี `altText` สั้นสำหรับ notification/talk list
  - ถ้า signed URL ไม่พร้อมหรือยาวเกิน guard จะ fallback เป็น text message
- Empty-state Flex bubble ใช้ hybrid report card:
  - คงโครงรายงานผู้บริหาร ไม่กลายเป็น checklist/error card
  - แสดงหมวดสาขา/สินค้าแบบ empty summary ที่ compact และไม่ซ้ำคำ
  - ใช้ข้อมูลอ้างอิงแบบนุ่มแทน wording `-100%`
- เมื่อเพิ่ม report ใหม่ Morning Brief ต้องเป็น executive digest รวมเฉพาะ signal สำคัญ ไม่ใช่เอา report ทุกตัวมาต่อกันจนยาว
- Scheduler รันที่ `08:00 Asia/Bangkok`
- Scheduler จำกัด tenant เริ่มต้นเป็น `tenant_demo_remote`
- Morning Brief ใช้ period `yesterday`
  - วันที่ `2026-05-20` จะส่งข้อมูล `2026-05-19`
- Duplicate guard ใช้ key ต่อ target เพื่อรองรับหลายกลุ่ม:

```text
tenant_id + sales_goods_services + morning_brief + date_from + date_to + target_id_hash
```

- LINE message link ชี้ไป report viewer signed URL ไม่ใช่ admin dashboard
- `line_deliveries.message_type` เก็บ `flex` หรือ `text` เพื่อ audit รูปแบบข้อความ
- เพิ่ม `line_targets` สำหรับแยกสิทธิ์ระดับ user/group/room:
  - `executive`
  - `sales_manager`
  - `operations`
  - `staff`
- Scheduler ส่งไปทุก target ที่ `approved=true`, `enabled=true` และผ่าน permission check ของ report นั้น
- Target ใหม่จาก webhook จะถูกบันทึกเป็น pending ไม่ auto-enable
- Env fallback target ถูกปิดเป็นค่า default เพื่อไม่ให้กลุ่มเก่าจาก `.env.server` ถูกสร้างกลับมาทุก restart
- `/owner/line` เป็น flow หลักสำหรับดู masked target, profile, approve/change profile, enable-disable, quota estimate และ test send เฉพาะปลายทาง
- `/command-center/settings` ยังมี LINE Groups & Permissions เป็น legacy/admin fallback ชั่วคราว แต่ไม่ใช่ flow หลักแล้ว
- หน้า web/admin/brief สามารถเรียก API ผ่าน same-origin `/api` ได้ ไม่จำเป็นต้อง expose API tunnel แยกใน browser
- `/owner/line` มี onboarding card บอกขั้นตอนให้ผู้บริหาร add OA, ส่ง `test` ส่วนตัว, รีเฟรช, อนุมัติสิทธิ์ และส่งทดสอบ; group onboarding เป็น optional
- API พยายามดึงชื่อผู้รับ/ชื่อกลุ่มจาก LINE profile/group summary API แล้วบันทึกกลับเป็น `display_name`; ถ้าดึงไม่ได้จะ fallback เป็น masked id
- `line_channels` registry เริ่มรองรับหลาย LINE OA ต่อ tenant ในระดับ metadata แล้ว
- `/owner/line` มีฟอร์มบันทึก LINE channel access token และ channel secret แบบเข้ารหัส:
  - owner สร้าง LINE OA metadata ก่อน แล้วค่อยใส่ token/secret
  - webhook จะพยายาม verify ด้วย channel secret ที่เก็บไว้ และสร้าง pending target ใต้ tenant/LINE OA ที่ match
  - ถ้ายังไม่มี stored secret จะ fallback ไป env webhook secret ชั่วคราวสำหรับ pilot
- Env fallback target ยังปิดเป็นค่า default และไม่ถูกสร้างกลับมาอัตโนมัติ

### Security / Safety

- Mutation endpoints ต้องใช้ header:

```text
x-ai-bcc-admin-token: <server-only-token>
```

- Protected endpoints:
  - `POST /api/reports/:tenantId/sales_goods_services/run`
  - `POST /api/reports/:tenantId/sales_goods_services/morning-brief/run-and-send`
  - `POST /api/reports/:tenantId/sales_goods_services/line-send-test`
  - `POST /api/tenants/:tenantId/datasource/test`
  - `POST /api/line-targets/:id/approve`
  - `PATCH /api/line-targets/:id`
  - `POST /api/line-targets/:id/test-send`
  - `GET /api/owner/tenants`
  - `POST /api/owner/tenants`
  - `PATCH /api/owner/tenants/:tenantId`
  - `GET /api/owner/line-channels`
  - `POST /api/owner/line-channels`
- Customer read-only endpoints:
  - `GET /api/app/:tenantSlug/session`
  - `GET /api/app/:tenantSlug/reports/sales_goods_services/latest`
  - `GET /api/app/:tenantSlug/reports/sales_goods_services/documents`
  - `GET /api/app/:tenantSlug/reports/sales_goods_services/document-detail`
  - `GET /api/reports/:tenantId/:reportKey/pdf/prepare` with signed viewer token
  - `GET /api/reports/:tenantId/:reportKey/pdf` with signed viewer token
- Legacy customer endpoints ที่ไม่มี slug (`/api/app/session`, `/api/app/reports/...`) จะตอบ safe error และไม่ default ไป DEMO SHOP อีกแล้ว
- Owner login ใช้ signed cookie ชื่อ `ai_bcc_owner_session`
- Mutation API เดิมยังใช้ `x-ai-bcc-admin-token` เป็น MVP guard โดยหน้า login จะ bootstrap token ให้หลังเข้าสู่ระบบ
- UI ใช้ TailAdmin-style dialog สำหรับกรอก admin token เฉพาะกรณี sessionStorage ไม่มี token หรือ token ใช้ไม่ได้
- UI ใช้ TailAdmin-style confirmation dialog ก่อนส่ง LINE จริง / ส่ง test จริง
- API log redact `x-ai-bcc-admin-token`
- LINE target API response/audit ใช้ masked/hash id ไม่ expose target id เต็ม
- Secret จริงอยู่ใน `.env.server` บน server เท่านั้น ไม่ commit

## สถานะข้อมูลล่าสุด

Latest snapshot ที่ตรวจบน server:

```text
tenant_id: tenant_demo_remote
run_id: run_tenant_demo_remote_1779211410122
date_from: 2026-05-19
date_to: 2026-05-19
total_sales: 0
document_count: 0
comparison: true
```

การตีความ:

- วันที่ `2026-05-19` ของ tenant demo ไม่มียอดขาย
- Viewer จึงแสดง `ไม่มีข้อมูล`
- Comparison ยังทำงานและพบว่ายอดลดลงจากวันที่อ้างอิง
- นี่เป็น empty state ที่ถูกต้อง ไม่ใช่ระบบล่ม

## Validation ล่าสุด

Local validation หลัง PDF export `sml-row-v5`:

```text
corepack pnpm --filter @ai-bcc/api typecheck          -> pass
corepack pnpm --filter @ai-bcc/api test               -> pass (51 tests)
corepack pnpm --filter @ai-bcc/web typecheck          -> pass
corepack pnpm --filter @ai-bcc/api build              -> pass
corepack pnpm --filter @ai-bcc/web build              -> pass
corepack pnpm --filter @ai-bcc/api test -- report-pdf-export.test.ts -> pass
git diff --check                                      -> pass
```

Server:

```text
GET /health                         -> 200
GET /command-center/brief           -> 200
GET /api/reports/:tenantId/:reportKey/pdf/prepare without signed token
                                    -> 400 safe error: Invalid report viewer link.
Server git commit                    -> 050b2a2
API bundle PDF layout                -> sml-row-v5
Web bundle PDF layout                -> sml-row-v5
GET /api/app/demo-shop/session      -> 200 (DEMO SHOP)
GET /api/app/248-shop/session       -> 200 (248 SHOP)
GET /api/app/unknown-shop/session   -> 404
GET /api/app/session                -> 400 (slug required)
GET /api/app/:tenantSlug/reports/sales_goods_services?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
                                    -> read-only approved report run, max 31 days
POST /run without admin token       -> 401
POST /run with wrong admin token    -> 403
docker compose ps                   -> api/web/worker/system-db running
api health                          -> healthy
system_store                        -> postgres
```

Browser QA:

- PDF visual QA จากไฟล์ลูกค้าจริงก่อน patch พบหน้า 6/7 ว่างเพราะ forced page-start heuristic และข้อความยาว; v5 แก้โดยให้ Chromium จัดหน้าเองมากขึ้นและ keep เฉพาะกลุ่มเล็กที่เตี้ยจริง
- Smoke PDF จำลองข้อมูลชื่อยาว/สินค้า wrap หลายบรรทัด render ได้, header ซ้ำทุกหน้า, total row ไม่ overlap
- `/` redirect ไป `/owner`
- ถ้ายังไม่ login, `/owner` และ `/command-center` redirect ไป `/signin?next=...`
- login ด้วย `superadmin/superadmin` เข้า `/owner` ได้
- logout แล้วกลับไป `/signin`
- `/owner` เห็นร้าน DEMO SHOP และ 248 SHOP ในภาพรวม พร้อมงานที่ต้องทำต่อ
- `/owner/tenants` เห็น tenant operations และไม่มี horizontal overflow
- `/owner/reports` เห็นสถานะ report snapshot ต่อร้าน, เลือกร้าน/ช่วงวันที่, ยืนยันก่อนรัน report และไม่มี horizontal overflow
- `/owner/line` เห็น LINE readiness/onboarding guide, ผู้บริหารรายคน, กลุ่มทีมงาน, target pending, profile permission, quota estimate และ action ส่ง test โดยไม่มี horizontal overflow
- `/owner/audit` เห็น latest run/delivery ต่อร้าน และไม่มี horizontal overflow
- `/app` แสดงข้อความให้ใช้ลิงก์ร้าน ไม่โชว์ Demo อัตโนมัติ
- `/app/demo-shop` แสดงข้อมูล DEMO SHOP แบบ read-only
- `/app/248-shop` แสดงข้อมูล 248 SHOP แบบ read-only
- `/app/:tenantSlug` เลือกช่วงวันที่ได้, search บิลได้, pagination ทำงาน, กดดูรายการสินค้าในบิลตามช่วงวันที่ที่เลือกได้
- `/command-center` โหลดได้ ไม่มี horizontal overflow
- `/command-center/settings` โหลดได้ ไม่มี horizontal overflow
- `/command-center/brief` signed link โหลดได้ ไม่มี horizontal overflow
- หน้า brief ไม่มี token leak ใน body text
- Sidebar active state ทำงานกับ path/hash หลังเปลี่ยนหน้าแล้ว
- User dropdown ชี้ไปเฉพาะ owner/customer/product routes ไม่ชี้ไป TailAdmin sample `/profile`
- Browser logout จาก user dropdown ล้าง session แล้ว redirect ไป `/signin`

## สิ่งที่ยังเป็น MVP ไม่ใช่ Production เต็ม

- Owner auth เป็น signed cookie login แล้ว แต่ยังเป็น single admin user ไม่ใช่ user table/role เต็ม
- ค่า credential เริ่มต้น `superadmin/superadmin` ใช้เฉพาะ owner pilot และไม่แสดงบน UI; production จริงควรย้ายไป user/role table หรือ strong secret ที่หมุนได้
- Mutation API ยังพึ่ง `x-ai-bcc-admin-token` ระหว่างเปลี่ยนผ่านไป session/role เต็ม
- trycloudflare เป็น quick tunnel ชั่วคราว ไม่ใช่ domain/named tunnel
- SML DB credential ยังอยู่ใน env; เพิ่ม secret vault/table foundation แล้ว แต่ยังไม่ migrate credential จริงเข้า encrypted datasource workflow
- Owner portal ทดสอบ datasource ได้แล้ว แต่ยังไม่ได้บันทึก/แก้ host, port, user, password ผ่าน UI แบบ encrypted
- LINE OA token/secret ยังอยู่ใน env หรือ metadata registry; เพิ่ม secret vault/table foundation แล้ว แต่ยังไม่ migrate LINE credential จริงเข้า encrypted channel workflow
- customer-specific LINE OA onboarding ยังไม่เต็ม แต่เริ่มมี `line_channels` registry, pending target discovery และ permission profile แล้ว
- PDF export ยังเป็น synchronous + local Docker volume cache ใน pilot; ถ้ารายงานระดับปีเต็มหรือหลายหมื่นแถวต้องย้ายไป background queue และ object storage
- `/app/:tenantSlug` ยังเป็น pilot link-based viewer ไม่ใช่ login/role จริง
- หลังมี login จริง customer tenant ต้อง derive จาก session/role ไม่ใช่ slug เพียงอย่างเดียว
- `subscriptions` ยังไม่แยก table ใช้ `tenants.status` เป็น gate จริงชั่วคราว
- `tenant_report_configs` ยังไม่เปิดใช้จริง รายงานแรกยังเป็น `sales_goods_services`
- ยังไม่แยกสิทธิ์ราย user ใน LINE group เดียวกัน
- ยังไม่มี backup/restore automation สำหรับ system PostgreSQL
- ยังไม่ได้ทำ CI/CD pipeline
- ยังไม่ได้เพิ่ม report อื่นนอกจาก `sales_goods_services` และ `purchase_goods_payables`

## จุดที่ควรทำต่อพรุ่งนี้

Priority 1:

1. Browser QA `/`, `/owner`, `/owner/line`, `/app`, `/app/demo-shop`, `/app/248-shop`, `/command-center/brief`
2. ทดสอบเปลี่ยน tenant status เป็น `suspended` แล้ว `/app/:tenantSlug` ถูก block และ Morning Brief skip
3. เพิ่ม LINE OA metadata ใน `/owner` แล้วตรวจว่าไม่ leak token/secret
4. ออกแบบ login/session จริงแทน slug-only customer pilot
5. ถ้าลูกค้าจะใช้ช่วงรายงานเกิน 31 วัน ให้แยก summary/top product computation เป็น summary-only query เพิ่มเติม ก่อนขยาย limit ช่วงวันที่ใน customer viewer
6. ทดสอบ PDF จาก LINE viewer อีกครั้งหลัง refresh link เพื่อยืนยันว่า `sml-row-v5` ลดพื้นที่ว่างหน้า 6/7 ในข้อมูลจริง

Priority 2:

1. ทำ login/session จริงสำหรับ owner/customer แทน admin token/slug-only viewer
2. ต่อ owner datasource config ให้บันทึก secret ผ่าน encrypted secret store
3. ต่อ LINE channel token/secret ให้บันทึกผ่าน encrypted secret store สำหรับหลาย LINE OA จริง
4. เพิ่ม `subscriptions` และ `tenant_report_configs` เป็น table/workflow แยก

Priority 3:

1. เตรียม report ถัดไปจาก SML query จริง เช่น AR Overdue, SO Backlog หรือ Inventory Risk
2. ทำ named tunnel/domain แทน trycloudflare quick tunnel
3. ทำ read-only DB user guide สำหรับลูกค้า pilot

## คำสั่ง deploy/update

บนเครื่อง local:

```bash
git push origin main
```

บน server:

```bash
cd /home/bosscatdog/deployments/ai-business-command-center
bash scripts/deploy-server.sh
```

ดูสถานะ:

```bash
docker compose -f infra/docker-compose.yml --env-file .env.server ps
curl http://127.0.0.1:4055/health
```

## Reminder สำหรับ Codex รอบถัดไป

- อ่านไฟล์นี้ก่อนเริ่มงาน
- อย่า print `.env.server`, LINE token, admin token หรือ signed viewer token
- อย่า hardcode credential จริงลง repo
- ถ้าจะส่ง LINE จริง ต้อง confirm กับ user ก่อน
- ถ้าจะทดสอบ mutation endpoint ให้ใช้ token จาก server env โดยไม่ echo ออกมา
- ค่า admin token สำหรับ pilot อาจตั้งให้ง่ายต่อการจำใน server env ได้ แต่ production ต้องเปลี่ยนเป็น secret ที่ strong และหมุนได้
- ถ้าเห็นยอด `0` ของวันที่ `2026-05-19` ให้ถือว่าเป็นข้อมูลจริงของ snapshot ล่าสุด ไม่ใช่ error
