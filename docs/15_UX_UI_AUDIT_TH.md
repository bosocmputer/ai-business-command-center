# UX/UI Audit: TailAdmin Alignment

## เป้าหมาย

เอกสารนี้ใช้เป็น checklist สำหรับตรวจว่า **AI Business Command Center** ยังยึด TailAdmin Next.js template มากพอหรือไม่ และระบุจุดที่ควร refactor เพื่อลด custom UI ที่ดูแลยากก่อนขยาย feature ต่อไป

Scope:

- `/command-center`
- `/command-center/brief`
- `/command-center/settings`
- shared shell: sidebar, header, user dropdown
- TailAdmin sample routes ที่ยังอยู่ใน repo เพื่อใช้เป็น component reference

## สถานะปัจจุบัน

สถานะล่าสุดวันที่ `2026-05-20`: ระบบถูกปรับเป็น professional pilot แล้ว โดยแยก UX เป็น 2 ประเภทชัดเจน

- `/command-center`: admin control room สำหรับทีมดูแล
- `/command-center/brief`: customer-facing compact report viewer สำหรับคนกดจาก LINE
- `/command-center/settings`: readiness/control panel สำหรับทดสอบระบบ

ก่อน audit เดิมมีการประกอบ card/layout ด้วย Tailwind class ซ้ำเองหลายจุด เช่น:

```text
rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]
```

รูปแบบนี้ไม่ได้ผิด แต่ถ้าปล่อยต่อไปจะทำให้ UI หลุดจาก template ได้ง่ายเมื่อเพิ่มหน้ารายงานใหม่

รอบ professional pilot ไม่เปลี่ยน TailAdmin ทั้งระบบ เพราะปัญหาหลักไม่ใช่ template แต่เป็นการใช้ admin dashboard layout กับ customer-facing LINE flow จึงสร้าง brief viewer แยกแทน

## Findings

### 1. Product Pages

| พื้นที่ | สถานะ | ข้อสังเกต | Action |
| --- | --- | --- | --- |
| Dashboard control bar | Custom acceptable | เป็น admin control surface เฉพาะ product มี tenant selector/date/run actions | คงไว้ แต่ต้อง compact และไม่ใช้ hero ใหญ่ |
| KPI cards | Custom acceptable | ใกล้ pattern `EcommerceMetrics` ของ TailAdmin | คงไว้เป็น metric card เฉพาะ domain |
| Operations readiness | ควร align | ก่อนหน้าเป็น custom card + custom header | ใช้ `ComponentCard` พร้อม `action` |
| Morning Brief control | ควร align | card header/action ทำเอง | ใช้ `ComponentCard` |
| LINE preview | ควร align | มี layout เฉพาะ แต่ควรอยู่ใน template card | ใช้ `ComponentCard` และเก็บ preview block ไว้ |
| Charts | ควร align | chart card ทำเอง | ใช้ `ComponentCard` + badge action |
| Run history / audit log | ควร align | card header ซ้ำเอง | ใช้ `ComponentCard` |
| Tables | ควร align | ใช้ `Table` แล้ว แต่ pagination ทำเอง | ใช้ `ComponentCard`, `Table`, `Pagination` |
| Settings readiness/action/info panels | ควร align | card หลายชุดเขียน class ซ้ำ | ใช้ `ComponentCard` |
| Brief viewer | Custom intentional | ไม่ใช้ admin shell เพราะเป็นหน้า customer-facing จาก LINE | ใช้ compact pro layout, no sidebar, technical details collapsed |

### 1.1 Current UX Direction

แนวทางล่าสุดคือ `Compact Pro`:

- ลูกค้ากดจาก LINE ต้องเห็นยอดขาย วันที่ บริษัท และ insight ทันที
- ไม่ใช้ card dump ที่ข้อมูลกระจายเต็มหน้า
- technical detail เช่น `run_id`, reconciliation, source ไปท้ายหน้าแบบ collapsed
- admin dashboard ใช้เพื่อ control/monitor เท่านั้น ไม่ใช่หน้าที่ลูกค้าควรเห็น
- copy ต้องเป็นภาษาไทยที่เจ้าของกิจการอ่านรู้เรื่อง ไม่ใช่คำ developer

### 2. Template Components

| Component | ก่อน audit | ปรับแล้ว |
| --- | --- | --- |
| `ComponentCard` | รองรับ title/desc/body เท่านั้น | เพิ่ม `id`, `action`, `bodyClassName` แบบ backward compatible |
| `PageBreadCrumb` | label `Home` ตายตัว | เพิ่ม `homeLabel`, `homeHref` เพื่อใช้ภาษาไทย |
| `Pagination` | ปุ่ม `Previous/Next` ตายตัว | เพิ่ม `previousLabel`, `nextLabel` |
| `Alert` | มีอยู่แต่ยังไม่ได้ใช้ใน product pages | ใช้กับ error state ใน Command Center |

### 3. Responsive / Mobile

ตรวจด้วย in-app browser ที่ประมาณ desktop `1135x998` และ mobile `390x844`

ผลตรวจ:

- ไม่มี horizontal overflow ของ main content บน mobile
- sidebar ซ่อนออกซ้ายตาม pattern template เดิม ถือว่า acceptable
- table ต้องอยู่ใน `overflow-x-auto` ต่อไป เพราะข้อมูล SML มีชื่อสินค้า/เลขเอกสารยาว
- LINE preview เป็น `pre` ที่ scroll ได้ เหมาะกับข้อความจริงที่ส่ง LINE
- บน mobile ตอน reload จะเห็น loading/empty wording สั้น ๆ ก่อนข้อมูลมา ควรตรวจอีกครั้งเมื่อเพิ่ม skeleton แบบละเอียด

Latest Browser QA:

- `/command-center` ไม่มี horizontal overflow
- `/command-center/settings` ไม่มี horizontal overflow
- `/command-center/brief` signed viewer ไม่มี horizontal overflow
- `/command-center/brief` first viewport มี KPI, status, CTA และ `วันนี้ควรรู้อะไร`
- sidebar active state รองรับ hash route แล้ว เช่น `#morning-brief`

## UX Wording Notes

ควรใช้คำที่ผู้ใช้ทั่วไปเข้าใจ:

- `Run` -> `รันรายงาน` หรือ `อัปเดตรายงาน`
- `Snapshot` -> `ข้อมูลล่าสุด`
- `Datasource` -> `ฐานข้อมูล SML`
- `Delivery` -> `การส่ง LINE`
- `Audit` -> `บันทึกกิจกรรมระบบ`
- `Worker` -> `งานเบื้องหลัง`
- `Reconciliation` -> `ตรวจยอดขาย`

## สิ่งที่ยังควรทำต่อ

1. ซ่อนหรือปิด TailAdmin sample routes ก่อน production จริง หากยังไม่มี auth
2. เพิ่ม design wrapper สำหรับ `CommandCenterMetricCard` ถ้าจะมี KPI ซ้ำในหลายรายงาน
3. ทำ mobile QA หลังเพิ่มรายงานใหม่ทุกตัว เพราะชื่อสินค้า SML และชื่อสาขาอาจยาวมาก
4. เพิ่ม empty/error/loading pattern กลางสำหรับ report pages
5. พิจารณา role-based navigation เมื่อเริ่มทำ subscription tenant จริง
6. เก็บ feedback จากผู้บริหารจริงหลังเปิด brief viewer จาก LINE
7. ปรับ empty state วันที่ยอดขาย 0 ให้ชัดว่าเป็นข้อมูลจริง ไม่ใช่ระบบเสีย

## Production Review Checklist

- ใช้ TailAdmin component ที่มีอยู่ก่อนสร้าง layout เอง
- ถ้าต้อง custom ให้เป็น reusable component ใน `components/command-center`
- ทุกหน้า product ต้องมี breadcrumb/title ภาษาไทย
- ปุ่ม action ต้องมี loading/disabled state
- ตารางต้องรองรับ overflow และ pagination
- ข้อความ error ห้าม leak credential, host, token หรือ LINE target จริง
- UI ต้องแยก tenant ชัดเจนทุกจุดที่มีข้อมูลลูกค้า

## Assumptions

- Phase 1 ยังเป็น demo/pilot จึงยังคง TailAdmin sample routes ไว้เป็น reference ใน repo ได้
- Dashboard/Settings เป็นหน้าผู้ดูแล ส่วน brief viewer เป็นหน้าลูกค้ากดจาก LINE
- ไม่เปลี่ยน business logic, API contract หรือ report calculation ใน audit รอบนี้
