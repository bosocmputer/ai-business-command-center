# Product Blueprint: AI Business Command Center

## เป้าหมายของเอกสาร

นิยาม product, target customer, subscription model, phase roadmap และขอบเขตที่ชัดเจนสำหรับระบบ **AI Business Command Center** ในฐานะ multi-channel Morning Brief / Business Brief Hub

## Product Vision

สร้างระบบรายเดือนที่ช่วยให้ผู้บริหารเห็นรายงานสำคัญทุกวันจากหลาย business system โดยไม่ต้องเปิดหลายระบบหรือรอคนดึงรายงาน

ระบบเริ่มจาก SML เป็น channel แรก:

- Dashboard จากรายงาน SML PostgreSQL ที่ approved แล้ว
- LINE OA Morning Brief ทุกเช้า
- Report library ที่ใช้ร่วมกันทุกลูกค้า

อนาคตต่อยอดเป็น:

- FlowAccount finance/accounting brief channel แบบอ่านข้อมูล/สรุปข้อมูล ไม่ใช่ sync เอกสารจาก SML
- Channel อื่น เช่น ecommerce, POS, inventory หรือ CRM โดยแยก auth/credential/runner/template ของตัวเอง
- Chatbot ถามข้อมูลจากรายงานที่ approved แล้ว
- AI Business Copilot ที่ช่วยสรุป anomaly, insight, recommendation

## One-Line Pitch

ระบบผู้ช่วยผู้บริหารที่เชื่อม business systems หลายช่องทางแบบปลอดภัย แล้วส่ง Dashboard / LINE Morning Brief ที่ trace ได้ทุกเช้า พร้อมต่อยอดเป็น chatbot ที่ตอบจากรายงานที่ตรวจสอบได้

## Core Positioning

ระบบนี้ไม่ใช่ BI ทั่วไป และไม่ใช่ chatbot ถาม database/API ตรง ๆ แต่เป็น **AI Business Brief Hub**

```text
Business Source Channel
  -> Approved Report/Brief Contract
  -> Metric Snapshot
  -> Dashboard / LINE OA / Future Chatbot
```

Current channel:

```text
sml_reports
  -> SML PostgreSQL read-only approved SQL
  -> sales/purchase snapshots
  -> dashboard / LINE / signed viewer / PDF
```

Planned channel:

```text
flowaccount_finance
  -> FlowAccount OpenAPI read/report access
  -> finance/accounting brief snapshots
  -> LINE / dashboard / future chatbot
```

กติกาสำคัญ: ห้าม assume ว่า FlowAccount ต้องเชื่อมโยงกับ SML. แต่ละ channel เป็น source แยก เว้นแต่ requirement ระบุให้ reconcile/sync โดยตรง

## Target Customer

- ร้าน/บริษัทที่ใช้ SML PostgreSQL, FlowAccount หรือ business system อื่นที่ต้องการ daily executive brief
- บริษัทที่มีเจ้าของหรือผู้จัดการต้องดูยอดขายทุกวัน
- ธุรกิจค้าปลีก/ค้าส่ง/หลายสาขา
- ธุรกิจที่มีรายงานในระบบต้นทางอยู่แล้ว แต่ยังต้องดึงเอง
- ลูกค้าที่ต้องการเริ่มจาก dashboard และ LINE ก่อน ยังไม่พร้อม chatbot เต็มระบบ

## Subscription Model

หลักคิด:

```text
brief/report logic per channel = shared
customer data / credentials / LINE target = separated per tenant
```

### Suggested Packages

#### Starter

- 1 company / 1 database
- Sales dashboard
- LINE Morning Brief 1 target
- Daily scheduled refresh
- Basic report run history

#### Business

- Multiple report modules
- Sales by branch/product/customer
- AR, inventory, SO backlog, FlowAccount finance brief in future
- Multiple LINE targets
- Role/branch permission
- Export report

#### Pro / Enterprise

- LINE/Web chatbot over approved reports
- Custom report mapping
- Private deployment or VPN/Tailscale connection
- SLA/support
- Advanced audit and anomaly alerts

## Value Proposition

สำหรับลูกค้า:

- ได้รายงานทุกเช้าโดยไม่ต้องเปิด SML
- ในอนาคตได้ brief จากหลายระบบ เช่น SML และ FlowAccount โดยไม่ต้องรวมระบบเข้าด้วยกัน
- ลดเวลารอคนสรุปรายงาน
- เห็นยอดขาย/สาขา/สินค้าแบบเร็ว
- เริ่มจากข้อมูลจริงและรายงานที่ตรวจสอบได้

สำหรับ product:

- report/brief contract หนึ่งตัวขายซ้ำได้หลาย tenant ใน channel เดียวกัน
- feedback จากลูกค้าแต่ละรายเพิ่มคุณค่าให้ shared channel knowledge
- ต่อ chatbot ได้โดยไม่เสี่ยงให้ AI เดา SQL/API เอง

## Phase 1 Scope

ทำ:

- Tenant เดียวสำหรับ pilot
- Connect SML PostgreSQL แบบ read-only
- Report แรก: sales by branch/product จาก query ที่เจ้าของระบบส่งให้
- Dashboard หน้าแรก
- LINE OA Morning Brief ทุก 08:00 หรือเวลาที่ config
- Report run history และ error log

ยังไม่ทำ:

- Chatbot
- AI forecast/recommendation
- Write-back เข้า SML
- FlowAccount document creation หรือการ sync เอกสารระหว่าง SML/FlowAccount
- Multi-company complex permission
- Mobile native app
- OpenHuman desktop fork

## Future Scope

- เพิ่ม report library: AR overdue, inventory risk, SO backlog, top products
- เพิ่ม FlowAccount Foundation: OpenID partner connection, encrypted token, test connection, finance brief snapshot
- Multi-tenant subscription admin
- LINE Q&A และ Web Chat
- Role-based chatbot
- AI insight/anomaly detection
- On-prem/local connector option

## Product Loop

```mermaid
flowchart TD
    A[ลูกค้าใช้ Business System] --> B[เชื่อม Channel แบบปลอดภัย]
    B --> C[รัน Approved Brief Contract]
    C --> D[Dashboard + LINE Brief]
    D --> E[ลูกค้า feedback อยากดูเพิ่ม]
    E --> F[เพิ่ม channel/report module กลาง]
    F --> G[ลูกค้าที่เปิด channel นั้นใช้ได้]
    G --> H[shared brief knowledge โตขึ้น]
    H --> I[future chatbot ฉลาดขึ้น]
```

## Explicit Assumptions

- SML channel: ลูกค้า SML ส่วนใหญ่มี schema เหมือนกันหรือใกล้เคียงกันมาก, 1 บริษัทใช้ 1 database เป็น baseline, บางร้านมี `branch_code` บางร้านไม่มี ต้องรองรับทั้งสองแบบ
- FlowAccount channel: เริ่มจาก read/report foundation ผ่าน OpenID Partner Flow และ Sandbox ก่อน ยังไม่สร้างหรือแก้เอกสาร
- แต่ละ channel มี credential, permission, schedule, audit และ failure mode แยก
- Phase 1 deploy บนเครื่องทดสอบก่อน แล้วค่อย harden สำหรับ production
