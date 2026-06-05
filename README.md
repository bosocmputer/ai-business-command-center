# AI Business Command Center

Professional pilot สำหรับ AI Business Brief Hub: เชื่อม data channel หลายแบบเพื่อสร้าง Morning Brief / Business Brief ที่ trace ได้ โดย SML เป็น channel แรก และ FlowAccount จะเป็น finance/accounting brief channel แยก ไม่ใช่ระบบ sync เอกสารจาก SML

## Current Milestone

- UI: TailAdmin Next.js dashboard ใน `apps/web`
- Viewer: compact signed report viewer ที่ `/command-center/brief`
- API: Fastify report API + signed viewer API + LINE endpoints ใน `apps/api`
- Worker: DB-backed notification rule worker ใน `apps/worker`
- Channels: ตอนนี้เปิดใช้ `sml_reports` เป็น channel แรกผ่าน approved SML reports; เตรียม `flowaccount_finance` เป็น channel ถัดไปแบบ read/report ไม่ผูกกับ SML
- Reports: `sales_goods_services` และ `purchase_goods_payables` ใน `packages/reports` พร้อม document detail drilldown แบบ read-only สำหรับ SML channel
- PDF: server-side SML PDF export ด้วย Chromium, signed token, progress modal, cache ใน server volume และ layout `sml-row-v5`
- Shared schemas: `packages/shared`
- Latest deployed commit: `050b2a2` (`Tighten SML PDF pagination`)

อ่านสถานะล่าสุดก่อนเริ่มงานต่อ:

```text
docs/16_CURRENT_STATUS_2026-05-20_TH.md
```

## Quick Start

```bash
corepack pnpm install
cp .env.example .env.local
corepack pnpm dev
```

เปิด dashboard:

```text
http://localhost:3000/command-center
```

API health:

```text
http://localhost:4000/health
```

ถ้าไม่ได้ใส่ SML credentials ใน `.env.local` ระบบจะแสดง stale sample snapshot ของ SML channel เพื่อให้ UX ทำงานได้ก่อน และ manual report run จะตอบ error แบบปลอดภัยโดยไม่ leak secret.

## Multi-Channel Brief Hub Direction

AI-Business ไม่ใช่ตัวกลาง sync SML ไป FlowAccount. บทบาทหลักคือเป็น hub สำหรับสร้าง brief จากหลาย source แยกกัน:

- `sml_reports`: อ่าน SML PostgreSQL แบบ read-only แล้วสร้าง sales/purchase brief, dashboard, signed viewer และ PDF
- `flowaccount_finance`: วางเป็น channel ถัดไปสำหรับ finance/accounting brief จาก FlowAccount OpenAPI
- future channels เช่น `ecommerce` หรือ `pos` ต้องมี credential, runner, schedule, template, permission และ audit แยกของตัวเอง

กติกาเริ่มต้น: อย่า assume ว่า integration ใหม่ต้องเชื่อมกับ SML เว้นแต่ requirement ระบุชัดเจน.

## Persistence

Phase 1 เก็บ `report_runs`, `report_snapshots`, `line_deliveries`, `line_webhook_events`, `worker_heartbeats` และ `audit_logs` ผ่าน system store แล้ว

- Dev default: local JSON ที่ `.data/system-store.json`
- Prod/staging/pilot server: ตั้ง `SYSTEM_DATABASE_URL` เพื่อใช้ PostgreSQL system DB

Local JSON store ถูก ignore จาก git เพื่อไม่ให้ข้อมูลลูกค้าหลุดเข้า repo

## LINE Morning Brief

Phase 1 professional pilot มี preview, manual test sender และ scheduled sender แล้วสำหรับ SML channel
ข้อความที่ส่งจริงใช้ LINE Flex Message เป็น default เพื่อให้ผู้บริหารเห็นสรุปแบบ compact และกดปุ่ม `เปิดรายงาน` แทนการเห็น signed URL ยาวในแชท ส่วน text summary ยังเก็บไว้เป็น fallback/preview/dry-run

```text
GET /api/reports/:tenantId/sales_goods_services/line-preview
GET /api/reports/:tenantId/sales_goods_services/line-deliveries
POST /api/reports/:tenantId/sales_goods_services/line-send-test
POST /api/reports/:tenantId/sales_goods_services/morning-brief/run-and-send
GET /api/reports/:tenantId/purchase_goods_payables/line-preview
```

Customer viewer read-only ใช้ tenant slug และ derive tenant ฝั่ง server:

```text
GET /api/app/:tenantSlug/session
GET /api/app/:tenantSlug/reports/sales_goods_services/latest
GET /api/app/:tenantSlug/reports/sales_goods_services/document-detail?doc_no=...
GET /api/app/:tenantSlug/reports/purchase_goods_payables?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
GET /api/app/:tenantSlug/reports/purchase_goods_payables/document-detail?doc_no=...
```

Morning Brief ใช้:

```text
period = yesterday
timezone = Asia/Bangkok
schedule = 08:00
default tenant = tenant_demo_remote
```

LINE link ที่ส่งให้ผู้ใช้ต้องเป็น signed report viewer URL:

```text
/command-center/brief?tenant_id=...&run_id=...&token=...
```

ข้อกำหนดสำคัญ:

- live send ใช้ `message_type = flex` เมื่อ signed URL เป็น http(s) และไม่ยาวเกิน guard ของ LINE URI action
- ถ้า URL ไม่พร้อมหรือยาวเกิน guard ระบบ fallback เป็น `message_type = text`
- `altText` และ logs/audit ห้ามมี signed token เต็ม
- ห้ามบันทึก signed URL เต็มลง docs หรือ log เพราะมี token

## Owner Mutation Auth

Mutation endpoints ใช้ owner login session cookie `ai_bcc_owner_session` จาก `/signin` และไม่ใช้ header secret แยกแล้ว

```text
Cookie: ai_bcc_owner_session=<signed-owner-session>
```

Protected endpoints:

```text
POST /api/reports/:tenantId/sales_goods_services/run
POST /api/reports/:tenantId/purchase_goods_payables/run
POST /api/reports/:tenantId/sales_goods_services/line-send-test
POST /api/reports/:tenantId/sales_goods_services/morning-brief/run-and-send
POST /api/tenants/:tenantId/datasource/test
```

UI จะตรวจ session ผู้ดูแลและ confirm ก่อนส่ง LINE จริง

Production runtime config ไม่ควรใส่ใน env แล้ว ให้ตั้งผ่าน Owner UI:

```text
SML JavaWS ต่อร้าน: /owner/sml-connections
LINE OA และผู้รับ: /owner/line
แผนแจ้งเตือน: /owner/notifications
App URL, report signing, worker token: /owner/settings
```

## LINE Webhook Target Discovery

ใช้ตอน onboarding LINE OA เพื่อค้นพบผู้รับ LINE จาก webhook:

```text
POST /api/line/webhook
GET  /api/line/webhook-events/latest
```

`POST /api/line/webhook` ตรวจ `x-line-signature` ด้วย channel secret ที่บันทึกใน encrypted store ของ LINE OA เท่านั้น. latest-events คืน masked IDs เป็นค่า default และไม่ใช้ debug token จาก env.
เฉพาะช่วง setup เท่านั้น
