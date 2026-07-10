# Phase 1 Stabilization Check

## เป้าหมาย

ล็อกสถานะระบบหลังจาก dashboard + LINE OA demo + scheduler + signed report viewer deploy สำเร็จจริง เพื่อกันปัญหาเดิมเกิดซ้ำทุกเช้าและใช้เป็น checkpoint ก่อนเพิ่ม report ใหม่

## สถานะล่าสุด

วันที่ตรวจล่าสุด: 2026-05-20

ระบบ deploy บนเครื่องทดสอบ:

```text
Web LAN: http://192.168.2.109:3055/command-center
API LAN: http://192.168.2.109:4055
Public web tunnel: https://relationship-code-others-challenging.trycloudflare.com
Public API tunnel: https://bibliography-numbers-lite-motion.trycloudflare.com
LINE webhook demo tunnel: trycloudflare quick tunnel
System store: PostgreSQL
Latest deployed commit: 9b7cb23
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
| System DB migration | Pass | `SYSTEM_DATABASE_URL` ใช้ PostgreSQL system store |
| Scheduler | Pass | worker running, heartbeat ok, configured `08:00 Asia/Bangkok` |
| Duplicate guard | Pass | delivery key per tenant/report/type/date |
| Signed report viewer | Pass | `/command-center/brief` claims v2 token in fragment, then authorizes with viewer session by tenant/report |
| Mutation auth | Pass | no token = `401`, wrong token = `403`, valid token = `200` |
| Browser QA | Pass | admin/settings/brief load without horizontal overflow |

## Verified Tenant Snapshots

### `tenant_demo_remote` historical full-year run

```text
database: demo
run_id: run_tenant_demo_remote_1779185525132
total_sales: 87,106,503.67
document_count: 95,317
line_count: 521,141
quality_status: reconciled_with_warning
```

### `tenant_demo_remote` latest professional pilot run

```text
database: demo
run_id: run_tenant_demo_remote_1779211410122
date_from: 2026-05-19
date_to: 2026-05-19
total_sales: 0
document_count: 0
comparison: true
quality_status: valid
```

Interpretation:

- วันที่ `2026-05-19` ใน tenant demo ไม่มียอดขาย
- brief viewer แสดง empty state เป็น business message
- comparison ยังทำงานโดยเทียบกับ `2026-05-18` และ `2026-05-12`

### `tenant_office_sml1_2026`

```text
database: sml1_2026
run_id: run_tenant_office_sml1_2026_1779182629732
total_sales: 3,120.67
document_count: 13
line_count: 13
quality_status: reconciled_with_warning
```

## Findings After Professional Pilot Deploy

### Done: Scheduler prevents duplicate sends

ก่อนส่งอัตโนมัติทุก 08:00 ระบบใช้ idempotency key:

```text
tenant_id + report_key + period_date + delivery_type
```

ถ้า key นี้เคย `success` แล้ว ห้ามส่งซ้ำ ยกเว้น manual force send จาก admin

### Done for MVP: Mutation endpoints protected by owner session

Mutation endpoints ต้องใช้:

```text
ai_bcc_owner_session cookie
```

Protected endpoints:

- `POST /api/reports/:tenantId/sales_goods_services/run`
- `POST /api/reports/:tenantId/sales_goods_services/morning-brief/run-and-send`
- `POST /api/reports/:tenantId/sales_goods_services/line-send-test`
- `POST /api/tenants/:tenantId/datasource/test`

ยังเป็น MVP auth ไม่ใช่ production login/role permission

### Done: System store moved to PostgreSQL

`SYSTEM_DATABASE_URL` ใช้ PostgreSQL system DB บน Docker Compose แล้ว

### Updated: LINE target isolation uses registry targets

ตอนนี้ target กลุ่ม LINE ต้องมาจาก webhook/registry และผ่าน admin approval ก่อนรับข้อมูลธุรกิจ ค่า env ใช้เก็บ channel token ได้ แต่ไม่ควรใช้ `*_TARGET_ID` เป็น target หลักอีกแล้ว:

```text
LINE_DEMO_CHANNEL_ACCESS_TOKEN
LINE_OFFICE_CHANNEL_ACCESS_TOKEN
```

หรือย้ายไป `line_channels` table พร้อม encrypted secrets

### P2: trycloudflare is temporary

Quick tunnel ใช้ทดสอบ webhook ได้ แต่ production ต้องใช้:

- domain จริง + reverse proxy, หรือ
- Cloudflare named tunnel

## Recommended Next Step

ก่อนทำ chatbot หรือ report ใหม่ ให้ observe รอบเช้า `08:00 Asia/Bangkok`:

1. ใช้ `tenant_demo_remote` เป็น default pilot tenant
2. period default = `yesterday`
3. run report -> save snapshot -> render LINE -> send
4. ตรวจว่า LINE link เปิด signed brief viewer ของ run นั้นจริง
5. ตรวจ duplicate guard ต่อ `tenant_id/report_key/period`
6. บันทึกผลใน `report_runs`, `line_deliveries`, `audit_logs`

## Production Blockers

- ยังใช้ DB credential จาก env demo, production ต้องเปลี่ยนเป็น read-only user
- ยังไม่มี login/role permission เต็ม ใช้ single owner admin session แบบ pilot
- ยังไม่มี system DB backup/restore automation
- ยังไม่มี permanent webhook URL/domain
- ยังไม่มี tenant-specific LINE OA onboarding flow
