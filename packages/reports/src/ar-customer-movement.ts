import {
  type ArCustomerMovementCustomerSummary,
  type ArCustomerMovementLinePreview,
  type ArCustomerMovementRow,
  type ArCustomerMovementSnapshot,
  type ArCustomerMovementSummary,
  type ArCustomerMovementType,
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

type ArCustomerMovementRawRow = Record<string, unknown>;

export const arCustomerMovementContract = {
  report_key: "ar_customer_movement",
  name: "AR Customer Movement",
  version: "0.1.0",
  params_schema: salesGoodsServicesParamsSchema,
  metric_truth: {
    source_basis: "AR movement documents accumulated to params.date_to",
    ar_increase: "doc_sort = 1 from ic_trans",
    ar_decrease: "doc_sort = 2 from ic_trans",
    receipt: "doc_sort = 3 from ap_ar_trans/as_trans",
  },
} as const;

export function validateArCustomerMovementParams(
  input: unknown,
): SalesGoodsServicesParams {
  return salesGoodsServicesParamsSchema.parse(input);
}

export function buildArCustomerMovementQuery(params: SalesGoodsServicesParams) {
  validateArCustomerMovementParams(params);

  return {
    text: `
with ar_docs as (
  select
    t.roworder,
    1 as doc_sort,
    t.cust_code,
    coalesce(c.name_1, '') as cust_name,
    t.trans_flag as doc_type,
    t.doc_date,
    t.doc_no,
    t.tax_doc_no,
    t.doc_ref,
    t.credit_day,
    t.total_amount as amount
  from ic_trans t
  left join ar_customer c on c.code = t.cust_code
  where t.last_status = 0
    and t.doc_date <= $1::date
    and (
      (t.trans_flag in (44, 250) and t.inquiry_type in (0, 2))
      or t.trans_flag in (46)
      or t.trans_flag in (93, 99, 95, 101, 254, 418)
    )

  union all

  select
    t.roworder,
    2 as doc_sort,
    t.cust_code,
    coalesce(c.name_1, '') as cust_name,
    t.trans_flag as doc_type,
    t.doc_date,
    t.doc_no,
    t.tax_doc_no,
    t.doc_ref,
    t.credit_day,
    t.total_amount as amount
  from ic_trans t
  left join ar_customer c on c.code = t.cust_code
  where t.last_status = 0
    and t.doc_date <= $1::date
    and (
      (t.trans_flag = 48 and t.inquiry_type in (0, 2, 4))
      or t.trans_flag in (97, 103)
      or (t.trans_flag = 262 and t.inquiry_type not in (1, 3))
    )

  union all

  select
    t.roworder,
    3 as doc_sort,
    t.cust_code,
    coalesce(c.name_1, '') as cust_name,
    t.trans_flag as doc_type,
    t.doc_date,
    t.doc_no,
    t.tax_doc_no,
    t.doc_ref,
    0 as credit_day,
    t.total_net_value as amount
  from ap_ar_trans t
  left join ar_customer c on c.code = t.cust_code
  where t.last_status = 0
    and t.doc_date <= $1::date
    and t.trans_flag = 239

  union all

  select
    t.roworder,
    3 as doc_sort,
    t.cust_code,
    coalesce(c.name_1, '') as cust_name,
    t.trans_flag as doc_type,
    t.doc_date,
    t.doc_no,
    t.tax_doc_no,
    t.doc_ref,
    0 as credit_day,
    t.total_amount as amount
  from as_trans t
  left join ar_customer c on c.code = t.cust_code
  where t.last_status = 0
    and t.doc_date <= $1::date
    and t.trans_flag = 1802
)
select
  roworder,
  doc_sort,
  cust_code,
  cust_name,
  doc_type,
  doc_date,
  doc_no,
  tax_doc_no,
  doc_ref,
  credit_day,
  amount
from ar_docs
order by cust_code, doc_date, doc_sort, doc_no
`,
    values: [params.date_to] as unknown[],
  };
}

export function summarizeArCustomerMovement(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: ArCustomerMovementSnapshot["source"];
  rows: ArCustomerMovementRawRow[];
}): ArCustomerMovementSnapshot {
  const rows = input.rows.map(normalizeArCustomerMovementRow);
  const topCustomers = summarizeCustomers(rows).slice(0, 10);
  const topDocuments = sortTopDocuments(rows).slice(0, 20);
  const summary = summarizeRows(rows, topCustomers[0] ?? null);

  return {
    tenant_id: input.tenant_id,
    report_key: "ar_customer_movement",
    run_id: input.run_id,
    params: input.params,
    generated_at: input.generated_at,
    source: input.source,
    quality_status: resolveQualityStatus(input.source),
    source_basis: "ar_movement_as_of_date",
    summary,
    top_customers: topCustomers,
    top_documents: topDocuments,
    line_template: {
      title: "รายงานเคลื่อนไหวลูกหนี้",
      body: [
        `ยอดเคลื่อนไหวสุทธิ ${formatMoney(summary.net_movement_amount)} บาท`,
        `ลูกหนี้ ${formatInteger(summary.customer_count)} ราย`,
        `เอกสาร ${formatInteger(summary.document_count)} ใบ`,
      ],
    },
  };
}

export function renderArCustomerMovementLinePreview(input: {
  snapshot: ArCustomerMovementSnapshot;
  dashboardUrl?: string | null;
  tenantName?: string | null;
}): ArCustomerMovementLinePreview {
  const { snapshot } = input;
  const dashboardUrl = input.dashboardUrl ?? null;
  const useFlexMessage = isValidExecutiveDigestUri(dashboardUrl);
  const tenantName = input.tenantName?.trim() || snapshot.tenant_id;
  const generatedAt = formatThaiDateTime(snapshot.generated_at);
  const asOf = formatArMovementAsOf(snapshot.params.date_to);
  const insight = buildArMovementInsight(snapshot);
  const warnings = buildLineWarnings(snapshot);
  const topCustomer = snapshot.top_customers[0] ?? null;
  const lines = [
    "รายงานเคลื่อนไหวลูกหนี้",
    "",
    `บริษัท: ${tenantName}`,
    `ข้อมูล: ${asOf} จาก SML`,
    `อัปเดต: ${generatedAt}`,
    "",
    `ยอดเคลื่อนไหวสุทธิ: ${formatMoney(snapshot.summary.net_movement_amount)} บาท`,
    `ลูกหนี้: ${formatInteger(snapshot.summary.customer_count)} ราย`,
    `เอกสาร: ${formatInteger(snapshot.summary.document_count)} ใบ`,
    `รับชำระ/ลดหนี้: ${formatMoney(
      snapshot.summary.ar_decrease_amount + snapshot.summary.receipt_amount,
    )} บาท`,
    "",
    `สรุปที่ควรดู: ${insight}`,
    "",
    topCustomer
      ? `ลูกหนี้มูลค่าสูง: ${topCustomer.cust_name || topCustomer.cust_code} สุทธิ ${formatMoney(
          topCustomer.net_movement_amount,
        )} บาท`
      : "ลูกหนี้มูลค่าสูง: ยังไม่มีเอกสารเคลื่อนไหว",
    ...warnings.map((warning) => `\nหมายเหตุ: ${warning}`),
    "",
    useFlexMessage
      ? "เปิดรายงาน: กดปุ่มใน LINE เพื่อดูรายละเอียด"
      : "เปิดรายงาน: ยังไม่พร้อมใช้งานในข้อความนี้",
  ];
  const flexMessage = buildArCustomerMovementFlexMessage({
    snapshot,
    tenantName,
    generatedAt,
    dashboardUrl,
    insight,
    asOf,
  });

  return {
    tenant_id: snapshot.tenant_id,
    report_key: "ar_customer_movement",
    run_id: snapshot.run_id,
    generated_at: snapshot.generated_at,
    source: snapshot.source,
    line_message_type: flexMessage ? "flex" : "text",
    title: "รายงานเคลื่อนไหวลูกหนี้",
    text: lines.join("\n"),
    lines,
    flex_message: flexMessage,
    warnings,
    dashboard_url: dashboardUrl,
  };
}

function normalizeArCustomerMovementRow(
  row: ArCustomerMovementRawRow,
): ArCustomerMovementRow {
  const docSort = toInteger(row.doc_sort);
  return {
    roworder: toNullableInteger(row.roworder),
    doc_sort: docSort,
    movement_type: getMovementType(docSort),
    cust_code: toStringValue(row.cust_code),
    cust_name: toStringValue(row.cust_name),
    doc_type: toInteger(row.doc_type),
    doc_date: toDateString(row.doc_date),
    doc_no: toStringValue(row.doc_no),
    tax_doc_no: toStringValue(row.tax_doc_no),
    doc_ref: toStringValue(row.doc_ref),
    credit_day: toInteger(row.credit_day),
    amount: roundMoney(toNumber(row.amount)),
  };
}

function getMovementType(docSort: number): ArCustomerMovementType {
  if (docSort === 2) {
    return "ar_decrease";
  }
  if (docSort === 3) {
    return "receipt";
  }
  return "ar_increase";
}

function summarizeRows(
  rows: ArCustomerMovementRow[],
  topCustomer: ArCustomerMovementCustomerSummary | null,
): ArCustomerMovementSummary {
  const customerCodes = new Set(rows.map((row) => row.cust_code));
  const arIncreaseAmount = sumByType(rows, "ar_increase");
  const arDecreaseAmount = sumByType(rows, "ar_decrease");
  const receiptAmount = sumByType(rows, "receipt");
  return {
    document_count: rows.length,
    customer_count: customerCodes.size,
    ar_increase_amount: arIncreaseAmount,
    ar_decrease_amount: arDecreaseAmount,
    receipt_amount: receiptAmount,
    net_movement_amount: roundMoney(
      arIncreaseAmount - arDecreaseAmount - receiptAmount,
    ),
    top_customer_name: topCustomer
      ? topCustomer.cust_name || topCustomer.cust_code
      : null,
  };
}

function summarizeCustomers(rows: ArCustomerMovementRow[]) {
  const byCustomer = new Map<string, ArCustomerMovementCustomerSummary>();
  for (const row of rows) {
    const customerKey = row.cust_code || "ไม่ระบุลูกหนี้";
    const current =
      byCustomer.get(customerKey) ??
      ({
        cust_code: row.cust_code,
        cust_name: row.cust_name,
        document_count: 0,
        ar_increase_amount: 0,
        ar_decrease_amount: 0,
        receipt_amount: 0,
        net_movement_amount: 0,
      } satisfies ArCustomerMovementCustomerSummary);
    current.document_count += 1;
    if (row.movement_type === "ar_increase") {
      current.ar_increase_amount = roundMoney(
        current.ar_increase_amount + row.amount,
      );
    } else if (row.movement_type === "ar_decrease") {
      current.ar_decrease_amount = roundMoney(
        current.ar_decrease_amount + row.amount,
      );
    } else {
      current.receipt_amount = roundMoney(current.receipt_amount + row.amount);
    }
    current.net_movement_amount = roundMoney(
      current.ar_increase_amount -
        current.ar_decrease_amount -
        current.receipt_amount,
    );
    byCustomer.set(customerKey, current);
  }

  return [...byCustomer.values()].sort(
    (a, b) =>
      Math.abs(b.net_movement_amount) - Math.abs(a.net_movement_amount) ||
      b.document_count - a.document_count ||
      a.cust_code.localeCompare(b.cust_code),
  );
}

function sortTopDocuments(rows: ArCustomerMovementRow[]) {
  return [...rows].sort(
    (a, b) =>
      Math.abs(b.amount) - Math.abs(a.amount) ||
      a.cust_code.localeCompare(b.cust_code) ||
      a.doc_date.localeCompare(b.doc_date) ||
      a.doc_no.localeCompare(b.doc_no),
  );
}

function sumByType(
  rows: ArCustomerMovementRow[],
  movementType: ArCustomerMovementType,
) {
  return roundMoney(
    rows
      .filter((row) => row.movement_type === movementType)
      .reduce((sum, row) => sum + row.amount, 0),
  );
}

function buildArMovementInsight(snapshot: ArCustomerMovementSnapshot) {
  if (snapshot.summary.document_count === 0) {
    return "ยังไม่พบเอกสารเคลื่อนไหวลูกหนี้ถึงวันที่นี้";
  }
  const topCustomer = snapshot.top_customers[0];
  if (topCustomer) {
    return `${topCustomer.cust_name || topCustomer.cust_code} มียอดเคลื่อนไหวสุทธิ ${formatMoney(
      topCustomer.net_movement_amount,
    )} บาท`;
  }
  return "ตรวจลูกหนี้และเอกสารมูลค่าสูงก่อนตัดสินใจ";
}

function buildLineWarnings(snapshot: ArCustomerMovementSnapshot) {
  const warnings: string[] = [];
  if (snapshot.source === "sample_snapshot") {
    warnings.push("ข้อความนี้เป็น preview จากข้อมูลตัวอย่าง ยังไม่ใช่ข้อมูลสดจาก SML");
  }
  return warnings;
}

function buildArCustomerMovementFlexMessage(input: {
  snapshot: ArCustomerMovementSnapshot;
  tenantName: string;
  generatedAt: string;
  dashboardUrl: string | null;
  insight: string;
  asOf: string;
}) {
  const { snapshot } = input;
  const topCustomer = snapshot.top_customers[0] ?? null;

  return buildExecutiveDigestFlexMessage({
    variant: "executive_report_v2",
    kicker: "ลูกหนี้ · สะสม",
    title: "เคลื่อนไหวลูกหนี้",
    subtitle: `${input.tenantName} · ${input.asOf}`,
    altText: `เคลื่อนไหวลูกหนี้ ${input.tenantName}: สุทธิ ${formatMoney(
      snapshot.summary.net_movement_amount,
    )} บาท`,
    generatedAt: input.generatedAt,
    status: getArMovementDigestStatus(snapshot),
    primaryAmount: {
      value: formatMoney(snapshot.summary.net_movement_amount),
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
        value: `${formatInteger(snapshot.summary.document_count)} ใบ`,
      },
      {
        label: "รับชำระ/ลดหนี้",
        value: `${formatMoney(
          snapshot.summary.ar_decrease_amount + snapshot.summary.receipt_amount,
        )} บาท`,
      },
    ],
    insight: input.insight,
    topLine: topCustomer
      ? {
          label: "ลูกหนี้มูลค่าสูง",
          value: `${truncateLineText(topCustomer.cust_name || topCustomer.cust_code, 34)}: ${formatMoney(
            topCustomer.net_movement_amount,
          )} บาท`,
        }
      : { label: "ลูกหนี้มูลค่าสูง", value: "ยังไม่มีเอกสารเคลื่อนไหว" },
    note: "ข้อมูลสะสมถึงวันที่จาก SML ใช้ดูการเคลื่อนไหวลูกหนี้",
    noteTone: "neutral",
    dashboardUrl: input.dashboardUrl,
  });
}

function getArMovementDigestStatus(
  snapshot: ArCustomerMovementSnapshot,
): ExecutiveDigestStatus {
  if (snapshot.summary.document_count === 0) {
    return { text: "ไม่มีข้อมูล", severity: "notice" };
  }
  return { text: "ข้อมูลสะสม", severity: "ready" };
}

function resolveQualityStatus(
  source: ArCustomerMovementSnapshot["source"],
): DataQualityStatus {
  return source === "sample_snapshot" ? "stale" : "valid";
}

function formatArMovementAsOf(dateTo: string) {
  return `ข้อมูลสะสมถึงวันที่ ${formatDateSlash(dateTo)}`;
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

function toInteger(value: unknown): number {
  return Math.trunc(toNumber(value));
}

function toNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return toInteger(value);
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
