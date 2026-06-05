# Tech Stack and Deployment

## เป้าหมายของเอกสาร

กำหนด tech stack และ deployment model สำหรับ MVP ที่เครื่องทดสอบ และต่อยอดสู่ production subscription platform

## Recommended Stack

### Frontend

```text
Next.js
React
Tailwind CSS
Recharts หรือ ECharts
```

ใช้สำหรับ:

- dashboard
- report viewer
- run history
- admin config

### Backend API

```text
Node.js
TypeScript
Fastify
Zod
node-postgres
```

เหตุผล:

- ต่อ PostgreSQL ง่าย
- ทำ API เร็ว
- validate params/output ชัด
- deploy ง่ายบน Docker

### Worker / Scheduler

Option MVP:

```text
Node.js worker + cron
```

Option Production:

```text
BullMQ + Redis
```

ใช้สำหรับ:

- scheduled report runs
- LINE sending
- retry
- background jobs

### System Database

```text
PostgreSQL
```

ใช้เก็บ:

- tenant config
- datasource
- report definitions
- report runs
- snapshots
- audit

Phase 1B implementation ใช้ `SystemStore` abstraction:

- development default: `.data/system-store.json`
- production/staging: `SYSTEM_DATABASE_URL` ไปยัง PostgreSQL system DB

ข้อกำหนด:

- `.data/` ต้องไม่ commit เข้า git
- production ต้องใช้ PostgreSQL system DB ไม่ใช้ local JSON
- system DB ต้องแยกจาก SML customer database
- SML JavaWS config ของร้านต้องอยู่ใน encrypted system store ไม่เก็บใน `report_snapshots`

### ORM / DB Layer

Recommended:

```text
Drizzle ORM
```

Alternative:

```text
Prisma
```

เหตุผลที่เริ่มด้วย Drizzle:

- schema explicit
- TypeScript friendly
- migration คุมง่าย
- เบากว่า Prisma สำหรับ worker/API

### LINE OA

ใช้ LINE Messaging API ผ่าน backend adapter

เก็บ token แบบ encrypted ใน system DB หรือ env สำหรับ demo

## Deployment Target: Test Machine

Target:

```text
192.168.2.109
```

Phase 1 professional pilot deploy ด้วย Docker Compose:

```text
web
api
worker
postgres
redis optional
```

Current deployed snapshot:

```text
Latest commit: 050b2a2
Web Owner LAN: http://192.168.2.109:3055/owner
Web Customer DEMO SHOP LAN: http://192.168.2.109:3055/app/demo-shop
Web Customer 248 SHOP LAN: http://192.168.2.109:3055/app/248-shop
Web signed viewer: http://192.168.2.109:3055/command-center/brief
API LAN: http://192.168.2.109:4055
Public web tunnel: https://relationship-code-others-challenging.trycloudflare.com
Public API tunnel: https://bibliography-numbers-lite-motion.trycloudflare.com
System store: PostgreSQL
PDF cache: /app/.data/pdf-cache via ai_bcc_data Docker volume
PDF layout version: sml-row-v5
Pilot tenants: tenant_demo_remote, tenant_office_sml1_2026
Current reports: sales_goods_services, purchase_goods_payables
```

หมายเหตุ: trycloudflare quick tunnel เป็น URL ชั่วคราว ถ้า tunnel restart ต้อง update `APP_BASE_URL`; `NEXT_PUBLIC_API_BASE_URL` ควรเป็น `same-origin` เพื่อให้ owner session cookie ใช้กับ API rewrite ได้

## Docker Compose Shape

```text
services:
  web:
    Next.js dashboard

  api:
    Fastify backend

  worker:
    report scheduler + LINE sender

  postgres:
    system database

  redis:
    optional job queue
```

## Environment Variables

ตัวอย่างชื่อ env:

```text
APP_ENV=development
APP_BASE_URL=http://192.168.2.109:3000
SYSTEM_DATABASE_URL=<SYSTEM_DB_URL>
ENCRYPTION_KEY=<SECRET>
LINE_DEMO_CHANNEL_ACCESS_TOKEN=<SECRET>
DEFAULT_TIMEZONE=Asia/Bangkok
REPORT_VIEWER_SIGNING_SECRET=<32_PLUS_RANDOM_CHARS>
REPORT_VIEWER_LINK_TTL_HOURS=72
OWNER_AUTH_SECRET=<32_PLUS_RANDOM_CHARS>
OWNER_ADMIN_USERNAME=<OWNER_ADMIN_USERNAME>
OWNER_ADMIN_PASSWORD=<OWNER_ADMIN_PASSWORD>
```

ห้าม commit ค่า secret จริง

Current pilot env ที่สำคัญ:

```text
MORNING_BRIEF_ENABLED=true
MORNING_BRIEF_TENANT_IDS=tenant_demo_remote
MORNING_BRIEF_TIME=08:00
MORNING_BRIEF_TIMEZONE=Asia/Bangkok
MORNING_BRIEF_MODE=send
```

## Network Model for Pilot

```mermaid
flowchart TD
    Test[192.168.2.109 Test Server] --> Platform[Docker Compose Platform]
    Platform --> SML[SML Tomcat JavaWS in Office LAN]
    Platform --> LINE[LINE Messaging API]
    User[User Browser] --> Test
```

## Development Workflow

1. สร้าง project skeleton
2. สร้าง system DB schema
3. seed tenant/demo datasource/report definition
4. implement report runner
5. implement dashboard API
6. implement dashboard UI
7. implement LINE sender
8. deploy Docker Compose to test machine

## Update Deploy Workflow

บน local:

```bash
corepack pnpm -r typecheck
corepack pnpm -r test
corepack pnpm lint
corepack pnpm -r build
git push origin main
```

บน server:

```bash
cd /home/bosscatdog/deployments/ai-business-command-center
bash scripts/deploy-server.sh
```

Smoke test:

```bash
curl http://127.0.0.1:4055/health
docker compose -f infra/docker-compose.yml --env-file .env.server ps
```

ห้าม print `.env.server` ทั้งไฟล์ เพราะมี LINE token, SML credential, owner password และ signing secret

## Why Not OpenHuman Desktop in Phase 1

OpenHuman ให้ inspiration ที่ดี แต่ desktop/Tauri/Rust build หนักเกินสำหรับ MVP นี้

Phase 1 ต้องการ:

- web dashboard
- backend report engine
- scheduler
- LINE OA

ดังนั้น web-first stack เร็วและเหมาะกว่า

## Future Production Hardening

- nginx reverse proxy
- HTTPS/domain
- managed PostgreSQL หรือ backup strategy
- Redis for queue
- log aggregation
- error alert
- CI/CD
- staging/prod split
