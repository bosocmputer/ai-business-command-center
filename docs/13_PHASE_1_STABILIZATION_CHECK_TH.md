# Phase 1 Stabilization Check

## เป้าหมาย

ล็อกสถานะระบบหลังจาก dashboard + LINE OA demo ส่งสำเร็จจริง ก่อนเดินต่อไปที่ scheduler 08:00 เพื่อกันปัญหาเดิมเกิดซ้ำทุกเช้า

## สถานะล่าสุด

วันที่ตรวจ: 2026-05-19

ระบบ deploy บนเครื่องทดสอบ:

```text
Web:  http://192.168.2.109:3055/command-center
API:  http://192.168.2.109:4055
LINE webhook demo tunnel: trycloudflare quick tunnel
System store: local-json
```

## Checklist

| Area | Result | Evidence |
| --- | --- | --- |
| API health | Pass | `GET /health` returns ok |
| Web dashboard | Pass | `GET /command-center` returns 200 |
| Tenant config | Pass | both tenants show `datasourceConfigured: true` |
| Demo Remote report | Pass | latest snapshot from `tenant_demo_remote` |
| Office SML1 report | Pass | latest snapshot from `tenant_office_sml1_2026` |
| LINE webhook | Pass | webhook receives signed group message events |
| LINE target discovery | Pass | `groupId` captured and stored masked by default |
| LINE push | Pass | delivery success for both tenants |
| Audit/logging | Pass | report runs, webhook events, and LINE deliveries are stored |
| Secret scan in repo | Pass | no real LINE token or DB password found in committed files |
| Tests | Pass | `corepack pnpm typecheck`, `corepack pnpm test` |

## Verified Tenant Snapshots

### `tenant_demo_remote`

```text
database: demo
run_id: run_tenant_demo_remote_1779185525132
total_sales: 87,106,503.67
document_count: 95,317
line_count: 521,141
quality_status: reconciled_with_warning
```

### `tenant_office_sml1_2026`

```text
database: sml1_2026
run_id: run_tenant_office_sml1_2026_1779182629732
total_sales: 3,120.67
document_count: 13
line_count: 13
quality_status: reconciled_with_warning
```

## Findings Before Scheduler

### P1: Scheduler must prevent duplicate sends

ก่อนส่งอัตโนมัติทุก 08:00 ต้องมี idempotency key เช่น:

```text
tenant_id + report_key + period_date + delivery_type
```

ถ้า key นี้เคย `success` แล้ว ห้ามส่งซ้ำ ยกเว้น manual force send จาก admin

### P1: Mutation endpoints are demo/internal only

ตอนนี้ manual report run และ LINE send endpoint ยังเหมาะกับ demo/internal network:

```text
POST /api/reports/:tenantId/sales_goods_services/run
POST /api/reports/:tenantId/sales_goods_services/line-send-test
```

ก่อน production ต้องเพิ่ม admin auth หรือย้ายให้ worker เรียกภายใน network เท่านั้น

### P1: System store should move to PostgreSQL before paid pilot

`local-json` ใช้ demo ได้ แต่ production/pilot แบบคิดเงินควรใช้ `SYSTEM_DATABASE_URL` เพื่อให้:

- backup ง่าย
- query audit ได้
- concurrent write ปลอดภัยกว่า
- migration ชัดเจน

### P2: LINE target isolation is currently fallback-based

ตอนนี้ใช้ OA กลางและ target กลุ่มเดียวเป็น demo ได้ แต่ production ต้องใช้ tenant-specific config:

```text
LINE_DEMO_CHANNEL_ACCESS_TOKEN
LINE_DEMO_TARGET_ID
LINE_OFFICE_CHANNEL_ACCESS_TOKEN
LINE_OFFICE_TARGET_ID
```

หรือย้ายไป `line_channels` table พร้อม encrypted secrets

### P2: trycloudflare is temporary

Quick tunnel ใช้ทดสอบ webhook ได้ แต่ production ต้องใช้:

- domain จริง + reverse proxy, หรือ
- Cloudflare named tunnel

## Recommended Next Step

ก่อนทำ chatbot หรือ report ใหม่ ให้ทำ Morning Brief scheduler แบบจำกัด scope:

1. ใช้ `tenant_demo_remote` เป็น default pilot tenant
2. schedule `08:00 Asia/Bangkok`
3. period default = เมื่อวาน หรือวันนี้ ต้องเลือกก่อน implement
4. run report -> save snapshot -> render LINE -> send
5. มี duplicate guard ต่อ `tenant_id/report_key/period`
6. บันทึก `report_runs`, `line_deliveries`, `audit_logs`

## Production Blockers

- ยังใช้ DB credential จาก env demo, production ต้องเปลี่ยนเป็น read-only user
- ยังไม่มี dashboard auth
- ยังไม่มี system DB backup
- ยังไม่มี permanent webhook URL
- ยังไม่มี duplicate guard สำหรับ scheduled delivery
