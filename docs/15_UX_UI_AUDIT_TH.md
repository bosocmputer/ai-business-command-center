# UX/UI Audit: TailAdmin Alignment

## เป้าหมาย

เอกสารนี้ใช้เป็น checklist สำหรับตรวจว่า **AI Business Command Center** ยังยึด TailAdmin Next.js template มากพอหรือไม่ และระบุจุดที่ควร refactor เพื่อลด custom UI ที่ดูแลยากก่อนขยาย feature ต่อไป

Scope รอบนี้:

- `/command-center`
- `/command-center/settings`
- shared shell: sidebar, header, user dropdown
- TailAdmin sample routes ที่ยังอยู่ใน repo เพื่อใช้เป็น component reference

## สถานะปัจจุบัน

หน้าหลักและหน้าตั้งค่าพร้อมใช้สำหรับ demo แล้ว ข้อมูลจาก SML, run history, audit log, LINE preview และ readiness status แสดงผลได้ครบ แต่ก่อน audit นี้มีการประกอบ card/layout ด้วย Tailwind class ซ้ำเองหลายจุด เช่น:

```text
rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]
```

รูปแบบนี้ไม่ได้ผิด แต่ถ้าปล่อยต่อไปจะทำให้ UI หลุดจาก template ได้ง่ายเมื่อเพิ่มหน้ารายงานใหม่

## Findings

### 1. Product Pages

| พื้นที่ | สถานะ | ข้อสังเกต | Action |
| --- | --- | --- | --- |
| Dashboard hero/filter | Custom acceptable | เป็น control surface เฉพาะ product มี tenant selector/date/run actions | คงไว้ แต่ใช้ breadcrumb/template controls รอบนอก |
| KPI cards | Custom acceptable | ใกล้ pattern `EcommerceMetrics` ของ TailAdmin | คงไว้เป็น metric card เฉพาะ domain |
| Operations readiness | ควร align | ก่อนหน้าเป็น custom card + custom header | ใช้ `ComponentCard` พร้อม `action` |
| Morning Brief control | ควร align | card header/action ทำเอง | ใช้ `ComponentCard` |
| LINE preview | ควร align | มี layout เฉพาะ แต่ควรอยู่ใน template card | ใช้ `ComponentCard` และเก็บ preview block ไว้ |
| Charts | ควร align | chart card ทำเอง | ใช้ `ComponentCard` + badge action |
| Run history / audit log | ควร align | card header ซ้ำเอง | ใช้ `ComponentCard` |
| Tables | ควร align | ใช้ `Table` แล้ว แต่ pagination ทำเอง | ใช้ `ComponentCard`, `Table`, `Pagination` |
| Settings readiness/action/info panels | ควร align | card หลายชุดเขียน class ซ้ำ | ใช้ `ComponentCard` |

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
- Dashboard/Settings เป็นหน้าที่ลูกค้าเห็นจริง จึงต้อง align กับ template ก่อนหน้าอื่น
- ไม่เปลี่ยน business logic, API contract หรือ report calculation ใน audit รอบนี้
