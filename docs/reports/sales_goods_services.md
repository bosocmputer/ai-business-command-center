# Report Contract: sales_goods_services

## Goal

รายงานแรกของ Phase 1 สำหรับดูยอดขายสินค้าและบริการจาก SML PostgreSQL แบบใช้ร่วมกันได้ทุก tenant โดย query เดียวกัน แต่ datasource แยกตามบริษัท

## Report Key

```text
sales_goods_services
```

## Parameters

```json
{
  "date_from": "2026-05-10",
  "date_to": "2026-05-19"
}
```

Rules:

- Date format ต้องเป็น `YYYY-MM-DD`
- `date_from <= date_to`
- Phase 1 ยังไม่ใส่ branch filter เพื่อให้ query เดียวทำงานกับร้านที่มีหรือไม่มีสาขา

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

Branch fallback:

```text
detail.branch_code -> header.branch_code -> no_branch
```

Branch meaning for business UI:

- `0000`, `000`, `00`, `0` แสดงเป็น `สาขาหลัก (รหัส)` เพื่อไม่ให้ผู้บริหารเห็นรหัสลอย ๆ
- `no_branch` แสดงเป็น `ไม่ระบุสาขา` และถือเป็น data-quality signal ว่าหัวบิล/รายการสินค้าไม่มีรหัสสาขา
- รหัสอื่นยังแสดงเป็น `สาขา <code>` จนกว่าจะมี master mapping เป็นชื่อสาขาจริงของแต่ละ tenant
- ทุก label ต้องยังเก็บรหัสเดิมไว้เพื่อ trace กลับ SML ได้

Financial meaning:

- `ยอดขายสุทธิ` = `ic_trans.total_amount` และเป็นตัวเลขหลักสำหรับ KPI, LINE, dashboard
- `ยอดก่อนส่วนลด` = ผลรวม `ic_trans.total_value`
- `ส่วนลดรวม` = ผลรวม `ic_trans.total_discount`
- `ยอดก่อน VAT` = `ยอดขายสุทธิ - VAT` สำหรับ executive display; ถ้า `ic_trans.total_except_vat + VAT` reconcile กับยอดสุทธิได้ ระบบใช้ค่าจาก SML ตรง ๆ ได้
- `VAT` = ผลรวม `ic_trans.total_vat_value`
- `ยอดรวมสินค้า` จาก detail ใช้เพื่ออธิบายสินค้า/จำนวน ไม่ใช้แทนยอดเงินจริงเมื่อยอด detail ไม่ตรง header

## Header Query

ใช้กับ KPI ที่เป็นยอดเงินจริงและจำนวนเอกสาร

```sql
select
  0 as rownum,
  h.doc_date,
  h.doc_no,
  h.doc_time,
  h.doc_ref_date,
  h.doc_ref,
  h.cust_code,
  c.name_1 as cust_name,
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
left join ar_customer c on c.code = h.cust_code
where h.trans_flag in (44)
  and h.last_status = 0
  and h.doc_date between $1::date and $2::date
  and (coalesce(h.doc_ref, '') = '' or h.is_pos = 0)
  and h.is_doc_copy <> 1
order by h.doc_date, h.doc_no, h.doc_time, h.cust_code;
```

## Detail Query

ใช้กับ top product, quantity, branch detail และตารางสินค้า/บริการ

```sql
with filtered_headers as (
  select
    h.doc_no,
    h.doc_date,
    h.doc_time,
    h.cust_code,
    c.name_1 as cust_name,
    h.branch_code,
    h.trans_flag
  from ic_trans h
  left join ar_customer c on c.code = h.cust_code
  where h.trans_flag in (44)
    and h.last_status = 0
    and h.doc_date between $1::date and $2::date
    and (coalesce(h.doc_ref, '') = '' or h.is_pos = 0)
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
where d.trans_flag in (44)
  and d.last_status = 0
  and d.doc_date between $1::date and $2::date
order by d.doc_date, d.doc_no, d.line_number;
```

Detail query ต้อง join ผ่าน `filtered_headers` เสมอ เพื่อไม่ดึงรายการสินค้าที่หัวบิลถูกกรองออก เช่นบิล copy, บิลที่มี `doc_ref` จาก POS บางรูปแบบ หรือหัวบิลที่ไม่ใช่สถานะใช้งาน

## Document Detail Drilldown

หน้า customer dashboard ใช้ snapshot สำหรับ summary, branch ranking และ product ranking ส่วนตารางบิลใช้ server-side pagination/search จาก SML ด้วย approved SQL:

```text
GET /api/app/:tenantSlug/reports/sales_goods_services/documents?date_from=2026-05-01&date_to=2026-05-20&page=1&page_size=10&search=INV
```

เมื่อผู้ใช้เลือกบิล ระบบจะดึงรายละเอียดบิลแบบ read-only จาก SML ด้วย approved SQL แยก:

```text
GET /api/app/:tenantSlug/reports/sales_goods_services/document-detail?doc_no=...
```

Rules:

- API derive `tenant_id` จาก `tenantSlug` ฝั่ง server เท่านั้น
- document page bind `date_from`, `date_to`, `search`, `page_size`, `offset` เป็น `$1..$5` ห้าม concat เข้า SQL
- document page คืนเฉพาะบิลของหน้าที่ขอ พร้อม `detail_line_count`, `detail_total_amount`, `detail_total_qty`, `resolved_branch_code` และ business label เช่น `resolved_branch_label`
- document detail bind `doc_no` เป็น `$3` ห้าม concat เข้า SQL
- document detail คืน header + detail lines เฉพาะบิลนั้น
- ไม่ store detail ทุกแถวของช่วงใหญ่ลง snapshot เพื่อกัน payload ใหญ่เกินจำเป็น
- Customer dashboard ต้องแสดง document page แบบ responsive: desktop ใช้ table สำหรับรายการบิล, mobile ใช้ bill cards และรายการสินค้าในบิลใช้ item cards ทุก viewport เพื่อให้ผู้บริหารเปิดดูได้โดยไม่ต้อง scroll แนวนอน
- LINE brief viewer ต้องแสดง drilldown แบบ mobile-first: สินค้าในบิลมาก่อนข้อมูลภาษี/ส่วนลด, ซ่อน system cashier value เช่น `SUPERADMIN`, และใช้คำธุรกิจ เช่น `ยอดขายบิลนี้`, `จำนวนรวม`, `ยอดรวมสินค้า`

## Snapshot Shape

```json
{
  "tenant_id": "tenant_demo_remote",
  "report_key": "sales_goods_services",
  "summary": {
    "total_sales": 126148.78,
    "document_count": 68,
    "line_count": 139,
    "total_qty": 297,
    "top_product_name": "สินค้า A"
  },
  "financial_breakdown": {
    "gross_sales": 132000,
    "total_discount": 5851.22,
    "after_discount_amount": 126148.78,
    "before_vat_amount": 117895.12,
    "vat_amount": 8253.66,
    "net_sales": 126148.78,
    "discount_percent": 4.433,
    "vat_rate": 7,
    "document_count_with_discount": 12
  },
  "branch_sales": [
    {
      "branch_code": "0000",
      "branch_label": "สาขาหลัก (0000)",
      "branch_name": "สาขาหลัก",
      "branch_note": "ตีความจากรหัสสาขา SML ยังไม่ได้ map เป็นชื่อสาขาจริง",
      "total_amount": 126148.78,
      "document_count": 68,
      "line_count": 139
    }
  ],
  "reconciliation": {
    "header_total_amount": 126148.78,
    "detail_sum_amount": 131760.9,
    "difference_amount": -5612.12,
    "status": "reconciled_with_warning"
  },
  "comparison": {
    "previous_day": {
      "label": "previous_day",
      "date_from": "2026-05-18",
      "date_to": "2026-05-18",
      "total_sales": 6161.1,
      "document_count": 4,
      "difference_amount": -6161.1,
      "difference_percent": -100,
      "direction": "down"
    },
    "same_weekday_last_week": {
      "label": "same_weekday_last_week",
      "date_from": "2026-05-12",
      "date_to": "2026-05-12",
      "total_sales": 20754.12,
      "document_count": 39,
      "difference_amount": -20754.12,
      "difference_percent": -100,
      "direction": "down"
    }
  }
}
```

Comparison จะถูกสร้างเฉพาะ report ที่เป็นวันเดียว (`date_from === date_to`) เพื่อลดภาระ query และทำให้ Morning Brief ตอบคำถามผู้บริหารได้ทันทีว่าเมื่อวานดีขึ้น/แย่ลงจากฐานเทียบหรือไม่

## LINE Preview Endpoint

```text
GET /api/reports/:tenantId/sales_goods_services/line-preview
```

Output คืนทั้ง text fallback และ Flex metadata สำหรับ LINE preview:

```json
{
  "line_message_type": "flex",
  "title": "Morning Brief - Sales Goods and Services",
  "text": "รายงานขายสินค้าและบริการ...",
  "flex_message": {
    "type": "flex",
    "altText": "รายงานขาย Demo Remote 19 พ.ค. 2026: 0.00 บาท",
    "contents": {
      "type": "bubble"
    }
  },
  "warnings": [
    "ยอดหัวเอกสารและยอดรายละเอียดสินค้าไม่เท่ากัน..."
  ],
  "run_id": "run_tenant_demo_remote_..."
}
```

Preview นี้ใช้ snapshot ล่าสุด ไม่ยิง SML DB สดเอง

Live LINE send ใช้ `flex_message` เมื่อ signed viewer URL พร้อมและผ่าน guard ของ LINE URI action. ถ้า URL ไม่พร้อมหรือยาวเกิน guard จะ fallback เป็น text message โดยไม่แสดง signed URL เต็มใน body

กรณี empty state เช่นยอดขาย `0` และไม่มีบิล:

- Flex bubble ต้องเป็น hybrid empty-state report card
- คงหมวดรายงานหลัก เพื่อให้ผู้บริหารยังรู้สึกว่าเป็นรายงานขาย ไม่ใช่ระบบ error
- แสดง `วันนี้ควรรู้อะไร` เป็น insight สั้น ไม่ใช่ checklist ยาว
- แสดง `ยอดขายตามสาขา` และ `สินค้าขายดี` ด้วย empty summary แบบเบา ๆ ในพื้นที่ compact
- comparison แสดงเป็นข้อมูลอ้างอิง เช่น `ต่ำกว่าวันก่อนหน้า ซึ่งมียอดขาย ...` ไม่ใช้ `-100%` ใน bubble

เมื่อระบบมีหลาย report แล้ว `sales_goods_services` ต้องส่งออกเฉพาะ sales summary สั้นสำหรับ Morning Brief หลัก ส่วนรายละเอียดเต็มยังอยู่ใน signed report viewer ของ report นี้

## Current Implementation Status

สถานะล่าสุดวันที่ `2026-05-20`:

- report key นี้เป็น report แรกที่ deploy แล้ว
- API run/report/latest/line-preview/line-delivery พร้อมใช้งาน
- Dashboard admin ใช้ snapshot ล่าสุด
- LINE Morning Brief ใช้ `period = yesterday`
- LINE Morning Brief live send ใช้ Flex Message พร้อมปุ่ม `เปิดรายงาน`
- Customer viewer ใช้ signed URL:

```text
/command-center/brief?tenant_id=...&run_id=...&token=...
```

- ห้ามบันทึก signed URL เต็มใน docs เพราะมี token

Latest snapshot ที่ตรวจ:

```text
tenant_id: tenant_demo_remote
run_id: run_tenant_demo_remote_1779211410122
date_from: 2026-05-19
date_to: 2026-05-19
total_sales: 0
document_count: 0
comparison: true
```

Interpretation:

- วันที่ `2026-05-19` ของ demo tenant ไม่มียอดขาย
- empty state เป็น expected output
- viewer ต้องบอกผู้ใช้ว่าอาจเป็นร้านหยุดขาย, ยังไม่ปิดบิล, หรือช่วงวันที่ต้องตรวจ ไม่ใช่แสดง error ดิบ

## Production Considerations

- ใช้ parameterized SQL เท่านั้น ห้าม string replace แบบ `@from_date@`
- Production ต้องใช้ read-only DB user ไม่ใช่ `postgres`
- Query ต้องมี timeout
- Dashboard, LINE, chatbot ต้องอ่านจาก snapshot/run ที่ trace ได้
- ถ้า header total และ detail total ไม่ตรงกัน ให้ใช้ header เป็นยอดเงินจริง และแสดง reconciliation warning
- Mutation run endpoint ต้องใช้ admin token ใน pilot
- Signed viewer token TTL default = `72` ชั่วโมง
