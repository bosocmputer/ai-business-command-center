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
- `line_deliveries`
- `line_webhook_events`
- `worker_heartbeats`
- `audit_logs`

ส่วน `datasources`, `line_channels`, `users`, `roles`, `subscriptions` ยังเป็น future expansion หลัง professional pilot stable ตอนนี้ datasource/LINE secrets ยังมาจาก env บน server

### tenants

เก็บบริษัท/ร้านที่เป็นลูกค้า

```text
id
company_name
display_name
plan
status
timezone
created_at
updated_at
```

`status`: `trial`, `active`, `paused`, `cancelled`

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

LINE OA หรือ target config ต่อ tenant

```text
id
tenant_id
name
line_channel_id
encrypted_channel_access_token
target_type
target_id
send_time
timezone
enabled
created_at
updated_at
```

`target_type`: `user`, `group`, `room`

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
