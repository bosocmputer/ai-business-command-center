# Data Model

## เป้าหมายของเอกสาร

นิยาม data model กลางสำหรับระบบ subscription, datasource, report registry, report run, snapshot, LINE config, audit และ future chatbot

## Design Principles

- ทุกข้อมูลของลูกค้าต้องมี `tenant_id`
- shared knowledge เช่น `report_definitions` ไม่ผูกกับ tenant โดยตรง
- secret ต้อง encrypted
- report result ต้อง trace กลับไป `report_run_id`
- schema ต้องรองรับหลาย tenant ตั้งแต่แรก แม้ phase 1 ใช้ tenant เดียว

## Core Tables

Current implementation ผ่าน `SystemStore` persist ตารางหลักใน PostgreSQL system DB แล้ว:

- `tenants`
- `report_definitions`
- `report_runs`
- `report_snapshots`
- `users`
- `line_channels`
- `line_targets`
- `line_deliveries`
- `line_webhook_events`
- `worker_heartbeats`
- `secrets`
- `audit_logs`

ส่วน `datasources`, `roles`, `subscriptions`, `tenant_report_configs` ยังเป็น next expansion หลัง SaaS pilot stable ตอนนี้ subscription status ถูกเก็บบน `tenants` ก่อนเพื่อใช้ gate จริง ส่วน datasource/LINE channel secret ยังมาจาก env บน server หรือ metadata ใน `line_channels` โดยไม่ commit secret ลง repo. รอบล่าสุดเพิ่ม `secrets` เป็น encrypted secret foundation แล้ว แต่ยังไม่ migrate credential จริงเข้า workflow config

### tenants

เก็บบริษัท/ร้านที่เป็นลูกค้า

```text
id
name
database_name
description
datasource_configured
status
plan_code
suspended_reason
current_period_end
```

`status`: `trial`, `active`, `past_due`, `suspended`, `cancelled`

Policy:

- `trial` / `active`: dashboard และ LINE ใช้งานได้
- `past_due`: ยังใช้งานได้ แต่ owner เห็น warning
- `suspended` / `cancelled`: customer viewer ถูก block และ scheduler ไม่ส่ง LINE

### secrets

เก็บ encrypted secret envelope สำหรับ datasource และ LINE channel ใน phase ถัดไป

```text
id
tenant_id
scope
secret_key
encrypted_value
encryption_key_id
metadata_json
created_at
updated_at
```

Policy:

- `encrypted_value` ต้องเป็น envelope จาก secret vault ไม่ใช่ plaintext
- `tenant_id + scope + secret_key` ใช้เป็น boundary เพื่อป้องกันนำ secret ข้าม tenant
- UI/API ที่ list secret ต้องคืนเฉพาะ metadata และ `has_encrypted_value`
- decrypt เฉพาะตอน worker/API ต้องใช้งานจริงใน memory

### subscriptions

เก็บ package และสถานะรายเดือน

```text
id
tenant_id
plan_code
status
billing_cycle
started_at
current_period_start
current_period_end
cancelled_at
metadata_json
```

### datasources

เก็บ connection ไปยัง SML PostgreSQL

```text
id
tenant_id
type
name
host
port
database_name
username
encrypted_password
ssl_mode
connection_mode
status
last_tested_at
last_error
created_at
updated_at
```

`type`: `sml_postgres`

`connection_mode`: `direct_ip`, `vpn`, `local_connector`

### report_definitions

shared report library กลาง

```text
id
report_key
name
description
category
version
sql_template
parameters_schema_json
output_schema_json
summary_rules_json
dashboard_widgets_json
line_template_json
chatbot_policy_json
status
created_at
updated_at
```

`status`: `draft`, `active`, `deprecated`

### tenant_report_configs

เปิด/ปิด report ต่อ tenant และตั้งค่าต่าง ๆ

```text
id
tenant_id
report_definition_id
enabled
schedule_enabled
schedule_cron
default_params_json
branch_mode
freshness_minutes
created_at
updated_at
```

`branch_mode`: `has_branch_code`, `single_branch`, `unknown`

### report_runs

ประวัติการรัน report

```text
id
tenant_id
report_definition_id
datasource_id
trigger_type
status
params_json
result_json
row_count
started_at
finished_at
duration_ms
error_code
error_message
created_at
```

`trigger_type`: `manual`, `schedule`, `line_brief`, `chatbot`

`status`: `queued`, `running`, `success`, `failed`, `timeout`, `cancelled`

### report_snapshots

ข้อมูลที่ normalize เพื่อใช้ dashboard/LINE/chatbot

```text
id
tenant_id
report_definition_id
report_run_id
period_from
period_to
snapshot_type
data_json
summary_json
quality_status
created_at
```

`quality_status`: `valid`, `stale`, `failed`, `partial`

### line_channels

LINE OA/channel config ต่อ tenant ใน production

```text
id
tenant_id
display_name
channel_type
channel_access_token_configured
channel_secret_configured
enabled
source
created_at
updated_at
```

Phase ปัจจุบัน `line_channels` เป็น registry/metadata สำหรับ Owner Admin ก่อน เช่น มี token/secret แล้วหรือยัง, เปิดใช้งานหรือไม่, source มาจาก env/manual. Token จริงยังอยู่ใน env (`LINE_CHANNEL_ACCESS_TOKEN` หรือ tenant-specific env) จนกว่าจะเพิ่ม encrypted secret store

### line_targets

ปลายทาง LINE ต่อ tenant เช่น `userId`, `groupId`, หรือ `roomId` พร้อม permission profile ระดับ target. ค่า default ใหม่ของ pilot คือส่งส่วนตัวให้ผู้บริหาร (`userId`) ก่อน ส่วน group ใช้เฉพาะข้อมูลที่ทีมควรเห็นร่วมกัน

```text
id
tenant_id
line_channel_id
display_name
target_type
target_id
target_id_masked
target_id_hash
recipient_count_estimate
access_profile_key
allowed_report_keys
allowed_actions
enabled
approved
source
last_delivery_at
created_at
updated_at
```

`target_type`: `user`, `group`, `room`

`recipient_count_estimate` ใช้เพื่อประมาณ LINE quota เท่านั้น ไม่ใช่ตัวควบคุมการส่งจริง:

- `user`: default = `1`
- `group` / `room`: owner กรอกเองเมื่อรู้จำนวนสมาชิกโดยประมาณ

`access_profile_key`:

- `executive`: รับ Morning Brief/ถาม chatbot ได้ทุก approved report ที่เปิดให้ tenant
- `sales_manager`: ดูรายงานขายได้ แต่อนาคตต้องแยก margin/profit ถ้ามี
- `operations`: เตรียมไว้สำหรับ stock/SO/backlog; ไม่เห็นรายงานขายถ้าไม่ได้เปิดสิทธิ์
- `staff`: ไม่เห็นยอดขายรวม และ chatbot ต้องตอบว่าไม่มีสิทธิ์เมื่อถาม report ที่ถูก deny

`allowed_actions`:

- `receive_morning_brief`
- `ask_report`
- `open_signed_viewer`

กติกา:

- target ใหม่จาก webhook ต้อง `approved=false`, `enabled=false` เสมอ
- API response และ audit ใช้ `target_id_masked`/`target_id_hash` ห้ามโชว์ `target_id` เต็ม
- env fallback target ปิดเป็นค่า default; pilot/production ต้องใช้ target registry ที่ผูก `tenant_id` และผ่านการอนุมัติเท่านั้น

### line_deliveries

ประวัติการส่ง LINE

```text
id
tenant_id
report_key
report_run_id
delivery_key
delivery_type
period_from
period_to
target_id_masked
message_type
status
provider_response_json
safe_error_message
sent_at
created_at
```

`delivery_type`: `manual_test`, `morning_brief`

`message_type`: `text`, `flex`

`status`: `dry_run`, `success`, `failed`, `skipped`

### line_webhook_events

เก็บ event inbound จาก LINE webhook เพื่อหา target id และเตรียม chatbot ในอนาคต

```text
id
event_type
source_type
source_id
source_id_masked
user_id
message_text
raw_event_json
created_at
```

default API response ต้องคืน masked ids เท่านั้น

### worker_heartbeats

ใช้ตรวจว่างานเบื้องหลังยังทำงานอยู่

```text
id
worker_id
role
status
metadata_json
checked_at
created_at
```

### users

ผู้ใช้ dashboard

```text
id
tenant_id
email
display_name
status
created_at
updated_at
```

### roles

บทบาทและ permission

```text
id
tenant_id
role_key
name
permissions_json
created_at
updated_at
```

Phase 1 ใช้ owner/admin เป็นหลักได้ แต่ต้องมี schema รองรับ

### audit_logs

บันทึกเหตุการณ์สำคัญ

```text
id
tenant_id
actor_type
actor_id
action
resource_type
resource_id
metadata_json
created_at
```

ตัวอย่าง `action`:

- `datasource.test_connection`
- `report.run`
- `report.snapshot.created`
- `line.message.sent`
- `user.login`

## Future Chatbot Tables

### chat_sessions

```text
id
tenant_id
channel_type
external_user_id
status
created_at
updated_at
```

### chat_messages

```text
id
tenant_id
chat_session_id
role
message_text
intent_json
report_run_id
created_at
```

## Tenant Isolation Rules

- API ทุก endpoint ต้อง resolve `tenant_id`
- Worker ทุก job ต้องมี `tenant_id`
- Query system DB ทุกครั้งที่อ่าน customer data ต้อง filter `tenant_id`
- ห้าม reuse LINE target ข้าม tenant
- ห้าม cache report result แบบไม่มี tenant namespace
