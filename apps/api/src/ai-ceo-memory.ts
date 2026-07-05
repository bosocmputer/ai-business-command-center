import { createHash } from "node:crypto";
import {
  type MetricSnapshotRecord,
  type ReportKey,
  type ReportSnapshot,
  type TenantId,
} from "@ai-bcc/shared";

export const AI_CEO_MEMORY_LOOKBACK_DAYS = 7;

export type AiCeoBusinessMemoryTrend =
  | "new"
  | "repeated"
  | "improved"
  | "worsened"
  | "resolved";

export type AiCeoBusinessMemoryItem = {
  issue_key: string;
  report_key: ReportKey;
  metric_name: string;
  metric_label: string;
  current_value: number;
  previous_value: number | null;
  repeated_days: number;
  trend: AiCeoBusinessMemoryTrend;
  source_metric_date: string;
  source_run_ids: string[];
};

type MetricIssueDefinition = {
  issueKey: string;
  reportKey: ReportKey;
  metricName: string;
  metricLabel: string;
  threshold: number;
};

const METRIC_ISSUE_DEFINITIONS: MetricIssueDefinition[] = [
  {
    issueKey: "cash_bank_receipts:unallocated_amount",
    reportKey: "cash_bank_receipts",
    metricName: "unallocated_amount",
    metricLabel: "รับเงินยังไม่จัดสรร",
    threshold: 0.01,
  },
  {
    issueKey: "cash_bank_receipts:mismatch_document_count",
    reportKey: "cash_bank_receipts",
    metricName: "mismatch_document_count",
    metricLabel: "เอกสารรับเงินไม่ตรงช่องทาง",
    threshold: 0,
  },
  {
    issueKey: "cash_bank_payments:unallocated_amount",
    reportKey: "cash_bank_payments",
    metricName: "unallocated_amount",
    metricLabel: "จ่ายเงินยังไม่จัดสรร",
    threshold: 0.01,
  },
  {
    issueKey: "cash_bank_payments:mismatch_document_count",
    reportKey: "cash_bank_payments",
    metricName: "mismatch_document_count",
    metricLabel: "เอกสารจ่ายเงินไม่ตรงช่องทาง",
    threshold: 0,
  },
  {
    issueKey: "stock_balance:negative_stock_count",
    reportKey: "stock_balance",
    metricName: "negative_stock_count",
    metricLabel: "สินค้าสต็อกติดลบ",
    threshold: 0,
  },
  {
    issueKey: "stock_balance:zero_or_missing_cost_count",
    reportKey: "stock_balance",
    metricName: "zero_or_missing_cost_count",
    metricLabel: "สินค้าที่ไม่มีต้นทุน",
    threshold: 0,
  },
  {
    issueKey: "stock_reorder:reorder_count",
    reportKey: "stock_reorder",
    metricName: "reorder_count",
    metricLabel: "สินค้าถึงจุดสั่งซื้อ",
    threshold: 0,
  },
  {
    issueKey: "gross_profit_by_product:negative_gross_profit_count",
    reportKey: "gross_profit_by_product",
    metricName: "negative_gross_profit_count",
    metricLabel: "สินค้าที่กำไรติดลบ",
    threshold: 0,
  },
  {
    issueKey: "gross_profit_by_ar_customer:negative_gross_profit_count",
    reportKey: "gross_profit_by_ar_customer",
    metricName: "negative_gross_profit_count",
    metricLabel: "ลูกค้าที่กำไรติดลบ",
    threshold: 0,
  },
  {
    issueKey: "ar_debt_receipt:unmatched_payment_count",
    reportKey: "ar_debt_receipt",
    metricName: "unmatched_payment_count",
    metricLabel: "รับชำระหนี้ยังไม่จับคู่",
    threshold: 0,
  },
];

export function buildMetricSnapshotFromReportSnapshot(input: {
  snapshot: ReportSnapshot;
  periodPreset: string;
  createdAt?: string;
}): MetricSnapshotRecord | null {
  const metrics = extractStableMetrics(input.snapshot);
  if (!Object.keys(metrics).length) {
    return null;
  }
  const metricDate = extractSnapshotMetricDate(input.snapshot);
  const periodPreset = input.periodPreset || "unknown";
  const id = buildMetricSnapshotId({
    tenantId: input.snapshot.tenant_id,
    reportKey: input.snapshot.report_key,
    metricDate,
    periodPreset,
  });
  return {
    id,
    tenant_id: input.snapshot.tenant_id,
    report_key: input.snapshot.report_key,
    metric_date: metricDate,
    period_preset: periodPreset,
    metrics_json: metrics,
    quality_status: input.snapshot.quality_status,
    source_run_ids: [input.snapshot.run_id],
    created_at: input.createdAt ?? new Date().toISOString(),
  };
}

export function buildAiCeoBusinessMemory(input: {
  metricDateTo: string;
  reportKeys: ReportKey[];
  metrics: MetricSnapshotRecord[];
  limit?: number;
}): AiCeoBusinessMemoryItem[] {
  const allowedReportKeys = new Set(input.reportKeys);
  const metricDateTo = input.metricDateTo;
  const metricDateFrom = subtractIsoDays(
    metricDateTo,
    AI_CEO_MEMORY_LOOKBACK_DAYS,
  );
  const relevantMetrics = input.metrics.filter(
    (metric) =>
      allowedReportKeys.has(metric.report_key) &&
      metric.metric_date >= metricDateFrom &&
      metric.metric_date <= metricDateTo,
  );
  const memory: AiCeoBusinessMemoryItem[] = [];

  for (const definition of METRIC_ISSUE_DEFINITIONS) {
    if (!allowedReportKeys.has(definition.reportKey)) {
      continue;
    }
    const datedMetrics = latestMetricsByDate(
      relevantMetrics.filter((metric) => metric.report_key === definition.reportKey),
    );
    if (!datedMetrics.length) {
      continue;
    }
    const currentMetric =
      datedMetrics.find((metric) => metric.metric_date === metricDateTo) ??
      datedMetrics[0];
    const currentValue = readMetricNumber(
      currentMetric,
      definition.metricName,
    );
    if (currentValue === null) {
      continue;
    }
    const previousMetrics = datedMetrics.filter(
      (metric) => metric.metric_date < currentMetric.metric_date,
    );
    const previousValue = previousMetrics
      .map((metric) => readMetricNumber(metric, definition.metricName))
      .find((value): value is number => value !== null) ?? null;
    const repeatedDays = datedMetrics.filter((metric) => {
      const value = readMetricNumber(metric, definition.metricName);
      return value !== null && hasMetricIssue(value, definition.threshold);
    }).length;
    const hasCurrentIssue = hasMetricIssue(currentValue, definition.threshold);
    const hadPreviousIssue = previousMetrics.some((metric) => {
      const value = readMetricNumber(metric, definition.metricName);
      return value !== null && hasMetricIssue(value, definition.threshold);
    });
    if (!hasCurrentIssue && !hadPreviousIssue) {
      continue;
    }

    memory.push({
      issue_key: definition.issueKey,
      report_key: definition.reportKey,
      metric_name: definition.metricName,
      metric_label: definition.metricLabel,
      current_value: currentValue,
      previous_value: previousValue,
      repeated_days: repeatedDays,
      trend: resolveTrend({
        currentValue,
        previousValue,
        hasCurrentIssue,
        hadPreviousIssue,
      }),
      source_metric_date: currentMetric.metric_date,
      source_run_ids: currentMetric.source_run_ids,
    });
  }

  return memory
    .sort(compareBusinessMemoryItems)
    .slice(0, input.limit ?? 8);
}

export function subtractIsoDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function extractStableMetrics(snapshot: ReportSnapshot): Record<string, number> {
  switch (snapshot.report_key) {
    case "sales_goods_services":
      return pickNumbers(snapshot.summary, [
        "total_sales",
        "document_count",
        "line_count",
        "total_qty",
      ]);
    case "purchase_goods_payables":
      return pickNumbers(snapshot.summary, [
        "total_purchase",
        "document_count",
        "line_count",
        "total_qty",
      ]);
    case "gross_profit_by_product":
    case "gross_profit_by_ar_customer":
      return pickNumbers(snapshot.summary, [
        "row_count",
        "document_count",
        "line_count",
        "total_qty",
        "total_sales",
        "net_amount",
        "net_cost",
        "gross_profit",
        "gross_margin_percent",
        "negative_gross_profit_count",
      ]);
    case "stock_balance":
      return pickNumbers(snapshot.summary, [
        "sku_count",
        "stock_value",
        "balance_qty",
        "negative_stock_count",
        "zero_or_missing_cost_count",
      ]);
    case "stock_reorder":
      return pickNumbers(snapshot.summary, [
        "reorder_count",
        "out_of_stock_count",
        "low_stock_count",
        "purchase_balance_qty_total",
        "shortage_qty_total",
      ]);
    case "ar_customer_movement":
      return pickNumbers(snapshot.summary, [
        "document_count",
        "customer_count",
        "ar_increase_amount",
        "ar_decrease_amount",
        "receipt_amount",
        "net_movement_amount",
      ]);
    case "ar_debt_receipt":
      return pickNumbers(snapshot.summary, [
        "receipt_count",
        "customer_count",
        "total_received_amount",
        "cash_amount",
        "transfer_amount",
        "unmatched_payment_count",
      ]);
    case "cash_bank_receipts":
    case "cash_bank_payments":
      return pickNumbers(snapshot.summary, [
        "document_count",
        "party_count",
        "total_amount",
        "cash_amount",
        "card_amount",
        "chq_amount",
        "transfer_amount",
        "total_income_amount",
        "coupon_amount",
        "petty_cash_amount",
        "channel_total_amount",
        "unallocated_amount",
        "mismatch_document_count",
      ]);
  }
}

function pickNumbers(
  value: Record<string, unknown>,
  fields: string[],
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const field of fields) {
    const numeric = Number(value[field]);
    if (Number.isFinite(numeric)) {
      result[field] = Number(numeric.toFixed(4));
    }
  }
  return result;
}

function extractSnapshotMetricDate(snapshot: ReportSnapshot) {
  const params = snapshot.params;
  return params.date_to || params.date_from || snapshot.generated_at.slice(0, 10);
}

function buildMetricSnapshotId(input: {
  tenantId: TenantId;
  reportKey: ReportKey;
  metricDate: string;
  periodPreset: string;
}) {
  const hash = createHash("sha256")
    .update(
      [
        input.tenantId,
        input.reportKey,
        input.metricDate,
        input.periodPreset,
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 24);
  return `metric_${hash}`;
}

function latestMetricsByDate(metrics: MetricSnapshotRecord[]) {
  const byDate = new Map<string, MetricSnapshotRecord>();
  for (const metric of metrics) {
    const existing = byDate.get(metric.metric_date);
    if (!existing || existing.created_at < metric.created_at) {
      byDate.set(metric.metric_date, metric);
    }
  }
  return Array.from(byDate.values()).sort((a, b) =>
    b.metric_date.localeCompare(a.metric_date) ||
    b.created_at.localeCompare(a.created_at),
  );
}

function readMetricNumber(
  metric: MetricSnapshotRecord,
  metricName: string,
): number | null {
  const value = Number(metric.metrics_json[metricName]);
  return Number.isFinite(value) ? value : null;
}

function hasMetricIssue(value: number, threshold: number) {
  return threshold === 0 ? value > 0 : Math.abs(value) > threshold;
}

function resolveTrend(input: {
  currentValue: number;
  previousValue: number | null;
  hasCurrentIssue: boolean;
  hadPreviousIssue: boolean;
}): AiCeoBusinessMemoryTrend {
  if (!input.hasCurrentIssue && input.hadPreviousIssue) {
    return "resolved";
  }
  if (!input.hadPreviousIssue) {
    return "new";
  }
  if (input.previousValue === null) {
    return "repeated";
  }
  if (Math.abs(input.currentValue) < Math.abs(input.previousValue)) {
    return "improved";
  }
  if (Math.abs(input.currentValue) > Math.abs(input.previousValue)) {
    return "worsened";
  }
  return "repeated";
}

function compareBusinessMemoryItems(
  left: AiCeoBusinessMemoryItem,
  right: AiCeoBusinessMemoryItem,
) {
  const leftScore = scoreBusinessMemoryItem(left);
  const rightScore = scoreBusinessMemoryItem(right);
  return (
    rightScore - leftScore ||
    right.repeated_days - left.repeated_days ||
    left.report_key.localeCompare(right.report_key)
  );
}

function scoreBusinessMemoryItem(item: AiCeoBusinessMemoryItem) {
  let score = 0;
  if (item.trend === "worsened") {
    score += 80;
  } else if (item.trend === "repeated") {
    score += 70;
  } else if (item.trend === "new") {
    score += 60;
  } else if (item.trend === "improved") {
    score += 30;
  }
  if (
    item.report_key === "cash_bank_receipts" ||
    item.report_key === "cash_bank_payments"
  ) {
    score += 20;
  }
  if (item.report_key === "stock_balance") {
    score += 18;
  }
  return score;
}
