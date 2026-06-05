import {
  formatSmlBranchLabel,
  getSmlBranchMeaning,
  type BranchSales,
  type DataQualityStatus,
  type SalesDetailRow,
  type SalesFinancialBreakdown,
  type SalesGoodsServicesParams,
  type SalesGoodsServicesLinePreview,
  type SalesGoodsServicesSnapshot,
  salesGoodsServicesParamsSchema,
  type SalesHeaderRow,
  type SmlBranchRecord,
  type TenantId,
  type TopProduct,
} from "@ai-bcc/shared";
import {
  buildExecutiveDigestFlexMessage,
  isValidLineUri as isValidExecutiveDigestUri,
  type ExecutiveDigestStatus,
} from "./line-flex.js";

export const salesGoodsServicesContract = {
  report_key: "sales_goods_services",
  name: "Sales Goods and Services",
  version: "0.2.0",
  params_schema: salesGoodsServicesParamsSchema,
  metric_truth: {
    financial_total: "ic_trans.total_amount",
    detail_analytics: "ic_trans_detail.sum_amount, ic_trans_detail.qty",
    branch_fallback:
      "detail.branch_code -> header.branch_code -> no_branch",
  },
} as const;

export function validateSalesGoodsServicesParams(
  input: unknown,
): SalesGoodsServicesParams {
  return salesGoodsServicesParamsSchema.parse(input);
}

export function buildSalesHeaderQuery(params: SalesGoodsServicesParams) {
  validateSalesGoodsServicesParams(params);

  return {
    text: `
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
order by h.doc_date, h.doc_no, h.doc_time, h.cust_code
`,
    values: [params.date_from, params.date_to],
  };
}

export function buildSalesDetailQuery(params: SalesGoodsServicesParams) {
  validateSalesGoodsServicesParams(params);

  return {
    text: `
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
order by d.doc_date, d.doc_no, d.line_number
`,
    values: [params.date_from, params.date_to],
  };
}

export function buildSalesPdfCountQuery(params: SalesGoodsServicesParams) {
  validateSalesGoodsServicesParams(params);

  return {
    text: `
with filtered_headers as (
  select
    h.doc_no,
    h.doc_date,
    h.trans_flag
  from ic_trans h
  where h.trans_flag in (44)
    and h.last_status = 0
    and h.doc_date between $1::date and $2::date
    and (coalesce(h.doc_ref, '') = '' or h.is_pos = 0)
    and h.is_doc_copy <> 1
)
select
  count(*)::int as document_count,
  coalesce(sum(detail_stats.detail_line_count), 0)::int as detail_row_count
from filtered_headers h
left join lateral (
  select count(*)::int as detail_line_count
  from ic_trans_detail d
  where d.doc_no = h.doc_no
    and d.doc_date = h.doc_date
    and d.trans_flag = h.trans_flag
    and d.last_status = 0
    and d.doc_date between $1::date and $2::date
) detail_stats on true
`,
    values: [params.date_from, params.date_to],
  };
}

export function buildSalesDocumentDetailQuery(
  params: SalesGoodsServicesParams,
  docNo: string,
) {
  validateSalesGoodsServicesParams(params);
  const normalizedDocNo = docNo.trim();
  if (!normalizedDocNo) {
    throw new Error("doc_no is required");
  }

  return {
    text: `
with filtered_headers as (
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
    cast(h.last_status as varchar) as last_status,
    h.trans_flag
  from ic_trans h
  left join ar_customer c on c.code = h.cust_code
  where h.trans_flag in (44)
    and h.last_status = 0
    and h.doc_date between $1::date and $2::date
    and h.doc_no = $3
    and (coalesce(h.doc_ref, '') = '' or h.is_pos = 0)
    and h.is_doc_copy <> 1
)
select
  h.rownum,
  h.doc_date,
  h.doc_no,
  h.doc_time,
  h.doc_ref_date,
  h.doc_ref,
  h.cust_code,
  h.cust_name,
  h.branch_code,
  h.total_value,
  h.total_discount,
  h.total_except_discount,
  h.total_except_vat,
  h.vat_rate,
  h.total_vat_value,
  h.vat_type,
  h.total_amount,
  h.cashier_code,
  h.last_status,
  d.discount,
  d.discount_amount,
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
  case
    when d.vat_type = 0 then 'E'
    when d.vat_type = 1 then 'I'
    when d.vat_type = 2 then 'C'
    when d.vat_type = 3 then '3'
  end as detail_vat_type,
  cast(d.tax_type as varchar) as tax_type,
  d.ref_row,
  d.price,
  d.sum_amount,
  d.line_number,
  coalesce(nullif(d.branch_code, ''), nullif(h.branch_code, ''), 'no_branch') as detail_branch_code
from filtered_headers h
left join ic_trans_detail d on d.doc_no = h.doc_no
  and d.doc_date = h.doc_date
  and d.trans_flag = h.trans_flag
  and d.last_status = 0
left join ic_inventory i on i.code = d.item_code
left join ic_unit u on u.code = d.unit_code
order by h.doc_date, h.doc_no, d.line_number
`,
    values: [params.date_from, params.date_to, normalizedDocNo],
  };
}

export function buildSalesDocumentPageQuery(
  params: SalesGoodsServicesParams,
  options: {
    page: number;
    pageSize: number;
    search?: string | null;
  },
) {
  validateSalesGoodsServicesParams(params);
  const page = Math.max(1, Math.floor(options.page));
  const pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize)));
  const offset = (page - 1) * pageSize;
  const search = options.search?.trim() || null;

  return {
    text: `
with filtered_headers as (
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
    cast(h.last_status as varchar) as last_status,
    h.trans_flag
  from ic_trans h
  left join ar_customer c on c.code = h.cust_code
  where h.trans_flag in (44)
    and h.last_status = 0
    and h.doc_date between $1::date and $2::date
    and (coalesce(h.doc_ref, '') = '' or h.is_pos = 0)
    and h.is_doc_copy <> 1
    and (
      nullif($3::text, '') is null
      or lower(coalesce(h.doc_no, '')) like '%' || lower($3::text) || '%'
      or lower(coalesce(h.cust_code, '')) like '%' || lower($3::text) || '%'
      or lower(coalesce(c.name_1, '')) like '%' || lower($3::text) || '%'
      or lower(coalesce(h.cashier_code, '')) like '%' || lower($3::text) || '%'
      or h.doc_date::text like '%' || $3::text || '%'
      or h.total_amount::text like '%' || $3::text || '%'
    )
),
paged_headers as (
  select
    filtered_headers.*,
    count(*) over() as total_count
  from filtered_headers
  order by doc_date desc, doc_no desc, doc_time desc nulls last
  limit $4::int
  offset $5::int
)
select
  h.rownum,
  h.doc_date,
  h.doc_no,
  h.doc_time,
  h.doc_ref_date,
  h.doc_ref,
  h.cust_code,
  h.cust_name,
  h.branch_code,
  h.total_value,
  h.total_discount,
  h.total_except_discount,
  h.total_except_vat,
  h.vat_rate,
  h.total_vat_value,
  h.vat_type,
  h.total_amount,
  h.cashier_code,
  h.last_status,
  coalesce(detail_stats.detail_line_count, 0) as detail_line_count,
  coalesce(detail_stats.detail_total_amount, 0) as detail_total_amount,
  coalesce(detail_stats.detail_total_qty, 0) as detail_total_qty,
  coalesce(nullif(detail_stats.detail_branch_code, ''), nullif(h.branch_code, ''), 'no_branch') as resolved_branch_code,
  h.total_count
from paged_headers h
left join lateral (
  select
    count(*)::int as detail_line_count,
    sum(d.sum_amount) as detail_total_amount,
    sum(d.qty) as detail_total_qty,
    min(nullif(d.branch_code, '')) as detail_branch_code
  from ic_trans_detail d
  where d.doc_no = h.doc_no
    and d.doc_date = h.doc_date
    and d.trans_flag = h.trans_flag
    and d.last_status = 0
) detail_stats on true
order by h.doc_date desc, h.doc_no desc, h.doc_time desc nulls last
`,
    values: [params.date_from, params.date_to, search, pageSize, offset],
  };
}

export function buildSmlBranchListQuery() {
  return {
    text: `
select
  code,
  name_1
from erp_branch_list
where coalesce(code, '') <> ''
order by code
`,
    values: [],
  };
}

export function normalizeBranchCode(
  detailBranch: string | null | undefined,
  headerBranch?: string | null,
) {
  return detailBranch?.trim() || headerBranch?.trim() || "no_branch";
}

function resolveDocumentBranch(
  header: SalesHeaderRow,
  detailsByDoc: Map<string, SalesDetailRow[]>,
) {
  const headerBranch = header.branch_code?.trim();
  const detailBranches = [
    ...new Set(
      (detailsByDoc.get(header.doc_no) ?? [])
        .map((detail) => detail.branch_code?.trim())
        .filter((branch): branch is string => Boolean(branch)),
    ),
  ];

  if (detailBranches.length === 1) {
    return detailBranches[0];
  }

  return headerBranch || detailBranches[0] || "no_branch";
}

function buildBranchNameMap(branches: SmlBranchRecord[] | undefined) {
  const map = new Map<string, string>();
  for (const branch of branches ?? []) {
    const code = branch.code.trim();
    const name = branch.name_1.trim();
    if (code && name) {
      map.set(code, name);
    }
  }
  return map;
}

function buildFinancialBreakdown(
  headers: SalesHeaderRow[],
  headerTotal: number,
): SalesFinancialBreakdown {
  const grossSales = roundMoney(
    headers.reduce((sum, row) => sum + safeNumber(row.total_value), 0),
  );
  const totalDiscount = roundMoney(
    headers.reduce((sum, row) => sum + safeNumber(row.total_discount), 0),
  );
  const afterDiscountAmount = roundMoney(
    headers.reduce(
      (sum, row) => sum + safeNumber(row.total_except_discount),
      0,
    ),
  );
  const rawBeforeVatAmount = roundMoney(
    headers.reduce((sum, row) => sum + safeNumber(row.total_except_vat), 0),
  );
  const vatAmount = roundMoney(
    headers.reduce((sum, row) => sum + safeNumber(row.total_vat_value), 0),
  );
  const derivedBeforeVatAmount = roundMoney(headerTotal - vatAmount);
  const rawBeforeVatReconciles =
    Math.abs(roundMoney(rawBeforeVatAmount + vatAmount - headerTotal)) <= 0.05;
  const beforeVatAmount =
    rawBeforeVatAmount > 0 && rawBeforeVatReconciles
      ? rawBeforeVatAmount
      : derivedBeforeVatAmount;
  const vatRates = [
    ...new Set(
      headers
        .map((row) => safeNumber(row.vat_rate))
        .filter((rate) => Number.isFinite(rate))
        .map((rate) => roundQty(rate)),
    ),
  ];

  return {
    gross_sales: grossSales,
    total_discount: totalDiscount,
    after_discount_amount: afterDiscountAmount,
    before_vat_amount: beforeVatAmount,
    vat_amount: vatAmount,
    net_sales: headerTotal,
    discount_percent:
      grossSales > 0 ? roundQty((totalDiscount / grossSales) * 100) : null,
    vat_rate: vatRates.length === 1 ? vatRates[0] : null,
    document_count_with_discount: headers.filter(
      (row) => safeNumber(row.total_discount) > 0,
    ).length,
  };
}

export function summarizeSalesGoodsServices(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: SalesGoodsServicesSnapshot["source"];
  headers: SalesHeaderRow[];
  details: SalesDetailRow[];
  branches?: SmlBranchRecord[];
}): SalesGoodsServicesSnapshot {
  const headerTotal = roundMoney(
    input.headers.reduce((sum, row) => sum + safeNumber(row.total_amount), 0),
  );
  const detailTotal = roundMoney(
    input.details.reduce((sum, row) => sum + safeNumber(row.sum_amount), 0),
  );
  const totalQty = roundQty(
    input.details.reduce((sum, row) => sum + safeNumber(row.qty), 0),
  );
  const difference = roundMoney(headerTotal - detailTotal);
  const financialBreakdown = buildFinancialBreakdown(
    input.headers,
    headerTotal,
  );

  const detailsByDoc = new Map<string, SalesDetailRow[]>();
  for (const detail of input.details) {
    const current = detailsByDoc.get(detail.doc_no) ?? [];
    current.push(detail);
    detailsByDoc.set(detail.doc_no, current);
  }

  const branchMap = new Map<string, BranchSales>();
  const headerBranchByDoc = new Map<string, string>();
  const branchNameByCode = buildBranchNameMap(input.branches);

  for (const header of input.headers) {
    const branchCode = resolveDocumentBranch(header, detailsByDoc);
    const branchMeaning = getSmlBranchMeaning(
      branchCode,
      branchNameByCode.get(branchCode),
    );
    headerBranchByDoc.set(header.doc_no, branchCode);
    const current =
      branchMap.get(branchCode) ??
      ({
        branch_code: branchCode,
        branch_label: branchMeaning.label,
        branch_name: branchMeaning.name,
        branch_note: branchMeaning.note,
        total_amount: 0,
        document_count: 0,
        line_count: 0,
      } satisfies BranchSales);
    current.total_amount = roundMoney(
      current.total_amount + safeNumber(header.total_amount),
    );
    current.document_count += 1;
    branchMap.set(branchCode, current);
  }

  for (const detail of input.details) {
    const branchCode = normalizeBranchCode(
      detail.branch_code,
      headerBranchByDoc.get(detail.doc_no),
    );
    const branchMeaning = getSmlBranchMeaning(
      branchCode,
      branchNameByCode.get(branchCode),
    );
    const current =
      branchMap.get(branchCode) ??
      ({
        branch_code: branchCode,
        branch_label: branchMeaning.label,
        branch_name: branchMeaning.name,
        branch_note: branchMeaning.note,
        total_amount: 0,
        document_count: 0,
        line_count: 0,
      } satisfies BranchSales);
    current.line_count += 1;
    branchMap.set(branchCode, current);
  }

  const productMap = new Map<string, TopProduct>();
  for (const detail of input.details) {
    const key = detail.item_code?.trim() || "unknown_item";
    const current =
      productMap.get(key) ??
      ({
        item_code: key,
        item_name: detail.item_name?.trim() || "Unknown item",
        qty: 0,
        sum_amount: 0,
        line_count: 0,
      } satisfies TopProduct);
    current.qty = roundQty(current.qty + safeNumber(detail.qty));
    current.sum_amount = roundMoney(
      current.sum_amount + safeNumber(detail.sum_amount),
    );
    current.line_count += 1;
    productMap.set(key, current);
  }

  const topProducts = [...productMap.values()]
    .sort((a, b) => b.sum_amount - a.sum_amount)
    .slice(0, 10);

  const qualityStatus = resolveQualityStatus(
    input.source,
    input.headers.length,
    difference,
  );

  return {
    tenant_id: input.tenant_id,
    report_key: "sales_goods_services",
    run_id: input.run_id,
    params: input.params,
    generated_at: input.generated_at,
    source: input.source,
    quality_status: qualityStatus,
    summary: {
      total_sales: headerTotal,
      document_count: input.headers.length,
      line_count: input.details.length,
      total_qty: totalQty,
      top_product_name: topProducts[0]?.item_name ?? null,
    },
    financial_breakdown: financialBreakdown,
    branch_sales: [...branchMap.values()].sort(
      (a, b) => b.total_amount - a.total_amount,
    ),
    top_products: topProducts,
    documents: input.headers.slice(0, 500),
    lines: input.details.slice(0, 1000),
    reconciliation: {
      header_total_amount: headerTotal,
      detail_sum_amount: detailTotal,
      difference_amount: difference,
      status: qualityStatus,
      note:
        Math.abs(difference) > 0.01
          ? "ยอดหัวบิลและยอดรายละเอียดสินค้าไม่เท่ากัน อาจเกิดจาก VAT, discount, rounding หรือโครงสร้าง SML; ระบบใช้ ic_trans.total_amount เป็นยอดขายหลัก."
          : "Header total and detail sum are reconciled.",
    },
    line_template: {
      title: "Morning Brief: Sales Goods and Services",
      body: [
        `ยอดขายสุทธิ ${formatMoney(headerTotal)} บาท`,
        `เอกสาร ${input.headers.length.toLocaleString("th-TH")} ใบ / รายการ ${input.details.length.toLocaleString("th-TH")} แถว`,
        topProducts[0]
          ? `สินค้าสูงสุด: ${topProducts[0].item_name} (${formatMoney(topProducts[0].sum_amount)} บาท)`
          : "ไม่มีสินค้าในช่วงเวลานี้",
      ],
    },
  };
}

export function createEmptySalesGoodsServicesSnapshot(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
}): SalesGoodsServicesSnapshot {
  return summarizeSalesGoodsServices({
    ...input,
    source: "sample_snapshot",
    headers: [],
    details: [],
  });
}

export function renderSalesGoodsServicesLinePreview(input: {
  snapshot: SalesGoodsServicesSnapshot;
  dashboardUrl?: string | null;
  tenantName?: string | null;
}): SalesGoodsServicesLinePreview {
  const { snapshot } = input;
  const warnings = buildLineWarnings(snapshot);
  const dashboardUrl = input.dashboardUrl ?? null;
  const useFlexMessage = isValidLineUri(dashboardUrl);
  const branchLines = snapshot.branch_sales.slice(0, 3).map((branch, index) => {
    return `${index + 1}. ${branch.branch_label ?? formatBranchLabel(branch.branch_code)}: ${formatMoney(branch.total_amount)} บาท`;
  });
  const topProductLines = snapshot.top_products.slice(0, 3).map((product, index) => {
    return `${index + 1}. ${product.item_name}: ${formatMoney(product.sum_amount)} บาท`;
  });
  const tenantName = input.tenantName?.trim() || snapshot.tenant_id;
  const generatedAt = formatThaiDateTime(snapshot.generated_at);
  const insight = buildBusinessInsight(snapshot);
  const comparisonText = formatComparisonSummary(snapshot);
  const isEmptySales = isEmptySalesSnapshot(snapshot);
  const lines = isEmptySales
    ? [
        "รายงานขายสินค้าและบริการ",
        "",
        `บริษัท: ${tenantName}`,
        `วันที่ข้อมูล: ${formatReportPeriodWithTime(snapshot.params.date_from, snapshot.params.date_to)}`,
        `อัปเดต: ${generatedAt}`,
        "",
        "สถานะ: ไม่พบยอดขาย",
        "ยอดขายสุทธิ: 0.00 บาท",
        "บิลขาย: 0 ใบ",
        "จำนวนรายการขาย: 0 รายการ",
        "",
        "วันนี้ควรรู้อะไร",
        "ไม่พบยอดขายในช่วงวันที่นี้ อาจเป็นวันหยุดขาย หรือยังไม่มีการปิดบิลใน SML",
        ...formatEmptyComparisonLines(snapshot),
        "",
        "ข้อมูลประกอบ",
        "ยอดขายตามสาขา: ไม่มีข้อมูลสำหรับช่วงวันที่นี้",
        "สินค้าขายดี: ไม่มีข้อมูลสำหรับช่วงวันที่นี้",
        ...warnings
          .filter((warning) => warning !== "ไม่พบยอดขายในช่วงวันที่นี้")
          .map((warning) => `\nหมายเหตุ: ${warning}`),
        "",
        useFlexMessage
          ? "เปิดรายงาน: กดปุ่มใน LINE เพื่อดูรายละเอียด"
          : "เปิดรายงาน: ยังไม่พร้อมใช้งานในข้อความนี้",
      ]
    : [
        "รายงานขายสินค้าและบริการ",
        "",
        `บริษัท: ${tenantName}`,
        `วันที่ข้อมูล: ${formatReportPeriodWithTime(snapshot.params.date_from, snapshot.params.date_to)}`,
        `อัปเดต: ${generatedAt}`,
        "",
        `ยอดขายสุทธิ: ${formatMoney(snapshot.summary.total_sales)} บาท`,
        `บิลขาย: ${snapshot.summary.document_count.toLocaleString("th-TH")} ใบ`,
        `จำนวนรายการขาย: ${snapshot.summary.line_count.toLocaleString("th-TH")} รายการ`,
        `จำนวนขายรวม: ${snapshot.summary.total_qty.toLocaleString("th-TH", {
          maximumFractionDigits: 3,
        })}`,
        "",
        "ยอดขายตามสาขา",
        ...(branchLines.length ? branchLines : ["- ไม่มีข้อมูลสาขา"]),
        "",
        "สินค้าขายดี",
        ...(topProductLines.length ? topProductLines : ["- ไม่มีสินค้าในช่วงเวลานี้"]),
        "",
        `สรุปที่ควรดู: ${insight}`,
        ...(comparisonText ? [`เทียบยอด: ${comparisonText}`] : []),
        ...warnings.map((warning) => `\nหมายเหตุ: ${warning}`),
        "",
        useFlexMessage
          ? "เปิดรายงาน: กดปุ่มใน LINE เพื่อดูรายละเอียด"
          : "เปิดรายงาน: ยังไม่พร้อมใช้งานในข้อความนี้",
      ];
  const flexMessage = useFlexMessage
    ? buildSalesGoodsServicesFlexMessage({
        snapshot,
        tenantName,
        generatedAt,
        dashboardUrl,
        insight,
        comparisonText,
        warnings,
      })
    : undefined;

  return {
    tenant_id: snapshot.tenant_id,
    report_key: snapshot.report_key,
    run_id: snapshot.run_id,
    generated_at: snapshot.generated_at,
    source: snapshot.source,
    line_message_type: flexMessage ? "flex" : "text",
    title: "Morning Brief - Sales Goods and Services",
    text: lines.join("\n"),
    lines,
    flex_message: flexMessage,
    warnings,
    dashboard_url: dashboardUrl,
  };
}

function buildSalesGoodsServicesFlexMessage(input: {
  snapshot: SalesGoodsServicesSnapshot;
  tenantName: string;
  generatedAt: string;
  dashboardUrl: string | null;
  insight: string;
  comparisonText: string | null;
  warnings: string[];
}) {
  if (!isValidExecutiveDigestUri(input.dashboardUrl)) {
    return undefined;
  }

  const { snapshot } = input;
  if (isEmptySalesSnapshot(snapshot)) {
    return buildEmptySalesGoodsServicesFlexMessage(input);
  }

  const firstProduct = snapshot.top_products[0];
  return buildExecutiveDigestFlexMessage({
    title: "ขายสินค้าและบริการ",
    subtitle: `${input.tenantName} · ${formatReportPeriodWithTime(
      snapshot.params.date_from,
      snapshot.params.date_to,
    )}`,
    altText: `ขายสินค้าและบริการ ${input.tenantName} ${formatReportPeriod(
      snapshot.params.date_from,
      snapshot.params.date_to,
    )}: ${formatMoney(snapshot.summary.total_sales)} บาท`,
    generatedAt: input.generatedAt,
    status: getSalesDigestStatus(snapshot),
    primaryAmount: `${formatMoney(snapshot.summary.total_sales)} บาท`,
    metrics: [
      { label: "บิลขาย", value: `${formatInteger(snapshot.summary.document_count)} ใบ` },
      {
        label: "รายการขาย",
        value: `${formatInteger(snapshot.summary.line_count)} รายการ`,
      },
      { label: "จำนวนขายรวม", value: formatQty(snapshot.summary.total_qty) },
    ],
    insight: input.insight,
    topLine: firstProduct
      ? {
          label: "สินค้าขายดี",
          value: `${truncateLineText(firstProduct.item_name, 38)}: ${formatMoney(firstProduct.sum_amount)} บาท`,
        }
      : { label: "สินค้าขายดี", value: "ยังไม่มีสินค้าในช่วงเวลานี้" },
    dashboardUrl: input.dashboardUrl,
  });
}

function buildEmptySalesGoodsServicesFlexMessage(input: {
  snapshot: SalesGoodsServicesSnapshot;
  tenantName: string;
  generatedAt: string;
  dashboardUrl: string | null;
  insight: string;
  comparisonText: string | null;
  warnings: string[];
}) {
  if (!isValidExecutiveDigestUri(input.dashboardUrl)) {
    return undefined;
  }

  const { snapshot } = input;
  const comparisonText = formatEmptyComparisonSummary(snapshot);
  return buildExecutiveDigestFlexMessage({
    title: "ขายสินค้าและบริการ",
    subtitle: `${input.tenantName} · ${formatReportPeriodWithTime(
      snapshot.params.date_from,
      snapshot.params.date_to,
    )}`,
    altText: `ไม่พบยอดขาย ${input.tenantName} ${formatReportPeriod(
      snapshot.params.date_from,
      snapshot.params.date_to,
    )}`,
    generatedAt: input.generatedAt,
    status: { text: "ไม่มีข้อมูล", severity: "notice" },
    primaryAmount: "0.00 บาท",
    metrics: [
      { label: "บิลขาย", value: "0 ใบ" },
      { label: "รายการขาย", value: "0 รายการ" },
    ],
    insight:
      "ไม่พบยอดขายในช่วงวันที่นี้ อาจเป็นวันหยุดขาย หรือยังไม่มีการปิดบิลใน SML",
    topLine: comparisonText
      ? { label: "เทียบยอด", value: comparisonText }
      : { label: "ข้อมูลประกอบ", value: "ยังไม่มีข้อมูลสาขาหรือสินค้าขายดี" },
    dashboardUrl: input.dashboardUrl,
  });
}

function buildFlexCompactMetric(label: string, value: string) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    contents: [
      {
        type: "text",
        text: label,
        size: "xs",
        color: "#6B7280",
      },
      {
        type: "text",
        text: value,
        size: "sm",
        color: "#111827",
        weight: "bold",
        margin: "xs",
      },
    ],
  };
}

function buildFlexInlineSummary(items: Array<[string, string]>) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    margin: "sm",
    contents: items.map(([label, value]) => ({
      type: "box",
      layout: "vertical",
      flex: 1,
      contents: [
        {
          type: "text",
          text: label,
          size: "xs",
          color: "#6B7280",
          weight: "bold",
          wrap: true,
        },
        {
          type: "text",
          text: value,
          size: "sm",
          color: "#111827",
          margin: "xs",
          wrap: true,
        },
      ],
    })),
  };
}

function buildFlexMetricRow(label: string, value: string) {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      {
        type: "text",
        text: label,
        size: "sm",
        color: "#6B7280",
        flex: 2,
      },
      {
        type: "text",
        text: value,
        size: "sm",
        color: "#111827",
        align: "end",
        weight: "bold",
        flex: 2,
      },
    ],
  };
}

function buildFlexInfoBlock(label: string, value: string) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    contents: [
      {
        type: "text",
        text: label,
        size: "xs",
        color: "#6B7280",
        weight: "bold",
      },
      {
        type: "text",
        text: value,
        size: "sm",
        color: "#111827",
        wrap: true,
      },
    ],
  };
}

function isValidLineUri(value: string | null | undefined): value is string {
  if (!value || value.length > 1000) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function buildBusinessInsight(snapshot: SalesGoodsServicesSnapshot) {
  if (snapshot.summary.document_count === 0) {
    return "ไม่พบยอดขายเมื่อวาน ควรตรวจว่าร้านหยุดขาย ยังไม่ปิดบิล หรือช่วงวันที่ถูกต้องหรือไม่";
  }

  const topBranch = snapshot.branch_sales[0];
  if (topBranch && snapshot.summary.total_sales > 0) {
    const share = (topBranch.total_amount / snapshot.summary.total_sales) * 100;
    if (share >= 99) {
      return "ยอดขายอยู่ที่สาขาเดียวเกือบทั้งหมด อาจเป็นร้านสาขาเดียวหรือยังไม่ได้ map สาขา";
    }
  }

  const noBranch = snapshot.branch_sales.find(
    (branch) => branch.branch_code === "no_branch",
  );
  if (noBranch && noBranch.total_amount > 0) {
    return "มีรายการขายที่ไม่ระบุสาขา ควรตรวจการตั้งค่าสาขาใน SML";
  }

  if (snapshot.quality_status === "reconciled_with_warning") {
    return "ยอดหัวบิลและยอดรายละเอียดไม่เท่ากัน ระบบใช้ยอดหัวบิลเป็นตัวเลขหลัก";
  }

  return "รายงานพร้อมใช้สำหรับดูยอดขายและกดเปิดรายละเอียดเพิ่มเติม";
}

function getSalesDigestStatus(
  snapshot: SalesGoodsServicesSnapshot,
): ExecutiveDigestStatus {
  if (snapshot.summary.total_sales < 0) {
    return { text: "ควรตรวจทันที", severity: "critical" };
  }
  if (snapshot.summary.document_count === 0) {
    return { text: "ไม่มีข้อมูล", severity: "notice" };
  }
  if (snapshot.source === "sample_snapshot" || snapshot.quality_status === "stale") {
    return { text: "ข้อมูลเก่า", severity: "notice" };
  }
  if (
    snapshot.quality_status === "reconciled_with_warning" ||
    snapshot.branch_sales.some(
      (branch) => branch.branch_code === "no_branch" && branch.total_amount > 0,
    )
  ) {
    return { text: "มีข้อสังเกต", severity: "notice" };
  }
  return { text: "พร้อมใช้", severity: "ready" };
}

function formatEmptyComparisonLines(snapshot: SalesGoodsServicesSnapshot) {
  const comparisonText = formatEmptyComparisonSummary(snapshot);
  if (!comparisonText) {
    return [];
  }

  return ["", `เทียบยอด: ${comparisonText}`];
}

function formatEmptyComparisonSummary(snapshot: SalesGoodsServicesSnapshot) {
  const previousDay = snapshot.comparison?.previous_day;
  if (previousDay && previousDay.total_sales > 0) {
    return `ต่ำกว่าวันก่อนหน้า ซึ่งมียอดขาย ${formatMoney(
      previousDay.total_sales,
    )} บาท จาก ${formatInteger(previousDay.document_count)} บิล`;
  }

  const sameWeekdayLastWeek = snapshot.comparison?.same_weekday_last_week;
  if (sameWeekdayLastWeek && sameWeekdayLastWeek.total_sales > 0) {
    return `ต่ำกว่าวันเดียวกันสัปดาห์ก่อน ซึ่งมียอดขาย ${formatMoney(
      sameWeekdayLastWeek.total_sales,
    )} บาท จาก ${formatInteger(sameWeekdayLastWeek.document_count)} บิล`;
  }

  return null;
}

function formatComparisonSummary(snapshot: SalesGoodsServicesSnapshot) {
  const previousDay = snapshot.comparison?.previous_day;
  const sameWeekdayLastWeek = snapshot.comparison?.same_weekday_last_week;
  const target = previousDay ?? sameWeekdayLastWeek;
  if (!target) {
    return null;
  }

  const label =
    target.label === "previous_day" ? "วันก่อนหน้า" : "วันเดียวกันสัปดาห์ก่อน";
  if (target.direction === "no_reference") {
    return `ยังไม่มีฐานเทียบกับ${label}`;
  }

  return `${formatComparisonDirection(target.direction)}จาก${label} ${formatSignedMoney(
    target.difference_amount,
  )} บาท${target.difference_percent !== null ? ` (${formatSignedPercent(target.difference_percent)})` : ""}`;
}

function formatComparisonDirection(
  direction: "up" | "down" | "flat" | "no_reference",
) {
  if (direction === "up") {
    return "เพิ่มขึ้น";
  }
  if (direction === "down") {
    return "ลดลง";
  }
  if (direction === "flat") {
    return "ทรงตัว";
  }
  return "ยังไม่มีฐานเทียบ";
}

function formatSignedMoney(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatMoney(value)}`;
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("th-TH", {
    maximumFractionDigits: 1,
  })}%`;
}

function formatTrustStatus(snapshot: SalesGoodsServicesSnapshot) {
  if (snapshot.summary.document_count === 0) {
    return "ไม่มีข้อมูล";
  }
  if (snapshot.source === "sample_snapshot" || snapshot.quality_status === "stale") {
    return "ข้อมูลเก่า";
  }
  if (snapshot.quality_status === "reconciled_with_warning") {
    return "ควรตรวจยอด";
  }
  return "พร้อมใช้";
}

function formatBranchLabel(branchCode: string) {
  return formatSmlBranchLabel(branchCode);
}

function isEmptySalesSnapshot(snapshot: SalesGoodsServicesSnapshot) {
  return (
    snapshot.summary.document_count === 0 &&
    snapshot.summary.line_count === 0 &&
    snapshot.summary.total_sales === 0
  );
}

function buildLineWarnings(snapshot: SalesGoodsServicesSnapshot): string[] {
  const warnings: string[] = [];

  if (snapshot.source === "sample_snapshot") {
    warnings.push("ข้อความนี้เป็น preview จากข้อมูลตัวอย่าง ยังไม่ใช่ข้อมูลสดจาก SML");
  }

  if (snapshot.quality_status === "reconciled_with_warning") {
    warnings.push(
      "ยอดหัวเอกสารและยอดรายละเอียดไม่เท่ากัน ระบบใช้ยอดหัวเอกสารเป็นยอดขายหลัก",
    );
  }

  if (snapshot.summary.document_count === 0) {
    warnings.push("ไม่พบยอดขายในช่วงวันที่นี้");
  }

  return warnings;
}

function formatReportPeriod(dateFrom: string, dateTo: string) {
  if (dateFrom === dateTo) {
    return formatThaiDate(dateFrom);
  }

  return `${formatThaiDate(dateFrom)} - ${formatThaiDate(dateTo)}`;
}

function formatReportPeriodWithTime(dateFrom: string, dateTo: string) {
  const from = formatDateSlash(dateFrom);
  const to = formatDateSlash(dateTo);
  if (dateFrom === dateTo) {
    return `${from} 00:00 - ${to} 23:59`;
  }
  return `${from} 00:00 - ${to} 23:59`;
}

function formatDateSlash(ymd: string) {
  const [year, month, day] = ymd.split("-");
  return `${day}/${month}/${year}`;
}

function formatThaiDate(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatThaiDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function resolveQualityStatus(
  source: SalesGoodsServicesSnapshot["source"],
  headerCount: number,
  difference: number,
): DataQualityStatus {
  if (source === "sample_snapshot") {
    return "stale";
  }

  if (headerCount === 0) {
    return "valid";
  }

  return Math.abs(difference) > 0.01 ? "reconciled_with_warning" : "valid";
}

function safeNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatInteger(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function formatQty(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 3 });
}

function truncateLineText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
