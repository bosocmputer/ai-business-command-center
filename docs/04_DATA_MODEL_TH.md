# Data Model

## เป้าหมายของเอกสาร

นิยาม data model กลางสำหรับระบบ subscription, integration channel, SML JavaWS/partner secret, report registry, report run, snapshot, LINE config, audit และ future chatbot

## Design Principles

- ทุกข้อมูลของลูกค้าต้องมี `tenant_id`
- shared knowledge เช่น `report_definitions` ไม่ผูกกับ tenant โดยตรง
- secret ต้อง encrypted
- report result ต้อง trace กลับไป `report_run_id`
- schema ต้องรองรับหลาย tenant ตั้งแต่แรก แม้ phase 1 ใช้ tenant เดียว
- integration ใหม่ต้องเป็น channel แยก เช่น `sml_reports` หรือ `flowaccount_finance`; ห้ามถือว่า channel อื่นขึ้นกับ SML โดยอัตโนมัติ

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
- `notification_rules`
- `notification_rule_runs`
- `line_webhook_events`
- `worker_heartbeats`
- `secrets`
- `audit_logs`

ส่วน `datasources`, `roles`, `subscriptions`, `tenant_report_configs` และ `integration_channels` ยังเป็น next expansion หลัง SaaS pilot stable ตอนนี้ subscription status ถูกเก็บบน `tenants` ก่อนเพื่อใช้ gate จริง. SML JavaWS/LINE channel secret ย้ายเข้า encrypted store สำหรับ Owner UI แล้ว และ scheduler หลักของการแจ้งเตือนใช้ `notification_rules` แทน env Morning Brief เป็นหลัก

### integration_channels / brief_channels (planned)

เก็บสถานะ integration ต่อ tenant ในเชิง channel:

```text
id
tenant_id
channel_key
display_name
environment
status
schedule_enabled
last_run_at
last_error
metadata_json
created_at
updated_at
```

`channel_key` examples:

- `sml_reports`: SML JavaWS read-only reports
- `flowaccount_finance`: FlowAccount OpenAPI finance/accounting brief
- `ecommerce`: future ecommerce marketplace brief
- `pos`: future POS brief

Policy:

- แต่ละ channel มี credential, permission, runner, schedule, template และ audit แยก
- SML และ FlowAccount ไม่ sync กันโดย default
- executive digest อาจรวมหลาย channel ได้ในอนาคต แต่ snapshot/source ต้อง trace กลับ channel เดิมได้

### tenants

เก็บบริษัท/ร้านที่เป็นลูกค้า

```text
id
name
database_name
description
datasource_configured
feature_flags_json
business_signal_thresholds_json
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
- `feature_flags_json`: rollout gate เช่น Business Signals, LINE Action Digest v2, Demo Mode
- `business_signal_thresholds_json`: threshold override ต่อร้าน ถ้าไม่มีค่าใช้ default กลาง

### secrets

เก็บ encrypted secret envelope สำหรับ SML JavaWS reverse-proxy auth, LINE channel และ partner channel เช่น FlowAccount ใน phase ถัดไป

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

### notification_rules

เก็บแผนแจ้งเตือนต่อร้านที่ Owner ตั้งผ่าน `/owner/notifications`

```text
id
tenant_id
name
enabled
timezone
period_preset
schedule_json
report_keys_json
target_ids_json
message_packaging
digest_mode
retry_policy_json
last_run_at
last_run_status
last_safe_error_message
created_at
updated_at
```

Policy:

- `period_preset` v1: `yesterday`, `today_so_far`, `last_7_days`
- `schedule_json` v1 เป็น recurring weekly เท่านั้น ใช้ ISO weekday `1-7` และเวลา `HH:mm` ได้หลายเวลา
- `target_ids_json` ต้องอ้างถึง `line_targets` ที่ approved/enabled และมีสิทธิ์รับ report keys ที่เลือก
- `message_packaging` v1 คือ `digest` เสมอ
- `digest_mode`: `action_only` ส่ง Action Digest เป็นหลัก, `all_reports` ส่งรายงานที่เลือกครบทุกใบ
- UI ไม่ให้กรอก raw LINE userId/groupId/roomId ใน rule

### notification_rule_runs

เก็บประวัติการ execute notification rule หนึ่งรอบเวลา

```text
id
rule_id
tenant_id
scheduled_local_date
scheduled_local_time
timezone
period_from
period_to
status
attempt
idempotency_key
report_run_ids_json
delivery_ids_json
safe_error_message
started_at
finished_at
next_retry_at
created_at
updated_at
```

Policy:

- `idempotency_key` unique ต่อ rule + local date + local time + attempt เพื่อกันส่งซ้ำในนาทีเดียวกัน
- retry v1 ทำได้ 1 ครั้งหลัง delay ตาม `retry_policy_json`
- `safe_error_message` ต้องไม่เก็บ secret, raw LINE id หรือ SQL เต็ม

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

### datasources (legacy/planned)

ตารางนี้เป็น schema เดิม/next expansion เท่านั้น. Flow ปัจจุบันไม่ใช้ PostgreSQL direct สำหรับ SML ของร้านค้าแล้ว และเก็บ SML JavaWS metadata + encrypted auth ผ่าน `secrets`/system store

```text
id
tenant_id
type
name
base_url
webapp_path
endpoint
config_file_name
database_name
query_method
auth_mode
status
last_tested_at
last_error
created_at
updated_at
```

`type`: `sml_javaws`

ค่าเก่า `sml_postgres` ถ้าพบใน store ให้ถือว่าไม่พร้อมใช้งานและต้องตั้งค่า SML JavaWS ใหม่

### flowaccount_connections (planned)

เก็บ connection metadata ของ `flowaccount_finance` channel โดย token จริงอยู่ใน `secrets`

```text
id
tenant_id
environment
support_code
status
access_token_expires_at
refresh_token_expires_at
last_tested_at
last_error
created_at
updated_at
```

Policy:

- ใช้ OpenID Partner Flow
- เริ่มจาก Sandbox first
- `support_code` ใช้ map FlowAccount business กับ tenant เมื่อ FlowAccount ยืนยันว่า stable/unique
- `access_token` และ `refresh_token` เก็บใน `secrets` scope `flowaccount_oauth`
- รอบ foundation ใช้อ่าน/ทดสอบ connection เท่านั้น ไม่สร้างหรือแก้เอกสาร

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

เปิด/ปิด report/brief ต่อ tenant/channel และตั้งค่าต่าง ๆ

```text
id
tenant_id
report_definition_id
enabled
schedule_enabled
schedule_cron
default_params_json
branch_mode
channel_key
freshness_minutes
created_at
updated_at
```

`branch_mode`: `has_branch_code`, `single_branch`, `unknown`

`channel_key`: `sml_reports`, `flowaccount_finance`, future channel keys

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

LINE OA/channel config สำหรับส่ง LINE ต่อร้าน หรือใช้เป็น Owner shared OA ให้หลายร้านเลือกใช้

```text
id
tenant_id
display_name
channel_type
scope
channel_access_token_configured
channel_secret_configured
enabled
source
created_at
updated_at
```

`scope`:

- `tenant`: LINE OA ของร้านนั้นเอง
- `owner_shared`: LINE OA ของ Owner ที่ร้านอื่นเลือกใช้ได้ ถ้าร้านยังไม่มี LINE OA ของตัวเอง

Token/secret จริงเก็บใน `secrets` แบบ encrypted โดยผูกกับ channel owner (`tenant_id` ของ channel) ไม่ copy secret ไปหลายร้าน. ถ้าร้านยังไม่มี LINE OA ของตัวเอง ให้เลือกใช้ Owner shared OA ได้

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

- `executive`: รับแผนแจ้งเตือน/ถาม chatbot ได้ทุก approved report ที่เปิดให้ tenant
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
- target ของ `owner_shared` LINE OA อาจถูก expose เป็น virtual target ต่อร้าน เพื่อให้แผนแจ้งเตือนของร้านนั้นส่งผ่าน Owner OA ได้โดยไม่ copy LINE secret

### line_deliveries

ประวัติการส่ง LINE

```text
id
tenant_id
report_key
channel_key
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

- `sml_javaws.test_connection`
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
- future multi-channel permission ต้องระบุได้ว่า target รับ brief จาก `channel_key` ใดได้บ้าง
