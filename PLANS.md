# AI Business Command Center: Implementation Plans

เอกสารนี้คือแผนลงมือทำหลักของโปรเจกต์ หลังจาก clean workspace แล้ว เหลือ `docs/` เป็น source of truth เดียว

สถานะ operational ล่าสุดให้เริ่มอ่านจาก:

```text
docs/16_CURRENT_STATUS_2026-05-20_TH.md
```

## Current State

Workspace ตอนนี้มี Phase 1 SaaS pilot ที่แยก Owner Admin กับ Customer Viewer ชัดเจนแล้ว

สิ่งที่มี:

- `docs/` ชุด blueprint และ engineering playbook
- `.codex/skills/ai-business-command-center/SKILL.md` project skill สำหรับให้ AI ยึด workflow เดิม
- `apps/web` TailAdmin Next.js admin dashboard + compact signed LINE report viewer
- `apps/api` Fastify report runner + LINE endpoints + signed viewer API + admin mutation auth
- `apps/worker` Morning Brief scheduler สำหรับ `08:00 Asia/Bangkok`
- `packages/shared` shared types/Zod schemas
- `packages/reports` report contract/renderer สำหรับ `sales_goods_services`
- Docker Compose deploy บน `192.168.2.109`
- LINE OA demo flow ส่งเข้ากลุ่มทดสอบได้จริง
- LINE Morning Brief ส่งแบบ Flex Message พร้อมปุ่ม `เปิดรายงาน` เป็น default และมี text fallback
- System PostgreSQL store สำหรับ report runs/snapshots/audit/line deliveries
- LINE target registry + group-level permission profiles สำหรับหลายกลุ่ม LINE
- `/signin` Owner login สำหรับ admin surface ค่าเริ่มต้น pilot คือ `superadmin/superadmin`
- `/owner` Owner Admin portal สำหรับคุณ/ทีม โดยแยก section เป็นภาพรวม, ร้านค้า, รายงาน, LINE OA, ประวัติระบบ
- `/owner` มี Pilot rollout board แสดง readiness ต่อร้าน, progress, next action และลิงก์ไปหน้าที่ต้องทำต่อ
- `/owner/tenants` ใช้เพิ่มร้าน, คุม subscription status, ดู datasource และเปิดลิงก์ Dashboard ลูกค้า
- `/owner/reports` ใช้ติดตาม report snapshot ล่าสุดต่อร้าน และรันรายงานขายสินค้าและบริการแบบ manual จาก Owner Portal โดยตรง
- `/owner/line` ใช้ดู LINE OA readiness, onboarding guide, อนุมัติ/เปลี่ยนสิทธิ์กลุ่ม LINE และส่ง test เฉพาะกลุ่ม
- `/owner/audit` ใช้ดู latest report run และ latest LINE delivery ต่อ tenant
- `/app` เป็น neutral state ไม่โชว์ร้านใดอัตโนมัติ
- `/app/demo-shop` Customer Viewer read-only ของ DEMO SHOP
- `/app/248-shop` Customer Viewer read-only ของ 248 SHOP
- `/app/:tenantSlug` ใช้ compact executive report layout แล้ว: ยอดขายหลัก, KPI, insight, comparison, trust note, branch/product ranking และรายละเอียดแหล่งข้อมูลแบบ collapsed
- `/app/:tenantSlug` มี drilldown read-only สำหรับบิลขาย โดยตารางบิลมาจาก snapshot และรายการสินค้าในบิลดึงจาก SML แบบ on-demand ด้วย approved SQL เพื่อให้หน้า customer โหลดเร็วแม้ช่วงรายงานใหญ่
- API ฝั่ง customer ใช้ `/api/app/:tenantSlug/*` และ derive tenant จาก slug ฝั่ง server เท่านั้น
- tenant status gate: `trial`, `active`, `past_due`, `suspended`, `cancelled`
- suspended/cancelled tenant ถูก block จาก customer viewer และ scheduler/Morning Brief send
- Signed report viewer link TTL default `72` ชั่วโมง
- Duplicate guard สำหรับ Morning Brief delivery ต่อ target
- Signed owner session cookie สำหรับ route protection
- Lightweight admin token guard สำหรับ mutation endpoints ระหว่าง MVP transition
- `/owner` มี pilot readiness checklist ต่อร้าน และคู่มือ LINE OA onboarding สำหรับให้ลูกค้าดึง OA เข้ากลุ่มแล้วพิมพ์ `test`
- Secret vault foundation สำหรับเข้ารหัส datasource/LINE secrets ด้วย AES-256-GCM และ system store `secrets` metadata โดยยังไม่เปิดช่องกรอก secret ดิบใน UI
- Phase 1 stabilization checkpoint ที่ `docs/13_PHASE_1_STABILIZATION_CHECK_TH.md`

สิ่งที่ไม่มีแล้ว:

- OpenHuman repo
- proposal เก่า
- Python generator scripts
- dependency/cache/build artifacts

Current deployed endpoints:

```text
Web Owner LAN: http://192.168.2.109:3055/owner
Web Customer DEMO SHOP LAN: http://192.168.2.109:3055/app/demo-shop
Web Customer 248 SHOP LAN: http://192.168.2.109:3055/app/248-shop
API LAN: http://192.168.2.109:4055
Public web tunnel: https://relationship-code-others-challenging.trycloudflare.com
Public API tunnel: https://bibliography-numbers-lite-motion.trycloudflare.com
Latest deployed code commit: ดู `git rev-parse --short HEAD` บน server หลัง deploy
```

ห้ามบันทึก signed viewer URL เต็มลงเอกสาร เพราะ URL มี `token=...`

## Product Direction

สร้าง **AI Business Command Center for SML** เป็น subscription/hybrid SaaS:

- 1 บริษัท = 1 SML PostgreSQL database
- shared report knowledge ใช้ร่วมกันทุก tenant
- customer data, DB credential, report results, LINE targets แยกด้วย `tenant_id`
- Phase 1 ทำ dashboard + LINE Morning Brief จาก approved SQL
- Future chatbot ตอบจาก approved reports ไม่ใช่ SQL generator อิสระ

## Non-Negotiable Engineering Rules

- ห้าม hardcode credential จริงลง repo
- production ห้ามใช้ DB superuser เช่น `postgres`
- ทุก report ต้องมาจาก `report_contract`
- SQL ต้อง approved และ parameterized
- ทุก customer data ต้องมี `tenant_id`
- ทุก report run และ LINE delivery ต้อง trace/audit ได้
- chatbot ในอนาคตต้อง route ไปหา report ที่ approved แล้ว
- งานสำคัญต้องใช้ engineering playbook ใน `docs/12_ENGINEERING_PLAYBOOK_TH.md`

## Phase 0: Lock Report Contract From First Query

Trigger: ผู้ใช้ส่ง SQL query รายงานแรก "รายงานขายสินค้าและบริการ"

Tasks:

1. อ่าน SQL และตัวอย่าง output 5-10 rows
2. ระบุ params ที่ query ต้องใช้ เช่น `date_from`, `date_to`
3. ระบุ output columns และ type
4. สร้าง report contract สำหรับ `sales_goods_services`
5. นิยาม summary rules สำหรับ dashboard/LINE จาก header truth และ detail analytics
6. นิยาม edge cases:
   - ไม่มี `branch_code` โดย fallback `detail.branch_code -> header.branch_code -> no_branch`
   - หัวบิลต้องผ่าน filter SML sales report: `trans_flag in (44)`, `last_status = 0`, `(coalesce(doc_ref,'') = '' or is_pos = 0)`, `is_doc_copy <> 1`
   - detail ต้อง join ผ่านหัวบิลที่ผ่าน filter แล้วด้วย `doc_no + doc_date + trans_flag`
   - ไม่มีข้อมูลในช่วงวันที่
   - ยอดติดลบจาก return/credit note
   - date/timezone ไม่ตรง SML report เดิม

Deliverable:

- `docs/reports/sales_goods_services.md` หรือไฟล์ contract เทียบเท่า

Acceptance:

- contract บอกได้ว่า query รับอะไร คืนอะไร สรุปอย่างไร และใช้กับ LINE/dashboard อย่างไร

## Phase 1: Project Skeleton

Goal: สร้างระบบ web-first MVP ที่ deploy ได้บนเครื่องทดสอบ

Recommended structure:

```text
apps/
  web/
  api/
  worker/
packages/
  shared/
  reports/
infra/
  docker-compose.yml
docs/
```

Alternative acceptable for speed:

```text
src/
  web/
  api/
  worker/
  db/
  reports/
  line/
```

Default decision: ใช้ monorepo style `apps/` + `packages/` ถ้าไม่ติดข้อจำกัด toolchain

Tech stack:

- Next.js + React + Tailwind for dashboard
- Node.js + TypeScript + Fastify for API
- PostgreSQL for system DB
- Drizzle ORM for schema/migrations
- Node worker + cron first, BullMQ/Redis when queue complexity appears
- node-postgres for SML PostgreSQL
- Docker Compose for test deployment

Acceptance:

- app boot ได้ local
- system DB migration/seed ได้
- health endpoint พร้อม

## Phase 2: SaaS Tenant Foundation

Current implementation เพิ่ม SaaS pilot primitives แล้ว:

- `tenants`
- `users`
- `report_definitions`
- `report_runs`
- `report_snapshots`
- `line_channels`
- `line_targets`
- `line_deliveries`
- `audit_logs`

Minimum behavior:

- seed demo tenant และ office tenant โดยไม่ overwrite status ที่ owner เปลี่ยนใน system store
- owner เพิ่ม tenant ใหม่ได้จาก `/owner`
- owner เปลี่ยน subscription status ได้
- `/app` ไม่ default ไป tenant ใด ต้องใช้ลิงก์ร้านที่ owner ส่งให้
- customer viewer อ่านรายงานอย่างเดียวที่ `/app/:tenantSlug`
- suspended/cancelled tenant ถูก block จาก customer viewer และ LINE scheduler
- LINE OA หลายตัวต่อ tenant มี registry metadata แล้ว
- seed `sales_goods_services` definition after contract ready
- datasource secret ยังเป็น env/deployment-level สำหรับ pilot; รอบนี้มี encrypted secret store foundation แล้ว แต่ owner datasource config UI ยังไม่บันทึก password/token จริง
- every customer-facing table has `tenant_id`

Acceptance:

- can create tenant
- can block tenant by subscription status
- customer cannot access admin/config controls from `/app/:tenantSlug`
- can register multiple LINE OA metadata per tenant
- can see per-tenant pilot readiness checklist in owner portal
- can enable report per tenant (next increment: `tenant_report_configs`)

## Phase 3: Report Runner MVP

Implement:

- load report definition
- validate params with Zod
- render approved SQL with parameter binding
- connect to SML PostgreSQL
- execute with timeout
- validate output schema
- save `report_runs`
- derive `report_snapshots`
- write audit log

Failure handling:

- connection failed
- query timeout
- invalid params
- invalid output schema
- empty result

Acceptance:

- manual run creates `report_run`
- success run creates latest snapshot
- failed run preserves error state
- no SQL mutation statements allowed

## Phase 4: Dashboard MVP

Implement dashboard page:

- date range filter
- optional branch filter
- KPI cards:
  - total net sales
  - total quantity
  - last run time
  - data quality status
- chart sales by branch when branch data exists
- top products table
- raw report table or summarized detail table
- manual refresh button
- run history/error panel

API endpoints:

```text
GET /api/dashboard/summary
GET /api/reports/:report_key/latest
GET /api/reports/:report_key/runs
POST /api/reports/:report_key/run
```

Acceptance:

- dashboard reads snapshots, not SML DB directly
- empty data shows useful empty state
- failed report shows failure state and last successful snapshot if available

## Phase 5: LINE Morning Brief MVP

Implement:

- message renderer from `summary_json`
- LINE adapter
- manual send endpoint or command for testing
- scheduled send at tenant-configured time, default `08:00 Asia/Bangkok`
- `line_deliveries` log
- retry policy

Message must include:

- report period
- total sales
- total quantity
- branch summary if branch exists
- top products
- last run timestamp
- dashboard link when available

Acceptance:

- can send test LINE brief
- scheduled send does not duplicate for same tenant/report/period
- provider failure is logged and retryable

Current status:

- implemented for `tenant_demo_remote`
- schedule = `08:00 Asia/Bangkok`
- period = `yesterday`
- วันที่ `2026-05-20` ใช้ข้อมูล `2026-05-19`
- LINE link ชี้ signed report viewer `/command-center/brief`
- UI confirm ก่อนส่ง LINE จริง
- mutation endpoints ต้องมี `x-ai-bcc-admin-token`
- scheduler ส่ง Morning Brief เฉพาะ `line_targets` ที่ผ่าน permission check; env fallback target ปิดเป็นค่า default

## Phase 6: Deploy Test Server

Target:

```text
192.168.2.109
```

Deploy with Docker Compose:

- web
- api
- worker
- postgres
- redis optional

Acceptance:

- dashboard accessible on LAN
- API connects to system DB
- worker can run report
- LINE manual send works

Current status:

- deployed with Docker Compose
- services running: `web`, `api`, `worker`, `system-db`
- API health ok
- system store = PostgreSQL
- latest snapshot `tenant_demo_remote` date `2026-05-19` has total_sales `0`, document_count `0`, comparison enabled

## Phase 7: Production Hardening

Add before real paid customer:

- auth/login
- customer-specific LINE channel onboarding และ role/permission UI เต็ม
- read-only SML DB user guide
- secret encryption key management
- tenant isolation tests
- backup/restore test
- HTTPS/nginx
- error alerting
- report validation against SML reference output
- staging/prod env separation

Acceptance:

- no plaintext secrets
- tenant isolation tested
- production checklist in `docs/08_SECURITY_AND_PRODUCTION_TH.md` passes

## Phase 8: Multi-Report and Subscription

Add:

- report catalog admin
- enable/disable report per plan
- subscription status check
- report versioning
- reports:
  - `sales_by_product`
  - `top_products`
  - `sales_daily_trend`
  - `sales_by_customer`

Acceptance:

- adding a report does not require dashboard rewrite
- tenant can enable shared report definitions

## Phase 9: Future Chatbot

Only start after report platform is stable

Rules:

- chatbot is report router
- no arbitrary SQL generation
- answer must include date period and source
- unsupported questions must say no approved report exists

Flow:

```text
LINE/Web question
  -> tenant/user resolution
  -> permission check
  -> intent routing
  -> approved report selection
  -> params extraction
  -> run/read report
  -> summarize answer
  -> cite report_run_id
```

## Immediate Next Action

พรุ่งนี้เริ่มจากการ observe Morning Brief รอบจริง:

1. ตรวจว่า worker ส่ง `tenant_demo_remote` ตอน `08:00 Asia/Bangkok`
2. ตรวจ duplicate guard ว่าไม่ส่งซ้ำรอบเดียวกัน
3. กด link จาก LINE แล้ว confirm ว่าเปิด `/command-center/brief` ของ `run_id` รอบนั้น
4. เก็บ UX feedback ของผู้บริหารจาก brief viewer
5. ถ้ารอบ 08:00 ผ่าน ค่อยเลือกงานถัดไป:
   - polish empty state/brief viewer
   - เพิ่ม report ถัดไปจาก SML query จริง
   - วาง lightweight login/role แทน shared admin token

ก่อนเริ่มงานให้เปิด [docs/16_CURRENT_STATUS_2026-05-20_TH.md](./docs/16_CURRENT_STATUS_2026-05-20_TH.md)
