# Pilot Sales Demo Kit: Daily Business Brief For SML Stores

วันที่บันทึก: 2026-06-15
สถานะ: sales/demo working kit สำหรับใช้หลังเริ่มเก็บ 7-day production proof

## Purpose

เอกสารนี้แปลง productized pilot plan และ 7-day production proof ให้เป็นภาษาขาย, demo flow, discovery questions และ next step ที่ใช้คุยกับลูกค้าจริงได้

หลักสำคัญ:

- ขายผลลัพธ์ ไม่ขายจำนวน report
- ใช้ LINE เป็น first proof เพราะลูกค้าใช้อยู่แล้ว
- ใช้ trace/audit เป็น trust proof หลังบ้าน
- ไม่ promise AI, chatbot, prediction, หรือ BI เต็มรูปแบบก่อนระบบพร้อม
- ทุก claim ที่แรงต้องมีหลักฐานจาก `docs/18_7_DAY_PRODUCTION_PROOF_LOG_TH.md`

## One-Line Positioning

```text
AI-BCC ส่งสรุปธุรกิจที่ต้องรู้ผ่าน LINE ให้เจ้าของร้านทุกวันจากข้อมูล SML พร้อมแจ้งทันทีเมื่อข้อมูลยังไม่น่าเชื่อถือ
```

เวอร์ชันพูดกับเจ้าของร้าน:

```text
ทุกเช้าคุณไม่ต้องเปิด SML เอง ระบบจะส่งให้ใน LINE ว่าวันนี้ต้องดูอะไร ถ้าดึงข้อมูลไม่ได้ก็จะบอกว่าอย่าเพิ่งใช้ยอดรอบนี้
```

เวอร์ชันพูดกับ IT/SML implementer:

```text
AI-BCC เป็น monitoring-and-brief layer เหนือ SML JavaWS: approved reports, scheduled LINE brief, incident fallback, audit, และ ops alert โดยไม่แก้ JavaWeb ของลูกค้า
```

## Ideal First Conversation

ใช้กับเจ้าของร้าน/ผู้บริหารที่มี SML อยู่แล้ว

### Opening

```text
ผมไม่ได้อยากเพิ่ม dashboard ให้คุณต้องเปิดอีกหน้า
สิ่งที่อยากแก้คือ ทุกเช้าคุณควรรู้ทันทีว่ายอดขาย สต๊อก ลูกหนี้ หรือระบบ SML มีอะไรที่ต้องดู โดยส่งเข้า LINE แบบอ่านจบเร็ว
```

### Qualification Questions

ถาม 5 ข้อนี้ก่อน demo:

1. ทุกเช้าตอนนี้คุณรู้ยอดขายเมื่อวานจากช่องทางไหน
2. ถ้า SML/Tomcat หรือ server มีปัญหาตอนเช้า ใครเป็นคนรู้ก่อน
3. รายงานไหนที่คุณเปิดบ่อยจริง: ยอดขาย, ซื้อ, สต๊อก, ลูกหนี้, กำไร
4. อยากให้แจ้งทุกยอด หรือแจ้งเฉพาะเรื่องที่ต้องทำ
5. คนรับ LINE ควรเป็นใคร: เจ้าของ, ผู้จัดการ, บัญชี, ทีมสาขา

สัญญาณว่าลูกค้า fit:

- เจ้าของไม่ได้เปิด SML เองทุกวัน
- มีคนรอรายงานจากพนักงาน
- เคยมีปัญหา server/SML ทำให้ไม่รู้ยอดตอนเช้า
- มีหลายสาขา หรือมี stock/AR ที่ต้องตาม
- ใช้ LINE คุยงานอยู่แล้ว

สัญญาณว่าอาจยังไม่ fit:

- ยังไม่มีข้อมูลใน SML ที่น่าเชื่อถือ
- เจ้าของอยากได้ BI dashboard เต็มรูปแบบก่อน
- ต้องการให้ระบบเขียน/แก้ข้อมูล SML
- ต้องการ chatbot ที่ถามอะไรก็ได้ตั้งแต่วันแรก

## 10-Minute Demo Script

เป้าหมาย demo คือให้ลูกค้าจำ 3 เรื่อง:

```text
รู้เร็ว
เชื่อถือได้
ถ้าระบบมีปัญหาจะไม่สรุปมั่ว
```

### 0:00-1:00 Pain

พูด:

```text
ปัญหาของเจ้าของร้านไม่ใช่ไม่มีรายงาน แต่คือไม่รู้ว่าเช้านี้ควรดูเรื่องไหนก่อน และไม่รู้ว่าข้อมูลที่ได้รับเชื่อถือได้แค่ไหน
```

แสดง:

- LINE message หรือ mock จาก proof ที่ไม่มีข้อมูลลูกค้า sensitive
- ชื่อรอบ เช่น `08:00`

### 1:00-3:00 LINE Brief

พูด:

```text
ระบบส่งสรุปเข้าช่องทางที่เจ้าของใช้ทุกวันอยู่แล้ว ไม่ต้องเปิด portal ก่อน
```

แสดง:

- LINE brief รอบจริง
- report key ที่ส่ง
- status ว่าส่งสำเร็จ

หลักฐานที่ต้องมี:

- `line_delivery id`
- `notification_rule_run id`
- timestamp

### 3:00-5:00 Drill Down

พูด:

```text
ถ้าอยากดูต่อ กดเปิดรายงานได้ แต่หน้าแรกไม่บังคับให้คุณอ่านตารางยาว
```

แสดง:

- signed viewer/customer report
- KPI หลัก
- detail ที่ trace ได้

ห้ามแสดง:

- signed URL เต็ม
- token
- raw endpoint
- raw SQL

### 5:00-7:00 Trust Failure Case

พูด:

```text
จุดต่างคือ ถ้า SML ตอบผิดรูปแบบหรือดึงข้อมูลไม่ได้ ระบบจะไม่สรุปยอดให้เหมือนว่าทุกอย่างปกติ แต่แจ้งว่าอย่าใช้ยอดรอบนี้ก่อน
```

แสดง:

- incident notice ภาษาไทย
- `failure_kind`
- `failure_phase`
- recommended action

หลักฐานที่ต้องมี:

- failed `report_run id`
- LINE incident delivery id หรือ Telegram alert delivery id
- safe error เท่านั้น

### 7:00-9:00 Owner Cockpit

พูด:

```text
ฝั่งผู้ดูแลเห็นว่าร้านไหนพร้อม ร้านไหนมีปัญหา และต้องทำอะไรต่อ ไม่ต้องเดาจาก log
```

แสดง:

- `/owner` readiness หรือ operations summary
- business signals/open issues
- latest notification/LINE delivery

### 9:00-10:00 Offer

พูด:

```text
รอบแรกเราไม่ได้ขายระบบใหญ่ เราขอเริ่มจาก 7 วันพิสูจน์กับรอบแจ้งเตือนจริง ถ้าไม่มี silent failure และคุณรู้สึกว่ามันช่วยตัดสินใจได้ เราค่อยเปิดเป็นรายเดือน
```

CTA:

```text
ขอเลือก 1 ร้าน, 1-2 รอบแจ้งเตือน, ผู้รับ LINE 1-2 คน แล้วเริ่ม proof 7 วัน
```

## One-Page Sales Copy

ใช้เป็นข้อความใน proposal หรือ one-pager

### Headline

```text
รายงานธุรกิจที่เจ้าของร้านควรรู้ ส่งเข้า LINE ทุกวันจากข้อมูล SML
```

### Subheadline

```text
AI-BCC ช่วยให้เจ้าของร้านเห็นยอดสำคัญ เรื่องที่ต้องจัดการ และปัญหาการดึงข้อมูล SML โดยไม่ต้องเปิด SML เองทุกเช้า
```

### Problems

- เจ้าของต้องรอคนสรุปรายงาน
- เปิด SML เองทุกวันไม่สะดวก
- รายงานเยอะ แต่ไม่รู้เรื่องไหนต้องรีบดู
- ถ้า SML/Tomcat มีปัญหา ผู้บริหารรู้ช้า
- ข้อมูลผิดหรือดึงไม่สำเร็จอาจถูกนำไปสรุปต่อแบบไม่รู้ตัว

### What You Get

- LINE brief ตามรอบเวลาที่ตั้ง
- Action Digest: เรื่องที่ควรทำวันนี้
- Signed report viewer สำหรับดูรายละเอียด
- SML/JavaWS incident notice เมื่อข้อมูลยังไม่น่าเชื่อถือ
- Owner cockpit สำหรับดู readiness, delivery, audit และปัญหาล่าสุด

### Why It Is Safer

- อ่านจาก approved report เท่านั้น
- ทุกยอดผูกกับ report run/snapshot
- ไม่สร้าง SQL เองแบบอิสระ
- ไม่แก้ข้อมูลใน SML
- ถ้า report fail จะสร้าง data-quality signal หรือ incident notice

### First Pilot Offer

```text
7-Day Business Brief Proof
- 1 ร้าน
- 1-2 รอบแจ้งเตือนต่อวัน
- LINE ผู้บริหาร 1-2 ปลายทาง
- สรุปผลทุกวันจาก run/delivery จริง
- จบรอบด้วย proof report ว่าระบบพร้อมขายรายเดือนหรือยัง
```

## Owner Proof And Qualification Source

ก่อนคุยลูกค้าหรือทำ proposal ให้เปิด `/owner` และดู section `หลักฐาน production proof ล่าสุด`

ข้อมูลที่ต้องใช้จากหน้านี้:

- `Sales kit สำหรับคุยลูกค้า`: copy ข้อความเปิดบทสนทนาและ caveat ล่าสุด
- `Pilot qualification`: ใช้เลือกว่าลูกค้าคนไหนควรคุยตอนนี้ และใครยังไม่ควรขาย
- `Minimum pilot`: scope ต่ำสุดของรอบทดลอง เช่น 1 ร้าน, 1-2 รอบ, 1-2 รายงาน
- `Decision signal`: เงื่อนไขว่าควรปิดเป็นรายเดือนหรือรอ proof เพิ่ม
- `Clean target`: วันที่ caveat จาก failed run เก่าจะหลุดจาก rolling proof window ถ้าไม่มี failed ใหม่

สถานะที่ใช้ตีความ:

| Owner status | ใช้ขายอย่างไร | สิ่งที่ต้องพูดตรง ๆ |
| --- | --- | --- |
| `รอ proof` | demo แนวทางเท่านั้น | ยังไม่ควรเสนอ paid pilot จนมีรอบจริงอย่างน้อย 1 รอบ |
| `pilot แบบมี caveat` | คุยกับเจ้าของที่รับ proof แบบโปร่งใสได้ | ยังมี failed ใน window ล่าสุด ต้องรอดู clean rounds หรือถึง Clean target |
| `เก็บ proof เพิ่ม` | ใช้เปิดบทสนทนาและ demo | รอบถัดไปต้องสำเร็จครบก่อนใช้ claim ว่าพร้อมขาย |
| `พร้อมเปิด pilot` | เสนอ 7-day proof ได้ | ยังเป็น pilot ต้องติดตาม run/delivery จริงต่อเนื่อง |

ห้ามข้าม qualification นี้แม้ระบบส่ง LINE สำเร็จ เพราะเป้าหมายคือขายแบบที่ proof รองรับ ไม่ใช่ขายเกินสิ่งที่ระบบพิสูจน์แล้ว

## Packages For Early Sales

### Starter Brief

เหมาะกับ:

- ร้านเดียว
- เจ้าของอยากรู้ยอดขาย/ซื้อประจำวัน
- ยังไม่ต้องการ ops monitoring ลึก

รวม:

- LINE daily brief
- sales + purchase reports
- basic Business Signals
- incident notice
- signed viewer

### Owner Ops

เหมาะกับ:

- หลายร้านหรือหลายสาขา
- เจ้าของต้องตาม stock/AR/heavy reports
- ต้องการ Telegram ops alert ให้คนดูแลระบบ

รวม:

- Starter Brief
- Action Digest
- stock/AR heavy report flow
- Telegram ops alert
- operations cockpit

### Managed Brief

เหมาะกับ:

- ลูกค้าที่ไม่มี IT ดูแล SML/Tomcat
- ต้องการให้ทีมเราช่วย monitor และแจ้งผล

รวม:

- Owner Ops
- monitoring review
- monthly summary
- incident follow-up

## Proof Claims Matrix

ใช้ matrix นี้กันการขายเกินจริง

| Claim | พูดได้เมื่อมีหลักฐาน | Evidence |
| --- | --- | --- |
| ส่ง LINE ได้จริงทุกวัน | มี delivery success ใน proof log | `line_deliveries`, `notification_rule_runs` |
| ไม่มี silent failure | ทุก fail มี incident/ops alert หรือ audit | proof log + `operational_alert_deliveries` |
| SML failure แยกประเภทได้ | report fail มี `failure_kind` และ `failure_phase` | `report_runs` |
| heavy report ไม่ทำให้ระบบค้าง | chunked run จบ หรือมี slow alert | `report_run_chunks`, alert delivery |
| Action Digest ลด noise ได้ | digest mode ส่ง issue สำคัญแทน report ยาว | audit + LINE delivery |
| พร้อมขายร้านถัดไป | ผ่าน 7-day exit criteria | `18_7_DAY_PRODUCTION_PROOF_LOG_TH.md` |

ถ้ายังไม่มี evidence ให้พูดเป็น:

```text
ระบบออกแบบมาเพื่อ...
ตอนนี้อยู่ในรอบพิสูจน์...
เราจะเปิดใช้งานหลังผ่าน proof...
```

ไม่พูดเป็น:

```text
รับประกันว่าไม่มีพลาด
AI จะวิเคราะห์ให้หมด
ต่อได้ทุกระบบทันที
แทนคนบัญชีหรือผู้จัดการได้
```

## Pilot Success Scorecard

ใช้ scorecard นี้หลังจบ 7-day proof เพื่อ decide ว่าจะ:

1. เปิดเป็นรายเดือน
2. ต่อ proof อีก 7 วัน
3. หยุดและแก้ operational gap ก่อน

### Primary Success Metrics

| Metric | Definition | Target for paid pilot | Source |
| --- | --- | --- | --- |
| Executive brief delivery rate | scheduled round ที่ส่ง LINE report หรือ incident notice ถึง target ได้สำเร็จ | >= 98% ใน rolling 7 วัน | `notification_rule_runs`, `line_deliveries` |
| No silent failure rate | failed report/LINE/worker ที่มี incident/audit/Telegram ตาม policy | 100% | `report_runs`, `business_signals`, `operational_alert_deliveries`, `audit_logs` |
| Traceable report coverage | report ที่มี run id, status, row count/duration/failure phase ครบ | 100% ของ report ที่ส่งผู้บริหาร | `report_runs`, `report_run_chunks` |
| Owner comprehension | owner ตอบได้ภายใน 30 วินาทีว่าร้านไหนมีปัญหาและต้องทำอะไรต่อ | ผ่าน demo review | `/owner`, `/owner/audit` |
| Customer pull signal | ลูกค้ายอมเปิดรอบแจ้งเตือนจริงต่อหรือขอดู report เพิ่ม | อย่างน้อย 1 commitment หลัง demo | discovery notes หรือ follow-up message |

### Driver Metrics

| Driver | Why it matters | Target |
| --- | --- | --- |
| Time to onboard one store | ทำให้ขายซ้ำได้ ไม่ติด dev ทุกครั้ง | < 60 นาทีหลังได้ SML/LINE info ครบ |
| Heavy report duration | กัน worker/tick ค้างและลด JavaWS load | อยู่ต่ำกว่า critical threshold หรือมี slow alert |
| Incident notice clarity | ถ้า fail ต้องไม่ทำให้ผู้บริหารงง | ข้อความบอกปัญหา + action ถัดไปเป็นภาษาไทย |
| Proof asset readiness | ทำให้ขายร้านถัดไปเร็วขึ้น | มี screenshot/story ที่ mask ข้อมูลแล้วอย่างน้อย 2 ชิ้น |

### Guardrails

| Guardrail | No-go if |
| --- | --- |
| Secret safety | มี token, endpoint เต็ม, raw SQL, customer rows หรือ response body ใน log/docs/screenshot |
| Trust safety | ระบบสรุปยอดธุรกิจจาก response ที่อ่านไม่ได้ หรือ fail แต่ไม่มี incident |
| Scope safety | ลูกค้าเข้าใจว่าระบบเป็น BI/chatbot/full accounting automation ตั้งแต่วันแรก |
| Support load | owner ต้องให้ dev ช่วยทุกครั้งเมื่อเพิ่มร้านหรือดู failed run |

### Decision Rule

```text
Go paid pilot:
- delivery rate >= 98%
- no silent failure 100%
- Owner UI ตอบ next action ได้
- ลูกค้ารับ scope 7-day proof ได้

Continue proof:
- ระบบส่งได้ แต่ยังมี failed เก่าใน rolling window หรือยังขาด proof asset

No-go:
- silent failure, secret leakage, owner setup ยังพึ่ง dev หนัก, หรือ incident copy ยังทำให้ผู้บริหารเข้าใจผิด
```

## Objection Handling

### "เราเปิด SML ดูเองได้อยู่แล้ว"

ตอบ:

```text
ใช่ครับ ระบบนี้ไม่ได้แทน SML แต่ช่วยให้เจ้าของรู้ก่อนว่าควรเปิดดูเรื่องไหน ไม่ต้องเปิดทุก report เองทุกเช้า
```

### "กลัวข้อมูลผิด"

ตอบ:

```text
นี่คือเหตุผลที่เราออกแบบให้ทุกยอด trace กลับไปที่ report run ได้ และถ้าดึงข้อมูลไม่ได้หรือ JavaWS ตอบผิดรูปแบบ ระบบจะไม่สรุปยอดรอบนั้น
```

### "ไม่อยากเพิ่มระบบใหม่"

ตอบ:

```text
ผู้บริหารเริ่มจาก LINE ก่อน ส่วน Owner portal ใช้เฉพาะตอนตั้งค่าและตรวจปัญหา ไม่ได้บังคับให้เปิดทุกวัน
```

### "ถ้า LINE ส่งไม่สำเร็จล่ะ"

ตอบ:

```text
ระบบบันทึก delivery status และมี ops alert แยกให้ผู้ดูแลรู้ว่า LINE ส่งไม่สำเร็จ โดยไม่ไปแก้สถานะ report ให้ดูเหมือนสำเร็จ
```

### "ข้อมูล SML อยู่ใน server เรา ปลอดภัยไหม"

ตอบ:

```text
ระบบอ่านผ่าน approved report และเก็บเฉพาะ snapshot/audit ที่จำเป็น ไม่ log token, raw SQL, endpoint เต็ม หรือข้อมูลลูกค้าดิบใน alert
```

### "ทำไมต้องจ่ายรายเดือน"

ตอบ:

```text
คุณไม่ได้จ่ายค่าหน้ารายงานอย่างเดียว แต่จ่ายค่าระบบแจ้งเตือน, monitoring, audit, incident handling และการดูแลให้ brief ส่งได้ทุกวัน
```

## Demo Asset Checklist

เก็บ asset เหล่านี้จาก proof จริงเท่านั้น และ mask ข้อมูลลูกค้า:

- LINE brief screenshot ที่อ่านง่าย
- incident notice screenshot
- Owner cockpit screenshot ที่เห็น next action
- proof log summary 1 วัน
- report run/delivery ids แบบ masked หรือเฉพาะ id ที่ไม่เปิดข้อมูลลับ
- before/after story เช่น "จากเดิมรอคนส่งยอด → ตอนนี้ LINE แจ้ง 08:00"

ห้ามใส่:

- token หรือ signed URL เต็ม
- raw SQL
- endpoint เต็ม
- customer list/name ใน screenshot ที่ไม่จำเป็น
- provider response body
- server password หรือ bot token

## Post-Demo Next Step

หลัง demo ต้องขอ commitment ที่เล็กและชัด:

```text
ถ้าเห็นด้วย เราเริ่ม 7-day proof กับร้านเดียวก่อน
ขอ 4 อย่าง: SML JavaWS config, LINE target, รอบเวลาที่ต้องการ, รายงานที่อยากเริ่ม
หลัง 7 วันเราสรุปผลว่าควรเปิดเป็นรายเดือนหรือแก้จุดไหนก่อน
```

## Sales Readiness Checklist

ก่อนนำไปขายร้านใหม่:

- [ ] มี proof log อย่างน้อย 7 วัน หรืออธิบายได้ว่ายังเป็น pilot proof
- [ ] มี LINE brief screenshot ที่ไม่ติดข้อมูลลับ
- [ ] มี incident screenshot หรือ dry-run incident ที่ระบุว่าเป็น demo
- [ ] มี pricing ทดลองและ setup scope ชัด
- [ ] มี no-go criteria ที่ยังไม่ผ่านพร้อมแผนแก้
- [ ] Owner UI ทำให้คนดูแลตอบ next action ได้ใน 30 วินาที
- [ ] backup/restore readiness ไม่เป็นช่องโหว่สำคัญก่อนรับเงินลูกค้า

## Handoff To Creative Assets

เมื่อมี proof จริงครบ ให้ทำ asset ชุดแรก:

1. One-page PDF: pain, promise, LINE screenshot, trust behavior, package
2. 5-slide mini deck: problem, LINE brief, trust layer, owner cockpit, pilot offer
3. Demo script 10 นาที พร้อม screenshot sequence
4. Short LINE-style sample message สำหรับส่งให้ lead

Creative direction:

- calm, precise, operational
- ใช้ภาพหน้าจอจริงเป็น proof object
- ไม่ใช้ hero/AI fantasy/gradient dashboard
- ข้อความต้องอ่านเหมือนคนทำธุรกิจ ไม่ใช่ทีม dev
