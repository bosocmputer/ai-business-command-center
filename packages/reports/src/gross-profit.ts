import {
  type DataQualityStatus,
  type GrossProfitBaseRow,
  type GrossProfitByArCustomerRow,
  type GrossProfitByArCustomerSnapshot,
  type GrossProfitByProductRow,
  type GrossProfitByProductSnapshot,
  type GrossProfitLinePreview,
  type GrossProfitReportKey,
  type GrossProfitSummary,
  type SalesGoodsServicesParams,
  salesGoodsServicesParamsSchema,
  type TenantId,
} from "@ai-bcc/shared";
import {
  buildExecutiveDigestFlexMessage,
  isValidLineUri as isValidExecutiveDigestUri,
  type ExecutiveDigestStatus,
} from "./line-flex.js";

export const grossProfitByProductContract = {
  report_key: "gross_profit_by_product",
  name: "Gross Profit by Product",
  version: "0.1.0",
  params_schema: salesGoodsServicesParamsSchema,
  metric_truth: {
    sales_qty:
      "ic_trans_detail.qty * (stand_value/divide_value), trans_flag 44 or 46 inquiry_type 0/2",
    sales_amount: "ic_trans_detail.sum_amount_exclude_vat, trans_flag 44/46",
    sales_cost: "ic_trans_detail.sum_of_cost, trans_flag 44/46",
    return_amount: "ic_trans_detail.sum_amount_exclude_vat, trans_flag 48",
    inventory_lookup: "ic_inventory.name_1, ic_inventory.unit_cost -> ic_unit.name_1",
  },
} as const;

export const grossProfitByArCustomerContract = {
  report_key: "gross_profit_by_ar_customer",
  name: "Gross Profit by AR Customer",
  version: "0.1.0",
  params_schema: salesGoodsServicesParamsSchema,
  metric_truth: {
    sales_qty:
      "ic_trans_detail.qty * (stand_value/divide_value), trans_flag 44 or 46 inquiry_type 0/2",
    sales_amount: "ic_trans_detail.sum_amount_exclude_vat, trans_flag 44/46",
    sales_cost: "ic_trans_detail.sum_of_cost, trans_flag 44/46",
    return_amount: "ic_trans_detail.sum_amount_exclude_vat, trans_flag 48",
    customer_lookup: "ic_trans.cust_code -> ar_customer.name_1",
  },
} as const;

export function validateGrossProfitParams(
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

export function buildGrossProfitByProductQuery(params: SalesGoodsServicesParams) {
  validateGrossProfitParams(params);
  const timeFilter = buildDocumentTimeWindowFilter("h", params);

  return {
    text: `
with filtered_docs as (
  select
    h.doc_no,
    h.doc_date,
    h.trans_flag
  from ic_trans h
  where h.doc_date between $1::date and $2::date
    and h.trans_flag in (44, 46, 48)
${timeFilter.sql}
),
detail_agg as (
  select
    d.item_code,
    coalesce(sum(case
      when (d.trans_flag in (44) or (d.trans_flag in (46) and d.inquiry_type in (0, 2)))
        then d.qty * (d.stand_value / nullif(d.divide_value, 0))
      else 0
    end), 0) as qty_sale,
    coalesce(sum(case when d.trans_flag in (44, 46) then d.sum_amount_exclude_vat else 0 end), 0) as amount_sale,
    coalesce(sum(case when d.trans_flag in (44, 46) then d.sum_of_cost else 0 end), 0) as cost_sale,
    coalesce(sum(case
      when d.trans_flag in (48)
        then d.qty * (d.stand_value / nullif(d.divide_value, 0))
      else 0
    end), 0) as qty_sale_return,
    coalesce(sum(case when d.trans_flag in (48) then d.sum_amount_exclude_vat else 0 end), 0) as amount_sale_return,
    coalesce(sum(case when d.trans_flag in (48) then d.sum_of_cost else 0 end), 0) as cost_sale_return
  from ic_trans_detail d
  where d.item_type <> 5
    and d.item_type <> 3
    and d.last_status = 0
    and d.doc_date between $1::date and $2::date
    and d.trans_flag in (44, 46, 48)
    and exists (
      select 1
      from filtered_docs h
      where h.doc_no = d.doc_no
        and h.doc_date = d.doc_date
        and h.trans_flag = d.trans_flag
    )
  group by d.item_code
)
select
  i.code,
  i.name_1,
  i.unit_cost || '(' || coalesce(u.name_1, '') || ')' as unit_name,
  coalesce(a.qty_sale, 0) as qty_sale,
  coalesce(a.amount_sale, 0) as amount_sale,
  coalesce(a.cost_sale, 0) as cost_sale,
  coalesce(a.qty_sale_return, 0) as qty_sale_return,
  coalesce(a.amount_sale_return, 0) as amount_sale_return,
  coalesce(a.cost_sale_return, 0) as cost_sale_return
from ic_inventory i
left join detail_agg a on a.item_code = i.code
left join ic_unit u on u.code = i.unit_cost
where i.item_type <> 5
  and (coalesce(a.qty_sale, 0) <> 0 or coalesce(a.qty_sale_return, 0) <> 0)
order by i.code
`,
    values: [params.date_from, params.date_to, ...timeFilter.values],
  };
}

export function buildGrossProfitByArCustomerQuery(
  params: SalesGoodsServicesParams,
) {
  validateGrossProfitParams(params);
  const timeFilter = buildDocumentTimeWindowFilter("h", params);

  return {
    text: `
with filtered_docs as (
  select
    h.doc_no,
    h.doc_date,
    h.trans_flag,
    h.cust_code
  from ic_trans h
  where h.doc_date between $1::date and $2::date
    and h.trans_flag in (44, 46, 48)
${timeFilter.sql}
),
detail_by_doc as (
  select
    d.doc_no,
    d.doc_date,
    d.trans_flag,
    coalesce(sum(case
      when (d.trans_flag in (44) or (d.trans_flag in (46) and d.inquiry_type in (0, 2)))
        then d.qty * (d.stand_value / nullif(d.divide_value, 0))
      else 0
    end), 0) as qty_sale,
    coalesce(sum(case when d.trans_flag in (44, 46) then d.sum_amount_exclude_vat else 0 end), 0) as amount_sale,
    coalesce(sum(case when d.trans_flag in (44, 46) then d.sum_of_cost else 0 end), 0) as cost_sale,
    coalesce(sum(case
      when d.trans_flag in (48)
        then d.qty * (d.stand_value / nullif(d.divide_value, 0))
      else 0
    end), 0) as qty_sale_return,
    coalesce(sum(case when d.trans_flag in (48) then d.sum_amount_exclude_vat else 0 end), 0) as amount_sale_return,
    coalesce(sum(case when d.trans_flag in (48) then d.sum_of_cost else 0 end), 0) as cost_sale_return
  from ic_trans_detail d
  where d.item_type <> 5
    and d.item_type <> 3
    and d.last_status = 0
    and d.doc_date between $1::date and $2::date
    and d.trans_flag in (44, 46, 48)
    and exists (
      select 1
      from filtered_docs h
      where h.doc_no = d.doc_no
        and h.doc_date = d.doc_date
        and h.trans_flag = d.trans_flag
    )
  group by d.doc_no, d.doc_date, d.trans_flag
)
select
  coalesce(nullif(t.cust_code, ''), 'ไม่ระบุลูกหนี้') as ar_code,
  coalesce(c.name_1, '') as ar_detail,
  coalesce(sum(d.qty_sale), 0) as qty_sale,
  coalesce(sum(d.amount_sale), 0) as amount_sale,
  coalesce(sum(d.cost_sale), 0) as cost_sale,
  coalesce(sum(d.qty_sale_return), 0) as qty_sale_return,
  coalesce(sum(d.amount_sale_return), 0) as amount_sale_return,
  coalesce(sum(d.cost_sale_return), 0) as cost_sale_return
from detail_by_doc d
inner join filtered_docs t on t.doc_no = d.doc_no
  and t.doc_date = d.doc_date
  and t.trans_flag = d.trans_flag
left join ar_customer c on c.code = t.cust_code
group by coalesce(nullif(t.cust_code, ''), 'ไม่ระบุลูกหนี้'), coalesce(c.name_1, '')
having coalesce(sum(d.qty_sale), 0) <> 0
  or coalesce(sum(d.qty_sale_return), 0) <> 0
order by ar_code
`,
    values: [params.date_from, params.date_to, ...timeFilter.values],
  };
}

export function enrichGrossProfitMetrics<T extends GrossProfitBaseRow>(
  row: T,
): T {
  const netQty = roundQty(row.qty_sale - row.qty_sale_return);
  const netAmount = roundMoney(row.amount_sale - row.amount_sale_return);
  const netCost = roundMoney(row.cost_sale - row.cost_sale_return);
  const grossProfit = roundMoney(netAmount - netCost);
  return {
    ...row,
    net_qty: netQty,
    net_amount: netAmount,
    net_cost: netCost,
    gross_profit: grossProfit,
    gross_margin_percent:
      netAmount > 0.000001
        ? roundPercent((grossProfit / netAmount) * 100)
        : null,
  } as T;
}

export function summarizeGrossProfitByProduct(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: GrossProfitByProductSnapshot["source"];
  rows: GrossProfitByProductRow[];
}): GrossProfitByProductSnapshot {
  const rows = input.rows.map((row) => enrichGrossProfitMetrics(row));
  const summary = summarizeRows(
    rows,
    (row) => row.name_1 || row.code || "ไม่ระบุสินค้า",
    input.source,
  );

  return {
    tenant_id: input.tenant_id,
    report_key: "gross_profit_by_product",
    run_id: input.run_id,
    params: input.params,
    generated_at: input.generated_at,
    source: input.source,
    quality_status: resolveQualityStatus(input.source),
    summary,
    rows: rows.slice(0, 1000),
    top_rows: sortTopRows(rows).slice(0, 10),
    negative_rows: sortNegativeRows(rows).slice(0, 10),
    line_template: buildLineTemplate({
      reportTitle: "รายงานกำไรขั้นต้นสินค้า",
      summary,
    }),
  };
}

export function summarizeGrossProfitByArCustomer(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: GrossProfitByArCustomerSnapshot["source"];
  rows: GrossProfitByArCustomerRow[];
}): GrossProfitByArCustomerSnapshot {
  const rows = input.rows.map((row) => enrichGrossProfitMetrics(row));
  const summary = summarizeRows(
    rows,
    (row) => row.ar_detail || row.ar_code || "ไม่ระบุลูกหนี้",
    input.source,
  );

  return {
    tenant_id: input.tenant_id,
    report_key: "gross_profit_by_ar_customer",
    run_id: input.run_id,
    params: input.params,
    generated_at: input.generated_at,
    source: input.source,
    quality_status: resolveQualityStatus(input.source),
    summary,
    rows: rows.slice(0, 1000),
    top_rows: sortTopRows(rows).slice(0, 10),
    negative_rows: sortNegativeRows(rows).slice(0, 10),
    line_template: buildLineTemplate({
      reportTitle: "รายงานกำไรขั้นต้นลูกหนี้",
      summary,
    }),
  };
}

export function renderGrossProfitLinePreview(input: {
  snapshot: GrossProfitByProductSnapshot | GrossProfitByArCustomerSnapshot;
  dashboardUrl?: string | null;
  tenantName?: string | null;
}): GrossProfitLinePreview {
  const { snapshot } = input;
  const dashboardUrl = input.dashboardUrl ?? null;
  const useFlexMessage = isValidExecutiveDigestUri(dashboardUrl);
  const tenantName = input.tenantName?.trim() || snapshot.tenant_id;
  const generatedAt = formatThaiDateTime(snapshot.generated_at);
  const reportTitle = getGrossProfitReportTitle(snapshot.report_key);
  const rowLabel =
    snapshot.report_key === "gross_profit_by_product" ? "สินค้า" : "ลูกหนี้";
  const topLines = snapshot.top_rows.slice(0, 3).map((row, index) => {
    const label =
      snapshot.report_key === "gross_profit_by_product"
        ? (row as GrossProfitByProductRow).name_1 || (row as GrossProfitByProductRow).code
        : (row as GrossProfitByArCustomerRow).ar_detail ||
          (row as GrossProfitByArCustomerRow).ar_code;
    return `${index + 1}. ${label}: กำไร ${formatMoney(row.gross_profit)} บาท (${formatMargin(row.gross_margin_percent)})`;
  });
  const warnings = buildLineWarnings(snapshot);
  const insight = buildGrossProfitInsight(snapshot);
  const lines = [
    reportTitle,
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
    `ยอดขายสุทธิหลังคืน: ${formatMoney(snapshot.summary.net_amount)} บาท`,
    `ต้นทุนสุทธิ: ${formatMoney(snapshot.summary.net_cost)} บาท`,
    `กำไรขั้นต้น: ${formatMoney(snapshot.summary.gross_profit)} บาท`,
    `อัตรากำไรขั้นต้น: ${formatMargin(snapshot.summary.gross_margin_percent)}`,
    `${rowLabel}ที่มีรายการ: ${formatInteger(snapshot.summary.row_count)} รายการ`,
    "",
    `สรุปที่ควรดู: ${insight}`,
    "",
    "รายการเด่นตามกำไรขั้นต้น",
    ...(topLines.length ? topLines : ["- ไม่มีข้อมูลในช่วงวันที่นี้"]),
    ...warnings.map((warning) => `\nหมายเหตุ: ${warning}`),
    "",
    useFlexMessage
      ? "เปิดรายงาน: กดปุ่มใน LINE เพื่อดูรายละเอียด"
      : "เปิดรายงาน: ยังไม่พร้อมใช้งานในข้อความนี้",
  ];
  const flexMessage = buildGrossProfitFlexMessage({
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
    title: reportTitle,
    text: lines.join("\n"),
    lines,
    flex_message: flexMessage,
    warnings,
    dashboard_url: dashboardUrl,
  };
}

function summarizeRows<T extends GrossProfitBaseRow>(
  rows: T[],
  getLabel: (row: T) => string,
  source: GrossProfitByProductSnapshot["source"],
): GrossProfitSummary {
  const totalSales = roundMoney(rows.reduce((sum, row) => sum + row.amount_sale, 0));
  const totalReturns = roundMoney(
    rows.reduce((sum, row) => sum + row.amount_sale_return, 0),
  );
  const netAmount = roundMoney(rows.reduce((sum, row) => sum + row.net_amount, 0));
  const netCost = roundMoney(rows.reduce((sum, row) => sum + row.net_cost, 0));
  const grossProfit = roundMoney(netAmount - netCost);
  const topRow = sortTopRows(rows)[0] ?? null;

  return {
    row_count: rows.length,
    document_count: rows.length,
    line_count: rows.length,
    total_qty: roundQty(rows.reduce((sum, row) => sum + row.net_qty, 0)),
    total_sales: totalSales,
    total_returns: totalReturns,
    net_amount: netAmount,
    net_cost: netCost,
    gross_profit: source === "sample_snapshot" ? 0 : grossProfit,
    gross_margin_percent:
      netAmount > 0.000001
        ? roundPercent((grossProfit / netAmount) * 100)
        : null,
    negative_gross_profit_count: rows.filter((row) => row.gross_profit < 0)
      .length,
    top_gross_profit_name: topRow ? getLabel(topRow) : null,
  };
}

function sortTopRows<T extends GrossProfitBaseRow>(rows: T[]) {
  return [...rows].sort((a, b) => b.gross_profit - a.gross_profit);
}

function sortNegativeRows<T extends GrossProfitBaseRow>(rows: T[]) {
  return rows
    .filter((row) => row.gross_profit < 0)
    .sort((a, b) => a.gross_profit - b.gross_profit);
}

function buildLineTemplate(input: {
  reportTitle: string;
  summary: GrossProfitSummary;
}) {
  return {
    title: input.reportTitle,
    body: [
      `กำไรขั้นต้น ${formatMoney(input.summary.gross_profit)} บาท`,
      `ยอดขายสุทธิ ${formatMoney(input.summary.net_amount)} บาท`,
      `Margin ${formatMargin(input.summary.gross_margin_percent)}`,
    ],
  };
}

function buildGrossProfitInsight(
  snapshot: GrossProfitByProductSnapshot | GrossProfitByArCustomerSnapshot,
) {
  if (snapshot.summary.row_count === 0) {
    return "ยังไม่พบรายการขายหรือคืนสินค้าที่นำมาคำนวณกำไรขั้นต้นในช่วงนี้";
  }
  if (snapshot.summary.gross_profit < 0) {
    return "กำไรขั้นต้นติดลบ ควรตรวจต้นทุนสินค้า ราคาขาย และรายการคืนสินค้า";
  }
  if (snapshot.summary.negative_gross_profit_count > 0) {
    return `มี ${formatInteger(snapshot.summary.negative_gross_profit_count)} รายการที่กำไรติดลบ ควรตรวจเฉพาะรายการเหล่านี้ก่อน`;
  }
  return "รายงานพร้อมใช้สำหรับดูยอดขาย ต้นทุน กำไรขั้นต้น และ margin";
}

function buildLineWarnings(
  snapshot: GrossProfitByProductSnapshot | GrossProfitByArCustomerSnapshot,
) {
  const warnings: string[] = [];
  if (snapshot.source === "sample_snapshot") {
    warnings.push("ข้อความนี้เป็น preview จากข้อมูลตัวอย่าง ยังไม่ใช่ข้อมูลสดจาก SML");
  }
  if (snapshot.summary.row_count === 0) {
    warnings.push("ไม่พบข้อมูลกำไรขั้นต้นในช่วงวันที่นี้");
  }
  if (snapshot.summary.negative_gross_profit_count > 0) {
    warnings.push("พบรายการกำไรติดลบ ควรตรวจต้นทุนและเอกสารคืนสินค้า");
  }
  return warnings;
}

function buildGrossProfitFlexMessage(input: {
  snapshot: GrossProfitByProductSnapshot | GrossProfitByArCustomerSnapshot;
  tenantName: string;
  generatedAt: string;
  dashboardUrl: string | null;
  insight: string;
  warnings: string[];
}) {
  const { snapshot } = input;
  const title = getGrossProfitDigestTitle(snapshot.report_key);
  const rowLabel =
    snapshot.report_key === "gross_profit_by_product" ? "สินค้า" : "ลูกหนี้";
  const topRow = snapshot.top_rows[0] ?? null;
  const topLabel = topRow ? getGrossProfitRowLabel(snapshot, topRow) : null;
  const primaryAmountColor =
    snapshot.summary.gross_profit < 0 ? "#B42318" : undefined;
  const viewNote =
    snapshot.report_key === "gross_profit_by_product"
      ? "ยอดรวมเดียวกัน แยกตามสินค้า"
      : "ยอดรวมเดียวกัน แยกตามลูกหนี้";

  return buildExecutiveDigestFlexMessage({
    title,
    subtitle: `${input.tenantName} · ${formatReportPeriodWithTime(
      snapshot.params.date_from,
      snapshot.params.date_to,
      snapshot.params.time_from,
      snapshot.params.time_to,
    )}`,
    altText: `${title} ${input.tenantName} ${formatReportPeriod(
      snapshot.params.date_from,
      snapshot.params.date_to,
    )}: กำไร ${formatMoney(snapshot.summary.gross_profit)} บาท`,
    generatedAt: input.generatedAt,
    status: getGrossProfitDigestStatus(snapshot),
    primaryAmount: `${formatMoney(snapshot.summary.gross_profit)} บาท`,
    primaryAmountColor,
    metrics: [
      {
        label: "ยอดขายสุทธิ",
        value: `${formatMoney(snapshot.summary.net_amount)} บาท`,
      },
      {
        label: "ต้นทุนสุทธิ",
        value: `${formatMoney(snapshot.summary.net_cost)} บาท`,
      },
      {
        label: "Margin",
        value: formatMargin(snapshot.summary.gross_margin_percent),
      },
    ],
    insight: input.insight,
    topLine: topRow && topLabel
      ? {
          label: "รายการเด่น",
          value: `${truncateLineText(topLabel, 34)}: กำไร ${formatMoney(topRow.gross_profit)} บาท (${formatMargin(
            topRow.gross_margin_percent,
          )})`,
        }
      : { label: "รายการเด่น", value: `ยังไม่มี${rowLabel}ในช่วงนี้` },
    note: viewNote,
    dashboardUrl: input.dashboardUrl,
  });
}

function getGrossProfitRowLabel(
  snapshot: GrossProfitByProductSnapshot | GrossProfitByArCustomerSnapshot,
  row: GrossProfitByProductRow | GrossProfitByArCustomerRow,
) {
  return snapshot.report_key === "gross_profit_by_product"
    ? (row as GrossProfitByProductRow).name_1 ||
        (row as GrossProfitByProductRow).code
    : (row as GrossProfitByArCustomerRow).ar_detail ||
        (row as GrossProfitByArCustomerRow).ar_code;
}

function getGrossProfitDigestStatus(
  snapshot: GrossProfitByProductSnapshot | GrossProfitByArCustomerSnapshot,
): ExecutiveDigestStatus {
  if (snapshot.summary.row_count === 0) {
    return { text: "ไม่มีข้อมูล", severity: "notice" };
  }
  if (snapshot.summary.gross_profit < 0) {
    return { text: "ควรตรวจทันที", severity: "critical" };
  }
  if (snapshot.summary.negative_gross_profit_count > 0) {
    return { text: "มีข้อสังเกต", severity: "notice" };
  }
  return { text: "พร้อมใช้", severity: "ready" };
}

function getGrossProfitReportTitle(reportKey: GrossProfitReportKey) {
  return reportKey === "gross_profit_by_product"
    ? "รายงานกำไรขั้นต้นสินค้า"
    : "รายงานกำไรขั้นต้นลูกหนี้";
}

function getGrossProfitDigestTitle(reportKey: GrossProfitReportKey) {
  return reportKey === "gross_profit_by_product"
    ? "กำไรขั้นต้นสินค้า"
    : "กำไรขั้นต้นลูกหนี้";
}

function resolveQualityStatus(
  source: GrossProfitByProductSnapshot["source"],
): DataQualityStatus {
  return source === "sample_snapshot" ? "stale" : "valid";
}

function formatReportPeriodWithTime(
  dateFrom: string,
  dateTo: string,
  timeFrom?: string,
  timeTo?: string,
) {
  const from = formatDateSlash(dateFrom);
  const to = formatDateSlash(dateTo);
  return `${from} ${timeFrom ?? "00:00"} - ${to} ${timeTo ?? "23:59"}`;
}

function formatReportPeriod(dateFrom: string, dateTo: string) {
  if (dateFrom === dateTo) {
    return formatDateSlash(dateFrom);
  }
  return `${formatDateSlash(dateFrom)} - ${formatDateSlash(dateTo)}`;
}

function truncateLineText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatDateSlash(ymd: string) {
  const [year, month, day] = ymd.split("-");
  return `${day}/${month}/${year}`;
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

function formatMargin(value: number | null) {
  if (value === null) {
    return "ตรวจสอบ";
  }
  return `${value.toLocaleString("th-TH", { maximumFractionDigits: 2 })}%`;
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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
