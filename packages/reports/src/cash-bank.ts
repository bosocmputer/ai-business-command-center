import {
  type CashBankChannelKey,
  type CashBankChannelSummary,
  type CashBankDirection,
  type CashBankDocumentRow,
  type CashBankDocumentStatus,
  type CashBankLinePreview,
  type CashBankReportKey,
  type CashBankSnapshot,
  type CashBankSummary,
  type CashBankTransFlagSummary,
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

type CashBankRawRow = Record<string, unknown>;

const MONEY_TOLERANCE = 0.01;
const TOP_DOCUMENT_LIMIT = 20;
const MISMATCH_DOCUMENT_LIMIT = 20;

const channelLabels: Record<CashBankChannelKey, string> = {
  cash: "เงินสด",
  card: "บัตร",
  cheque: "เช็ค",
  transfer: "โอน",
  income: "รายได้อื่น",
  coupon: "คูปอง",
  petty_cash: "เงินสดย่อย",
  unallocated: "ไม่ระบุช่องทาง",
};

const receiptChannels: CashBankChannelKey[] = [
  "cash",
  "card",
  "cheque",
  "transfer",
  "income",
  "coupon",
  "unallocated",
];

const paymentChannels: CashBankChannelKey[] = [
  "cash",
  "card",
  "cheque",
  "transfer",
  "income",
  "petty_cash",
  "unallocated",
];

export const cashBankReceiptsContract = {
  report_key: "cash_bank_receipts",
  name: "Cash Bank Receipts",
  version: "0.1.0",
  params_schema: salesGoodsServicesParamsSchema,
  metric_truth: {
    source_basis: "cb_trans.doc_date where pay_type = 1",
    receipt_document:
      "cb_trans pay_type = 1, status = 0, trans_flag not in (144), and source document last_status = 0",
    total_amount: "cb_trans.total_amount",
    payment_channels:
      "cb_trans cash_amount, card_amount, chq_amount, tranfer_amount, total_income_amount, coupon_amount",
  },
} as const;

export const cashBankPaymentsContract = {
  report_key: "cash_bank_payments",
  name: "Cash Bank Payments",
  version: "0.1.0",
  params_schema: salesGoodsServicesParamsSchema,
  metric_truth: {
    source_basis: "cb_trans.doc_date where pay_type = 2",
    payment_document: "cb_trans pay_type = 2 and status = 0",
    total_amount: "cb_trans.total_amount",
    payment_channels:
      "cb_trans cash_amount, card_amount + total_credit_charge, chq_amount, tranfer_amount, total_income_amount, petty_cash_amount",
  },
} as const;

export function validateCashBankParams(
  input: unknown,
): SalesGoodsServicesParams {
  return salesGoodsServicesParamsSchema.parse(input);
}

export function buildCashBankReceiptsQuery(params: SalesGoodsServicesParams) {
  validateCashBankParams(params);

  return {
    text: `
with filtered_cb as (
  select cb.*
  from cb_trans cb
  where cb.doc_date between $1::date and $2::date
    and cb.pay_type = 1
    and cb.status = 0
    and cb.trans_flag not in (144)
)
select
  cb.doc_date,
  cb.doc_no,
  cb.doc_time,
  cb.trans_flag as trans_flag_code,
  trans_flag(cb.trans_flag) as trans_flag_label,
  cb.ap_ar_code,
  coalesce((select c.name_1 from ar_customer c where c.code = cb.ap_ar_code), '')
    || ' (' || coalesce(cb.ap_ar_code, '') || ')'
    || ' ' || coalesce(cb.remark, '') as ap_ar_name,
  coalesce(cb.cash_amount, 0) as cash_amount,
  coalesce(cb.card_amount, 0) as card_amount,
  coalesce(cb.chq_amount, 0) as chq_amount,
  coalesce(cb.tranfer_amount, 0) as transfer_amount,
  coalesce(cb.total_income_amount, 0) as total_income_amount,
  coalesce(cb.coupon_amount, 0) as coupon_amount,
  0::numeric as petty_cash_amount,
  coalesce(cb.total_amount, 0) as total_amount
from filtered_cb cb
where (
  case
    when cb.trans_flag in (19, 239) then (
      select a.last_status
      from ap_ar_trans a
      where a.doc_no = cb.doc_no
      limit 1
    )
    else (
      select i.last_status
      from ic_trans i
      where i.doc_no = cb.doc_no
      limit 1
    )
  end
) = 0
order by cb.doc_date, cb.trans_flag, cb.doc_no
`,
    values: [params.date_from, params.date_to] as unknown[],
  };
}

export function buildCashBankPaymentsQuery(params: SalesGoodsServicesParams) {
  validateCashBankParams(params);

  return {
    text: `
select
  cb.doc_date,
  cb.doc_no,
  cb.doc_time,
  cb.trans_flag as trans_flag_code,
  trans_flag(cb.trans_flag) as trans_flag_label,
  cb.ap_ar_code,
  coalesce((select s.name_1 from ap_supplier s where s.code = cb.ap_ar_code), '')
    || ' (' || coalesce(cb.ap_ar_code, '') || ')'
    || ' ' || coalesce(cb.remark, '') as ap_ar_name,
  coalesce(cb.cash_amount, 0) as cash_amount,
  coalesce(cb.card_amount, 0) + coalesce(cb.total_credit_charge, 0) as card_amount,
  coalesce(cb.chq_amount, 0) as chq_amount,
  coalesce(cb.tranfer_amount, 0) as transfer_amount,
  coalesce(cb.total_income_amount, 0) as total_income_amount,
  0::numeric as coupon_amount,
  coalesce(cb.petty_cash_amount, 0) as petty_cash_amount,
  coalesce(cb.total_amount, 0) as total_amount
from cb_trans cb
where cb.doc_date between $1::date and $2::date
  and cb.pay_type = 2
  and cb.status = 0
order by cb.doc_date, cb.trans_flag, cb.doc_no
`,
    values: [params.date_from, params.date_to] as unknown[],
  };
}

export function summarizeCashBankReceipts(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: CashBankSnapshot["source"];
  rows: CashBankRawRow[];
}): CashBankSnapshot {
  return summarizeCashBank({
    ...input,
    report_key: "cash_bank_receipts",
    direction: "receipt",
    source_basis: "cash_bank_receipts_doc_date",
    title: "รายงานรับเงิน",
    channels: receiptChannels,
  });
}

export function summarizeCashBankPayments(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: CashBankSnapshot["source"];
  rows: CashBankRawRow[];
}): CashBankSnapshot {
  return summarizeCashBank({
    ...input,
    report_key: "cash_bank_payments",
    direction: "payment",
    source_basis: "cash_bank_payments_doc_date",
    title: "รายงานจ่ายเงิน",
    channels: paymentChannels,
  });
}

export function renderCashBankLinePreview(input: {
  snapshot: CashBankSnapshot;
  dashboardUrl?: string | null;
  tenantName?: string | null;
}): CashBankLinePreview {
  const { snapshot } = input;
  const dashboardUrl = input.dashboardUrl ?? null;
  const useFlexMessage = isValidExecutiveDigestUri(dashboardUrl);
  const tenantName = input.tenantName?.trim() || snapshot.tenant_id;
  const generatedAt = formatThaiDateTime(snapshot.generated_at);
  const period = formatCashBankPeriod(snapshot.params);
  const title = getReportTitle(snapshot.report_key);
  const shortTitle = getReportShortTitle(snapshot.report_key);
  const directionLabel = snapshot.direction === "receipt" ? "รับเงิน" : "จ่ายเงิน";
  const insight = buildCashBankInsight(snapshot);
  const warnings = buildCashBankLineWarnings(snapshot);
  const lines = [
    title,
    "",
    `บริษัท: ${tenantName}`,
    `ข้อมูล: ข้อมูลวันที่เอกสาร${directionLabel} ${period} จาก SML`,
    `อัปเดต: ${generatedAt}`,
    "",
    `ยอดรวม: ${formatMoney(snapshot.summary.total_amount)} บาท`,
    `เอกสาร: ${formatInteger(snapshot.summary.document_count)} ใบ`,
    `เงินสด/โอน: ${formatMoney(snapshot.summary.cash_amount)} / ${formatMoney(
      snapshot.summary.transfer_amount,
    )} บาท`,
    `ไม่ระบุช่องทาง: ${formatMoney(snapshot.summary.unallocated_amount)} บาท`,
    "",
    `สรุปที่ควรดู: ${insight}`,
    "",
    snapshot.trans_flag_summary[0]
      ? `ประเภทเอกสารสูงสุด: ${snapshot.trans_flag_summary[0].trans_flag_label} ${formatMoney(
          snapshot.trans_flag_summary[0].total_amount,
        )} บาท`
      : "ประเภทเอกสารสูงสุด: ยังไม่มีเอกสารในช่วงวันที่นี้",
    "หมายเหตุ: รายงานนี้อิงวันที่เอกสาร ไม่ตัดตามเวลาแจ้งเตือน",
    ...warnings.map((warning) => `หมายเหตุ: ${warning}`),
    "",
    useFlexMessage
      ? "เปิดรายงาน: กดปุ่มใน LINE เพื่อดูรายละเอียด"
      : "เปิดรายงาน: ยังไม่พร้อมใช้งานในข้อความนี้",
  ];
  const flexMessage = buildCashBankFlexMessage({
    snapshot,
    tenantName,
    generatedAt,
    dashboardUrl,
    insight,
    period,
    title: shortTitle,
    directionLabel,
  });

  return {
    tenant_id: snapshot.tenant_id,
    report_key: snapshot.report_key,
    run_id: snapshot.run_id,
    generated_at: snapshot.generated_at,
    source: snapshot.source,
    line_message_type: flexMessage ? "flex" : "text",
    title,
    text: lines.join("\n"),
    lines,
    flex_message: flexMessage,
    warnings,
    dashboard_url: dashboardUrl,
  };
}

function summarizeCashBank(input: {
  tenant_id: TenantId;
  report_key: CashBankReportKey;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: CashBankSnapshot["source"];
  source_basis: CashBankSnapshot["source_basis"];
  direction: CashBankDirection;
  title: string;
  rows: CashBankRawRow[];
  channels: CashBankChannelKey[];
}): CashBankSnapshot {
  const rows = input.rows.map(normalizeCashBankRow);
  const transFlagSummary = summarizeTransFlags(rows);
  const summary = summarizeRows(rows);

  return {
    tenant_id: input.tenant_id,
    report_key: input.report_key,
    run_id: input.run_id,
    params: input.params,
    generated_at: input.generated_at,
    source: input.source,
    quality_status: resolveCashBankQualityStatus(input.source, summary),
    source_basis: input.source_basis,
    direction: input.direction,
    summary,
    channel_summary: summarizeChannels(rows, input.channels),
    trans_flag_summary: transFlagSummary,
    top_documents: sortTopDocuments(rows).slice(0, TOP_DOCUMENT_LIMIT),
    mismatch_documents: sortMismatchDocuments(rows).slice(
      0,
      MISMATCH_DOCUMENT_LIMIT,
    ),
    data_quality_notes: buildCashBankDataQualityNotes(summary),
    line_template: {
      title: input.title,
      body: [
        `ยอดรวม ${formatMoney(summary.total_amount)} บาท`,
        `เอกสาร ${formatInteger(summary.document_count)} ใบ`,
        `ไม่ระบุช่องทาง ${formatMoney(summary.unallocated_amount)} บาท`,
      ],
    },
  };
}

function normalizeCashBankRow(row: CashBankRawRow): CashBankDocumentRow {
  const cashAmount = roundMoney(toNumber(row.cash_amount));
  const cardAmount = roundMoney(toNumber(row.card_amount));
  const chqAmount = roundMoney(toNumber(row.chq_amount));
  const transferAmount = roundMoney(
    toNumber(row.transfer_amount ?? row.tranfer_amount),
  );
  const totalIncomeAmount = roundMoney(toNumber(row.total_income_amount));
  const couponAmount = roundMoney(toNumber(row.coupon_amount));
  const pettyCashAmount = roundMoney(toNumber(row.petty_cash_amount));
  const totalAmount = roundMoney(toNumber(row.total_amount));
  const channelTotalAmount = roundMoney(
    cashAmount +
      cardAmount +
      chqAmount +
      transferAmount +
      totalIncomeAmount +
      couponAmount +
      pettyCashAmount,
  );
  const unallocatedAmount = roundMoney(totalAmount - channelTotalAmount);

  return {
    doc_date: toDateString(row.doc_date),
    doc_no: toStringValue(row.doc_no),
    doc_time: toNullableString(row.doc_time),
    trans_flag_code: toNullableNumber(row.trans_flag_code),
    trans_flag_label: toStringValue(row.trans_flag_label ?? row.trans_flag),
    ap_ar_code: toStringValue(row.ap_ar_code),
    ap_ar_name: toStringValue(row.ap_ar_name).trim(),
    cash_amount: cashAmount,
    card_amount: cardAmount,
    chq_amount: chqAmount,
    transfer_amount: transferAmount,
    total_income_amount: totalIncomeAmount,
    coupon_amount: couponAmount,
    petty_cash_amount: pettyCashAmount,
    total_amount: totalAmount,
    channel_total_amount: channelTotalAmount,
    unallocated_amount: unallocatedAmount,
    channel_status: getChannelStatus(unallocatedAmount),
  };
}

function getChannelStatus(unallocatedAmount: number): CashBankDocumentStatus {
  if (Math.abs(unallocatedAmount) <= MONEY_TOLERANCE) {
    return "matched";
  }
  return unallocatedAmount > 0 ? "unallocated_amount" : "channel_over_total";
}

function summarizeRows(rows: CashBankDocumentRow[]): CashBankSummary {
  const parties = new Set(
    rows.map((row) => row.ap_ar_code || row.ap_ar_name).filter(Boolean),
  );
  const topParty = summarizeParties(rows)[0] ?? null;
  const docTimes = rows
    .map((row) => row.doc_time)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => a.localeCompare(b));

  return {
    document_count: rows.length,
    party_count: parties.size,
    total_amount: sumMoney(rows, "total_amount"),
    cash_amount: sumMoney(rows, "cash_amount"),
    card_amount: sumMoney(rows, "card_amount"),
    chq_amount: sumMoney(rows, "chq_amount"),
    transfer_amount: sumMoney(rows, "transfer_amount"),
    total_income_amount: sumMoney(rows, "total_income_amount"),
    coupon_amount: sumMoney(rows, "coupon_amount"),
    petty_cash_amount: sumMoney(rows, "petty_cash_amount"),
    channel_total_amount: sumMoney(rows, "channel_total_amount"),
    unallocated_amount: sumMoney(rows, "unallocated_amount"),
    mismatch_document_count: rows.filter(
      (row) => row.channel_status !== "matched",
    ).length,
    top_party_name: topParty
      ? topParty.name || topParty.code || "ไม่ระบุชื่อ"
      : null,
    first_doc_time: docTimes[0] ?? null,
    last_doc_time: docTimes[docTimes.length - 1] ?? null,
  };
}

function summarizeChannels(
  rows: CashBankDocumentRow[],
  channels: CashBankChannelKey[],
): CashBankChannelSummary[] {
  return channels.map((channelKey) => {
    const amounts = rows.map((row) => getChannelAmount(row, channelKey));
    return {
      channel_key: channelKey,
      label: channelLabels[channelKey],
      amount: roundMoney(amounts.reduce((sum, amount) => sum + amount, 0)),
      document_count: amounts.filter(
        (amount) => Math.abs(amount) > MONEY_TOLERANCE,
      ).length,
    };
  });
}

function summarizeTransFlags(rows: CashBankDocumentRow[]) {
  const byFlag = new Map<string, CashBankTransFlagSummary>();
  for (const row of rows) {
    const key = `${row.trans_flag_code ?? "null"}:${row.trans_flag_label}`;
    const current =
      byFlag.get(key) ??
      ({
        trans_flag_code: row.trans_flag_code,
        trans_flag_label: row.trans_flag_label || "ไม่ระบุประเภทเอกสาร",
        document_count: 0,
        total_amount: 0,
        cash_amount: 0,
        card_amount: 0,
        chq_amount: 0,
        transfer_amount: 0,
        total_income_amount: 0,
        coupon_amount: 0,
        petty_cash_amount: 0,
        channel_total_amount: 0,
        unallocated_amount: 0,
        mismatch_document_count: 0,
      } satisfies CashBankTransFlagSummary);
    current.document_count += 1;
    current.total_amount = roundMoney(current.total_amount + row.total_amount);
    current.cash_amount = roundMoney(current.cash_amount + row.cash_amount);
    current.card_amount = roundMoney(current.card_amount + row.card_amount);
    current.chq_amount = roundMoney(current.chq_amount + row.chq_amount);
    current.transfer_amount = roundMoney(
      current.transfer_amount + row.transfer_amount,
    );
    current.total_income_amount = roundMoney(
      current.total_income_amount + row.total_income_amount,
    );
    current.coupon_amount = roundMoney(current.coupon_amount + row.coupon_amount);
    current.petty_cash_amount = roundMoney(
      current.petty_cash_amount + row.petty_cash_amount,
    );
    current.channel_total_amount = roundMoney(
      current.channel_total_amount + row.channel_total_amount,
    );
    current.unallocated_amount = roundMoney(
      current.unallocated_amount + row.unallocated_amount,
    );
    if (row.channel_status !== "matched") {
      current.mismatch_document_count += 1;
    }
    byFlag.set(key, current);
  }

  return [...byFlag.values()].sort(
    (a, b) =>
      b.total_amount - a.total_amount ||
      b.document_count - a.document_count ||
      a.trans_flag_label.localeCompare(b.trans_flag_label),
  );
}

function summarizeParties(rows: CashBankDocumentRow[]) {
  const byParty = new Map<string, { code: string; name: string; total: number }>();
  for (const row of rows) {
    const key = row.ap_ar_code || row.ap_ar_name || "unknown";
    const current =
      byParty.get(key) ?? { code: row.ap_ar_code, name: row.ap_ar_name, total: 0 };
    current.total = roundMoney(current.total + row.total_amount);
    byParty.set(key, current);
  }
  return [...byParty.values()].sort((a, b) => b.total - a.total);
}

function getChannelAmount(
  row: CashBankDocumentRow,
  channelKey: CashBankChannelKey,
) {
  switch (channelKey) {
    case "cash":
      return row.cash_amount;
    case "card":
      return row.card_amount;
    case "cheque":
      return row.chq_amount;
    case "transfer":
      return row.transfer_amount;
    case "income":
      return row.total_income_amount;
    case "coupon":
      return row.coupon_amount;
    case "petty_cash":
      return row.petty_cash_amount;
    case "unallocated":
      return row.unallocated_amount;
  }
}

function sortTopDocuments(rows: CashBankDocumentRow[]) {
  return [...rows].sort(
    (a, b) =>
      Math.abs(b.total_amount) - Math.abs(a.total_amount) ||
      a.doc_date.localeCompare(b.doc_date) ||
      a.doc_no.localeCompare(b.doc_no),
  );
}

function sortMismatchDocuments(rows: CashBankDocumentRow[]) {
  return rows
    .filter((row) => row.channel_status !== "matched")
    .sort(
      (a, b) =>
        Math.abs(b.unallocated_amount) - Math.abs(a.unallocated_amount) ||
        Math.abs(b.total_amount) - Math.abs(a.total_amount) ||
        a.doc_date.localeCompare(b.doc_date) ||
        a.doc_no.localeCompare(b.doc_no),
    );
}

function buildCashBankDataQualityNotes(summary: CashBankSummary) {
  if (summary.mismatch_document_count === 0) {
    return [];
  }
  return [
    `พบเอกสาร ${formatInteger(
      summary.mismatch_document_count,
    )} ใบที่ยอดรวมไม่ตรงกับยอดตามช่องทาง ส่วนต่างสุทธิ ${formatMoney(
      summary.unallocated_amount,
    )} บาท`,
  ];
}

function buildCashBankInsight(snapshot: CashBankSnapshot) {
  if (snapshot.summary.document_count === 0) {
    return "ยังไม่พบเอกสารในช่วงวันที่นี้";
  }
  if (snapshot.summary.mismatch_document_count > 0) {
    return `พบ ${formatInteger(
      snapshot.summary.mismatch_document_count,
    )} เอกสารที่ควรตรวจช่องทางเงิน`;
  }
  const topFlag = snapshot.trans_flag_summary[0];
  if (topFlag) {
    return `${topFlag.trans_flag_label} มียอดสูงสุด ${formatMoney(
      topFlag.total_amount,
    )} บาท`;
  }
  return "ยอดตามช่องทางตรงกับยอดรวมในช่วงวันที่นี้";
}

function buildCashBankLineWarnings(snapshot: CashBankSnapshot) {
  const warnings = [...snapshot.data_quality_notes];
  if (snapshot.source === "sample_snapshot") {
    warnings.push("ข้อความนี้เป็น preview จากข้อมูลตัวอย่าง ยังไม่ใช่ข้อมูลสดจาก SML");
  }
  return warnings;
}

function buildCashBankFlexMessage(input: {
  snapshot: CashBankSnapshot;
  tenantName: string;
  generatedAt: string;
  dashboardUrl: string | null;
  insight: string;
  period: string;
  title: string;
  directionLabel: string;
}) {
  const { snapshot } = input;
  const topFlag = snapshot.trans_flag_summary[0] ?? null;
  return buildExecutiveDigestFlexMessage({
    variant: "executive_report_v2",
    kicker: `เงินสด/ธนาคาร · ${input.directionLabel}`,
    title: input.title,
    subtitle: `${input.tenantName} · ${input.period}`,
    altText: `${input.title} ${input.tenantName}: ${formatMoney(
      snapshot.summary.total_amount,
    )} บาท`,
    generatedAt: input.generatedAt,
    status: getCashBankDigestStatus(snapshot),
    primaryAmount: {
      value: formatMoney(snapshot.summary.total_amount),
      unit: "บาท",
      compact: true,
    },
    metrics: [
      {
        label: "เอกสาร",
        value: `${formatInteger(snapshot.summary.document_count)} ใบ`,
      },
      {
        label: "เงินสด",
        value: `${formatMoney(snapshot.summary.cash_amount)} บาท`,
      },
      {
        label: "โอน",
        value: `${formatMoney(snapshot.summary.transfer_amount)} บาท`,
      },
      {
        label: "ไม่ระบุ",
        value: `${formatMoney(snapshot.summary.unallocated_amount)} บาท`,
      },
    ],
    insight: input.insight,
    topLine: topFlag
      ? {
          label: "ประเภทเอกสารสูงสุด",
          value: `${truncateLineText(topFlag.trans_flag_label, 34)}: ${formatMoney(
            topFlag.total_amount,
          )} บาท`,
        }
      : { label: "ประเภทเอกสารสูงสุด", value: "ยังไม่มีเอกสาร" },
    note:
      snapshot.summary.mismatch_document_count > 0
        ? "ควรตรวจช่องทาง: บางเอกสารยอดรวมไม่ตรงกับยอดตามช่องทาง"
        : "รายงานนี้อิงวันที่เอกสาร ไม่ตัดตามเวลาแจ้งเตือน",
    noteTone:
      snapshot.summary.mismatch_document_count > 0 ? "warning" : "neutral",
    dashboardUrl: input.dashboardUrl,
  });
}

function getCashBankDigestStatus(
  snapshot: CashBankSnapshot,
): ExecutiveDigestStatus {
  if (snapshot.summary.document_count === 0) {
    return { text: "ไม่มีข้อมูล", severity: "notice" };
  }
  if (snapshot.summary.mismatch_document_count > 0) {
    return { text: "ควรตรวจยอด", severity: "notice" };
  }
  return { text: "พร้อมใช้", severity: "ready" };
}

function resolveCashBankQualityStatus(
  source: CashBankSnapshot["source"],
  summary: CashBankSummary,
): DataQualityStatus {
  if (source === "sample_snapshot") {
    return "stale";
  }
  if (summary.mismatch_document_count > 0) {
    return "reconciled_with_warning";
  }
  return "valid";
}

function getReportTitle(reportKey: CashBankReportKey) {
  return reportKey === "cash_bank_receipts"
    ? "รายงานรับเงิน"
    : "รายงานจ่ายเงิน";
}

function getReportShortTitle(reportKey: CashBankReportKey) {
  return reportKey === "cash_bank_receipts" ? "รับเงิน" : "จ่ายเงิน";
}

function formatCashBankPeriod(params: SalesGoodsServicesParams) {
  if (params.date_from === params.date_to) {
    return formatDateSlash(params.date_to);
  }
  return `${formatDateSlash(params.date_from)}-${formatDateSlash(params.date_to)}`;
}

function sumMoney<K extends keyof CashBankDocumentRow>(
  rows: CashBankDocumentRow[],
  key: K,
) {
  return roundMoney(
    rows.reduce((sum, row) => {
      const value = row[key];
      return typeof value === "number" ? sum + value : sum;
    }, 0),
  );
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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  return String(value);
}

function toNullableString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const text = String(value);
  return text === "" ? null : text;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }
  return toNumber(value);
}

function toDateString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return toStringValue(value).slice(0, 10);
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
  return Math.round(value).toLocaleString("th-TH");
}
