import {
  type ReportKey,
  type ReportSnapshot,
  reportKeyValues,
} from "@ai-bcc/shared";

export type ReconciliationStatus = "pass" | "warning" | "fail";

export type ReconciliationMetricKind = "count" | "money" | "percent" | "quantity";

export type ReconciliationMetric = {
  key: string;
  label: string;
  kind: ReconciliationMetricKind;
  actual: number;
  expected?: number;
  diff?: number;
  tolerance?: number;
  status: ReconciliationStatus;
};

export type ReconciliationReportResult = {
  report_key: ReportKey;
  run_id: string;
  basis: string;
  status: ReconciliationStatus;
  metrics: ReconciliationMetric[];
  warnings: string[];
};

export type ReconciliationExpectedInput = {
  reports?: Partial<Record<ReportKey, Record<string, unknown>>>;
} & Partial<Record<ReportKey, Record<string, unknown>>>;

const MONEY_MIN_TOLERANCE = 1;
const MONEY_RELATIVE_TOLERANCE = 0.0001;
const PERCENT_TOLERANCE = 0.01;
const QUANTITY_TOLERANCE = 0.01;

export function normalizeReconciliationExpected(
  input: ReconciliationExpectedInput | null | undefined,
): Partial<Record<ReportKey, Record<string, number>>> {
  if (!input) {
    return {};
  }
  const source = input.reports ?? input;
  const result: Partial<Record<ReportKey, Record<string, number>>> = {};
  for (const reportKey of reportKeyValues) {
    const rawReport = source[reportKey];
    if (!rawReport || typeof rawReport !== "object") {
      continue;
    }
    const metrics: Record<string, number> = {};
    for (const [key, value] of Object.entries(rawReport)) {
      const numericValue = toNumberOrNull(value);
      if (numericValue !== null) {
        metrics[key] = numericValue;
      }
    }
    result[reportKey] = metrics;
  }
  return result;
}

export function reconcileSnapshot(
  snapshot: ReportSnapshot,
  expectedByReport: Partial<Record<ReportKey, Record<string, number>>> = {},
): ReconciliationReportResult {
  const expected = expectedByReport[snapshot.report_key] ?? null;
  const warnings: string[] = [];
  const definitions = getMetricDefinitions(snapshot);
  const metrics = definitions.map((definition) =>
    reconcileMetric(definition, expected),
  );

  if (expected) {
    for (const definition of definitions) {
      if (!(definition.key in expected)) {
        warnings.push(`expected_missing:${definition.key}`);
      }
    }
  }

  warnings.push(...getSnapshotWarnings(snapshot));

  return {
    report_key: snapshot.report_key,
    run_id: snapshot.run_id,
    basis: getSnapshotBasis(snapshot),
    status: resolveReportStatus(metrics, warnings),
    metrics,
    warnings,
  };
}

function getMetricDefinitions(snapshot: ReportSnapshot): Array<{
  key: string;
  label: string;
  kind: ReconciliationMetricKind;
  actual: number;
}> {
  switch (snapshot.report_key) {
    case "sales_goods_services":
      return [
        countMetric("bill_count", "บิลขาย", snapshot.summary.document_count),
        countMetric("line_count", "รายการขาย", snapshot.summary.line_count),
        moneyMetric("total_sales", "ยอดขายรวม", snapshot.summary.total_sales),
        moneyMetric(
          "reconciliation_difference",
          "ส่วนต่างหัวบิล/รายการ",
          snapshot.reconciliation.difference_amount,
        ),
        countMetric("warning_count", "จำนวน warning", countSnapshotWarnings(snapshot)),
      ];
    case "purchase_goods_payables":
      return [
        countMetric("document_count", "เอกสารซื้อ", snapshot.summary.document_count),
        countMetric("line_count", "รายการสินค้า", snapshot.summary.line_count),
        moneyMetric("purchase_total", "ยอดซื้อรวม", snapshot.summary.total_purchase),
        moneyMetric(
          "reconciliation_difference",
          "ส่วนต่างหัวเอกสาร/รายการ",
          snapshot.reconciliation.difference_amount,
        ),
      ];
    case "gross_profit_by_product":
      return grossProfitMetrics(snapshot, "negative_item_count");
    case "gross_profit_by_ar_customer":
      return grossProfitMetrics(snapshot, "negative_customer_count");
    case "stock_balance":
      return [
        countMetric("sku_count", "จำนวนสินค้า", snapshot.summary.sku_count),
        moneyMetric("stock_value", "มูลค่าสต็อก", snapshot.summary.stock_value),
        countMetric(
          "negative_stock_count",
          "สต็อกติดลบ",
          snapshot.summary.negative_stock_count,
        ),
        moneyMetric("amount_in", "รับเข้า", snapshot.summary.amount_in),
        moneyMetric("amount_out", "จ่ายออก", snapshot.summary.amount_out),
      ];
    case "stock_reorder":
      return [
        countMetric("reorder_count", "ถึงจุดสั่งซื้อ", snapshot.summary.reorder_count),
        countMetric(
          "out_of_stock_count",
          "ของหมด",
          snapshot.summary.out_of_stock_count,
        ),
        countMetric("low_stock_count", "ใกล้หมด", snapshot.summary.low_stock_count),
        quantityMetric(
          "purchase_balance_qty",
          "ค้างรับเข้า",
          snapshot.summary.purchase_balance_qty_total,
        ),
      ];
    case "ar_customer_movement":
      return [
        countMetric("document_count", "เอกสาร", snapshot.summary.document_count),
        countMetric("customer_count", "ลูกหนี้", snapshot.summary.customer_count),
        moneyMetric(
          "ar_increase_amount",
          "เพิ่มลูกหนี้",
          snapshot.summary.ar_increase_amount,
        ),
        moneyMetric(
          "ar_decrease_receipt_amount",
          "ลดลูกหนี้/รับชำระ",
          snapshot.summary.ar_decrease_amount + snapshot.summary.receipt_amount,
        ),
        moneyMetric(
          "net_movement_amount",
          "เคลื่อนไหวสุทธิ",
          snapshot.summary.net_movement_amount,
        ),
      ];
    case "ar_debt_receipt":
      return [
        countMetric("receipt_count", "เอกสารรับชำระ", snapshot.summary.receipt_count),
        countMetric("customer_count", "ลูกหนี้", snapshot.summary.customer_count),
        moneyMetric(
          "total_received_amount",
          "ยอดรับชำระรวม",
          snapshot.summary.total_received_amount,
        ),
        moneyMetric("cash_amount", "เงินสด", snapshot.summary.cash_amount),
        moneyMetric("transfer_amount", "โอน", snapshot.summary.transfer_amount),
        countMetric(
          "unmatched_payment_count",
          "ช่องทางรับเงินที่ควรตรวจ",
          snapshot.summary.unmatched_payment_count,
        ),
      ];
  }
}

function grossProfitMetrics(
  snapshot: Extract<
    ReportSnapshot,
    { report_key: "gross_profit_by_product" | "gross_profit_by_ar_customer" }
  >,
  negativeMetricKey: "negative_item_count" | "negative_customer_count",
) {
  return [
    moneyMetric("sales", "ยอดขายสุทธิ", snapshot.summary.net_amount),
    moneyMetric("cost", "ต้นทุนสุทธิ", snapshot.summary.net_cost),
    moneyMetric("gross_profit", "กำไรขั้นต้น", snapshot.summary.gross_profit),
    percentMetric(
      "margin",
      "Margin",
      snapshot.summary.gross_margin_percent ?? 0,
    ),
    countMetric(
      negativeMetricKey,
      negativeMetricKey === "negative_item_count"
        ? "สินค้ากำไรติดลบ"
        : "ลูกหนี้กำไรติดลบ",
      snapshot.summary.negative_gross_profit_count,
    ),
  ];
}

function reconcileMetric(
  definition: {
    key: string;
    label: string;
    kind: ReconciliationMetricKind;
    actual: number;
  },
  expected: Record<string, number> | null,
): ReconciliationMetric {
  if (!expected || !(definition.key in expected)) {
    return {
      ...definition,
      status: "pass",
    };
  }

  const expectedValue = expected[definition.key];
  const tolerance = getTolerance(definition.kind, expectedValue);
  const diff = roundMetric(definition.actual - expectedValue);
  return {
    ...definition,
    expected: expectedValue,
    diff,
    tolerance,
    status: Math.abs(diff) <= tolerance ? "pass" : "fail",
  };
}

function getSnapshotBasis(snapshot: ReportSnapshot) {
  if ("source_basis" in snapshot) {
    return snapshot.source_basis;
  }
  if (
    snapshot.report_key === "sales_goods_services" ||
    snapshot.report_key === "purchase_goods_payables" ||
    snapshot.report_key === "gross_profit_by_product" ||
    snapshot.report_key === "gross_profit_by_ar_customer"
  ) {
    return "period";
  }
  return "snapshot";
}

function getSnapshotWarnings(snapshot: ReportSnapshot) {
  const warnings: string[] = [];
  if (snapshot.quality_status === "failed" || snapshot.quality_status === "partial") {
    warnings.push(`quality_status:${snapshot.quality_status}`);
  }
  if (
    (snapshot.report_key === "sales_goods_services" ||
      snapshot.report_key === "purchase_goods_payables") &&
    Math.abs(snapshot.reconciliation.difference_amount) >
      getTolerance("money", snapshot.reconciliation.header_total_amount)
  ) {
    warnings.push("reconciliation_difference_over_tolerance");
  }
  if (
    snapshot.report_key === "ar_debt_receipt" &&
    snapshot.summary.unmatched_payment_count > 0
  ) {
    warnings.push("unmatched_payment_split");
  }
  return warnings;
}

function countSnapshotWarnings(snapshot: ReportSnapshot) {
  if ("warnings" in snapshot && Array.isArray(snapshot.warnings)) {
    return snapshot.warnings.length;
  }
  if ("data_quality_notes" in snapshot && Array.isArray(snapshot.data_quality_notes)) {
    return snapshot.data_quality_notes.length;
  }
  return getSnapshotWarnings(snapshot).length;
}

function resolveReportStatus(
  metrics: ReconciliationMetric[],
  warnings: string[],
): ReconciliationStatus {
  if (metrics.some((metric) => metric.status === "fail")) {
    return "fail";
  }
  if (warnings.some((warning) => warning.startsWith("quality_status:failed"))) {
    return "fail";
  }
  return warnings.length ? "warning" : "pass";
}

function getTolerance(kind: ReconciliationMetricKind, expected: number) {
  switch (kind) {
    case "money":
      return Math.max(
        MONEY_MIN_TOLERANCE,
        Math.abs(expected) * MONEY_RELATIVE_TOLERANCE,
      );
    case "percent":
      return PERCENT_TOLERANCE;
    case "quantity":
      return QUANTITY_TOLERANCE;
    case "count":
      return 0;
  }
}

function countMetric(key: string, label: string, actual: number) {
  return { key, label, kind: "count" as const, actual: roundMetric(actual) };
}

function moneyMetric(key: string, label: string, actual: number) {
  return { key, label, kind: "money" as const, actual: roundMetric(actual) };
}

function percentMetric(key: string, label: string, actual: number) {
  return { key, label, kind: "percent" as const, actual: roundMetric(actual) };
}

function quantityMetric(key: string, label: string, actual: number) {
  return { key, label, kind: "quantity" as const, actual: roundMetric(actual) };
}

function roundMetric(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function toNumberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
