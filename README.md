# AI Business Command Center

Prod-minded MVP สำหรับลูกค้า SML: approved report runner, multi-tenant dashboard, และเตรียมต่อ LINE OA Morning Brief ใน phase ถัดไป

## Current Milestone

- UI: TailAdmin Next.js dashboard ใน `apps/web`
- API: Fastify report API ใน `apps/api`
- Report: `sales_goods_services` ใน `packages/reports`
- Shared schemas: `packages/shared`

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

Phase 1B เก็บ `report_runs`, `report_snapshots`, และ `audit_logs` ผ่าน system store แล้ว

- Dev default: local JSON ที่ `.data/system-store.json`
- Prod/staging: ตั้ง `SYSTEM_DATABASE_URL` เพื่อใช้ PostgreSQL system DB

Local JSON store ถูก ignore จาก git เพื่อไม่ให้ข้อมูลลูกค้าหลุดเข้า repo

## LINE Morning Brief Preview

Phase 1D มี renderer สำหรับ preview ข้อความ LINE จาก snapshot ล่าสุดแล้ว

```text
GET /api/reports/:tenantId/sales_goods_services/line-preview
```

Preview ใช้ตรวจ wording, source, warning, top products, branch sales และ `run_id`

## LINE Test Sender

Phase 1E มี safe test sender แล้ว

```text
GET  /api/reports/:tenantId/sales_goods_services/line-deliveries
POST /api/reports/:tenantId/sales_goods_services/line-send-test
```

Body:

```json
{ "mode": "dry_run" }
```

หรือ

```json
{ "mode": "send" }
```

ถ้ายังไม่ได้ตั้ง `LINE_*_CHANNEL_ACCESS_TOKEN` และ `LINE_*_TARGET_ID` ระบบจะไม่ส่งออกไป LINE จริง แต่จะบันทึก delivery/audit เป็น `dry_run` หรือ `skipped` เพื่อทดสอบ flow ได้ปลอดภัยก่อน

Production ควรใช้ tenant-specific env:

```text
LINE_DEMO_CHANNEL_ACCESS_TOKEN=
LINE_DEMO_TARGET_ID=
LINE_OFFICE_CHANNEL_ACCESS_TOKEN=
LINE_OFFICE_TARGET_ID=
```
