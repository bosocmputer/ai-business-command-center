# Engineering Playbook: Senior AI-Assisted Development

## เป้าหมายของเอกสาร

กำหนดวิธีใช้ AI ในการสร้าง **AI Business Command Center** แบบ senior engineering workflow สำหรับ multi-channel brief platform ไม่ใช่แค่ให้ AI เขียนโค้ดเร็ว แต่ต้องช่วยตรวจสมมติฐาน, ลด risk, เพิ่ม testability, และป้องกัน production incident

เอกสารนี้รวบรวม prompt patterns ที่ต้องนำมาใช้ในงานสำคัญของโปรเจกต์ เช่น code review, refactor, debug, architecture decision, test, performance และ migration

## หลักคิด

ระบบนี้จะเชื่อม SML PostgreSQL, FlowAccount/future partner APIs, dashboard, LINE OA และในอนาคต chatbot ดังนั้นคุณภาพ engineering ต้องถือว่าเป็นระบบ production ตั้งแต่ phase 1

หลักการ:

- diagnose before prescribe
- design before code
- approved reports before AI answers
- tests that catch real production failures
- migrations must be reversible
- security and tenant isolation are product features, not afterthoughts

## Prompt 1: Senior Engineer Code Review

ใช้เมื่อ:

- เปิด PR
- เพิ่ม report runner
- เพิ่ม datasource connection
- เพิ่ม scheduler/LINE sender
- แก้ security-sensitive code

Template:

```text
ทำตัวเป็น Staff Engineer ที่มีประสบการณ์ 15 ปี
ช่วยรีวิวโค้ดนี้อย่างละเอียด โดยวิเคราะห์:
- bug ที่ซ่อนอยู่และ edge cases
- performance risks
- security vulnerabilities
- architecture smells และ code smells
- สิ่งที่คุณจะไม่อนุมัติในการ PR review

วิจารณ์ตรงไปตรงมา เหมือนระบบนี้กำลังจะ deploy ให้ลูกค้า production
ให้ findings เรียงตาม severity พร้อม file/line reference และข้อเสนอแก้ไขที่ชัดเจน
```

AI-Business Command-Center specific checks:

- มี `tenant_id` filter ครบหรือไม่
- มี secret หลุด log หรือไม่
- SQL เป็น approved/parameterized หรือไม่
- report/brief run trace กลับ `report_run_id` และ channel/source ได้หรือไม่
- LINE target แยก tenant ถูกต้องหรือไม่
- integration ใหม่ถูกแยกเป็น channel ของตัวเองหรือเผลอผูกกับ SML โดยไม่มี requirement หรือไม่

## Prompt 2: Safe Refactor

ใช้เมื่อ:

- เปลี่ยน report runner interface
- แยก API/worker modules
- เปลี่ยน data model
- เปลี่ยน LINE message renderer

Template:

```text
ช่วย refactor โค้ดนี้อย่างรอบคอบเหมือน production system
ก่อนแก้ ให้ทำ:
1. ระบุทุกฟังก์ชันหรือโมดูลที่เรียกใช้โค้ดส่วนนี้
2. วิเคราะห์ side effects และ dependencies
3. แสดง Before/After ที่สำคัญ
4. อธิบาย risk เมื่อ deploy production
5. เสนอ migration/rollout ที่ปลอดภัย

ห้าม refactor เพียงเพื่อให้โค้ดดูสะอาดขึ้น ต้องพิสูจน์ว่า behavior ไม่เปลี่ยนโดยไม่ตั้งใจ
```

Project rule:

- refactor report contract/data model ต้องมี migration notes
- refactor scheduler ต้องระบุ duplicate-send risk
- refactor datasource ต้องทดสอบ connection failure

## Prompt 3: Sherlock Holmes Debugging

ใช้เมื่อ:

- report ตัวเลขไม่ตรง SML
- LINE ไม่ส่งตอน 08:00
- dashboard ข้อมูล stale
- query ช้า/timeout

Template:

```text
ยังไม่ต้องแก้บั๊กทันที
ช่วยวิเคราะห์:
- สาเหตุที่เป็นไปได้ 5 ข้อ เรียงตามความน่าจะเป็น
- หลักฐานที่ยืนยัน/หักล้างแต่ละสาเหตุ
- ควร log หรือ inspect ค่าอะไร
- สมมติฐานในโค้ดที่อาจผิด
- test ที่เล็กที่สุดเพื่อแยกต้นตอ

หยุดเดา ใช้ข้อมูล หลักฐาน และการทดสอบเพื่อค้นหาต้นตอ
```

Common debug evidence:

- `report_runs.params_json`
- SQL rendered with placeholders redacted
- `row_count`
- `sum(net_amount)`
- `period_from/period_to`
- timezone used by scheduler
- LINE provider response

## Prompt 4: Architecture Decision Record (ADR)

ใช้เมื่อ:

- เลือก direct DB vs VPN vs local connector
- เลือก cron vs BullMQ
- เลือก Drizzle vs Prisma
- เลือก LINE OA ของลูกค้า vs OA กลาง
- เปลี่ยน snapshot strategy

Template:

```text
ฉันกำลังตัดสินใจระหว่าง [A] และ [B] สำหรับ [problem]
ช่วยทำ ADR โดยครอบคลุม:
- context และ constraints
- trade-offs
- scale 10x จะเกิดอะไร
- hidden costs
- recommendation พร้อมเหตุผล
- regret risk ในอีก 2 ปี

จัดรูปแบบเหมือน ADR จริงในองค์กร
```

ADR format:

```text
# ADR-XXXX: Title
Status: Proposed | Accepted | Superseded
Date:
Context:
Decision:
Options Considered:
Consequences:
Risks:
Rollback/Revisit Trigger:
```

## Prompt 5: Production-Grade Function

ใช้เมื่อ:

- เขียน encryption/decryption helper
- เขียน report param validator
- เขียน SQL renderer
- เขียน LINE sender
- เขียน tenant isolation guard

Template:

```text
เขียนฟังก์ชันนี้เหมือนใช้งานจริงใน FinTech
ต้องมี:
- Type hints/types และ docstrings
- input validation พร้อม error ชัดเจน
- logging ระดับเหมาะสม
- error handling ทุก failure mode
- unit tests happy path + edge cases อย่างน้อย 5 กรณี
- performance considerations
- scaling notes

ห้าม placeholder ทุกส่วนต้องพร้อม deploy
```

Project minimum:

- TypeScript types ชัด
- Zod schema สำหรับ input boundary
- no secret logging
- tests ต้องครอบคลุม invalid tenant, invalid params, timeout, empty result, provider failure

## Prompt 6: Senior Engineer Mentor

ใช้ก่อนเริ่ม feature ใหญ่

Template:

```text
ฉันกำลังจะอธิบายแนวทางแก้ [problem]
ยังไม่ต้องเขียนโค้ด
ช่วย:
- ถามคำถาม 5 ข้อเพื่อทดสอบสมมติฐาน
- ชี้ข้อบกพร่องในวิธีคิด
- เสนอทางเลือก 2 วิธี
- บอกว่าส่วนไหนซับซ้อนเกินจำเป็น
- บอกว่าส่วนไหนประเมินความยากต่ำไป
```

ใช้กับ:

- dashboard scope
- report abstraction
- chatbot design
- subscription/billing
- deployment approach

## Prompt 7: Codebase Onboarding

ใช้เมื่อ scaffold project แล้วหรือมีคนใหม่เข้าทีม

Template:

```text
นี่คือโครงสร้างโปรเจกต์:
[tree]
ช่วยอธิบาย codebase สำหรับพนักงานใหม่:
- entry point และ flow หลัก
- โมดูลสำคัญ/รอง
- conventions
- จุดแก้โค้ดปลอดภัย
- legacy/high-risk areas
- คำถามที่ควรถามทีม
```

ต้อง update เมื่อ:

- เพิ่ม worker
- เพิ่ม report module
- แยก packages
- เพิ่ม chatbot

## Prompt 8: Production-Focused Tests

ใช้เมื่อ:

- เพิ่ม report runner
- เพิ่ม scheduler
- เพิ่ม LINE sender
- เพิ่ม datasource connection
- เพิ่ม permission/tenant isolation

Template:

```text
อย่าเขียน test แบบทั่วไป
ให้เขียน test ที่จับปัญหา production จริง:
- real user edge cases
- race conditions/concurrency
- boundary values
- external dependency failure
- regression tests
- performance hot path

ข้าม assertions ที่ไม่สำคัญ ทุก test ต้องมีเหตุผลว่าป้องกัน bug อะไร
```

Required test themes:

- tenant A ไม่เห็นข้อมูล tenant B
- scheduled job ไม่ส่ง LINE ซ้ำ
- query timeout ถูก mark failed
- empty result ไม่ crash dashboard/LINE
- invalid date range ถูก reject

## Prompt 9: Explain for Tomorrow

ใช้เมื่อเรียน library/pattern ใหม่ก่อน implement

Template:

```text
ช่วยอธิบาย [concept/library/pattern] ใน 3 layer:
Layer 1: 30 วินาที ให้ PM เข้าใจ
Layer 2: 5 นาที พร้อมตัวอย่างใช้งานจริง
Layer 3: trade-offs, gotchas, เมื่อไหร่ไม่ควรใช้

เน้นสิ่งที่ต้องรู้เพื่อใช้งานจริงพรุ่งนี้
```

เหมาะกับ:

- BullMQ
- Drizzle
- Zod
- LINE Messaging API
- PostgreSQL connection pooling
- row-level tenant isolation patterns

## Prompt 10: Performance Detective

ใช้เมื่อ:

- dashboard ช้า
- report query ช้า
- worker memory สูง
- LINE batch ใช้เวลานาน

Template:

```text
โค้ดนี้ทำงานช้า ยังไม่ต้อง optimize
วิเคราะห์:
- bottleneck คือ CPU, memory, I/O หรือ network
- time complexity และ worst case
- memory allocations
- N+1 queries หรือ repeated computation
- profiler น่าจะเจออะไร
- quick win vs highest-impact improvement

Diagnose before prescribe
```

Project focus:

- SML query latency
- system DB snapshot query
- dashboard aggregate calculation
- repeated JSON parse/serialize
- worker concurrency

## Prompt 11: Zero-Downtime Migration

ใช้เมื่อ:

- เปลี่ยน schema ตารางกลาง
- migrate report snapshot shape
- เปลี่ยน datasource encryption
- เปลี่ยน LINE channel model
- เปลี่ยน report version production

Template:

```text
ต้อง migration จาก [old] ไป [new] ใน production
ช่วยวางแผน:
- pre-migration checks และ backups
- rollout strategy: feature flags, canary, dual writes
- validation ระหว่างย้าย
- rollback plan
- communication plan
- worst-case scenarios

ถือว่ามีรายได้และข้อมูลลูกค้าจริงเป็นเดิมพัน
```

Project migration rules:

- ห้าม destructive migration แบบไม่มี backup
- schema change ต้อง backward compatible เมื่อเป็นไปได้
- report definition version ใหม่ควรอยู่คู่ version เก่า
- LINE sender migration ต้องป้องกัน duplicate messages

## Workflow ที่ต้องใช้จริง

### ก่อนสร้าง feature ใหม่

1. ใช้ Prompt 6 เพื่อ challenge approach
2. ถ้าเป็น decision ใหญ่ ใช้ Prompt 4 สร้าง ADR
3. อัปเดต docs ถ้า architecture เปลี่ยน

### ระหว่าง implement

1. ใช้ Prompt 5 สำหรับ critical functions
2. ใช้ Prompt 8 สำหรับ tests
3. ใช้ Prompt 10 ถ้ามี performance concern

### ก่อน merge

1. ใช้ Prompt 1 review
2. ใช้ Prompt 2 ถ้ามี refactor
3. ตรวจ security/tenant isolation checklist

### เมื่อมี incident/bug

1. ใช้ Prompt 3 ก่อนแก้
2. เพิ่ม regression test จาก Prompt 8
3. ถ้าเป็น data/schema change ใช้ Prompt 11

## Definition of Done สำหรับ AI-Business Command-Center

งานหนึ่งชิ้นจะถือว่าเสร็จเมื่อ:

- behavior ตรงกับ docs/report contract
- มี tests ที่จับ failure mode สำคัญ
- ไม่มี secret/credential hardcoded
- tenant isolation ไม่รั่ว
- audit/run log เพียงพอสำหรับ debug
- LINE/report jobs retry/fail อย่างมีสถานะ
- production risk ถูกบันทึกถ้ามี
