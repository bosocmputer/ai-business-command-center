# Current Status: Professional Pilot

## เป้าหมายของเอกสาร

บันทึกสถานะล่าสุดของ AI Business Command Center หลังจบรอบงานวันที่ `20/05/2026` เพื่อให้วันถัดไปเริ่มทำต่อได้โดยไม่ต้องไล่ reconstruct จาก chat history

เอกสารนี้เป็น operational snapshot ไม่ใช่ replacement ของ blueprint หลัก ถ้ามีข้อมูลขัดกัน ให้ถือไฟล์นี้เป็นสถานะล่าสุด ณ เวลาที่ระบุ

## Snapshot ล่าสุด

```text
วันที่บันทึก: 2026-05-20
Timezone: Asia/Bangkok
Latest deployed commit: see latest `main` commit after SaaS pilot deploy
SaaS pilot owner/customer portals: ready for deploy
GitHub branch: main
Deploy target: 192.168.2.109
Compose project: ai-business-command-center
System store: PostgreSQL
Pilot tenant: tenant_demo_remote
Current report: sales_goods_services
```

## URL ที่ใช้ตรวจระบบ

LAN:

```text
Web: http://192.168.2.109:3055/command-center
API: http://192.168.2.109:4055
```

Public demo ผ่าน trycloudflare:

```text
Web: https://relationship-code-others-challenging.trycloudflare.com
API: https://bibliography-numbers-lite-motion.trycloudflare.com
```

หมายเหตุ:

- trycloudflare quick tunnel เป็น URL ชั่วคราว อาจเปลี่ยนเมื่อ process/server restart
- ห้ามบันทึก signed brief URL เต็มลง docs เพราะมี `token=...`
- LINE message ใช้ Flex Message พร้อมปุ่ม `เปิดรายงาน`; signed URL ต้องอยู่หลังปุ่มและสร้างจาก API เท่านั้น
- Web ใช้ same-origin `/api` rewrite ไป API service ภายใน Docker ได้แล้ว เพื่อลดปัญหา API quick tunnel URL หมดอายุหรือ DNS ไม่ทัน

## สิ่งที่สำเร็จแล้ว

### Report Platform

- ใช้ approved report contract `sales_goods_services`
- Query ใช้ parameter binding ไม่ใช้ string replace
- Summary ใช้ `ic_trans.total_amount` เป็น financial truth
- Detail analytics ใช้ `ic_trans_detail.sum_amount`, `qty`, product fields
- Branch fallback: `detail.branch_code -> header.branch_code -> no_branch`
- Snapshot มี comparison สำหรับ single-day report:
  - เมื่อวานเทียบกับวันก่อนหน้า
  - เมื่อวานเทียบกับวันเดียวกันสัปดาห์ก่อน

### Dashboard / Admin

- `/owner` เป็น Owner Admin portal สำหรับทีมเรา:
  - เห็นทุกร้าน
  - เพิ่ม tenant ใหม่
  - เปลี่ยน subscription status เช่น `active`, `suspended`
  - ดู tenant health เช่น datasource, LINE OA, LINE targets, users, latest run/delivery
  - เพิ่ม LINE OA metadata ต่อร้าน
- `/app` เป็น Customer Viewer portal:
  - read-only
  - ไม่มี config/admin token/manual mutation
  - ใช้ tenant session shim ใน MVP และต้องเปลี่ยนเป็น login/session จริงก่อน production
  - tenant `suspended`/`cancelled` ถูก block ด้วยข้อความติดต่อผู้ดูแล
- `/command-center` เป็น admin control room สำหรับทีมดูแล ไม่ใช่หน้าลูกค้ากดจาก LINE
- First viewport เหลือ tenant selector, date range, run action, และ empty/latest state
- Advanced section เก็บ charts, run history, audit, reconciliation, preview และตาราง
- Sidebar เหลือ navigation จริง:
  - ภาพรวม
  - รายงานขาย
  - Morning Brief
  - ตั้งค่า
  - ประวัติระบบ
- แก้ sidebar active state ให้รองรับ hash route เช่น `#morning-brief`

### LINE Brief Viewer

- `/command-center/brief` เป็น customer-facing compact report viewer
- ไม่มี admin sidebar/header
- ใช้ signed link ผูกกับ `tenant_id + report_key + run_id + expires_at`
- Signed link TTL default = `72` ชั่วโมง
- ภาษาหน้า viewer เปลี่ยนเป็น business language:
  - `จำนวนรายการขาย`
  - `จำนวนขายรวม`
  - `ข้อมูลจากระบบขาย SML`
  - `สินค้าขายดี`
- มี section `วันนี้ควรรู้อะไร`
- Technical detail เช่น `run_id`, reconciliation, source อยู่ท้ายหน้าแบบ collapsed
- มี CTA เดียว: `ดูรายละเอียดบิล/สินค้า`

### LINE OA / Morning Brief

- LINE OA demo ส่งเข้ากลุ่มทดสอบได้จริง
- Live send ใช้ LINE Flex Message เป็น default:
  - ไม่แสดง signed URL ยาวใน body
  - ไม่มีชื่อ `AI Business Center` ซ้ำในข้อความ เพราะ LINE แสดงชื่อ OA อยู่แล้ว
  - มี `altText` สั้นสำหรับ notification/talk list
  - ถ้า signed URL ไม่พร้อมหรือยาวเกิน guard จะ fallback เป็น text message
- Empty-state Flex bubble ใช้ hybrid report card:
  - คงโครงรายงานผู้บริหาร ไม่กลายเป็น checklist/error card
  - แสดงหมวดสาขา/สินค้าแบบ empty summary ที่ compact และไม่ซ้ำคำ
  - ใช้ข้อมูลอ้างอิงแบบนุ่มแทน wording `-100%`
- เมื่อเพิ่ม report ใหม่ Morning Brief ต้องเป็น executive digest รวมเฉพาะ signal สำคัญ ไม่ใช่เอา report ทุกตัวมาต่อกันจนยาว
- Scheduler รันที่ `08:00 Asia/Bangkok`
- Scheduler จำกัด tenant เริ่มต้นเป็น `tenant_demo_remote`
- Morning Brief ใช้ period `yesterday`
  - วันที่ `2026-05-20` จะส่งข้อมูล `2026-05-19`
- Duplicate guard ใช้ key ต่อ target เพื่อรองรับหลายกลุ่ม:

```text
tenant_id + sales_goods_services + morning_brief + date_from + date_to + target_id_hash
```

- LINE message link ชี้ไป report viewer signed URL ไม่ใช่ admin dashboard
- `line_deliveries.message_type` เก็บ `flex` หรือ `text` เพื่อ audit รูปแบบข้อความ
- เพิ่ม `line_targets` สำหรับแยกสิทธิ์ระดับกลุ่ม/room/user:
  - `executive`
  - `sales_manager`
  - `operations`
  - `staff`
- Scheduler ส่งไปทุก target ที่ `approved=true`, `enabled=true` และผ่าน permission check ของ report นั้น
- Target ใหม่จาก webhook จะถูกบันทึกเป็น pending ไม่ auto-enable
- Env fallback target ถูกปิดเป็นค่า default เพื่อไม่ให้กลุ่มเก่าจาก `.env.server` ถูกสร้างกลับมาทุก restart
- `/command-center/settings` มี section `LINE Groups & Permissions` สำหรับดู masked target, profile, approve/change profile/enable-disable/test send
- หน้า web/admin/brief สามารถเรียก API ผ่าน same-origin `/api` ได้ ไม่จำเป็นต้อง expose API tunnel แยกใน browser
- Settings มี onboarding card บอกขั้นตอนเพิ่ม OA เข้ากลุ่ม, ส่ง `test`, รีเฟรช, อนุมัติสิทธิ์ และส่งทดสอบ
- API พยายามดึงชื่อกลุ่ม LINE จาก group summary API แล้วบันทึกกลับเป็น `display_name`; ถ้าดึงไม่ได้จะ fallback เป็น masked id
- `line_channels` registry เริ่มรองรับหลาย LINE OA ต่อ tenant ในระดับ metadata แล้ว
- Env fallback target ยังปิดเป็นค่า default และไม่ถูกสร้างกลับมาอัตโนมัติ

### Security / Safety

- Mutation endpoints ต้องใช้ header:

```text
x-ai-bcc-admin-token: <server-only-token>
```

- Protected endpoints:
  - `POST /api/reports/:tenantId/sales_goods_services/run`
  - `POST /api/reports/:tenantId/sales_goods_services/morning-brief/run-and-send`
  - `POST /api/reports/:tenantId/sales_goods_services/line-send-test`
  - `POST /api/tenants/:tenantId/datasource/test`
  - `POST /api/line-targets/:id/approve`
  - `PATCH /api/line-targets/:id`
  - `POST /api/line-targets/:id/test-send`
  - `GET /api/owner/tenants`
  - `POST /api/owner/tenants`
  - `PATCH /api/owner/tenants/:tenantId`
  - `GET /api/owner/line-channels`
  - `POST /api/owner/line-channels`
- UI ใช้ TailAdmin-style dialog สำหรับกรอก admin token และเก็บใน `sessionStorage`
- UI ใช้ TailAdmin-style confirmation dialog ก่อนส่ง LINE จริง / ส่ง test จริง
- API log redact `x-ai-bcc-admin-token`
- LINE target API response/audit ใช้ masked/hash id ไม่ expose target id เต็ม
- Secret จริงอยู่ใน `.env.server` บน server เท่านั้น ไม่ commit

## สถานะข้อมูลล่าสุด

Latest snapshot ที่ตรวจบน server:

```text
tenant_id: tenant_demo_remote
run_id: run_tenant_demo_remote_1779211410122
date_from: 2026-05-19
date_to: 2026-05-19
total_sales: 0
document_count: 0
comparison: true
```

การตีความ:

- วันที่ `2026-05-19` ของ tenant demo ไม่มียอดขาย
- Viewer จึงแสดง `ไม่มีข้อมูล`
- Comparison ยังทำงานและพบว่ายอดลดลงจากวันที่อ้างอิง
- นี่เป็น empty state ที่ถูกต้อง ไม่ใช่ระบบล่ม

## Validation ล่าสุด

Local validation หลังเพิ่ม Flex Message 2.0:

```text
corepack pnpm -r typecheck  -> pass
corepack pnpm -r test       -> pass
corepack pnpm lint          -> pass
corepack pnpm -r build      -> pass
git diff --check            -> pass
```

Server:

```text
GET /health                         -> 200
POST /run without admin token       -> 401
POST /run with wrong admin token    -> 403
POST /run with server admin token   -> 200
docker compose ps                   -> api/web/worker/system-db running
api health                          -> healthy
system_store                        -> postgres
```

Browser QA:

- `/command-center` โหลดได้ ไม่มี horizontal overflow
- `/command-center/settings` โหลดได้ ไม่มี horizontal overflow
- `/command-center/brief` signed link โหลดได้ ไม่มี horizontal overflow
- หน้า brief ไม่มี token leak ใน body text
- Sidebar active state ทำงานกับ path/hash แล้ว

## สิ่งที่ยังเป็น MVP ไม่ใช่ Production เต็ม

- Admin auth ยังเป็น shared token prompt ไม่ใช่ login/role permission
- trycloudflare เป็น quick tunnel ชั่วคราว ไม่ใช่ domain/named tunnel
- SML DB credential ยังอยู่ใน env ไม่ใช่ encrypted datasource table
- LINE OA token/secret ยังอยู่ใน env หรือ metadata registry ไม่ใช่ encrypted secret table
- customer-specific LINE OA onboarding ยังไม่เต็ม แต่เริ่มมี `line_channels` registry, pending target discovery และ permission profile แล้ว
- `/app` customer session ยังเป็น MVP shim ไม่ใช่ login/role จริง
- `subscriptions` ยังไม่แยก table ใช้ `tenants.status` เป็น gate จริงชั่วคราว
- `tenant_report_configs` ยังไม่เปิดใช้จริง รายงานแรกยังเป็น `sales_goods_services`
- ยังไม่แยกสิทธิ์ราย user ใน LINE group เดียวกัน
- ยังไม่มี backup/restore automation สำหรับ system PostgreSQL
- ยังไม่ได้ทำ CI/CD pipeline
- ยังไม่ได้เพิ่ม report อื่นนอกจาก `sales_goods_services`

## จุดที่ควรทำต่อพรุ่งนี้

Priority 1:

1. Browser QA `/owner`, `/app`, `/command-center/settings`, `/command-center/brief`
2. ทดสอบเปลี่ยน tenant status เป็น `suspended` แล้ว `/app` ถูก block และ Morning Brief skip
3. เพิ่ม LINE OA metadata ใน `/owner` แล้วตรวจว่าไม่ leak token/secret
4. ออกแบบ login/session จริงแทน customer session shim

Priority 2:

1. ทำ login/session จริงสำหรับ owner/customer แทน admin token/session shim
2. ทำ encrypted datasource secret store และ owner datasource config
3. ทำ encrypted LINE channel token/secret store สำหรับหลาย LINE OA จริง
4. เพิ่ม `subscriptions` และ `tenant_report_configs` เป็น table/workflow แยก

Priority 3:

1. เตรียม report ถัดไปจาก SML query จริง เช่น AR Overdue, SO Backlog หรือ Inventory Risk
2. ทำ named tunnel/domain แทน trycloudflare quick tunnel
3. ทำ read-only DB user guide สำหรับลูกค้า pilot

## คำสั่ง deploy/update

บนเครื่อง local:

```bash
git push origin main
```

บน server:

```bash
cd /home/bosscatdog/deployments/ai-business-command-center
bash scripts/deploy-server.sh
```

ดูสถานะ:

```bash
docker compose -f infra/docker-compose.yml --env-file .env.server ps
curl http://127.0.0.1:4055/health
```

## Reminder สำหรับ Codex รอบถัดไป

- อ่านไฟล์นี้ก่อนเริ่มงาน
- อย่า print `.env.server`, LINE token, admin token หรือ signed viewer token
- อย่า hardcode credential จริงลง repo
- ถ้าจะส่ง LINE จริง ต้อง confirm กับ user ก่อน
- ถ้าจะทดสอบ mutation endpoint ให้ใช้ token จาก server env โดยไม่ echo ออกมา
- ค่า admin token สำหรับ pilot อาจตั้งให้ง่ายต่อการจำใน server env ได้ แต่ production ต้องเปลี่ยนเป็น secret ที่ strong และหมุนได้
- ถ้าเห็นยอด `0` ของวันที่ `2026-05-19` ให้ถือว่าเป็นข้อมูลจริงของ snapshot ล่าสุด ไม่ใช่ error
