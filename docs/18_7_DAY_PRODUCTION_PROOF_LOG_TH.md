# 7-Day Production Proof Log

วันที่บันทึก: 2026-06-15
สถานะ: template สำหรับเก็บหลักฐานว่า AI-BCC พร้อมขายแบบ pilot-to-production

## Purpose

เอกสารนี้ใช้เก็บ proof รายวันว่า AI-BCC ทำงานจริงตาม promise ของ productized pilot:

```text
ทุกเช้าเจ้าของร้านรู้เรื่องสำคัญก่อนพลาดผ่าน LINE
ถ้าข้อมูลจาก SML ยังไม่น่าเชื่อถือ ระบบแจ้งเตือนแทนการสรุปยอดผิด
```

ผลลัพธ์จาก 7 วันต้องตอบได้ว่า:

- ส่ง LINE brief หรือ incident notice ได้จริงตามรอบไหม
- ไม่มี silent failure ใช่ไหม
- JavaWS/SML failure ถูก classify พอให้แก้ต่อได้ไหม
- Telegram ops alert ส่งเฉพาะเรื่องที่ต้องรู้ไหม
- Owner UI บอก next action ชัดพอไหม
- มี story จริงพอใช้ขายหรือ demo กับลูกค้าถัดไปไหม

## Scope

Tenant หลัก:

- `tenant_demo_remote / กระบี่`
- `seaandhill_demo`

Tenant ที่ข้ามใน proof นี้:

- `tenant_office_sml1_2026 / 248 SHOP` เพราะร้านนี้ยังไม่ได้เปิดใช้จริงใน coverage รอบนี้

รอบที่ต้องตรวจ:

- `08:00 Asia/Bangkok`
- `18:30 Asia/Bangkok`

แหล่งข้อมูลหลัก:

- `notification_rule_runs`
- `report_runs`
- `report_run_chunks`
- `line_deliveries`
- `operational_alert_deliveries`
- `business_signals`
- `worker_heartbeats`
- `audit_logs`

ห้ามใช้เป็น proof:

- screenshot เดี่ยว ๆ ที่ไม่มี run/delivery id
- log ที่มี token, endpoint เต็ม, raw SQL, provider response body, customer rows หรือ customer names
- manual test แทน scheduled run จริง เว้นแต่ระบุชัดว่าเป็น smoke/manual

## Daily Status Scale

ใช้ status เดียวกันทุกวัน:

- `green`: scheduled run สำเร็จ, LINE ส่งสำเร็จ, no critical incident, no silent failure
- `yellow`: ส่งสำเร็จแต่มี warning เช่น heavy report slow, retry, missing optional report, Telegram summary warning
- `red`: report/LINE/worker fail แล้วกระทบผู้บริหาร หรือ incident/Telegram ไม่ถูกส่งตาม policy
- `gray`: ไม่มีรอบ scheduled จริง หรือข้อมูลตรวจไม่ครบ

## KPI Contract

| KPI | Definition | Source | Passing signal |
| --- | --- | --- | --- |
| Scheduled run completion | notification run ของรอบที่ต้องส่งจบเป็น `success`, `failed`, หรือ retry state ที่ audit ได้ | `notification_rule_runs` | ไม่มี run ค้างแบบไม่รู้สาเหตุ |
| LINE executive delivery | ส่ง report digest หรือ incident notice ไป target ตาม rule | `line_deliveries`, `notification_rule_runs.delivery_ids_json` | `success` หรือ incident fallback ถูกส่งเมื่อ report fail |
| Incident correctness | final retry fail แล้วส่ง LINE incident และ Telegram ops alert ตาม flag | `business_signals`, `line_deliveries`, `operational_alert_deliveries`, `audit_logs` | ไม่มี failure ที่เงียบ |
| JavaWS diagnostic quality | report failure มี `failure_kind`, `failure_phase`, safe metadata | `report_runs` | ระบุ phase ได้มากกว่า `unknown` เมื่อเป็น JavaWS unreadable/timeout/unreachable |
| Heavy report health | `stock_balance` และ `ar_customer_movement` ไม่ทำให้ worker/tick ค้าง | `report_runs`, `report_run_chunks`, `operational_alert_deliveries` | duration อยู่ใน threshold หรือมี slow alert |
| Action Digest readiness | `digest_mode=action_only` ใช้ Action Digest เมื่อ flag เปิด และ fallback ถูกต้องเมื่อไม่มี signal | `notification_rules`, `audit_logs`, `line_deliveries` | digest ส่งถูก mode และ trace ได้ |
| Business signal usefulness | มี signal ที่ actionable หรือ data_quality signal เมื่อ report fail | `business_signals` | signal มี recommended action และ lifecycle status |
| Worker health | worker heartbeat สดและไม่มี tick fail ต่อเนื่อง | `worker_heartbeats`, `audit_logs`, `operational_alert_deliveries` | heartbeat ไม่ stale เกิน policy |

## Daily Log Template

คัดลอก block นี้ต่อท้ายเอกสารทุกครั้งที่ตรวจรอบจริง:

```md
## YYYY-MM-DD Proof Entry

ช่วงที่ตรวจ: YYYY-MM-DD HH:mm-HH:mm Asia/Bangkok
ผู้ตรวจ:
Production commit:
Overall status: green/yellow/red/gray

### Tenant: tenant_demo_remote / กระบี่

| Round | Notification run | Reports | Rows | LINE | Telegram | JavaWS phase | Heavy reports | Digest mode | Status |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| 08:00 |  |  |  |  |  |  |  |  |  |
| 18:30 |  |  |  |  |  |  |  |  |  |

Evidence:
- notification_rule_run ids:
- report_run ids:
- line_delivery ids:
- operational_alert_delivery ids:
- business_signal ids:

Customer-facing result:
- ผู้บริหารได้รับ:
- ข้อความอ่านเข้าใจไหม:
- ถ้า fail ระบบบอก action ถัดไปไหม:

Ops result:
- Telegram ส่งหา owner/operator:
- worker heartbeat:
- slow/heavy warning:
- silent failure found: yes/no

Sales/demo evidence:
- เหตุการณ์จริงที่ใช้เล่า demo:
- screenshot หรือข้อความที่เก็บได้โดยไม่ติด secret/customer data:

Next action:
-

### Tenant: seaandhill_demo

| Round | Notification run | Reports | Rows | LINE | Telegram | JavaWS phase | Heavy reports | Digest mode | Status |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| 08:00 |  |  |  |  |  |  |  |  |  |
| 18:30 |  |  |  |  |  |  |  |  |  |

Evidence:
- notification_rule_run ids:
- report_run ids:
- line_delivery ids:
- operational_alert_delivery ids:
- business_signal ids:

Customer-facing result:
- ผู้บริหารได้รับ:
- ข้อความอ่านเข้าใจไหม:
- ถ้า fail ระบบบอก action ถัดไปไหม:

Ops result:
- Telegram ส่งหา owner/operator:
- worker heartbeat:
- slow/heavy warning:
- silent failure found: yes/no

Sales/demo evidence:
- เหตุการณ์จริงที่ใช้เล่า demo:
- screenshot หรือข้อความที่เก็บได้โดยไม่ติด secret/customer data:

Next action:
-
```

## Safe SQL Readout Queries

ใช้ query เหล่านี้เป็นจุดเริ่มต้นตอนตรวจ production DB. แทนค่า date/time/tenant เอง และอย่า export response body หรือ secret metadata ออกนอกเครื่อง

### Notification Runs

```sql
select
  nrr.tenant_id,
  t.name as tenant_name,
  nrr.scheduled_local_date,
  nrr.scheduled_local_time,
  nrr.status,
  nrr.attempt,
  nrr.mode,
  nrr.source,
  nrr.period_from,
  nrr.period_to,
  nrr.progress_stage,
  nrr.progress_percent,
  nrr.report_run_ids_json,
  nrr.delivery_ids_json,
  nrr.safe_error_message,
  nrr.started_at,
  nrr.finished_at,
  nrr.updated_at
from notification_rule_runs nrr
join tenants t on t.id = nrr.tenant_id
where nrr.tenant_id in ('tenant_demo_remote', 'seaandhill_demo')
  and nrr.scheduled_local_date = date 'YYYY-MM-DD'
  and nrr.scheduled_local_time in ('08:00', '18:30')
order by nrr.scheduled_local_date, nrr.scheduled_local_time, nrr.tenant_id, nrr.created_at;
```

### Report Runs

```sql
select
  rr.tenant_id,
  rr.report_key,
  rr.id as report_run_id,
  rr.status,
  rr.execution_strategy,
  rr.progress_stage,
  rr.progress_percent,
  rr.row_count,
  rr.failure_kind,
  rr.failure_phase,
  rr.safe_error_message,
  rr.started_at,
  rr.finished_at,
  extract(epoch from (coalesce(rr.finished_at, now()) - rr.started_at))::int as duration_seconds
from report_runs rr
where rr.tenant_id in ('tenant_demo_remote', 'seaandhill_demo')
  and rr.started_at >= timestamptz 'YYYY-MM-DD 00:00:00+07'
  and rr.started_at < timestamptz 'YYYY-MM-DD 23:59:59+07'
order by rr.started_at desc;
```

### Heavy Report Chunks

```sql
select
  rrc.tenant_id,
  rrc.report_key,
  rrc.report_run_id,
  count(*) as chunks_total,
  count(*) filter (where rrc.status = 'success') as chunks_success,
  count(*) filter (where rrc.status = 'failed') as chunks_failed,
  count(*) filter (where rrc.status = 'running') as chunks_running,
  sum(rrc.unit_count) as units_total,
  sum(rrc.row_count) as rows_total,
  max(rrc.duration_ms) as slowest_chunk_ms,
  max(rrc.safe_error_message) filter (where rrc.status = 'failed') as sample_safe_error
from report_run_chunks rrc
where rrc.tenant_id in ('tenant_demo_remote', 'seaandhill_demo')
  and rrc.created_at >= timestamptz 'YYYY-MM-DD 00:00:00+07'
  and rrc.created_at < timestamptz 'YYYY-MM-DD 23:59:59+07'
group by rrc.tenant_id, rrc.report_key, rrc.report_run_id
order by rrc.tenant_id, rrc.report_key;
```

### LINE Deliveries

```sql
select
  ld.tenant_id,
  ld.report_key,
  ld.report_run_id,
  ld.delivery_type,
  ld.message_type,
  ld.status,
  ld.target_id_masked,
  ld.period_from,
  ld.period_to,
  ld.safe_error_message,
  ld.created_at,
  ld.sent_at
from line_deliveries ld
where ld.tenant_id in ('tenant_demo_remote', 'seaandhill_demo')
  and ld.created_at >= timestamptz 'YYYY-MM-DD 00:00:00+07'
  and ld.created_at < timestamptz 'YYYY-MM-DD 23:59:59+07'
order by ld.created_at desc;
```

### Telegram Ops Alerts

```sql
select
  channel,
  alert_type,
  severity,
  status,
  dedupe_key,
  target_id_masked,
  safe_error_message,
  created_at,
  sent_at
from operational_alert_deliveries
where created_at >= timestamptz 'YYYY-MM-DD 00:00:00+07'
  and created_at < timestamptz 'YYYY-MM-DD 23:59:59+07'
order by created_at desc;
```

### Business Signals

```sql
select
  tenant_id,
  source_report_key,
  source_run_id,
  category,
  severity,
  title,
  status,
  period_from,
  period_to,
  recommended_action,
  created_at,
  updated_at
from business_signals
where tenant_id in ('tenant_demo_remote', 'seaandhill_demo')
  and created_at >= timestamptz 'YYYY-MM-DD 00:00:00+07'
  and created_at < timestamptz 'YYYY-MM-DD 23:59:59+07'
order by tenant_id, severity, created_at desc;
```

### Worker Heartbeat

```sql
select
  role,
  worker_id,
  status,
  checked_at
from worker_heartbeats
order by checked_at desc
limit 20;
```

## Daily Summary Format

เวลาแจ้งผลกลับใน chat ให้ใช้ format นี้:

```text
สรุป YYYY-MM-DD รอบ 08:00/18:30

กระบี่: green/yellow/red
- LINE: ส่งรายงาน/incident แล้วหรือไม่
- Reports: success/failed + report keys + row counts
- JavaWS: ไม่มีปัญหา / failure_kind / failure_phase
- Telegram: ส่ง alert/summary หรือไม่
- สิ่งที่ต้องทำต่อ:

seaandhill: green/yellow/red
- LINE:
- Reports:
- JavaWS:
- Telegram:
- สิ่งที่ต้องทำต่อ:

ข้อสรุปสำหรับ product proof:
- ใช้เป็น sales evidence ได้ไหม:
- ยังติด no-go criteria อะไร:
```

## Proof Exit Criteria

ครบ 7 วันแล้วถือว่าผ่าน proof เมื่อ:

- ทุก scheduled round มี result ที่ trace ได้
- ไม่มี silent failure
- LINE report หรือ incident notice ส่งถูก target ตาม policy
- Telegram alert ไม่ทำให้ executive LINE flow fail
- JavaWS failure มี diagnostic phase ที่ actionable
- heavy report ไม่ทำให้ notification worker ตอบช้า/ค้าง
- Owner cockpit มี next action ชัดจากข้อมูลจริง
- มี story อย่างน้อย 2 เหตุการณ์ที่นำไปใช้ขายได้โดยไม่เปิดเผยข้อมูลลูกค้า

ถ้าไม่ผ่าน ให้เปิด issue/plan จาก no-go criteria ก่อนขายร้านใหม่
