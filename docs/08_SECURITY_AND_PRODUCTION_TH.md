# Security and Production Readiness

## เป้าหมายของเอกสาร

กำหนด security baseline และ production checklist สำหรับระบบที่เชื่อม SML PostgreSQL ของลูกค้าและส่งข้อมูลผ่าน dashboard/LINE OA

## Core Security Rules

- ใช้ DB user แบบ read-only เท่านั้น
- ไม่ใช้ superuser เช่น `postgres` ใน production
- ไม่บันทึก password plaintext
- ไม่ให้ AI generate SQL production เอง
- ทุก customer data ต้องแยกด้วย `tenant_id`
- ทุก report run ต้องมี audit/run log

## Current MVP Security Baseline

สถานะล่าสุดวันที่ `2026-05-20`:

- System store ใช้ PostgreSQL แล้ว
- Signed report viewer ใช้ token ผูกกับ `tenant_id + report_key + run_id + expires_at`
- Signed viewer TTL default = `72` ชั่วโมง
- Mutation endpoints ใช้ lightweight admin token ผ่าน header `x-ai-bcc-admin-token`
- UI prompt admin token และเก็บใน `sessionStorage`
- UI ต้อง confirm ก่อนส่ง LINE จริง
- API log redact `x-ai-bcc-admin-token`
- LINE target แสดงแบบ masked เท่านั้น
- Secret จริงอยู่ใน `.env.server` บน server และห้าม commit

Protected mutation endpoints:

```text
POST /api/reports/:tenantId/sales_goods_services/run
POST /api/reports/:tenantId/sales_goods_services/morning-brief/run-and-send
POST /api/reports/:tenantId/sales_goods_services/line-send-test
POST /api/tenants/:tenantId/datasource/test
```

Response policy:

- no token -> `401`
- wrong token -> `403`
- server token not configured -> `503`

ข้อจำกัด: admin token เป็น MVP guard สำหรับ pilot เท่านั้น ไม่ใช่ replacement ของ login/role permission

## Database Access

### Recommended Production User

```text
username: ai_report_readonly
permission: SELECT only
scope: เฉพาะ schema/table/view ที่ใช้รายงาน
```

### Connection Modes

#### Direct IP

ใช้ได้ถ้าต้องเริ่มเร็ว แต่ต้องมี:

- IP allowlist
- firewall จำกัด source
- strong password
- read-only user
- SSL if available

#### VPN / Tailscale / WireGuard

เหมาะกับ production มากกว่า direct public DB

#### Local Connector Agent

เหมาะกับลูกค้าที่ไม่เปิด DB ออก internet โดย agent อยู่ใน network ลูกค้าและส่ง result กลับ platform

## Secret Management

`datasources.encrypted_password` และ `line_channels.encrypted_channel_access_token` ต้อง encrypted

ขั้นต่ำสำหรับ MVP:

- encrypt ด้วย application secret จาก environment variable
- ห้าม log secret
- decrypt เฉพาะตอนใช้งานใน memory

Production:

- ใช้ secret manager หรือ KMS
- key rotation
- access audit

## Query Safety

Report SQL ต้อง:

- มาจาก `report_definitions` ที่ approved แล้ว
- ใช้ parameterized query
- มี query timeout
- จำกัดช่วงวันที่
- block statement อันตราย

Block list:

```text
insert
update
delete
drop
alter
truncate
create
grant
revoke
copy
```

หมายเหตุ: block list เป็นชั้นเสริม ไม่ใช่ substitute ของ read-only user

## Tenant Isolation Checklist

- API endpoint ทุกตัว filter ด้วย `tenant_id`
- worker job ทุกตัวมี `tenant_id`
- report result ทุก record มี `tenant_id`
- LINE channel/target ผูกกับ `tenant_id`
- future chatbot session ผูกกับ `tenant_id`
- cache key ต้อง prefix ด้วย `tenant_id`

## Audit Requirements

ต้อง log:

- datasource created/updated/tested
- report run started/succeeded/failed
- LINE message sent/failed
- user login
- manual refresh
- future chatbot question/answer source

## Backup and Recovery

System DB ต้อง backup:

- daily backup
- restore test เป็นระยะ
- retention ตาม package/operation policy

สิ่งที่สำคัญ:

- tenant config
- report definitions
- report runs/snapshots
- audit logs

## Production Checklist

ก่อนขึ้น production:

- [ ] มี read-only DB user สำหรับ SML customer database
- [ ] SML password encrypted หรืออยู่ใน secret manager
- [ ] IP allowlist/VPN/named tunnel พร้อม
- [x] query ใช้ parameterized SQL
- [x] report run history พร้อม
- [x] LINE delivery log พร้อม
- [x] signed customer report link พร้อม
- [x] admin mutation token guard สำหรับ MVP พร้อม
- [ ] error alert พร้อม
- [ ] backup/restore test สำหรับ system DB พร้อม
- [ ] staging/prod env แยก
- [ ] dashboard มี login/role permission เต็ม
- [x] ไม่มี credential จริงใน repo/docs
- [ ] manual run เทียบกับรายงาน SML เดิมแบบ customer sign-off แล้ว

## Incident Scenarios

### SML DB connect ไม่ได้

- mark report run failed
- dashboard แสดง stale/failed
- log error
- optional admin LINE alert

### LINE ส่งไม่สำเร็จ

- retry
- save provider error
- ไม่ rerun report ถ้า snapshot valid อยู่แล้ว

### ตัวเลขผิด

- freeze report version
- compare params/date/filter
- update report definition version ใหม่
- keep old run history
