import {
  type ArDebtReceiptCustomerSummary,
  type ArDebtReceiptLinePreview,
  type ArDebtReceiptPaymentStatus,
  type ArDebtReceiptRow,
  type ArDebtReceiptSnapshot,
  type ArDebtReceiptSummary,
  type DataQualityStatus,
  type SalesGoodsServicesParams,
  salesGoodsServicesParamsSchema,
  type TenantId,
} from "@ai-bcc/shared";
import {
  buildExecutiveDigestFlexMessage,
  isValidLineUri as isValidExecutiveDigestUri,
  type ExecutiveDigestStatus,
  truncateLineText,
} from "./line-flex.js";

type ArDebtReceiptRawRow = Record<string, unknown>;

export const arDebtReceiptContract = {
  report_key: "ar_debt_receipt",
  name: "AR Debt Receipt",
  version: "0.1.0",
  params_schema: salesGoodsServicesParamsSchema,
  metric_truth: {
    source_basis: "AR receipt documents by ap_ar_trans.doc_date",
    receipt_document: "ap_ar_trans trans_flag = 239 and last_status = 0",
    receipt_amount: "ap_ar_trans.total_net_value",
    payment_split: "cb_trans cash_amount and tranfer_amount",
  },
} as const;

export function validateArDebtReceiptParams(
  input: unknown,
): SalesGoodsServicesParams {
  return salesGoodsServicesParamsSchema.parse(input);
}

export function buildArDebtReceiptQuery(params: SalesGoodsServicesParams) {
  validateArDebtReceiptParams(params);

  return {
    text: `
with billing_dates as (
  select
    d.doc_no,
    d.trans_flag,
    min(d.billing_date) as billing_date
  from ap_ar_trans_detail d
  where d.trans_flag = 239
  group by d.doc_no, d.trans_flag
),
payment_splits as (
  select
    p.doc_no,
    p.trans_flag,
    sum(coalesce(p.cash_amount, 0)) as cash_amount,
    sum(coalesce(p.tranfer_amount, 0)) as transfer_amount
  from cb_trans p
  where p.trans_flag = 239
  group by p.doc_no, p.trans_flag
)
select
  a.doc_date,
  a.doc_no,
  b.billing_date,
  a.cust_code,
  coalesce(c.name_1, '') as cust_name,
  coalesce(p.cash_amount, 0) as cash_amount,
  coalesce(p.transfer_amount, 0) as transfer_amount,
  coalesce(a.total_net_value, 0) as total_net_value,
  p.doc_no is null as payment_split_missing
from ap_ar_trans a
left join payment_splits p
  on p.doc_no = a.doc_no
  and p.trans_flag = a.trans_flag
left join ar_customer c
  on c.code = a.cust_code
left join billing_dates b
  on b.doc_no = a.doc_no
  and b.trans_flag = a.trans_flag
where a.trans_flag = 239
  and a.last_status = 0
  and a.doc_date between $1::date and $2::date
order by a.doc_date, a.doc_no
`,
    values: [params.date_from, params.date_to] as unknown[],
  };
}

export function summarizeArDebtReceipt(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: ArDebtReceiptSnapshot["source"];
  rows: ArDebtReceiptRawRow[];
}): ArDebtReceiptSnapshot {
  const rows = input.rows.map(normalizeArDebtReceiptRow);
  const topCustomers = summarizeCustomers(rows).slice(0, 10);
  const topReceipts = sortTopReceipts(rows).slice(0, 20);
  const summary = summarizeRows(rows, topCustomers[0] ?? null);
  const dataQualityNotes = buildDataQualityNotes(summary);

  return {
    tenant_id: input.tenant_id,
    report_key: "ar_debt_receipt",
    run_id: input.run_id,
    params: input.params,
    generated_at: input.generated_at,
    source: input.source,
    quality_status: resolveQualityStatus(input.source, summary),
    source_basis: "ar_debt_receipt_doc_date",
    summary,
    top_customers: topCustomers,
    top_receipts: topReceipts,
    data_quality_notes: dataQualityNotes,
    line_template: {
      title: "รายงานรับชำระหนี้",
      body: [
        `ยอดรับชำระรวม ${formatMoney(summary.total_received_amount)} บาท`,
        `ลูกหนี้ ${formatInteger(summary.customer_count)} ราย`,
        `เอกสาร ${formatInteger(summary.receipt_count)} ใบ`,
      ],
    },
  };
}

export function renderArDebtReceiptLinePreview(input: {
  snapshot: ArDebtReceiptSnapshot;
  dashboardUrl?: string | null;
  tenantName?: string | null;
}): ArDebtReceiptLinePreview {
  const { snapshot } = input;
  const dashboardUrl = input.dashboardUrl ?? null;
  const useFlexMessage = isValidExecutiveDigestUri(dashboardUrl);
  const tenantName = input.tenantName?.trim() || snapshot.tenant_id;
  const generatedAt = formatThaiDateTime(snapshot.generated_at);
  const period = formatReceiptPeriod(snapshot.params);
  const insight = buildReceiptInsight(snapshot);
  const warnings = buildLineWarnings(snapshot);
  const topCustomer = snapshot.top_customers[0] ?? null;
  const lines = [
    "รายงานรับชำระหนี้",
    "",
    `บริษัท: ${tenantName}`,
    `ข้อมูล: ข้อมูลวันที่รับชำระ ${period} จาก SML`,
    `อัปเดต: ${generatedAt}`,
    "",
    `ยอดรับชำระรวม: ${formatMoney(snapshot.summary.total_received_amount)} บาท`,
    `ลูกหนี้: ${formatInteger(snapshot.summary.customer_count)} ราย`,
    `เอกสาร: ${formatInteger(snapshot.summary.receipt_count)} ใบ`,
    `เงินสด/โอน: ${formatMoney(snapshot.summary.cash_amount)} / ${formatMoney(
      snapshot.summary.transfer_amount,
    )} บาท`,
    "",
    `สรุปที่ควรดู: ${insight}`,
    "",
    topCustomer
      ? `ลูกหนี้รับชำระสูงสุด: ${topCustomer.cust_name || topCustomer.cust_code} ${formatMoney(
          topCustomer.total_received_amount,
        )} บาท`
      : "ลูกหนี้รับชำระสูงสุด: ยังไม่มีเอกสารรับชำระ",
    "หมายเหตุ: รายงานนี้อิงวันที่เอกสารรับชำระ ไม่ตัดตามเวลาแจ้งเตือน",
    ...warnings.map((warning) => `หมายเหตุ: ${warning}`),
    "",
    useFlexMessage
      ? "เปิดรายงาน: กดปุ่มใน LINE เพื่อดูรายละเอียด"
      : "เปิดรายงาน: ยังไม่พร้อมใช้งานในข้อความนี้",
  ];
  const flexMessage = buildArDebtReceiptFlexMessage({
    snapshot,
    tenantName,
    generatedAt,
    dashboardUrl,
    insight,
    period,
  });

  return {
    tenant_id: snapshot.tenant_id,
    report_key: "ar_debt_receipt",
    run_id: snapshot.run_id,
    generated_at: snapshot.generated_at,
    source: snapshot.source,
    line_message_type: flexMessage ? "flex" : "text",
    title: "รายงานรับชำระหนี้",
    text: lines.join("\n"),
    lines,
    flex_message: flexMessage,
    warnings,
    dashboard_url: dashboardUrl,
  };
}

function normalizeArDebtReceiptRow(row: ArDebtReceiptRawRow): ArDebtReceiptRow {
  const cashAmount = roundMoney(toNumber(row.cash_amount));
  const transferAmount = roundMoney(
    toNumber(row.transfer_amount ?? row.tranfer_amount),
  );
  const totalReceivedAmount = roundMoney(toNumber(row.total_net_value));
  const paymentSplitAmount = roundMoney(cashAmount + transferAmount);
  const paymentDifferenceAmount = roundMoney(
    totalReceivedAmount - paymentSplitAmount,
  );
  const paymentSplitMissing =
    toBoolean(row.payment_split_missing) ||
    (row.cash_amount === null &&
      row.transfer_amount === null &&
      row.tranfer_amount === null);

  return {
    doc_date: toDateString(row.doc_date),
    doc_no: toStringValue(row.doc_no),
    billing_date: toNullableDateString(row.billing_date),
    cust_code: toStringValue(row.cust_code),
    cust_name: toStringValue(row.cust_name),
    cash_amount: cashAmount,
    transfer_amount: transferAmount,
    total_received_amount: totalReceivedAmount,
    payment_split_amount: paymentSplitAmount,
    payment_difference_amount: paymentDifferenceAmount,
    payment_status: getPaymentStatus({
      paymentSplitMissing,
      paymentDifferenceAmount,
    }),
  };
}

function getPaymentStatus(input: {
  paymentSplitMissing: boolean;
  paymentDifferenceAmount: number;
}): ArDebtReceiptPaymentStatus {
  if (input.paymentSplitMissing) {
    return "missing_payment_split";
  }
  if (Math.abs(input.paymentDifferenceAmount) > 0.01) {
    return "mismatched_payment_split";
  }
  return "matched";
}

function summarizeRows(
  rows: ArDebtReceiptRow[],
  topCustomer: ArDebtReceiptCustomerSummary | null,
): ArDebtReceiptSummary {
  const customerCodes = new Set(rows.map((row) => row.cust_code));
  return {
    receipt_count: rows.length,
    customer_count: customerCodes.size,
    total_received_amount: roundMoney(
      rows.reduce((sum, row) => sum + row.total_received_amount, 0),
    ),
    cash_amount: roundMoney(rows.reduce((sum, row) => sum + row.cash_amount, 0)),
    transfer_amount: roundMoney(
      rows.reduce((sum, row) => sum + row.transfer_amount, 0),
    ),
    unmatched_payment_count: rows.filter(
      (row) => row.payment_status !== "matched",
    ).length,
    top_customer_name: topCustomer
      ? topCustomer.cust_name || topCustomer.cust_code
      : null,
  };
}

function summarizeCustomers(rows: ArDebtReceiptRow[]) {
  const byCustomer = new Map<string, ArDebtReceiptCustomerSummary>();
  for (const row of rows) {
    const customerKey = row.cust_code || "ไม่ระบุลูกหนี้";
    const current =
      byCustomer.get(customerKey) ??
      ({
        cust_code: row.cust_code,
        cust_name: row.cust_name,
        receipt_count: 0,
        cash_amount: 0,
        transfer_amount: 0,
        total_received_amount: 0,
        unmatched_payment_count: 0,
      } satisfies ArDebtReceiptCustomerSummary);
    current.receipt_count += 1;
    current.cash_amount = roundMoney(current.cash_amount + row.cash_amount);
    current.transfer_amount = roundMoney(
      current.transfer_amount + row.transfer_amount,
    );
    current.total_received_amount = roundMoney(
      current.total_received_amount + row.total_received_amount,
    );
    if (row.payment_status !== "matched") {
      current.unmatched_payment_count += 1;
    }
    byCustomer.set(customerKey, current);
  }

  return [...byCustomer.values()].sort(
    (a, b) =>
      b.total_received_amount - a.total_received_amount ||
      b.receipt_count - a.receipt_count ||
      a.cust_code.localeCompare(b.cust_code),
  );
}

function sortTopReceipts(rows: ArDebtReceiptRow[]) {
  return [...rows].sort(
    (a, b) =>
      b.total_received_amount - a.total_received_amount ||
      a.doc_date.localeCompare(b.doc_date) ||
      a.doc_no.localeCompare(b.doc_no),
  );
}

function buildDataQualityNotes(summary: ArDebtReceiptSummary) {
  if (summary.unmatched_payment_count === 0) {
    return [];
  }
  return [
    `พบเอกสาร ${formatInteger(
      summary.unmatched_payment_count,
    )} ใบที่ยอดเงินสด/โอนไม่ตรงกับยอดรับชำระหรือยังไม่มีข้อมูลแยกช่องทาง`,
  ];
}

function buildReceiptInsight(snapshot: ArDebtReceiptSnapshot) {
  if (snapshot.summary.receipt_count === 0) {
    return "ยังไม่พบเอกสารรับชำระหนี้ในช่วงวันที่นี้";
  }
  if (snapshot.summary.unmatched_payment_count > 0) {
    return `พบ ${formatInteger(
      snapshot.summary.unmatched_payment_count,
    )} เอกสารที่ควรตรวจช่องทางรับเงิน`;
  }
  const topCustomer = snapshot.top_customers[0];
  if (topCustomer) {
    return `${topCustomer.cust_name || topCustomer.cust_code} รับชำระ ${formatMoney(
      topCustomer.total_received_amount,
    )} บาท`;
  }
  return "ตรวจลูกหนี้ที่รับชำระสูงก่อนปิดยอดประจำวัน";
}

function buildLineWarnings(snapshot: ArDebtReceiptSnapshot) {
  const warnings = [...snapshot.data_quality_notes];
  if (snapshot.source === "sample_snapshot") {
    warnings.push("ข้อความนี้เป็น preview จากข้อมูลตัวอย่าง ยังไม่ใช่ข้อมูลสดจาก SML");
  }
  return warnings;
}

function buildArDebtReceiptFlexMessage(input: {
  snapshot: ArDebtReceiptSnapshot;
  tenantName: string;
  generatedAt: string;
  dashboardUrl: string | null;
  insight: string;
  period: string;
}) {
  const { snapshot } = input;
  const topCustomer = snapshot.top_customers[0] ?? null;

  return buildExecutiveDigestFlexMessage({
    variant: "executive_report_v2",
    kicker: "รับเงิน · รายวัน",
    title: "รับชำระหนี้",
    subtitle: `${input.tenantName} · ${input.period}`,
    altText: `รับชำระหนี้ ${input.tenantName}: ${formatMoney(
      snapshot.summary.total_received_amount,
    )} บาท`,
    generatedAt: input.generatedAt,
    status: getDebtReceiptDigestStatus(snapshot),
    primaryAmount: {
      value: formatMoney(snapshot.summary.total_received_amount),
      unit: "บาท",
      compact: true,
    },
    metrics: [
      {
        label: "ลูกหนี้",
        value: `${formatInteger(snapshot.summary.customer_count)} ราย`,
      },
      {
        label: "เอกสาร",
        value: `${formatInteger(snapshot.summary.receipt_count)} ใบ`,
      },
      {
        label: "เงินสด",
        value: `${formatMoney(snapshot.summary.cash_amount)} บาท`,
      },
      {
        label: "โอน",
        value: `${formatMoney(snapshot.summary.transfer_amount)} บาท`,
      },
    ],
    insight: input.insight,
    topLine: topCustomer
      ? {
          label: "ลูกหนี้รับชำระสูงสุด",
          value: `${truncateLineText(topCustomer.cust_name || topCustomer.cust_code, 34)}: ${formatMoney(
            topCustomer.total_received_amount,
          )} บาท`,
        }
      : { label: "ลูกหนี้รับชำระสูงสุด", value: "ยังไม่มีเอกสารรับชำระ" },
    note:
      snapshot.summary.unmatched_payment_count > 0
        ? "ควรตรวจช่องทางรับเงิน: บางเอกสารเงินสด/โอนไม่ตรงกับยอดรับชำระ"
        : "รายงานนี้อิงวันที่เอกสารรับชำระ ไม่ตัดตามเวลาแจ้งเตือน",
    noteTone:
      snapshot.summary.unmatched_payment_count > 0 ? "warning" : "neutral",
    dashboardUrl: input.dashboardUrl,
  });
}

function getDebtReceiptDigestStatus(
  snapshot: ArDebtReceiptSnapshot,
): ExecutiveDigestStatus {
  if (snapshot.summary.receipt_count === 0) {
    return { text: "ไม่มีข้อมูล", severity: "notice" };
  }
  if (snapshot.summary.unmatched_payment_count > 0) {
    return { text: "ควรตรวจยอด", severity: "notice" };
  }
  return { text: "พร้อมใช้", severity: "ready" };
}

function resolveQualityStatus(
  source: ArDebtReceiptSnapshot["source"],
  summary: ArDebtReceiptSummary,
): DataQualityStatus {
  if (source === "sample_snapshot") {
    return "stale";
  }
  if (summary.unmatched_payment_count > 0) {
    return "reconciled_with_warning";
  }
  return "valid";
}

function formatReceiptPeriod(params: SalesGoodsServicesParams) {
  if (params.date_from === params.date_to) {
    return formatDateSlash(params.date_to);
  }
  return `${formatDateSlash(params.date_from)}-${formatDateSlash(params.date_to)}`;
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

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value === "true" || value === "1" || value === "t";
  }
  return false;
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toDateString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return toStringValue(value);
}

function toNullableDateString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return toDateString(value);
}
