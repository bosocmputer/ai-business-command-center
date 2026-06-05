# Report Contract: purchase_goods_payables

## Goal

รายงานตัวที่ 2 สำหรับดูยอดซื้อสินค้า/ตั้งหนี้จาก SML ผ่าน JavaWS โดยใช้ query เดียวกันทุก tenant แต่ connection แยกตามร้านค้า รายงานนี้ใช้คู่กับ `sales_goods_services` ใน dashboard และแผนแจ้งเตือน LINE

## Report Key

```text
purchase_goods_payables
```

## Parameters

```json
{
  "date_from": "2026-05-01",
  "date_to": "2026-05-21"
}
```

Rules:

- Date format ต้องเป็น `YYYY-MM-DD`
- `date_from <= date_to`
- แผนแจ้งเตือนใช้ช่วง `เดือนนี้ถึงเมื่อวาน` สำหรับ purchase เพื่อให้เห็นยอดซื้อสะสม ไม่ใช่เฉพาะวันเดียวที่อาจไม่มีเอกสาร

## SQL Truth

Financial truth:

```text
ic_trans.total_amount
```

Detail analytics:

```text
ic_trans_detail.qty
ic_trans_detail.sum_amount
ic_trans_detail.item_code
ic_trans_detail.item_name
```

Supplier lookup:

```text
ap_supplier.name_1
```

Branch fallback:

```text
detail.branch_code -> header.branch_code -> no_branch
```

## Header Query

ใช้กับ KPI ที่เป็นยอดเงินจริงและจำนวนเอกสารซื้อ/ตั้งหนี้

```sql
select
  0 as rownum,
  h.doc_date,
  h.doc_no,
  h.doc_time,
  h.doc_ref_date,
  h.doc_ref,
  h.cust_code,
  s.name_1 as cust_name,
  h.branch_code,
  h.total_value,
  h.total_discount,
  (h.total_value - h.total_discount) as total_except_discount,
  h.total_except_vat,
  h.vat_rate,
  h.total_vat_value,
  case
    when h.vat_type = 0 then 'E'
    when h.vat_type = 1 then 'I'
    when h.vat_type = 2 then 'C'
    when h.vat_type = 3 then '3'
  end as vat_type,
  h.total_amount,
  h.cashier_code,
  cast(h.last_status as varchar) as last_status
from ic_trans h
left join ap_supplier s on s.code = h.cust_code
where h.trans_flag in (12)
  and h.last_status = 0
  and h.doc_date between $1::date and $2::date
  and h.is_doc_copy <> 1
order by h.doc_date, h.doc_no, h.doc_time, h.cust_code;
```

## Detail Query

ใช้กับสินค้าที่ซื้อสูงสุด, จำนวนซื้อรวม, branch detail และ drilldown เอกสาร

```sql
with filtered_headers as (
  select
    h.doc_no,
    h.doc_date,
    h.doc_time,
    h.cust_code,
    s.name_1 as cust_name,
    h.branch_code,
    h.trans_flag
  from ic_trans h
  left join ap_supplier s on s.code = h.cust_code
  where h.trans_flag in (12)
    and h.last_status = 0
    and h.doc_date between $1::date and $2::date
    and h.is_doc_copy <> 1
)
select
  d.discount,
  d.discount_amount,
  d.doc_date,
  d.doc_no,
  h.doc_time,
  h.cust_code,
  h.cust_name,
  coalesce(nullif(d.branch_code, ''), nullif(h.branch_code, ''), 'no_branch') as branch_code,
  d.item_code,
  d.barcode,
  coalesce(i.name_1, d.item_name) as item_name,
  d.wh_code,
  d.shelf_code,
  d.unit_code,
  coalesce(u.name_1, '') as unit_name,
  d.qty,
  d.temp_float_1,
  d.temp_float_2,
  d.price,
  d.sum_amount,
  case
    when d.vat_type = 0 then 'E'
    when d.vat_type = 1 then 'I'
    when d.vat_type = 2 then 'C'
    when d.vat_type = 3 then '3'
  end as vat_type,
  cast(d.tax_type as varchar) as tax_type,
  d.ref_row,
  d.line_number
from ic_trans_detail d
inner join filtered_headers h on h.doc_no = d.doc_no
  and h.doc_date = d.doc_date
  and h.trans_flag = d.trans_flag
left join ic_inventory i on i.code = d.item_code
left join ic_unit u on u.code = d.unit_code
where d.trans_flag in (12)
  and d.last_status = 0
  and d.doc_date between $1::date and $2::date
order by d.doc_date, d.doc_no, d.line_number;
```

Detail query ต้อง join ผ่าน `filtered_headers` เสมอ เพื่อไม่ดึงรายการสินค้าที่หัวเอกสารถูกกรองออก เช่นเอกสาร copy หรือหัวเอกสารที่ไม่ใช่สถานะใช้งาน

## Snapshot Shape

```json
{
  "tenant_id": "tenant_demo_remote",
  "report_key": "purchase_goods_payables",
  "summary": {
    "total_purchase": 63864.35,
    "document_count": 27,
    "line_count": 57,
    "total_qty": 157,
    "top_supplier_name": "สด",
    "top_product_name": "แอนลีนแอคติฟิต 3x รสจืด 325กรัม"
  },
  "top_suppliers": [],
  "branch_purchases": [],
  "top_products": [],
  "reconciliation": {
    "header_total_amount": 63864.35,
    "detail_sum_amount": 62436.21,
    "difference_amount": 1428.14,
    "status": "reconciled_with_warning"
  }
}
```

## Customer Dashboard

Customer viewer ใช้ endpoint read-only และ derive tenant จาก slug ฝั่ง server:

```text
GET /api/app/:tenantSlug/reports/purchase_goods_payables?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
GET /api/app/:tenantSlug/reports/purchase_goods_payables/documents?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&page=1&page_size=10&search=...
GET /api/app/:tenantSlug/reports/purchase_goods_payables/document-detail?doc_no=...&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
```

UI wording:

- `ผู้จำหน่าย` แทน `ลูกค้า`
- `ยอดซื้อเอกสารนี้` แทน `ยอดขายบิลนี้`
- `เอกสารซื้อ` แทน `บิลขาย`
- `สินค้าในเอกสารนี้` แทน `สินค้าในบิลนี้`

## Server-Side PDF Export

รายงานนี้ใช้ PDF export path เดียวกับรายงานขาย:

```text
GET /api/reports/:tenantId/purchase_goods_payables/pdf/prepare?...signed params...
GET /api/reports/:tenantId/purchase_goods_payables/pdf?...signed params...
```

Current PDF contract:

- layout version ล่าสุด: `sml-row-v5`
- ใช้ signed token เดิมของ viewer ผูก `tenant_id + report_key + run_id`
- A4 landscape, header compact, Print Date/Page No., วันที่รูปแบบพ.ศ.
- document row ใช้ wording ฝั่งซื้อ เช่น `ผู้จำหน่าย`, `เอกสารซื้อ`, `ยอดซื้อเอกสารนี้`
- detail row ไม่ซ้ำวันที่/ชื่อผู้จำหน่าย และไม่แสดง barcode ใน PDF หลัก
- body ลดเส้น grid และคงเส้นเฉพาะหัวตารางกับ `รวมทั้งหมด`
- multi-page guard v5 ใช้ Chromium pagination เป็นหลัก, keep-together เฉพาะเอกสารเล็กที่เตี้ยจริง และมี continuation marker สำหรับเอกสารยาว
- cache ที่ `/app/.data/pdf-cache`, TTL 7 วัน, atomic write, single-flight, regenerate เมื่อ cache เสียหรือว่าง
- pilot limit: 300 เอกสาร และ 5,000 detail rows
- LINE viewer ใช้ progress modal ผ่าน `/pdf/prepare` ก่อนเปิด `/pdf` เพื่อให้ LINE browser ดาวน์โหลด PDF จริง

## LINE Morning Brief

Morning Brief ส่งเป็น Flex Carousel หนึ่งข้อความ:

- Card 1: รายงานขายสินค้าและบริการ
- Card 2: รายงานซื้อ/ตั้งหนี้

แต่ละ card มี signed viewer URL ของ report ตัวเอง โดย URL ต้องไม่แสดงใน body ของ LINE และไม่บันทึก token เต็มลง log/audit

## Data Smoke

ข้อมูลที่เคยตรวจจริงช่วง `2026-05-01` ถึง `2026-05-21`:

```text
DEMO SHOP: header 27, detail 57, header total 63,864.35 บาท
248 SHOP: header 0, detail 0
```

ถ้า 248 SHOP ยังไม่มีข้อมูลซื้อ UI ต้องแสดง empty state แบบธุรกิจ ไม่ใช่ error
