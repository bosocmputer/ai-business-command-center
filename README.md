# AI Business Command Center

Professional pilot สำหรับลูกค้า SML: approved report runner, admin control room, signed LINE report viewer, LINE OA Morning Brief, run history และ audit log

## Current Milestone

- UI: TailAdmin Next.js dashboard ใน `apps/web`
- Viewer: compact signed report viewer ที่ `/command-center/brief`
- API: Fastify report API + signed viewer API + LINE endpoints ใน `apps/api`
- Worker: Morning Brief scheduler ใน `apps/worker`
- Report: `sales_goods_services` ใน `packages/reports`
- Shared schemas: `packages/shared`
- Latest deployed commit: `9b7cb23`

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

ถ้าไม่ได้ใส่ SML credentials ใน `.env.local` ระบบจะแสดง stale sample snapshot เพื่อให้ UX ทำงานได้ก่อน และ manual report run จะตอบ error แบบปลอดภัยโดยไม่ leak secret.

## Persistence

Phase 1 เก็บ `report_runs`, `report_snapshots`, `line_deliveries`, `line_webhook_events`, `worker_heartbeats` และ `audit_logs` ผ่าน system store แล้ว

- Dev default: local JSON ที่ `.data/system-store.json`
- Prod/staging/pilot server: ตั้ง `SYSTEM_DATABASE_URL` เพื่อใช้ PostgreSQL system DB

Local JSON store ถูก ignore จาก git เพื่อไม่ให้ข้อมูลลูกค้าหลุดเข้า repo

## LINE Morning Brief

Phase 1 professional pilot มี preview, manual test sender และ scheduled sender แล้ว
ข้อความที่ส่งจริงใช้ LINE Flex Message เป็น default เพื่อให้ผู้บริหารเห็นสรุปแบบ compact และกดปุ่ม `เปิดรายงาน` แทนการเห็น signed URL ยาวในแชท ส่วน text summary ยังเก็บไว้เป็น fallback/preview/dry-run

```text
GET /api/reports/:tenantId/sales_goods_services/line-preview
GET /api/reports/:tenantId/sales_goods_services/line-deliveries
POST /api/reports/:tenantId/sales_goods_services/line-send-test
POST /api/reports/:tenantId/sales_goods_services/morning-brief/run-and-send
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

## Admin Mutation Auth

Mutation endpoints ต้องมี header:

```text
x-ai-bcc-admin-token: <server-only-token>
```

Protected endpoints:

```text
POST /api/reports/:tenantId/sales_goods_services/run
POST /api/reports/:tenantId/sales_goods_services/line-send-test
POST /api/reports/:tenantId/sales_goods_services/morning-brief/run-and-send
POST /api/tenants/:tenantId/datasource/test
```

UI จะ prompt token และ confirm ก่อนส่ง LINE จริง

Production ควรใช้ tenant-specific env:

```text
LINE_DEMO_CHANNEL_ACCESS_TOKEN=
LINE_DEMO_TARGET_ID=
LINE_OFFICE_CHANNEL_ACCESS_TOKEN=
LINE_OFFICE_TARGET_ID=
```

## LINE Webhook Target Discovery

ใช้ตอน onboarding LINE OA เข้ากลุ่ม เพื่อหา `groupId` สำหรับ Morning Brief:

```text
POST /api/line/webhook
GET  /api/line/webhook-events/latest
```

`POST /api/line/webhook` ตรวจ `x-line-signature` ด้วย `LINE_CHANNEL_SECRET`
ก่อนเก็บ event เสมอ ส่วน latest-events จะคืน masked IDs เป็นค่า default
ถ้าต้อง reveal `groupId` ระหว่าง setup ให้ตั้ง `LINE_WEBHOOK_DEBUG_TOKEN`
บน server แล้วเรียก `?reveal=1` พร้อม header `x-ai-bcc-debug-token`
เฉพาะช่วง setup เท่านั้น
