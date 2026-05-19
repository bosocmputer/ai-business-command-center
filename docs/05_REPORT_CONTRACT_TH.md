# Report Contract

## เป้าหมายของเอกสาร

กำหนดมาตรฐานของ report หนึ่งตัว เพื่อให้ report library ขยายได้, dashboard ใช้ซ้ำได้, LINE brief สร้างจากข้อมูลเดียวกันได้ และ future chatbot ตอบจาก report ที่ approved แล้ว

## Why Report Contract Matters

ระบบนี้จะขายแบบ subscription ได้เพราะ report หนึ่งตัวเป็น shared asset

```text
sales_by_branch v1
  -> ใช้กับ tenant A
  -> ใช้กับ tenant B
  -> ใช้กับ future chatbot
```

ถ้าไม่มี contract รายงานจะกลายเป็น SQL กระจัดกระจายและ chatbot จะต่อยาก

## Contract Fields

```json
{
  "report_key": "sales_by_branch",
  "version": 1,
  "name": "ยอดขายสินค้าแยกตามสาขา",
  "category": "sales",
  "erp": "sml_postgres",
  "parameters_schema": {},
  "output_schema": {},
  "sql_template": "",
  "summary_rules": {},
  "dashboard_widgets": [],
  "line_template": {},
  "validation_rule": {},
  "chatbot_policy": {}
}
```

## Naming Rules

- `report_key` ใช้ snake_case ภาษาอังกฤษ
- version เพิ่มเมื่อ output/logic เปลี่ยนแบบกระทบ downstream
- report ที่ deprecated ห้ามลบทันที ให้เปลี่ยน status เป็น `deprecated`

## Parameters Schema

ตัวอย่าง:

```json
{
  "type": "object",
  "required": ["date_from", "date_to"],
  "properties": {
    "date_from": { "type": "string", "format": "date" },
    "date_to": { "type": "string", "format": "date" },
    "branch_code": { "type": "string", "nullable": true }
  }
}
```

Rules:

- parameter ต้อง bind แบบ parameterized query
- ห้าม concat raw user input เข้า SQL
- ต้องมี default params สำหรับ scheduled run

## Output Schema

ตัวอย่าง report ขายตามสาขา:

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": ["product_code", "product_name", "qty", "net_amount"],
    "properties": {
      "branch_code": { "type": "string", "nullable": true },
      "branch_name": { "type": "string", "nullable": true },
      "product_code": { "type": "string" },
      "product_name": { "type": "string" },
      "qty": { "type": "number" },
      "gross_amount": { "type": "number" },
      "discount_amount": { "type": "number" },
      "net_amount": { "type": "number" }
    }
  }
}
```

## SQL Template Rules

- ต้องเป็น `SELECT` หรือ CTE ที่สุดท้ายเป็น `SELECT`
- ห้าม `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`
- ต้องมี timeout
- ต้องมี limit หรือ date range ที่ชัดเจน
- ใช้ read-only user

ตัวอย่าง placeholder:

```sql
select
  branch_code,
  item_code as product_code,
  item_name as product_name,
  sum(qty) as qty,
  sum(net_amount) as net_amount
from <approved_sales_view_or_query>
where doc_date between $1 and $2
group by branch_code, item_code, item_name
order by net_amount desc
```

## Summary Rules

สรุปสำหรับ dashboard/LINE:

```json
{
  "total_net_amount": "sum(net_amount)",
  "total_qty": "sum(qty)",
  "top_products": {
    "sort_by": "net_amount",
    "limit": 5
  },
  "branch_summary": {
    "group_by": "branch_code",
    "sum": ["net_amount", "qty"]
  }
}
```

## Dashboard Widgets

report หนึ่งตัวสามารถกำหนด widget ได้:

```json
[
  { "type": "kpi", "key": "total_net_amount", "title": "ยอดขายรวม" },
  { "type": "bar_chart", "key": "sales_by_branch", "title": "ยอดขายตามสาขา" },
  { "type": "table", "key": "rows", "title": "รายการสินค้า" }
]
```

## LINE Template

```json
{
  "title": "สรุปยอดขายประจำวันที่ {{period_date}}",
  "sections": [
    "ยอดขายรวม: {{total_net_amount}} บาท",
    "จำนวนสินค้า: {{total_qty}} ชิ้น",
    "สาขาขายดี: {{top_branch_name}}"
  ]
}
```

## Validation Rule

Phase 1 validation ขั้นต่ำ:

- output มี column ตาม schema
- `row_count >= 0`
- `sum(net_amount)` เป็นตัวเลข
- period date ตรงกับ params

Future validation:

- เทียบยอดกับรายงาน SML เดิม
- tolerance rule
- branch count check

## Chatbot Policy

```json
{
  "enabled": false,
  "allowed_intents": ["sales_summary", "top_products", "branch_sales"],
  "answer_source": "report_run_or_snapshot",
  "allow_sql_generation": false
}
```

หลักการ:

- AI เลือก report และ params ได้
- AI สรุปผลได้
- AI ไม่เขียน SQL production เอง

