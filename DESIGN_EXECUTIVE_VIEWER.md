# Executive Viewer Design

## Purpose

This file controls the new design direction for the signed report detail viewer opened from LINE.

The viewer is not an admin cockpit. It is an executive detail dashboard: the user opens one LINE card, lands on that report first, sees the same numbers from the LINE run, and can switch into a date-selected dashboard without logging in.

Mockup reference: `artifacts/detail-viewer-v2-cfo-operating-mockup.html`

## Relationship To `DESIGN.md`

- `DESIGN.md` remains the shared product/admin design baseline: TailAdmin-style owner cockpit, forms, setup, notification rules, and operational configuration.
- This file overrides `DESIGN.md` only for the customer-facing signed report viewer route, currently `/command-center/brief`.
- Owner/Admin pages should not copy this viewer layout unless the workflow is explicitly customer-facing.
- The viewer may still reuse shared tokens, buttons, badges, and table primitives when they fit, but the page structure should follow this document.

## Audience

Primary audience: business owners and executives opening a report from LINE on mobile.

Secondary audience: managers opening the same link on desktop to verify documents or discuss issues with staff.

They want confidence, direction, and charts that explain the number quickly. The page should feel like a financial operating dashboard, not a raw report table.

## Core Principles

1. Same Evidence As LINE

   The first screen must use the persisted run and snapshot behind the LINE card. Initial page load must not query SML again.

2. Answer Before Table

   Do not open with a large table. Open with the number, the meaning, and the next action. Tables are supporting evidence.

3. One Flex Card, One Starting Point

   The first screen starts from the report the user clicked in LINE. The dashboard may expose the other reports in the same LINE scope through a report selector, but the selected report remains the center of the page.

4. Business Language Only

   Use terms like `ข้อมูลจาก SML`, `รอบ LINE`, `ช่วงข้อมูล`, `สิ่งที่ควรดู`. Do not show `query`, `snapshot`, `trans_flag`, table names, tokens, runner ids, or internal datasource names.

5. Trust Is Visible

   Always show store, report name, period basis, generated time, freshness, and source. If the card used reference data, show that clearly.

6. Mobile First

   LINE opens on phones. Desktop can be richer, but mobile cannot be a squeezed desktop table.

## Page Anatomy

Every signed report viewer should follow this structure.

1. Trust Header

   Shows store, report, period, generated time, freshness, and source.

2. Primary Number

   Same primary KPI as LINE. The value and unit should be visually separated so large Thai/number text remains readable.

3. Decision Strip

   Three short blocks:

   - `เกิดอะไรขึ้น`
   - `กระทบอะไร`
   - `ควรทำอะไรต่อ`

4. Evidence Section

   The first evidence section changes by report, but it must always answer why the LINE card said what it said.

5. Action Sequence

   A short ordered list of 2 to 3 checks. These are operational next steps, not generic advice.

6. Source And Limits

   Plain-language basis, such as `ข้อมูลวันที่รับชำระ`, `ข้อมูลสะสมถึงวันที่`, `ข้อมูลล่าสุดจาก SML`, or `คงเหลือ ณ วันที่`.

7. Dashboard Toolbar

   Date controls live in the top toolbar. Changing dates does not run data by itself. The user must click `ดูข้อมูล`.

8. Advanced Area

   Search, full rows, V1 fallback, and drilldown live below the dashboard evidence.

## Report-Specific Direction

### ขายสินค้าและบริการ

- Primary story: sales total, bill count, line count, top sales drivers.
- Evidence starts with important bills and best-selling items.
- Reconciliation warnings must be written as business copy: `ยอดหัวบิลและยอดรายละเอียดไม่เท่ากัน`.

### ซื้อ/ตั้งหนี้

- Primary story: purchase total, document count, supplier concentration.
- Evidence starts with top suppliers and large purchase documents.
- Connect to inventory only as supporting context.

### กำไรขั้นต้นสินค้า

- Primary story: gross profit from product perspective.
- Negative-profit items come first.
- Must state that this uses the same total as customer profit, but split by product.

### กำไรขั้นต้นลูกหนี้

- Primary story: gross profit from customer/debtor perspective.
- Negative-profit customers and missing customer mapping come first.
- Must state that this uses the same total as product profit, but split by customer.

### สต็อกคงเหลือ

- Primary story: stock value, item count, in/out amount, negative stock risk.
- Evidence order: negative stock, high-value stock, missing/zero cost, high movement.
- Must show cost sensitivity. If using reference data, timestamp must be obvious.

### สินค้าถึงจุดสั่งซื้อ

- Primary story: items below reorder point.
- Evidence order: out of stock first, low stock second, pending receipt third.
- Copy must say it is latest SML data, not a historical period report.

### เคลื่อนไหวลูกหนี้

- Primary story: AR movement accumulated to date.
- Must not look like aging or outstanding AR.
- Evidence should show top customers and top documents, not the full movement table.
- Copy must say `ข้อมูลสะสมถึงวันที่` and `ไม่ใช่รายงานอายุหนี้`.

### รับชำระหนี้

- Primary story: receipt total, customer count, document count, cash/transfer split.
- Evidence starts with payment channel warnings when present.
- If no warning, focus on top receipts and top customers.

## Visual System

- Background: calm light product surface.
- Main surface: white panels with restrained borders.
- Use brand blue for navigation, selected states, and primary actions.
- Use warning/critical colors only when the data needs attention.
- Do not make every note orange. Tone should be neutral, info, warning, or critical based on meaning.
- Avoid decorative hero sections, large marketing headlines, glass effects, gradient text, and nested cards.
- Cards should use restrained radii and no heavy decorative shadows.
- Typography should be dense and readable, with fixed sizes and no viewport-scaled text.

## Interaction Rules

- Initial open is read-only evidence from the signed run.
- `เปิดรายละเอียด` from LINE must land directly on the relevant report, not a generic dashboard.
- `ดูช่วงอื่น` is secondary. It must not imply the LINE card changed.
- Drilldown must remain bound to the signed run, tenant, report key, and period.
- Invalid/expired token pages should stay simple and human-readable.

## Performance Rules

- Initial viewer load must not trigger SML/JavaWS report execution.
- Heavy report reference/fallback status must be read from persisted metadata.
- Large tables must be bounded on first render. Provide search or progressive reveal instead of rendering everything.
- Mobile layout must not require horizontal scrolling.

## Copy Rules

Use these labels consistently:

- `สิ่งที่ควรดู`
- `ที่มาของตัวเลข`
- `ข้อมูลจาก SML`
- `ข้อมูลจากรอบ LINE`
- `ดูช่วงอื่น`
- `ข้อมูลอ้างอิงล่าสุดเมื่อ ...`

Avoid these words in customer-facing viewer copy:

- `query`
- `snapshot`
- `trans_flag`
- `runner`
- `payload`
- `token`
- internal table names
- datasource implementation names

## Acceptance Checklist

Before shipping a viewer change:

- The primary number matches the LINE card for the same run.
- The page shows store, report, period, generated time, freshness, and source.
- Initial load does not run SML.
- The first screen explains what happened, impact, and next action.
- Tables do not appear before executive evidence.
- Mobile has no horizontal overflow.
- No technical/internal fields appear in Thai customer copy.
- Signed viewer security behavior is unchanged.
- LINE Flex payload is unchanged unless the task explicitly targets LINE card rendering.
