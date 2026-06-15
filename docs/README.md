# AI Business Command Center Docs

เอกสารชุดนี้คือ living specification สำหรับสร้างระบบ **AI Business Command Center** แบบ multi-channel Business Brief Hub โดยใช้แนวคิด shared channel knowledge + separated tenant data. SML เป็น channel แรกและเชื่อมร้านผ่าน JavaWS-only ส่วน FlowAccount เป็น planned finance/accounting channel แยก ไม่ใช่ระบบ sync จาก SML

เอกสารเดิมใน `proposal_output/` ถือเป็น proposal archive ส่วนเอกสารใน `docs/` คือชุดที่ใช้เดินงานจริง

## อ่านจากไฟล์ไหนก่อน

1. [16_CURRENT_STATUS_2026-05-20_TH.md](./16_CURRENT_STATUS_2026-05-20_TH.md) - สถานะล่าสุดหลัง deploy professional pilot
2. [17_PRODUCTIZED_PILOT_PLAN_TH.md](./17_PRODUCTIZED_PILOT_PLAN_TH.md) - แผนพา pilot ไปเป็น product ที่ขายได้จริง
3. [18_7_DAY_PRODUCTION_PROOF_LOG_TH.md](./18_7_DAY_PRODUCTION_PROOF_LOG_TH.md) - template เก็บ proof รายวันจาก production
4. [19_PILOT_SALES_DEMO_KIT_TH.md](./19_PILOT_SALES_DEMO_KIT_TH.md) - sales/demo kit สำหรับคุยลูกค้า pilot
5. [20_OWNER_COCKPIT_SIMPLIFICATION_PLAN_TH.md](./20_OWNER_COCKPIT_SIMPLIFICATION_PLAN_TH.md) - แผนปรับ `/owner` ให้เป็น operations cockpit
6. [01_PRODUCT_BLUEPRINT_TH.md](./01_PRODUCT_BLUEPRINT_TH.md) - ภาพรวมสินค้า, ลูกค้าเป้าหมาย, subscription model
7. [03_DATA_FLOW_TH.md](./03_DATA_FLOW_TH.md) - flow ข้อมูลตั้งแต่ integration channel ถึง Dashboard และ LINE OA
8. [05_REPORT_CONTRACT_TH.md](./05_REPORT_CONTRACT_TH.md) - มาตรฐานของ report/brief หนึ่งตัว ซึ่งเป็นแกนหลักของแต่ละ channel
9. [reports/sales_goods_services.md](./reports/sales_goods_services.md) - contract รายงานขายสินค้าและบริการ
10. [reports/purchase_goods_payables.md](./reports/purchase_goods_payables.md) - contract รายงานซื้อสินค้า/ตั้งหนี้
11. [09_TECH_STACK_AND_DEPLOYMENT_TH.md](./09_TECH_STACK_AND_DEPLOYMENT_TH.md) - stack และ deployment ที่เครื่องทดสอบ
12. [11_IMPLEMENTATION_ROADMAP_TH.md](./11_IMPLEMENTATION_ROADMAP_TH.md) - ลำดับ implementation

## เอกสารทั้งหมด

| ไฟล์ | หน้าที่ |
| --- | --- |
| [01_PRODUCT_BLUEPRINT_TH.md](./01_PRODUCT_BLUEPRINT_TH.md) | Product vision, package, roadmap, value proposition |
| [02_SYSTEM_ARCHITECTURE_TH.md](./02_SYSTEM_ARCHITECTURE_TH.md) | Architecture production-grade ของระบบ |
| [03_DATA_FLOW_TH.md](./03_DATA_FLOW_TH.md) | Full loop data flow และ feedback loop |
| [04_DATA_MODEL_TH.md](./04_DATA_MODEL_TH.md) | ตารางกลางของ subscription/report/channel platform |
| [05_REPORT_CONTRACT_TH.md](./05_REPORT_CONTRACT_TH.md) | มาตรฐาน report, SQL, params, output, validation |
| [06_SML_KNOWLEDGE_MODEL_TH.md](./06_SML_KNOWLEDGE_MODEL_TH.md) | Shared SML knowledge, business objects, chatbot intent |
| [07_LINE_OA_MORNING_BRIEF_TH.md](./07_LINE_OA_MORNING_BRIEF_TH.md) | LINE OA strategy, schedule, retry, template |
| [08_SECURITY_AND_PRODUCTION_TH.md](./08_SECURITY_AND_PRODUCTION_TH.md) | Security, prod checklist, tenant isolation |
| [09_TECH_STACK_AND_DEPLOYMENT_TH.md](./09_TECH_STACK_AND_DEPLOYMENT_TH.md) | Stack, Docker Compose, deployment target |
| [10_INSPIRATION_OPENHUMAN_OPENCLAW_HERMES_TH.md](./10_INSPIRATION_OPENHUMAN_OPENCLAW_HERMES_TH.md) | แนวคิดที่หยิบจาก OpenHuman/OpenClaw/Hermes |
| [11_IMPLEMENTATION_ROADMAP_TH.md](./11_IMPLEMENTATION_ROADMAP_TH.md) | MVP roadmap และ acceptance criteria |
| [12_ENGINEERING_PLAYBOOK_TH.md](./12_ENGINEERING_PLAYBOOK_TH.md) | Senior engineering prompts/playbook สำหรับ review, refactor, debug, ADR, test, migration |
| [13_PHASE_1_STABILIZATION_CHECK_TH.md](./13_PHASE_1_STABILIZATION_CHECK_TH.md) | Checkpoint หลัง dashboard + LINE + scheduler + signed viewer |
| [14_SYSTEM_DB_MIGRATION_TH.md](./14_SYSTEM_DB_MIGRATION_TH.md) | ขั้นตอนย้าย persistence จาก local JSON ไป PostgreSQL system DB |
| [15_UX_UI_AUDIT_TH.md](./15_UX_UI_AUDIT_TH.md) | UX/UI audit และ TailAdmin alignment checklist |
| [16_CURRENT_STATUS_2026-05-20_TH.md](./16_CURRENT_STATUS_2026-05-20_TH.md) | สถานะล่าสุด, deploy, validation, next steps สำหรับเริ่มงานวันถัดไป |
| [17_PRODUCTIZED_PILOT_PLAN_TH.md](./17_PRODUCTIZED_PILOT_PLAN_TH.md) | แผน sellable pilot, positioning, 7-day proof gate, packaging และ sprint ถัดไป |
| [18_7_DAY_PRODUCTION_PROOF_LOG_TH.md](./18_7_DAY_PRODUCTION_PROOF_LOG_TH.md) | template สำหรับเก็บ proof รายวันจาก production DB และสรุป readiness สำหรับขาย |
| [19_PILOT_SALES_DEMO_KIT_TH.md](./19_PILOT_SALES_DEMO_KIT_TH.md) | sales/demo kit, discovery questions, demo script, one-page copy และ objection handling |
| [20_OWNER_COCKPIT_SIMPLIFICATION_PLAN_TH.md](./20_OWNER_COCKPIT_SIMPLIFICATION_PLAN_TH.md) | แผนปรับ Owner overview เป็น operations cockpit ที่ตอบ next action ชัด |
| [admin-runbook-store-setup-th.md](./admin-runbook-store-setup-th.md) | คู่มือ Owner เพิ่มร้าน เชื่อม SML JavaWS ตั้ง LINE และแผนแจ้งเตือน |
| [adr/0001-db-backed-notification-rule-scheduler.md](./adr/0001-db-backed-notification-rule-scheduler.md) | ADR scheduler จาก DB-backed notification rules |
| [adr/0002-sml-javaws-only-tenant-datasource.md](./adr/0002-sml-javaws-only-tenant-datasource.md) | ADR SML datasource ของร้านใช้ JavaWS-only |
| [reports/sales_goods_services.md](./reports/sales_goods_services.md) | Report contract แรก: รายงานขายสินค้าและบริการ |
| [reports/purchase_goods_payables.md](./reports/purchase_goods_payables.md) | Report contract ที่ 2: รายงานซื้อสินค้า/ตั้งหนี้ |

## Product Direction

ระบบนี้ไม่ใช่ chatbot ที่ยิง SQL/API เอง แต่เป็น **AI Business Brief Hub**

หลักการสำคัญ:

- 1 tenant เปิดได้หลาย channel เช่น `sml_reports`, `flowaccount_finance`, future `ecommerce`, future `pos`
- SML เป็น channel แรก ไม่ใช่แกนถาวรของทุก integration และ datasource ของร้านใช้ JavaWS-only
- FlowAccount เป็น finance/accounting brief channel แยก ไม่ใช่ SML document sync target
- ข้อมูลจริง, credential, report/brief result, LINE target แยกด้วย `tenant_id`
- report/brief ทุกตัวต้องเป็น approved contract ของ channel นั้น
- dashboard, LINE OA, future chatbot อ่านจาก `report_runs` หรือ `report_snapshots` ที่ trace ได้
- chatbot ในอนาคตเป็น report/brief router ไม่ใช่ SQL/API generator อิสระ

## Phase Status

| Phase | Status | Goal |
| --- | --- | --- |
| Phase 0 | Done | วาง blueprint และ data architecture |
| Phase 1A | Done | report runner + dashboard สำหรับ `sales_goods_services` |
| Phase 1B | Done | LINE OA demo + webhook + manual send |
| Phase 1C | Done | scheduler 08:00, system PostgreSQL, signed brief viewer, admin mutation token |
| Phase 1D | Done | professional LINE brief, signed viewer, permission profiles |
| Phase 1E | Current | SaaS pilot portal: Owner Admin + Customer Viewer per tenant slug |
| Phase 2 | Current | report library เพิ่มเติม เริ่มที่ `purchase_goods_payables`, server-side PDF export และ multi-tenant subscription |
| Phase 2B | Planned | FlowAccount Foundation เป็น `flowaccount_finance` channel แบบ connection + finance brief foundation ไม่ sync กับ SML |
| Phase 3 | Future | LINE/Web chatbot over approved reports/briefs |
| Phase 4 | Future | AI business copilot, anomaly, recommendation |

## Current Deployment Snapshot

สถานะล่าสุดอยู่ที่ [16_CURRENT_STATUS_2026-05-20_TH.md](./16_CURRENT_STATUS_2026-05-20_TH.md)

```text
Runtime deployed code commit: e76acde
Latest docs commit: fe318e9 (docs-only, not runtime deploy)
Web Owner LAN: http://192.168.2.109:3055/owner
Web Customer DEMO SHOP LAN: http://192.168.2.109:3055/app/demo-shop
Web Customer 248 SHOP LAN: http://192.168.2.109:3055/app/248-shop
API LAN: http://192.168.2.109:4055
Public web tunnel: https://relationship-code-others-challenging.trycloudflare.com
Public API tunnel: https://bibliography-numbers-lite-motion.trycloudflare.com
System store: PostgreSQL
PDF export: server-side Chromium, layout sml-row-v5, cache in /app/.data/pdf-cache
Pilot proof tenants: tenant_demo_remote / กระบี่, seaandhill_demo
Skipped from proof coverage: tenant_office_sml1_2026 / 248 SHOP until datasource is configured
Current channel: sml_reports
Planned channel: flowaccount_finance
```

Operational note `2026-06-15`: production API/worker are healthy, Telegram ops alert test passed, and `/owner` now includes proof strip, sales kit, pilot qualification, and clean proof target. The current sales kit in [19_PILOT_SALES_DEMO_KIT_TH.md](./19_PILOT_SALES_DEMO_KIT_TH.md) includes owner proof qualification and a pilot success scorecard.

ห้ามบันทึก signed viewer URL แบบเต็มลงเอกสาร เพราะมี `token=...`

## Non-Negotiable Rules

- ห้ามบันทึก production DB password เป็น plaintext
- ห้ามใช้ superuser เช่น `postgres` ใน production connection
- ห้ามให้ AI generate SQL production เองโดยไม่มี approved report
- ห้าม assume ว่า integration ใหม่ต้องผูกกับ SML เว้นแต่ requirement ระบุชัดเจน
- ทุก record ที่เป็นข้อมูลลูกค้าต้องมี `tenant_id`
- ทุกการรัน report และการส่ง LINE ต้องมี audit/run log
- ต้องแยก demo, staging, production config
- งาน code/design สำคัญต้องผ่าน engineering playbook ใน [12_ENGINEERING_PLAYBOOK_TH.md](./12_ENGINEERING_PLAYBOOK_TH.md)

## Credential Policy

เอกสารนี้ตั้งใจไม่บันทึก credential จริง ตัวอย่าง connection ต้องใช้ placeholder เท่านั้น เช่น:

```text
tomcat_url: <SML_TOMCAT_URL>
tomcat_port: <SML_TOMCAT_PORT>
sml_config: <SMLConfigxxxx.xml>
database: <SML_DATABASE>
reverse_proxy_secret: <SECRET_IF_USED>
```
