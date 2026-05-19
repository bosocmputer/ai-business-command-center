# Implementation Roadmap

## เป้าหมายของเอกสาร

กำหนดลำดับการ implement ตั้งแต่ MVP แรกจนถึง production/subscription/chatbot โดยให้ implementer เดินงานได้ต่อเนื่อง

## MVP Principle

ทำให้จบ flow นี้ก่อน:

```text
SML PostgreSQL
  -> approved sales report
  -> dashboard
  -> LINE Morning Brief
  -> run history/audit
```

ยังไม่เริ่ม chatbot จนกว่า report contract และ snapshot เชื่อถือได้

## Phase 0: Documentation and Design

Deliverables:

- docs ชุดนี้
- report contract template
- data model draft
- deployment model

Acceptance:

- ทีมเข้าใจว่า report เป็นแกนหลัก
- ไม่มี decision ใหญ่ค้างก่อนเริ่ม coding

## Phase 1: Single-Tenant Pilot

Current status: professional pilot deployed. Historical checklist below remains as implementation reference; latest operational status is in [16_CURRENT_STATUS_2026-05-20_TH.md](./16_CURRENT_STATUS_2026-05-20_TH.md)

### 1. Project Skeleton

สร้าง web-first app:

```text
apps/web
apps/api
apps/worker
packages/shared
docker-compose.yml
```

หรือ monolith แรกได้ แต่ต้องแยก module ชัด:

```text
web
api
worker
db
reports
line
```

### 2. System Database

สร้าง table ขั้นต่ำ:

- `tenants`
- `datasources`
- `report_definitions`
- `tenant_report_configs`
- `report_runs`
- `report_snapshots`
- `line_channels`
- `line_deliveries`
- `audit_logs`

### 3. Seed Demo Tenant

สร้าง tenant pilot:

```text
company_name: Demo SML Customer
timezone: Asia/Bangkok
plan: trial
```

Datasource ใช้ placeholder/env ไม่ hardcode credential จริง

### 4. Report Contract: sales_goods_services

รายงานแรกที่ implement จริงคือ `sales_goods_services` จาก query รายงานขายสินค้าและบริการ แล้ว map เป็น:

- params: `date_from`, `date_to`, optional `branch_code`
- output schema: branch/product/qty/amount
- summary rules
- dashboard widgets
- LINE template

### 5. Report Runner

Implement:

- load report definition
- validate params
- connect datasource
- execute parameterized query
- timeout
- output validation
- save `report_runs`
- create `report_snapshots`

### 6. Dashboard API

Endpoints ขั้นต่ำ:

```text
GET /api/dashboard/summary
GET /api/reports/:report_key/runs
POST /api/reports/:report_key/run
GET /api/reports/:report_key/latest
```

### 7. Dashboard UI

หน้าแรก:

- KPI: ยอดขายรวม, จำนวนขายรวม, last run
- chart ยอดขายตามสาขา
- table สินค้าขาย
- filter date range/branch
- manual refresh
- run status/error

### 8. LINE Morning Brief

Implement:

- message renderer
- LINE adapter
- schedule 08:00
- manual send for test
- delivery log
- retry

### 9. Deploy Test Server

Deploy บนเครื่องทดสอบ:

```text
192.168.2.109
```

ใช้ Docker Compose

Acceptance Phase 1:

- รัน report จาก SML DB ได้
- dashboard แสดงข้อมูลจาก snapshot ได้
- LINE ส่ง morning brief ได้
- ดู run history และ error ได้
- ไม่มี secret จริงใน repo

Current acceptance:

- `sales_goods_services` run จาก SML DB ได้
- dashboard/admin control room ใช้งานได้ที่ `/command-center`
- customer-facing signed viewer ใช้งานได้ที่ `/command-center/brief`
- LINE OA demo ส่งเข้ากลุ่มทดสอบได้
- worker scheduler พร้อมรอบ `08:00 Asia/Bangkok`
- system store ใช้ PostgreSQL
- mutation endpoints มี MVP admin token guard
- latest deployed commit = `9b7cb23`

## Phase 2: Report Library and Multi-Tenant

เพิ่ม:

- tenant admin
- report catalog admin
- enable/disable report ต่อ tenant
- branch mode handling
- subscription status check
- report versioning

Reports ถัดไป:

- `sales_by_product`
- `top_products`
- `sales_daily_trend`
- `sales_by_customer`

Acceptance:

- เพิ่ม tenant ใหม่ได้โดยไม่แก้ code
- เปิด report เดิมให้ tenant ใหม่ได้
- shared report definition ใช้ซ้ำได้

## Phase 3: Production Hardening

เพิ่ม:

- auth/login
- role permission
- encrypted secret management
- backup
- nginx/HTTPS
- alert on failed jobs
- query safety scanner
- staging/prod split

Acceptance:

- ใช้ read-only DB user
- tenant isolation ผ่าน test
- restore backup test ผ่าน
- LINE failure retry/log ผ่าน

## Phase 4: Chatbot over Approved Reports

เพิ่ม:

- LINE webhook inbound
- chat session
- intent router
- report selection
- param extraction
- answer renderer
- source citation

Rules:

- chatbot ไม่ generate SQL เอง
- chatbot ตอบจาก report contract เท่านั้น
- ถ้าไม่มี report รองรับ ให้ตอบว่าไม่มีรายงานรองรับ

Acceptance:

- ถามยอดขายเมื่อวานได้
- ถาม top product ได้
- ถามสาขาขายดีที่สุดได้
- response มีช่วงวันที่และ source

## Phase 5: AI Business Copilot

เพิ่ม:

- anomaly detection
- trend comparison
- recommendation
- AR/inventory/SO modules
- proactive alerts

## Immediate Next Step

พรุ่งนี้ให้เริ่มจาก operational validation ของ Morning Brief:

1. ตรวจ worker รอบ `08:00 Asia/Bangkok`
2. ยืนยัน period = เมื่อวาน เช่น `2026-05-20` ต้องส่ง `2026-05-19`
3. ยืนยัน duplicate guard ไม่ส่งซ้ำ
4. กด link จาก LINE แล้วตรวจ signed viewer ของ `run_id` รอบนั้น
5. บันทึก UX feedback จากผู้ใช้จริง
6. ถ้ารอบนี้ผ่าน ค่อยเพิ่ม report ถัดไปหรือเริ่ม login/role permission
