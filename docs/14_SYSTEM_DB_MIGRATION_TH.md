# System DB Migration

## เป้าหมาย

ย้าย persistence ของ AI Business Command Center จาก local JSON volume ไปเป็น PostgreSQL system DB ที่แยกจาก SML customer database

สถานะล่าสุดวันที่ `2026-05-20`: pilot server ใช้ PostgreSQL system store แล้ว `GET /health` เห็น `system_store = postgres`

ข้อมูลที่ย้าย:

- `report_runs`
- `report_snapshots`
- `line_deliveries`
- `line_webhook_events`
- `audit_logs`

## เหตุผล

local JSON เหมาะกับ demo แรก แต่ไม่เหมาะกับ subscription product เพราะ:

- เสี่ยงหายเมื่อ volume เสีย
- scale API หลาย container ไม่ได้
- audit/delivery history สำคัญต่อความน่าเชื่อถือ
- duplicate guard ของ Morning Brief ต้องอยู่ใน storage ที่เชื่อถือได้

## Docker Compose Services

เพิ่ม service:

```text
system-db
```

container:

```text
ai-bcc-system-db
```

volume:

```text
ai_bcc_system_pgdata
```

## Required Environment

ตัวอย่าง:

```text
AI_BCC_SYSTEM_DB_NAME=ai_business_command_center
AI_BCC_SYSTEM_DB_USER=ai_bcc
AI_BCC_SYSTEM_DB_PASSWORD=<strong-password>
SYSTEM_DATABASE_URL=postgresql://ai_bcc:<strong-password>@system-db:5432/ai_business_command_center
```

ห้าม commit password จริง

## Safe Migration Flow

1. backup local JSON เดิม

```bash
cp .data/system-store.json .data/system-store.json.backup-$(date +%Y%m%d-%H%M%S)
```

2. set `SYSTEM_DATABASE_URL` ใน `.env.server`

3. deploy Docker Compose เพื่อให้ `system-db` และ `api` ขึ้น

4. run migration ใน API container

```bash
docker compose -f infra/docker-compose.yml --env-file .env.server exec api \
  node apps/api/dist/migrate-local-json-to-postgres.js
```

5. smoke test

```text
GET /health ต้องเห็น system_store = postgres
Dashboard latest snapshot ต้องโหลดได้
LINE deliveries ต้องยังเห็น delivery เดิม
Morning Brief duplicate guard ต้องยัง skip วันเดิมได้
```

## Rollback

ถ้า PostgreSQL store มีปัญหา:

1. unset หรือ blank `SYSTEM_DATABASE_URL`
2. restart `api`
3. API จะกลับไปใช้ `/app/.data/system-store.json`

ห้ามลบ `ai_bcc_data` จนกว่าจะมั่นใจว่า migration และ backup พร้อม

## Production Notes

- system DB นี้เป็น DB ของ platform ไม่ใช่ SML DB ของลูกค้า
- production จริงควรมี daily backup และ restore test
- SML datasource credential ยังอยู่ใน environment/secret manager ใน phase นี้
- future phase ควรเพิ่ม migration framework เช่น Drizzle migrations
