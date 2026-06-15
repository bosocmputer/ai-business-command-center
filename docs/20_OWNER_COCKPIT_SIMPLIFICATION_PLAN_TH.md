# Owner Cockpit Simplification Plan

วันที่บันทึก: 2026-06-15
สถานะ: implementation plan สำหรับปรับ `/owner` ให้เป็น cockpit ที่ใช้จริงระหว่าง proof และขาย pilot

## Decision

`/owner` ต้องเป็นหน้า **Operations Cockpit** ไม่ใช่หน้า home ที่รวมทุก widget

หน้าแรกต้องตอบ 3 คำถามภายใน 30 วินาที:

```text
ร้านไหนปกติ
ร้านไหนมีปัญหา
ต้องทำอะไรต่อ
```

ถ้าผู้ดูแลต้องไล่เปิด `/owner/reports`, `/owner/line`, `/owner/audit` เพื่อรู้ว่าร้านพร้อมหรือไม่ แปลว่า cockpit ยังไม่ผ่าน

## Product Design Brief

Thing to design:

- `/owner` overview สำหรับ owner/operator ที่ดูแลหลายร้าน
- ใช้ระหว่าง 7-day production proof, onboarding ร้านใหม่, และ demo ก่อนขาย

Visual source:

- ใช้ TailAdmin/current Owner UI เดิม
- คง dense operational layout, 8px-ish radius, badge/status/table pattern เดิม
- ไม่สร้าง landing page, hero, decorative dashboard, gradient หรือ visual language ใหม่

Interaction level:

- Full interaction สำหรับ action ที่มีอยู่แล้ว เช่นเลือก tenant, ไปหน้า setup, acknowledge/resolved signal
- Phase แรกเป็น refactor/IA ไม่เปลี่ยน business logic

## Current Evidence

จาก source ปัจจุบัน `apps/web/src/components/owner/OwnerPortal.tsx`:

- `OwnerOverviewContent` มี stat cards, signal metrics, `StoreSetupCockpitCard`, `OwnerRolloutBoard`, `OwnerProductionReadinessBoard`, tenant table, action items และ flow card
- `StoreSetupCockpitCard` มี selected tenant, readiness, business signals และ next step
- มี operations status จาก `/api/owner/operations/status`
- มี business signal lifecycle action อยู่แล้ว

ปัญหาหลัก:

- หน้าแรกมีหลาย panel ที่ตอบคำถามใกล้กัน ทำให้ cognitive load สูง
- next action กระจายอยู่หลายที่
- stat cards ยังนับของระบบมากกว่าบอก operational decision
- proof/sales evidence ยังไม่เด่น เช่น scheduled round ล่าสุด, LINE delivery, Telegram alert, JavaWS phase
- ยังไม่มี first viewport ที่ชัดว่า “วันนี้ต้องทำอะไร”

## Target First Viewport

ลำดับบนสุดของ `/owner` ควรเป็น:

1. **Proof/Operations Status Bar**
   - tenant scope: all active / selected tenant
   - proof day count ถ้ามี 7-day proof active
   - latest scheduled round status
   - silent failure status
   - worker heartbeat freshness

2. **Next Action Panel**
   - แสดง action เดียวที่สำคัญที่สุด
   - มีเหตุผลสั้น ๆ ว่าทำไมต้องทำ
   - CTA ไปหน้าที่ถูกต้อง เช่น `/owner/sml-connections`, `/owner/line`, `/owner/notifications`, `/owner/audit`, `/owner/reports`

3. **Store Health Matrix**
   - rows = tenant
   - columns = SML, LINE, schedule, last run, incident, open signals, proof status
   - row click เลือก tenant และเปิด detail ด้านล่าง

สิ่งที่ไม่ควรอยู่ first viewport:

- setup guide ยาว
- repeated stat cards ที่ไม่ได้บอก action
- debug detail เช่น raw run ids, tokens, endpoint, SQL
- multiple competing CTAs

## Information Architecture

### `/owner`

Role: cockpit

ควรมี:

- global status summary
- next best action
- store health matrix
- selected tenant detail
- latest proof/scheduled round summary
- open business signals แบบ compact

ไม่ควรมี:

- token setup form
- raw diagnostic detail
- long audit table
- every report test button

### `/owner/sml-connections`

Role: setup SML/JavaWS

ควรมี:

- SML config form
- datasource health resolver
- JavaWS diagnostic result
- safe setup errors

### `/owner/line`

Role: LINE channel and target setup

ควรมี:

- LINE OA readiness
- target approval
- test send
- channel secret/token status แบบ masked

### `/owner/notifications`

Role: scheduled brief rules

ควรมี:

- schedule
- digest mode
- report set
- target set
- manual send from saved rule

### `/owner/reports`

Role: manual report validation and heavy run test

ควรมี:

- manual report run
- heavy report progress
- validation signoff
- latest snapshots

### `/owner/audit`

Role: diagnostics and evidence

ควรมี:

- notification runs
- report runs
- LINE deliveries
- Telegram deliveries
- JavaWS failure phase
- worker heartbeat
- dry-run smoke tests

## Cockpit KPI Framework

Primary KPI:

| KPI | Definition | Target |
| --- | --- | --- |
| Time to next action | ผู้ดูแลเปิด `/owner` แล้วรู้ action สำคัญสุดภายในกี่วินาที | <= 30s |

Driver metrics:

| Metric | Definition | Target |
| --- | --- | --- |
| Critical issue visibility | critical tenant/report/LINE/worker issue ปรากฏใน first viewport | 100% |
| Duplicate action count | จำนวน CTA ที่นำไปทำ action เดียวกันใน first viewport | <= 1 ต่อ action |
| Proof evidence visibility | scheduled run/LINE/incident proof ล่าสุดเห็นใน cockpit โดยไม่เข้า audit | 100% สำหรับ tenant proof |
| Tenant readiness clarity | tenant health matrix บอก missing prerequisite ได้ในหนึ่ง row | 100% active tenants |

Guardrails:

| Guardrail | Definition | Target |
| --- | --- | --- |
| No secret leakage | ไม่แสดง token, endpoint เต็ม, raw SQL, customer list, provider body | 0 |
| No hidden failure | failed run/delivery/worker stale ไม่ถูกซ่อนไว้หลัง success card | 0 |
| Mobile no overflow | first viewport ไม่มี horizontal overflow ที่ 390px | 100% |
| No destructive misclick | critical setup/test/send actions มี confirm/disabled/loading guard | 100% |

## Next Best Action Rules

ใช้ priority นี้สำหรับ action เดียวใน cockpit:

1. **Security/secret missing**
   - condition: SML/LINE secret required but missing
   - CTA: ไปหน้า setup ที่เกี่ยวข้อง

2. **Datasource not runnable**
   - condition: SML connection missing/unhealthy หรือ JavaWS failure ล่าสุดเป็น `unreachable`, `operation_missing`, `soap_parse_failed`, `invalid_zip`, `missing_resultset`
   - CTA: ตรวจ SML connection

3. **LINE cannot deliver**
   - condition: no enabled/approved target, channel token missing, latest LINE delivery failed
   - CTA: ตรวจ LINE OA/ผู้รับ

4. **Scheduled run failed**
   - condition: latest notification run failed/final retry
   - CTA: เปิด audit ของ run นั้น

5. **Open critical business signal**
   - condition: critical open signal
   - CTA: เปิด selected tenant detail และ action lifecycle

6. **Proof incomplete**
   - condition: proof day missing round or not checked
   - CTA: เปิด proof log/audit check

7. **Ready**
   - condition: no blocker
   - CTA: ดู latest digest หรือรอรอบถัดไป

ถ้ามีหลาย tenant มีปัญหา ให้เลือก highest severity แล้วใช้ health matrix บอก tenant อื่น

## Proposed UI Blocks

### 1. Operations Status Bar

Content:

- `พร้อมส่งรอบถัดไป` / `ต้องแก้ก่อนรอบถัดไป`
- active tenants count
- latest scheduled round status
- worker heartbeat freshness
- Telegram ops target status

Copy examples:

```text
พร้อมส่งรอบถัดไป
2 ร้าน active, รอบล่าสุดส่ง LINE สำเร็จ, worker ปกติ
```

```text
ต้องแก้ก่อนรอบถัดไป
กระบี่มี JavaWS invalid_zip จากรอบ 08:00 และส่ง incident แล้ว
```

### 2. Next Action Panel

Content:

- action title
- why it matters
- affected tenant
- CTA
- secondary link to audit

Copy examples:

```text
ตรวจ SML JavaWS ของกระบี่
รอบ 08:00 ระบบติดต่อ JavaWS ได้ แต่ zip ที่ตอบกลับมาเปิดไม่ได้ จึงไม่ควรใช้ยอดรอบนี้
```

```text
เลือกผู้รับ LINE ของ seaandhill
ร้านนี้พร้อมดึงรายงานแล้ว แต่ยังไม่มี target ที่ approved สำหรับส่งผู้บริหาร
```

### 3. Store Health Matrix

Columns:

- ร้าน
- สถานะเปิดใช้
- SML
- LINE
- แผนแจ้งเตือน
- รอบล่าสุด
- Incident
- เรื่องที่เปิดอยู่
- Proof

Rules:

- ใช้ badge สี + ข้อความ ไม่ใช้สีอย่างเดียว
- row ต้องมี action link เดียวที่สอดคล้องกับ blocker หลัก
- cancelled/suspended แสดงแยกท้ายตารางหรือตัวกรอง ไม่ปนกับ active proof

### 4. Selected Tenant Detail

แสดงเมื่อเลือก tenant:

- readiness checklist แบบ compact
- latest notification run
- latest LINE delivery
- latest JavaWS failure phase
- latest heavy report duration
- top 3 open business signals
- next scheduled time

ไม่แสดง raw:

- token
- endpoint เต็ม
- SQL
- customer data
- provider response body

### 5. Proof Strip

สำหรับ tenant ที่อยู่ใน 7-day proof:

- Day 1-7 status
- latest checked round
- missing round count
- sales/demo evidence count
- link to proof log doc/audit

ถ้ายังไม่มี implementation เก็บ proof ใน DB ให้เริ่มจาก manual status derived from daily checks

## Empty And Error States

### No tenants

```text
ยังไม่มีร้านค้า
เพิ่มร้านแรก แล้วเชื่อม SML JavaWS ก่อนตั้งแผนแจ้งเตือน
```

CTA: `เพิ่มร้านค้า`

### Tenant exists but no SML

```text
ยังดึงรายงานไม่ได้
ร้านนี้ยังไม่ได้ตั้งค่า SML JavaWS จึงยังส่ง brief จริงไม่ได้
```

CTA: `ตั้งค่า SML`

### SML configured but LINE missing

```text
พร้อมดึงรายงาน แต่ยังส่งผู้บริหารไม่ได้
เลือก LINE OA และอนุมัติผู้รับก่อนเปิดรอบแจ้งเตือน
```

CTA: `ตั้งค่า LINE`

### Scheduled run failed

```text
รอบล่าสุดยังใช้สรุปธุรกิจไม่ได้
ระบบบันทึก incident แล้ว ให้ตรวจสาเหตุจาก SML/JavaWS ก่อนรันใหม่
```

CTA: `ดูรายละเอียดปัญหา`

### All ready

```text
ร้านหลักพร้อมใช้งาน
รอรอบแจ้งเตือนถัดไป หรือเปิดดู proof ล่าสุดได้
```

CTA: `ดูรอบล่าสุด`

## Implementation Plan

### Phase 1: IA Refactor Only

- รวม stat cards ให้เหลือ status bar เดียว
- ยก next best action ขึ้น first viewport
- ลด duplicate panel ระหว่าง rollout board, production readiness board และ action items
- ให้ Store Health Matrix เป็น default table แทน tenant operations table เดิม
- คง component/function เดิมเท่าที่ใช้ได้

No API changes required unless current payload ขาด field สำคัญ

### Phase 2: Proof-Aware Cockpit

- เพิ่ม proof strip ที่อ่านจาก proof/audit หรือ manual derived status
- แสดง latest scheduled round per tenant
- แสดง latest LINE/incident/Telegram summary
- เพิ่ม link จาก proof strip ไป `/owner/audit`

### Phase 3: Reduce Advanced Noise

- ย้าย setup guides/debug sections ที่ไม่ใช้ทุกวันออกจาก overview
- เก็บ diagnostic/dry-run ใน `/owner/audit`
- เก็บ test/report run controls ใน `/owner/reports`
- เก็บ LINE target setup ใน `/owner/line`

### Phase 4: Browser QA

- ตรวจ desktop current tunnel/local
- ตรวจ mobile 390px
- ตรวจ empty/error/loading
- ตรวจ duplicate click disabled
- ตรวจว่า first viewport ไม่ overflow และไม่ซ้อน

## Release Acceptance

ก่อนถือว่า cockpit พร้อม:

- ผู้ดูแลเปิด `/owner` แล้วรู้ next action ได้ภายใน 30 วินาทีจากข้อมูลจริง
- active tenant ทุกตัวมี health row และ blocker หลัก
- scheduled run/LINE incident ล่าสุดเห็นใน overview สำหรับ tenant proof
- critical business signal แสดงใน selected tenant detail
- ไม่มี token, endpoint เต็ม, SQL, provider body หรือ customer list ใน overview
- mobile 390px ไม่มี horizontal overflow
- action buttons มี loading/disabled state เดิมครบ
- smoke test ไม่เปลี่ยน report calculation หรือ notification behavior

## Out Of Scope

- ไม่ redesign ทั้ง Owner Portal
- ไม่ทำ dashboard warehouse แยก
- ไม่เพิ่ม chatbot
- ไม่เปลี่ยน LINE executive message logic
- ไม่เปลี่ยน report calculation
- ไม่เพิ่ม visual/creative assets ใน UI จนกว่าจะมี proof screenshot จริง

## Follow-Up

หลัง Phase 1 ผ่าน:

- เก็บ browser screenshots ก่อน/หลัง
- ให้ผู้ใช้ที่ไม่ใช่ dev เปิด `/owner` แล้วบอก action ถัดไป
- ใช้ผลจาก 7-day proof ปรับ copy/status labels
- ถ้า cockpit ใช้ขาย demo ได้ ให้ถ่าย screenshot สำหรับ `docs/19_PILOT_SALES_DEMO_KIT_TH.md`
