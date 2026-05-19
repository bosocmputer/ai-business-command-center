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

## Header Query

ใช้กับ KPI ที่เป็นยอดเงินจริงและจำนวนเอกสาร

```sql
select
  0 as rownum,
  h.doc_date,
  h.doc_no,
  h.doc_time,
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
  h.cashier_code
from ic_trans h
left join ar_customer c on c.code = h.cust_code
where h.trans_flag = 44
  and h.last_status = 0
  and h.doc_date between $1::date and $2::date
order by h.doc_date, h.doc_no, h.doc_time, h.cust_code;
```

## Detail Query

ใช้กับ top product, quantity, branch detail และตารางสินค้า/บริการ

```sql
select
  d.doc_date,
  d.doc_no,
  h.doc_time,
  h.cust_code,
  c.name_1 as cust_name,
  coalesce(nullif(d.branch_code, ''), nullif(h.branch_code, ''), 'no_branch') as branch_code,
  d.item_code,
  d.item_name,
  d.wh_code,
  d.shelf_code,
  d.unit_code,
  d.qty,
  d.price,
  d.discount,
  d.discount_amount,
  d.sum_amount,
  case
    when d.vat_type = 0 then 'E'
    when d.vat_type = 1 then 'I'
    when d.vat_type = 2 then 'C'
    when d.vat_type = 3 then '3'
  end as vat_type
from ic_trans_detail d
inner join ic_trans h on h.doc_no = d.doc_no
  and h.trans_flag = d.trans_flag
  and h.last_status = 0
left join ar_customer c on c.code = h.cust_code
where d.trans_flag = 44
  and h.trans_flag = 44
  and d.doc_date between $1::date and $2::date
order by d.doc_date, d.doc_no, d.item_code;
```

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

Output เป็น text payload สำหรับ LINE preview:

```json
{
  "line_message_type": "text",
  "title": "Morning Brief - Sales Goods and Services",
  "text": "Morning Brief - รายงานขายสินค้าและบริการ...",
  "warnings": [
    "ยอดหัวเอกสารและยอดรายละเอียดสินค้าไม่เท่ากัน..."
  ],
  "run_id": "run_tenant_demo_remote_..."
}
```

Preview นี้ใช้ snapshot ล่าสุด ไม่ยิง SML DB สดเอง

## Current Implementation Status

สถานะล่าสุดวันที่ `2026-05-20`:

- report key นี้เป็น report แรกที่ deploy แล้ว
- API run/report/latest/line-preview/line-delivery พร้อมใช้งาน
- Dashboard admin ใช้ snapshot ล่าสุด
- LINE Morning Brief ใช้ `period = yesterday`
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
