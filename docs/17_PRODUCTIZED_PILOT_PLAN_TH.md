# Productized Pilot Plan: Sellable AI Business Brief

วันที่บันทึก: 2026-06-15
สถานะ: working plan สำหรับพา pilot ไปสู่ production ที่ขายได้จริง

## Decision

AI-Business Command Center ควรถูกขายเป็น **Daily Business Brief สำหรับเจ้าของร้านผ่าน LINE** ไม่ใช่ dashboard SML หรือ AI dashboard ทั่วไป

ประโยคขายหลัก:

```text
ทุกเช้าเจ้าของร้านรู้เรื่องสำคัญก่อนพลาด โดยไม่ต้องเปิด SML เอง
ถ้าข้อมูลจาก SML ยังไม่น่าเชื่อถือ ระบบจะบอกตรง ๆ แทนการสรุปยอดผิด
```

SML เป็น source แรกของ product แต่ value ที่ลูกค้าซื้อคือ trust, action, และความสบายใจของเจ้าของกิจการ

## Why This Positioning

หลักฐานจาก product ปัจจุบัน:

- ระบบมี approved report, report snapshot, LINE delivery, audit, signed viewer, Business Signal, Action Digest, incident notice, Telegram ops alert และ chunked heavy reports แล้ว
- ADR 0003 ระบุชัดว่า report อย่างเดียวดูธรรมดาและไม่สร้างแรงจูงใจพอ ลูกค้าต้องการรู้ว่าเรื่องไหนต้องจัดการ
- Owner UI มี cockpit/readiness เริ่มต้นแล้ว แต่ยังต้องลดความซับซ้อนให้เหลือ next action ที่ชัด
- ระบบมี trust layer แล้ว: ถ้า SML/JavaWS fail จะสร้าง data quality signal หรือ incident notice แทนการสรุปมั่ว

สัญญาณตลาด:

- LINE เป็นช่องทางที่เจ้าของกิจการไทยคุ้นเคยมากกว่า portal ใหม่ โดย LY Corporation รายงานว่า ณ ธันวาคม 2024 มีผู้ใช้ LINE ในไทยราว 54 ล้านคน
- OECD ระบุว่า SME ยังเจอ barrier ด้าน cost, perceived relevance, data culture, digital awareness, skills และ trust เมื่อ adopt digital tools

แปลเป็น product strategy:

- ลูกค้าไม่ได้อยากได้หน้าจอเพิ่ม
- ลูกค้าอยากรู้ว่า "วันนี้ต้องดูอะไร"
- ลูกค้าจะจ่ายง่ายขึ้นถ้าไม่ต้องเปลี่ยนพฤติกรรมจาก LINE
- ระบบต้องขายความน่าเชื่อถือ ไม่ใช่ขาย AI wording

Sources:

- https://www.lycorp.co.jp/en/story/20250530/lineconference.html
- https://www.oecd.org/en/publications/the-digital-transformation-of-smes_bdb9256a-en.html

## First ICP

เริ่มขายตรงกับร้านที่มี SML อยู่แล้ว:

- ร้านค้าปลีก/ค้าส่ง/หลายสาขา
- เจ้าของหรือผู้บริหารไม่ได้เปิด SML เองทุกวัน
- มีพนักงานออกบิล/จัดซื้อ/ดูสต๊อก แต่เจ้าของอยากเห็นภาพรวม
- มี LINE เป็นช่องทางคุยงานประจำ
- มี pain เรื่องยอดขาย, สต๊อก, ลูกหนี้, กำไร, หรือ server SML ช่วงเช้า

ช่องทางรองหลังมี proof:

- SML implementer
- IT consultant ที่ดูแลร้านค้า
- บริษัทบัญชี/ที่ปรึกษาระบบที่อยากมี recurring service

ยังไม่ควรเริ่มจาก:

- ธุรกิจที่ยังไม่มีข้อมูลในระบบกลาง
- ลูกค้าที่ต้องการ BI เต็มรูปแบบก่อน brief
- ลูกค้าที่ต้องการ chatbot arbitrary SQL ตั้งแต่วันแรก
- FlowAccount-first use case ก่อน SML proof แข็งแรง

## Sellable V1 Promise

ลูกค้าควรซื้อเพราะได้ 5 เรื่องนี้:

1. ได้ LINE brief ทุกเช้า/รอบที่ตั้งไว้
2. เห็นเรื่องที่ควรทำวันนี้ ไม่ใช่รายงานยาวอย่างเดียว
3. เปิดดูรายละเอียดได้เมื่ออยาก drill down
4. ถ้าระบบอ่าน SML ไม่ได้ จะรู้ทันทีว่าห้ามใช้ยอดรอบนั้น
5. Owner/admin เห็นว่าร้านไหนพร้อม ร้านไหนติดปัญหา และต้องแก้อะไรต่อ

V1 ไม่ควร promise:

- ทำนายยอดขายด้วย AI
- ตอบทุกคำถามธุรกิจได้เอง
- แก้ข้อมูลใน SML
- sync เอกสารไป FlowAccount
- ทำ BI dashboard แทนทุก report

## Product Experience

### Customer Experience

ช่องทางหลักคือ LINE:

- ข้อความแรกต้องบอกสถานะธุรกิจหรือเรื่องที่ต้องดูทันที
- ถ้ามีปัญหาระบบ ต้องบอกแบบผู้บริหารเข้าใจ เช่น "ระบบติดต่อ SML ได้ แต่ข้อมูลที่ตอบกลับมาอ่านไม่ได้"
- ปุ่มเปิดรายงานใช้ signed viewer สำหรับดูรายละเอียด
- ไม่โชว์ token, endpoint, SQL, run id หรือศัพท์ developer ในพื้นที่หลัก

### Owner Experience

หน้า Owner ควรตอบ 3 คำถาม:

```text
ร้านไหนปกติ
ร้านไหนมีปัญหา
ต้องทำอะไรต่อ
```

แนว UX:

- `/owner` เป็น cockpit สั้น กระชับ
- `/owner/reports` สำหรับ manual test และ validation
- `/owner/line` สำหรับ LINE setup
- `/owner/audit` สำหรับ ops/debug
- ลด duplicate controls และคำ technical ที่ไม่จำเป็น
- action ทุกปุ่มต้องมี loading/disabled state และ copy บอก step ถัดไป

### Ops Experience

Telegram เป็นช่องทางของผู้ดูแลระบบ ไม่ใช่ช่องทางลูกค้า:

- แจ้ง final failure
- แจ้ง JavaWS unreadable/timeout/unreachable
- แจ้ง LINE delivery failed
- แจ้ง worker/heartbeat stale
- สรุปผลหลัง scheduled round

## 7-Day Production Proof Gate

ก่อนบอกว่า "ขายได้จริง" ต้องผ่าน proof อย่างน้อย 7 วันกับร้านจริง 2 ร้าน เช่น `tenant_demo_remote / กระบี่` และ `seaandhill_demo`

Gate ที่ต้องเก็บทุกวัน:

- scheduled run สำเร็จตามรอบ 08:00 และ 18:30
- LINE delivery สำเร็จหรือ incident notice ถูกส่งแทนอย่างถูก policy
- Telegram ops alert ส่งเฉพาะเคสที่ควรรู้ ไม่ spam
- report_runs มี status, duration, row count, failure kind/phase ครบ
- JavaWS unreadable ถูก classify เป็น phase ที่ช่วย debug ต่อได้
- heavy reports ไม่ทำให้ worker/tick ค้าง
- Action Digest หรือ fallback report digest ส่งตาม feature flag/digest mode ถูกต้อง
- Owner UI อ่านแล้วรู้ next action ภายใน 30 วินาที

Definition of done:

```text
7 วันติดกัน ไม่มี silent failure
ถ้ารายงาน fail ผู้เกี่ยวข้องรู้ผ่าน LINE/Telegram ตาม role
ข้อมูลที่ส่งถึงผู้บริหารมี source/run ที่ trace ได้
ไม่มี secret/customer raw data ใน log, docs, หรือ alert
```

## Metrics To Track

Product metrics:

- daily brief delivered rate
- incident correctly notified rate
- owner action taken rate จาก Business Signal lifecycle
- number of stores ready for scheduled notification
- time to onboard one store

Reliability metrics:

- report success rate by tenant/report
- JavaWS failure kind/phase count
- JavaWS latency and timeout rate
- heavy report duration versus rolling median
- LINE delivery failure rate
- Telegram alert dedupe rate

Sales proof metrics:

- ผู้บริหารเปิด LINE brief กี่วันใน 7 วัน
- ลูกค้าพูดซ้ำได้ไหมว่า product ช่วยอะไร
- เจ้าของร้านยอมให้เปิดรอบแจ้งเตือนจริงไหม
- มีเหตุการณ์จริงที่ระบบจับได้ เช่น SML data unreadable, ยอดผิดปกติ, สต๊อก/ลูกหนี้เสี่ยง

## Packaging

แพ็กเกจเริ่มต้นควรเรียบ:

### Starter Brief

- 1 ร้าน
- LINE daily brief
- sales + purchase + basic business signals
- incident notice เมื่อ data trust มีปัญหา
- เหมาะกับร้านเดียวหรือ pilot

### Owner Ops

- หลายร้าน/หลายสาขา
- Action Digest
- stock/AR heavy reports
- Telegram ops alert
- readiness cockpit
- เหมาะกับเจ้าของที่ต้อง monitor หลายกิจการ

### Managed Brief

- รวม monitoring, setup, และ monthly review
- เหมาะกับลูกค้าที่ไม่มี IT ดูแล SML/Tomcat

ราคาเริ่มต้นที่ควรทดลอง:

- setup fee: 5,000-20,000 บาท ตามความยาก SML/LINE
- monthly: 990-2,990 บาทต่อร้าน สำหรับ Starter/Owner Ops
- managed: 4,900+ บาทต่อเดือน เมื่อรวม monitoring/support

ต้อง validate ราคาอีกครั้งจาก pilot interview ไม่ควร fix pricing เป็นสัญญาระยะยาวก่อนมี proof

## Next Sprint

### Sprint 1: Proof And Trust

- สร้าง 7-day proof log จาก production DB สำหรับกระบี่และ seaandhill
- ใช้ `docs/18_7_DAY_PRODUCTION_PROOF_LOG_TH.md` เป็น template กลางสำหรับทุกวัน
- เช็ก scheduled rounds ทุกวันหลัง 08:00 และ 18:30
- ยืนยัน incident notice และ Telegram alert เมื่อ JavaWS/LINE fail
- จด evidence ที่ใช้เล่า demo ได้

### Sprint 2: Action Digest As Main Product

- เปิด `line_action_digest_v2_enabled` เฉพาะ tenant ที่ proof ผ่าน
- ตรวจ copy ของ Action Digest ให้เป็นภาษาผู้บริหาร
- ลดการส่ง report ยาวเมื่อไม่มีเหตุจำเป็น
- ทำ fallback ชัดเมื่อไม่มี signal สำคัญหรือ feature flag ปิด

### Sprint 3: Owner Cockpit Simplification

- ใช้ `docs/20_OWNER_COCKPIT_SIMPLIFICATION_PLAN_TH.md` เป็น UX/implementation source of truth
- ปรับ `/owner` ให้เน้น status + next action
- ย้าย diagnostic/test ที่ใช้ไม่บ่อยไป `/owner/audit` หรือ advanced area
- เพิ่ม empty/error copy ภาษาไทยแบบบอก action ถัดไป
- ตรวจ mobile/desktop ไม่มี overflow และไม่ซ้อนกัน

### Sprint 4: Sales Demo Kit

- ใช้ `docs/19_PILOT_SALES_DEMO_KIT_TH.md` เป็น sales/demo source of truth
- สร้าง demo narrative จากเหตุการณ์จริงใน 7-day proof
- เตรียม one-pager: pain, promise, LINE screenshot, trust behavior, pricing
- เตรียม script demo 10 นาที: ตั้งร้าน -> ส่ง LINE -> fail case -> audit proof

## No-Go Criteria

ยังไม่ควรขายกว้างถ้าเจอข้อใดข้อหนึ่ง:

- มี silent failure ที่ไม่แจ้ง LINE/Telegram
- report success rate ยังผันผวนโดยไม่มี diagnostic phase
- Owner ต้องให้ dev ช่วยบ่อยตอนตั้งค่าร้าน
- LINE message ยังยาวหรืออ่านไม่ออกในมือถือ
- Action Digest ยังบอก action ไม่ชัด
- backup/restore ยังไม่ผ่านรอบทดสอบจริง
- token/endpoint/customer data หลุดใน log หรือ docs

## Product Backlog Priority

ลำดับที่ควรทำก่อน:

1. production proof log
2. Action Digest default experience
3. Owner cockpit simplification
4. backup/restore drill
5. sales demo kit
6. pilot onboarding checklist
7. FlowAccount foundation
8. chatbot over approved reports

เหตุผล: ข้อ 1-5 ทำให้ขายได้เร็วที่สุดด้วยระบบที่มีอยู่แล้ว ส่วน FlowAccount/chatbot จะเพิ่ม surface area ก่อน proof จะแข็งแรง

## Open Questions

- ลูกค้ากลุ่มแรกอยากจ่ายแบบต่อร้าน ต่อสาขา หรือรวม managed service มากกว่า
- Action Digest ควรส่งกี่โมงดีที่สุดสำหรับร้านประเภทต่าง ๆ
- ผู้บริหารอยากเห็น stock/AR ทุกวัน หรือเฉพาะเมื่อมี signal
- ร้านที่ไม่มี LINE OA ของตัวเองควรใช้ owner shared OA ได้นานแค่ไหน
- 7-day proof ควรแสดงเป็นหน้า Owner UI หรือ export เป็น report สำหรับ sales
