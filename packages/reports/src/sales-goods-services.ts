import {
  type BranchSales,
  type DataQualityStatus,
  type SalesDetailRow,
  type SalesGoodsServicesParams,
  type SalesGoodsServicesLinePreview,
  type SalesGoodsServicesSnapshot,
  salesGoodsServicesParamsSchema,
  type SalesHeaderRow,
  type TenantId,
  type TopProduct,
} from "@ai-bcc/shared";

export const salesGoodsServicesContract = {
  report_key: "sales_goods_services",
  name: "Sales Goods and Services",
  version: "0.1.0",
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
order by h.doc_date, h.doc_no, h.doc_time, h.cust_code
`,
    values: [params.date_from, params.date_to],
  };
}

export function buildSalesDetailQuery(params: SalesGoodsServicesParams) {
  validateSalesGoodsServicesParams(params);

  return {
    text: `
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
order by d.doc_date, d.doc_no, d.item_code
`,
    values: [params.date_from, params.date_to],
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

export function summarizeSalesGoodsServices(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: SalesGoodsServicesSnapshot["source"];
  headers: SalesHeaderRow[];
  details: SalesDetailRow[];
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

  const detailsByDoc = new Map<string, SalesDetailRow[]>();
  for (const detail of input.details) {
    const current = detailsByDoc.get(detail.doc_no) ?? [];
    current.push(detail);
    detailsByDoc.set(detail.doc_no, current);
  }

  const branchMap = new Map<string, BranchSales>();
  const headerBranchByDoc = new Map<string, string>();

  for (const header of input.headers) {
    const branchCode = resolveDocumentBranch(header, detailsByDoc);
    headerBranchByDoc.set(header.doc_no, branchCode);
    const current =
      branchMap.get(branchCode) ??
      ({
        branch_code: branchCode,
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
    const current =
      branchMap.get(branchCode) ??
      ({
        branch_code: branchCode,
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
    branch_sales: [...branchMap.values()].sort(
      (a, b) => b.total_amount - a.total_amount,
    ),
    top_products: topProducts,
    documents: input.headers.slice(0, 50),
    lines: input.details.slice(0, 100),
    reconciliation: {
      header_total_amount: headerTotal,
      detail_sum_amount: detailTotal,
      difference_amount: difference,
      status: qualityStatus,
      note:
        Math.abs(difference) > 0.01
          ? "Header total and detail sum differ. Dashboard financial truth uses ic_trans.total_amount."
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
  const branchLines = snapshot.branch_sales.slice(0, 3).map((branch, index) => {
    return `${index + 1}. ${branch.branch_code}: ${formatMoney(branch.total_amount)} บาท`;
  });
  const topProductLines = snapshot.top_products.slice(0, 3).map((product, index) => {
    return `${index + 1}. ${product.item_name}: ${formatMoney(product.sum_amount)} บาท`;
  });
  const dashboardLine = input.dashboardUrl
    ? [`เปิดรายงาน: ${input.dashboardUrl}`]
    : [];
  const tenantName = input.tenantName?.trim() || snapshot.tenant_id;
  const generatedAt = formatThaiDateTime(snapshot.generated_at);

  const lines = [
    "AI Business Center",
    "รายงานขายสินค้าและบริการ",
    "",
    `บริษัท: ${tenantName}`,
    `วันที่ข้อมูล: ${formatReportPeriod(snapshot.params.date_from, snapshot.params.date_to)}`,
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
    ...warnings.map((warning) => `\nหมายเหตุ: ${warning}`),
    "",
    `Run ID: ${snapshot.run_id}`,
    ...dashboardLine,
  ];

  return {
    tenant_id: snapshot.tenant_id,
    report_key: snapshot.report_key,
    run_id: snapshot.run_id,
    generated_at: snapshot.generated_at,
    source: snapshot.source,
    line_message_type: "text",
    title: "Morning Brief - Sales Goods and Services",
    text: lines.join("\n"),
    lines,
    warnings,
    dashboard_url: input.dashboardUrl ?? null,
  };
}

function buildLineWarnings(snapshot: SalesGoodsServicesSnapshot): string[] {
  const warnings: string[] = [];

  if (snapshot.source === "sample_snapshot") {
    warnings.push("ข้อความนี้เป็น preview จากข้อมูลตัวอย่าง ยังไม่ใช่ข้อมูลสดจาก SML");
  }

  if (snapshot.quality_status === "reconciled_with_warning") {
    warnings.push(
      "ยอดหัวเอกสารและยอดรายละเอียดไม่เท่ากัน ระบบใช้ ic_trans.total_amount เป็นยอดขายหลัก",
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
