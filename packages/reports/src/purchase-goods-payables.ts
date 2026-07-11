import {
  formatSmlBranchLabel,
  getSmlBranchMeaning,
  type BranchSales,
  type DataQualityStatus,
  type PurchaseGoodsPayablesLinePreview,
  type PurchaseGoodsPayablesSnapshot,
  type SalesDetailRow,
  type SalesFinancialBreakdown,
  type SalesGoodsServicesParams,
  salesGoodsServicesParamsSchema,
  type SalesHeaderRow,
  type SmlBranchRecord,
  type TenantId,
  type TopProduct,
  type TopSupplier,
} from "@ai-bcc/shared";
import {
  buildExecutiveDigestFlexMessage,
  type ExecutiveDigestStatus,
} from "./line-flex.js";

export const purchaseGoodsPayablesContract = {
  report_key: "purchase_goods_payables",
  name: "Purchase Goods and Payables",
  version: "0.1.0",
  params_schema: salesGoodsServicesParamsSchema,
  metric_truth: {
    financial_total: "ic_trans.total_amount",
    detail_analytics: "ic_trans_detail.sum_amount, ic_trans_detail.qty",
    supplier_lookup: "ap_supplier.name_1",
    branch_fallback:
      "detail.branch_code -> header.branch_code -> no_branch",
  },
} as const;

export function validatePurchaseGoodsPayablesParams(
  input: unknown,
): SalesGoodsServicesParams {
  return salesGoodsServicesParamsSchema.parse(input);
}

function buildDocumentTimeWindowFilter(
  alias: string,
  params: SalesGoodsServicesParams,
  startIndex = 3,
) {
  if (!params.time_from || !params.time_to) {
    return { sql: "", values: [] as string[] };
  }

  return {
    sql: `
  and (
    nullif(substring(${alias}.doc_time::text from '^[0-9]{1,2}:[0-9]{2}'), '') is null
    or (
      ${alias}.doc_date::date
      + substring(${alias}.doc_time::text from '^[0-9]{1,2}:[0-9]{2}')::time
    ) between ($1::date + $${startIndex}::time) and ($2::date + $${startIndex + 1}::time)
  )`,
    values: [params.time_from, params.time_to],
  };
}

export function buildPurchaseHeaderQuery(params: SalesGoodsServicesParams) {
  validatePurchaseGoodsPayablesParams(params);
  const timeFilter = buildDocumentTimeWindowFilter("h", params);

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
${timeFilter.sql}
  and h.is_doc_copy <> 1
order by h.doc_date, h.doc_no, h.doc_time, h.cust_code
`,
    values: [params.date_from, params.date_to, ...timeFilter.values],
  };
}

export function buildPurchaseDetailQuery(params: SalesGoodsServicesParams) {
  validatePurchaseGoodsPayablesParams(params);
  const timeFilter = buildDocumentTimeWindowFilter("h", params);

  return {
    text: `
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
${timeFilter.sql}
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
order by d.doc_date, d.doc_no, d.line_number
`,
    values: [params.date_from, params.date_to, ...timeFilter.values],
  };
}

export function buildPurchasePdfCountQuery(params: SalesGoodsServicesParams) {
  validatePurchaseGoodsPayablesParams(params);
  const timeFilter = buildDocumentTimeWindowFilter("h", params);

  return {
    text: `
with filtered_headers as (
  select
    h.doc_no,
    h.doc_date,
    h.trans_flag
  from ic_trans h
  where h.trans_flag in (12)
    and h.last_status = 0
    and h.doc_date between $1::date and $2::date
${timeFilter.sql}
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
    values: [params.date_from, params.date_to, ...timeFilter.values],
  };
}

export function buildPurchaseDocumentDetailQuery(
  params: SalesGoodsServicesParams,
  docNo: string,
) {
  validatePurchaseGoodsPayablesParams(params);
  const normalizedDocNo = docNo.trim();
  if (!normalizedDocNo) {
    throw new Error("doc_no is required");
  }
  const timeFilter = buildDocumentTimeWindowFilter("h", params);
  const docNoParam = 3 + timeFilter.values.length;

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
    cast(h.last_status as varchar) as last_status,
    h.trans_flag
  from ic_trans h
  left join ap_supplier s on s.code = h.cust_code
  where h.trans_flag in (12)
    and h.last_status = 0
    and h.doc_date between $1::date and $2::date
${timeFilter.sql}
    and h.doc_no = $${docNoParam}
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
    values: [
      params.date_from,
      params.date_to,
      ...timeFilter.values,
      normalizedDocNo,
    ],
  };
}

export function buildPurchaseDocumentPageQuery(
  params: SalesGoodsServicesParams,
  options: {
    page: number;
    pageSize: number;
    search?: string | null;
  },
) {
  validatePurchaseGoodsPayablesParams(params);
  const page = Math.max(1, Math.floor(options.page));
  const pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize)));
  const offset = (page - 1) * pageSize;
  const search = options.search?.trim() || null;
  const timeFilter = buildDocumentTimeWindowFilter("h", params);
  const searchParam = 3 + timeFilter.values.length;
  const pageSizeParam = searchParam + 1;
  const offsetParam = searchParam + 2;

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
    cast(h.last_status as varchar) as last_status,
    h.trans_flag
  from ic_trans h
  left join ap_supplier s on s.code = h.cust_code
  where h.trans_flag in (12)
    and h.last_status = 0
    and h.doc_date between $1::date and $2::date
${timeFilter.sql}
    and h.is_doc_copy <> 1
    and (
      nullif($${searchParam}::text, '') is null
      or lower(coalesce(h.doc_no, '')) like '%' || lower($${searchParam}::text) || '%'
      or lower(coalesce(h.cust_code, '')) like '%' || lower($${searchParam}::text) || '%'
      or lower(coalesce(s.name_1, '')) like '%' || lower($${searchParam}::text) || '%'
      or lower(coalesce(h.cashier_code, '')) like '%' || lower($${searchParam}::text) || '%'
      or h.doc_date::text like '%' || $${searchParam}::text || '%'
      or h.total_amount::text like '%' || $${searchParam}::text || '%'
    )
),
paged_headers as (
  select
    filtered_headers.*,
    count(*) over() as total_count
  from filtered_headers
  order by doc_date desc, doc_no desc, doc_time desc nulls last
  limit $${pageSizeParam}::int
  offset $${offsetParam}::int
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
    values: [
      params.date_from,
      params.date_to,
      ...timeFilter.values,
      search,
      pageSize,
      offset,
    ],
  };
}

export function summarizePurchaseGoodsPayables(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: PurchaseGoodsPayablesSnapshot["source"];
  headers: SalesHeaderRow[];
  details: SalesDetailRow[];
  branches?: SmlBranchRecord[];
}): PurchaseGoodsPayablesSnapshot {
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
    const key = buildDocKey(detail.doc_date, detail.doc_no);
    const current = detailsByDoc.get(key) ?? [];
    current.push(detail);
    detailsByDoc.set(key, current);
  }

  const supplierMap = new Map<string, TopSupplier>();
  const branchMap = new Map<string, BranchSales>();
  const branchNameByCode = buildBranchNameMap(input.branches);
  for (const header of input.headers) {
    const supplierCode = header.cust_code?.trim() || "unknown_supplier";
    const supplierName = header.cust_name?.trim() || supplierCode;
    const supplier =
      supplierMap.get(supplierCode) ??
      ({
        supplier_code: supplierCode,
        supplier_name: supplierName,
        total_amount: 0,
        document_count: 0,
      } satisfies TopSupplier);
    supplier.total_amount = roundMoney(
      supplier.total_amount + safeNumber(header.total_amount),
    );
    supplier.document_count += 1;
    supplierMap.set(supplierCode, supplier);

    const branchCode = resolveDocumentBranch(header, detailsByDoc);
    const branchMeaning = getSmlBranchMeaning(
      branchCode,
      branchNameByCode.get(branchCode),
    );
    const branch =
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
    branch.total_amount = roundMoney(
      branch.total_amount + safeNumber(header.total_amount),
    );
    branch.document_count += 1;
    branchMap.set(branchCode, branch);
  }

  for (const detail of input.details) {
    const branchCode = detail.branch_code?.trim() || "no_branch";
    const branchMeaning = getSmlBranchMeaning(
      branchCode,
      branchNameByCode.get(branchCode),
    );
    const branch =
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
    branch.line_count += 1;
    branchMap.set(branchCode, branch);
  }

  const productMap = new Map<string, TopProduct>();
  for (const detail of input.details) {
    const key = detail.item_code?.trim() || "unknown_item";
    const current =
      productMap.get(key) ??
      ({
        item_code: key,
        item_name: detail.item_name?.trim() || "ไม่ระบุสินค้า",
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
  const topSuppliers = [...supplierMap.values()]
    .sort((a, b) => b.total_amount - a.total_amount)
    .slice(0, 10);
  const qualityStatus = resolveQualityStatus(
    input.source,
    input.headers.length,
    difference,
  );

  return {
    tenant_id: input.tenant_id,
    report_key: "purchase_goods_payables",
    run_id: input.run_id,
    params: input.params,
    generated_at: input.generated_at,
    source: input.source,
    quality_status: qualityStatus,
    summary: {
      total_purchase: headerTotal,
      document_count: input.headers.length,
      line_count: input.details.length,
      total_qty: totalQty,
      top_supplier_name: topSuppliers[0]?.supplier_name ?? null,
      top_product_name: topProducts[0]?.item_name ?? null,
    },
    financial_breakdown: financialBreakdown,
    top_suppliers: topSuppliers,
    branch_purchases: [...branchMap.values()].sort(
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
          ? "ยอดหัวเอกสารและยอดรายละเอียดสินค้าไม่เท่ากัน อาจเกิดจาก VAT, discount, rounding หรือโครงสร้าง SML; ระบบใช้ ic_trans.total_amount เป็นยอดซื้อ/ตั้งหนี้หลัก."
          : "Header total and detail sum are reconciled.",
    },
    line_template: {
      title: "Morning Brief: Purchase Goods and Payables",
      body: [
        `ยอดซื้อ/ตั้งหนี้ ${formatMoney(headerTotal)} บาท`,
        `เอกสาร ${input.headers.length.toLocaleString("th-TH")} ใบ / รายการ ${input.details.length.toLocaleString("th-TH")} แถว`,
        topSuppliers[0]
          ? `ผู้จำหน่ายหลัก: ${topSuppliers[0].supplier_name} (${formatMoney(topSuppliers[0].total_amount)} บาท)`
          : "ไม่มีเอกสารซื้อในช่วงเวลานี้",
      ],
    },
  };
}

export function renderPurchaseGoodsPayablesLinePreview(input: {
  snapshot: PurchaseGoodsPayablesSnapshot;
  dashboardUrl?: string | null;
  tenantName?: string | null;
}): PurchaseGoodsPayablesLinePreview {
  const { snapshot } = input;
  const warnings = buildLineWarnings(snapshot);
  const dashboardUrl = isValidLineUri(input.dashboardUrl)
    ? input.dashboardUrl
    : null;
  const hasViewerAction = dashboardUrl !== null;
  const tenantName = input.tenantName?.trim() || snapshot.tenant_id;
  const generatedAt = formatThaiDateTime(snapshot.generated_at);
  const topSupplier = snapshot.top_suppliers[0];
  const topProduct = snapshot.top_products[0];
  const insight = buildPurchaseInsight(snapshot);

  const lines = [
    "รายงานซื้อ/ตั้งหนี้",
    "",
    `บริษัท: ${tenantName}`,
    `ช่วงข้อมูล: ${formatReportPeriodWithTime(
      snapshot.params.date_from,
      snapshot.params.date_to,
      snapshot.params.time_from,
      snapshot.params.time_to,
    )}`,
    `อัปเดต: ${generatedAt}`,
    "",
    `ยอดซื้อ/ตั้งหนี้: ${formatMoney(snapshot.summary.total_purchase)} บาท`,
    `เอกสารซื้อ: ${snapshot.summary.document_count.toLocaleString("th-TH")} ใบ`,
    `จำนวนรายการสินค้า: ${snapshot.summary.line_count.toLocaleString("th-TH")} รายการ`,
    "",
    `สรุปที่ควรดู: ${insight}`,
    topSupplier
      ? `ผู้จำหน่ายหลัก: ${topSupplier.supplier_name} ${formatMoney(topSupplier.total_amount)} บาท`
      : "ผู้จำหน่ายหลัก: ไม่มีข้อมูล",
    topProduct
      ? `สินค้าที่ซื้อสูงสุด: ${topProduct.item_name} ${formatMoney(topProduct.sum_amount)} บาท`
      : "สินค้าที่ซื้อสูงสุด: ไม่มีข้อมูล",
    ...warnings.map((warning) => `\nหมายเหตุ: ${warning}`),
    "",
    hasViewerAction
      ? "เปิดรายงาน: กดปุ่มใน LINE เพื่อดูรายละเอียด"
      : "เปิดรายงาน: ยังไม่พร้อมใช้งานในข้อความนี้",
  ];
  const flexMessage = buildPurchaseGoodsPayablesFlexMessage({
    snapshot,
    tenantName,
    generatedAt,
    dashboardUrl,
    insight,
    warnings,
  });

  return {
    tenant_id: snapshot.tenant_id,
    report_key: snapshot.report_key,
    run_id: snapshot.run_id,
    generated_at: snapshot.generated_at,
    source: snapshot.source,
    line_message_type: flexMessage ? "flex" : "text",
    title: "Morning Brief - Purchase Goods and Payables",
    text: lines.join("\n"),
    lines,
    flex_message: flexMessage,
    warnings,
    dashboard_url: dashboardUrl,
  };
}

function buildPurchaseGoodsPayablesFlexMessage(input: {
  snapshot: PurchaseGoodsPayablesSnapshot;
  tenantName: string;
  generatedAt: string;
  dashboardUrl: string | null;
  insight: string;
  warnings: string[];
}) {
  const { snapshot } = input;
  const topSupplier = snapshot.top_suppliers[0];
  return buildExecutiveDigestFlexMessage({
    variant: "executive_report_v2",
    kicker: "ซื้อ · รายวัน",
    title: "ซื้อ/ตั้งหนี้",
    subtitle: `${input.tenantName} · ${formatReportPeriodWithTime(
      snapshot.params.date_from,
      snapshot.params.date_to,
      snapshot.params.time_from,
      snapshot.params.time_to,
    )}`,
    altText: `ซื้อ/ตั้งหนี้ ${input.tenantName} ${formatReportPeriod(
      snapshot.params.date_from,
      snapshot.params.date_to,
    )}: ${formatMoney(snapshot.summary.total_purchase)} บาท`,
    generatedAt: input.generatedAt,
    status: getPurchaseDigestStatus(snapshot),
    primaryAmount: {
      value: formatMoney(snapshot.summary.total_purchase),
      unit: "บาท",
      compact: true,
    },
    metrics: [
      {
        label: "เอกสารซื้อ",
        value: `${formatInteger(snapshot.summary.document_count)} ใบ`,
      },
      {
        label: "รายการสินค้า",
        value: `${formatInteger(snapshot.summary.line_count)} รายการ`,
      },
      { label: "จำนวนซื้อรวม", value: formatQty(snapshot.summary.total_qty) },
    ],
    insight: input.insight,
    topLine: topSupplier
      ? {
          label: "ผู้จำหน่ายหลัก",
          value: `${truncateLineText(topSupplier.supplier_name, 36)}: ${formatMoney(topSupplier.total_amount)} บาท`,
        }
      : { label: "ผู้จำหน่ายหลัก", value: "ยังไม่มีเอกสารซื้อในช่วงนี้" },
    dashboardUrl: input.dashboardUrl,
  });
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
  const beforeVatAmount = roundMoney(
    headers.reduce((sum, row) => sum + safeNumber(row.total_except_vat), 0),
  );
  const vatAmount = roundMoney(
    headers.reduce((sum, row) => sum + safeNumber(row.total_vat_value), 0),
  );
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
    after_discount_amount: roundMoney(grossSales - totalDiscount),
    before_vat_amount:
      beforeVatAmount > 0 ? beforeVatAmount : roundMoney(headerTotal - vatAmount),
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

function resolveDocumentBranch(
  header: SalesHeaderRow,
  detailsByDoc: Map<string, SalesDetailRow[]>,
) {
  const headerBranch = header.branch_code?.trim();
  const detailBranches = [
    ...new Set(
      (detailsByDoc.get(buildDocKey(header.doc_date, header.doc_no)) ?? [])
        .map((detail) => detail.branch_code?.trim())
        .filter((branch): branch is string => Boolean(branch)),
    ),
  ];

  if (detailBranches.length === 1) {
    return detailBranches[0];
  }

  return headerBranch || detailBranches[0] || "no_branch";
}

function buildDocKey(docDate: string, docNo: string) {
  return `${docDate}::${docNo}`;
}

function buildPurchaseInsight(snapshot: PurchaseGoodsPayablesSnapshot) {
  if (snapshot.summary.document_count === 0) {
    return "ยังไม่พบเอกสารซื้อ/ตั้งหนี้ในช่วงนี้ หากมีการรับสินค้าแล้วควรตรวจการบันทึกเอกสารใน SML";
  }

  const topSupplier = snapshot.top_suppliers[0];
  if (topSupplier && snapshot.summary.total_purchase > 0) {
    const share = (topSupplier.total_amount / snapshot.summary.total_purchase) * 100;
    if (share >= 80) {
      return `ยอดซื้อกระจุกที่ ${topSupplier.supplier_name} ประมาณ ${share.toFixed(
        1,
      )}% ของยอดซื้อรวม`;
    }
  }

  if (snapshot.quality_status === "reconciled_with_warning") {
    return "ยอดหัวเอกสารและยอดรายละเอียดไม่เท่ากัน ระบบใช้ยอดหัวเอกสารเป็นยอดซื้อหลัก";
  }

  return "รายงานพร้อมใช้สำหรับดูยอดซื้อ ผู้จำหน่าย และสินค้าที่รับเข้ามากที่สุด";
}

function getPurchaseDigestStatus(
  snapshot: PurchaseGoodsPayablesSnapshot,
): ExecutiveDigestStatus {
  if (snapshot.summary.total_purchase < 0) {
    return { text: "ควรตรวจทันที", severity: "critical" };
  }
  if (snapshot.summary.document_count === 0) {
    return { text: "ไม่มีข้อมูล", severity: "notice" };
  }
  if (snapshot.source === "sample_snapshot" || snapshot.quality_status === "stale") {
    return { text: "ข้อมูลเก่า", severity: "notice" };
  }
  if (snapshot.quality_status === "reconciled_with_warning") {
    return { text: "ควรตรวจยอด", severity: "notice" };
  }
  return { text: "พร้อมใช้", severity: "ready" };
}

function buildLineWarnings(snapshot: PurchaseGoodsPayablesSnapshot): string[] {
  const warnings: string[] = [];

  if (snapshot.source === "sample_snapshot") {
    warnings.push("ข้อความนี้เป็น preview จากข้อมูลตัวอย่าง ยังไม่ใช่ข้อมูลสดจาก SML");
  }

  if (snapshot.quality_status === "reconciled_with_warning") {
    warnings.push(
      "ยอดหัวเอกสารและยอดรายละเอียดไม่เท่ากัน ระบบใช้ยอดหัวเอกสารเป็นยอดซื้อหลัก",
    );
  }

  if (snapshot.summary.document_count === 0) {
    warnings.push("ไม่พบเอกสารซื้อ/ตั้งหนี้ในช่วงวันที่นี้");
  }

  return warnings;
}

function formatTrustStatus(snapshot: PurchaseGoodsPayablesSnapshot) {
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

function resolveQualityStatus(
  source: PurchaseGoodsPayablesSnapshot["source"],
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

function formatReportPeriod(dateFrom: string, dateTo: string) {
  if (dateFrom === dateTo) {
    return formatThaiDate(dateFrom);
  }

  return `${formatThaiDate(dateFrom)} - ${formatThaiDate(dateTo)}`;
}

function formatReportPeriodWithTime(
  dateFrom: string,
  dateTo: string,
  timeFrom?: string,
  timeTo?: string,
) {
  const from = formatDateSlash(dateFrom);
  const to = formatDateSlash(dateTo);
  const startTime = timeFrom ?? "00:00";
  const endTime = timeTo ?? "23:59";
  if (dateFrom === dateTo) {
    return `${from} ${startTime} - ${to} ${endTime}`;
  }
  return `${from} ${startTime} - ${to} ${endTime}`;
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

function truncateLineText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatMoney(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatInteger(value: number) {
  return value.toLocaleString("th-TH", {
    maximumFractionDigits: 0,
  });
}

function formatQty(value: number) {
  return value.toLocaleString("th-TH", {
    maximumFractionDigits: 3,
  });
}

function safeNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQty(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
