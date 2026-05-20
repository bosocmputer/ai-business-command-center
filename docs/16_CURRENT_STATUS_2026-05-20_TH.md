# Current Status: Professional Pilot

## เป้าหมายของเอกสาร

บันทึกสถานะล่าสุดของ AI Business Command Center หลังจบรอบงานวันที่ `20/05/2026` เพื่อให้วันถัดไปเริ่มทำต่อได้โดยไม่ต้องไล่ reconstruct จาก chat history

เอกสารนี้เป็น operational snapshot ไม่ใช่ replacement ของ blueprint หลัก ถ้ามีข้อมูลขัดกัน ให้ถือไฟล์นี้เป็นสถานะล่าสุด ณ เวลาที่ระบุ

## Snapshot ล่าสุด

```text
วันที่บันทึก: 2026-05-20
Timezone: Asia/Bangkok
Latest deployed commit before Flex Message 2.0: 9b7cb23
Flex Message 2.0 change: included in current main commit
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
- Scheduler รันที่ `08:00 Asia/Bangkok`
- Scheduler จำกัด tenant เริ่มต้นเป็น `tenant_demo_remote`
- Morning Brief ใช้ period `yesterday`
  - วันที่ `2026-05-20` จะส่งข้อมูล `2026-05-19`
- Duplicate guard ใช้ key:

```text
tenant_id + sales_goods_services + morning_brief + date_from + date_to
```

- LINE message link ชี้ไป report viewer signed URL ไม่ใช่ admin dashboard
- `line_deliveries.message_type` เก็บ `flex` หรือ `text` เพื่อ audit รูปแบบข้อความ

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
- UI จะ prompt admin token ฝั่ง browser และเก็บใน `sessionStorage`
- UI มี confirmation ก่อนส่ง LINE จริง
- API log redact `x-ai-bcc-admin-token`
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
- LINE OA ยังเป็น OA กลางสำหรับ demo/subscription เริ่มต้น
- ยังไม่มี customer-specific LINE OA onboarding flow
- ยังไม่มี backup/restore automation สำหรับ system PostgreSQL
- ยังไม่ได้ทำ CI/CD pipeline
- ยังไม่ได้เพิ่ม report อื่นนอกจาก `sales_goods_services`

## จุดที่ควรทำต่อพรุ่งนี้

Priority 1:

1. Deploy Flex Message 2.0 แล้วตรวจ `line-preview` ว่าได้ `line_message_type = flex`
2. ถ้า LINE ส่งสำเร็จ ให้กด link จาก LINE แล้วตรวจว่าพาเข้า `/command-center/brief` ของ `run_id` รอบนั้น
3. ตรวจ Morning Brief รอบ `08:00 Asia/Bangkok` ว่าส่งจาก `tenant_demo_remote` จริงและไม่ส่งซ้ำ
4. เก็บ screenshot และ feedback UX จากผู้บริหาร/ผู้ใช้จริง

Priority 2:

1. ปรับ copy/UX empty state ของวันที่ยอดขายเป็น 0 ถ้าลูกค้ารู้สึกว่าดูเหมือนระบบไม่มีข้อมูล
2. เพิ่มตัวกรองวันใน viewer หรือ link กลับไป admin เฉพาะผู้ดูแล
3. เตรียม report ถัดไปจาก SML query จริง เช่น AR Overdue, SO Backlog หรือ Inventory Risk

Priority 3:

1. วาง lightweight login/role แทน shared admin token
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
- ถ้าเห็นยอด `0` ของวันที่ `2026-05-19` ให้ถือว่าเป็นข้อมูลจริงของ snapshot ล่าสุด ไม่ใช่ error
