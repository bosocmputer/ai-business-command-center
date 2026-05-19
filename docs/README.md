# SML AI Business Command Center Docs

เอกสารชุดนี้คือ living specification สำหรับสร้างระบบ **AI Business Command Center for SML** แบบ subscription โดยใช้แนวคิด shared SML knowledge + separated tenant data

เอกสารเดิมใน `proposal_output/` ถือเป็น proposal archive ส่วนเอกสารใน `docs/` คือชุดที่ใช้เดินงานจริง

## อ่านจากไฟล์ไหนก่อน

1. [01_PRODUCT_BLUEPRINT_TH.md](./01_PRODUCT_BLUEPRINT_TH.md) - ภาพรวมสินค้า, ลูกค้าเป้าหมาย, subscription model
2. [03_DATA_FLOW_TH.md](./03_DATA_FLOW_TH.md) - flow ข้อมูลตั้งแต่ SML DB ถึง Dashboard และ LINE OA
3. [05_REPORT_CONTRACT_TH.md](./05_REPORT_CONTRACT_TH.md) - มาตรฐานของ report หนึ่งตัว ซึ่งเป็นแกนหลักของระบบ
4. [reports/sales_goods_services.md](./reports/sales_goods_services.md) - contract รายงานแรกที่ใช้ implement จริง
5. [09_TECH_STACK_AND_DEPLOYMENT_TH.md](./09_TECH_STACK_AND_DEPLOYMENT_TH.md) - stack และ deployment ที่เครื่องทดสอบ
6. [11_IMPLEMENTATION_ROADMAP_TH.md](./11_IMPLEMENTATION_ROADMAP_TH.md) - ลำดับ implementation

## เอกสารทั้งหมด

| ไฟล์ | หน้าที่ |
| --- | --- |
| [01_PRODUCT_BLUEPRINT_TH.md](./01_PRODUCT_BLUEPRINT_TH.md) | Product vision, package, roadmap, value proposition |
| [02_SYSTEM_ARCHITECTURE_TH.md](./02_SYSTEM_ARCHITECTURE_TH.md) | Architecture production-grade ของระบบ |
| [03_DATA_FLOW_TH.md](./03_DATA_FLOW_TH.md) | Full loop data flow และ feedback loop |
| [04_DATA_MODEL_TH.md](./04_DATA_MODEL_TH.md) | ตารางกลางของ subscription/report platform |
| [05_REPORT_CONTRACT_TH.md](./05_REPORT_CONTRACT_TH.md) | มาตรฐาน report, SQL, params, output, validation |
| [06_SML_KNOWLEDGE_MODEL_TH.md](./06_SML_KNOWLEDGE_MODEL_TH.md) | Shared SML knowledge, business objects, chatbot intent |
| [07_LINE_OA_MORNING_BRIEF_TH.md](./07_LINE_OA_MORNING_BRIEF_TH.md) | LINE OA strategy, schedule, retry, template |
| [08_SECURITY_AND_PRODUCTION_TH.md](./08_SECURITY_AND_PRODUCTION_TH.md) | Security, prod checklist, tenant isolation |
| [09_TECH_STACK_AND_DEPLOYMENT_TH.md](./09_TECH_STACK_AND_DEPLOYMENT_TH.md) | Stack, Docker Compose, deployment target |
| [10_INSPIRATION_OPENHUMAN_OPENCLAW_HERMES_TH.md](./10_INSPIRATION_OPENHUMAN_OPENCLAW_HERMES_TH.md) | แนวคิดที่หยิบจาก OpenHuman/OpenClaw/Hermes |
| [11_IMPLEMENTATION_ROADMAP_TH.md](./11_IMPLEMENTATION_ROADMAP_TH.md) | MVP roadmap และ acceptance criteria |
| [12_ENGINEERING_PLAYBOOK_TH.md](./12_ENGINEERING_PLAYBOOK_TH.md) | Senior engineering prompts/playbook สำหรับ review, refactor, debug, ADR, test, migration |
| [13_PHASE_1_STABILIZATION_CHECK_TH.md](./13_PHASE_1_STABILIZATION_CHECK_TH.md) | Checkpoint หลัง dashboard + LINE demo ก่อนทำ scheduler |
| [reports/sales_goods_services.md](./reports/sales_goods_services.md) | Report contract แรก: รายงานขายสินค้าและบริการ |

## Product Direction

ระบบนี้ไม่ใช่ chatbot ที่ยิง SQL เอง แต่เป็น **SML Report Intelligence Platform**

หลักการสำคัญ:

- 1 บริษัท = 1 SML PostgreSQL database
- รายงานและองค์ความรู้ SML ใช้ร่วมกันทุก tenant
- ข้อมูลจริง, credential, report result, LINE target แยกด้วย `tenant_id`
- report ทุกตัวต้องเป็น approved SQL และมี `report_contract`
- dashboard, LINE OA, future chatbot อ่านจาก `report_runs` หรือ `report_snapshots` ที่ trace ได้
- chatbot ในอนาคตเป็น report router ไม่ใช่ SQL generator อิสระ

## Phase Status

| Phase | Status | Goal |
| --- | --- | --- |
| Phase 0 | Done | วาง blueprint และ data architecture |
| Phase 1 | Current | report runner + dashboard สำหรับ `sales_goods_services` ก่อนต่อ LINE morning brief |
| Phase 2 | Future | report library เพิ่มเติมและ multi-tenant subscription |
| Phase 3 | Future | LINE/Web chatbot over approved reports |
| Phase 4 | Future | AI business copilot, anomaly, recommendation |

## Non-Negotiable Rules

- ห้ามบันทึก production DB password เป็น plaintext
- ห้ามใช้ superuser เช่น `postgres` ใน production connection
- ห้ามให้ AI generate SQL production เองโดยไม่มี approved report
- ทุก record ที่เป็นข้อมูลลูกค้าต้องมี `tenant_id`
- ทุกการรัน report และการส่ง LINE ต้องมี audit/run log
- ต้องแยก demo, staging, production config
- งาน code/design สำคัญต้องผ่าน engineering playbook ใน [12_ENGINEERING_PLAYBOOK_TH.md](./12_ENGINEERING_PLAYBOOK_TH.md)

## Credential Policy

เอกสารนี้ตั้งใจไม่บันทึก credential จริง ตัวอย่าง connection ต้องใช้ placeholder เท่านั้น เช่น:

```text
host: <SML_DB_HOST>
port: <SML_DB_PORT>
database: <SML_DATABASE>
username: ai_report_readonly
password: <SECRET>
```
