import {
  reportKeyValues,
  type ReportKey,
} from "@ai-bcc/shared";

export type ReportExecutionMode =
  | "fresh_required"
  | "fresh_first_with_reference_fallback";

export type ReportExecutionPolicy = {
  reportKey: ReportKey;
  mode: ReportExecutionMode;
  cooldownMs: number | null;
  fallbackMaxAgeMs: number | null;
  coalesceGraceMs: number | null;
};

const TEN_MINUTES_MS = 10 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const THREE_MINUTES_MS = 3 * 60 * 1000;

export const reportExecutionPolicies = {
  sales_goods_services: freshRequired("sales_goods_services"),
  purchase_goods_payables: freshRequired("purchase_goods_payables"),
  gross_profit_by_product: freshRequired("gross_profit_by_product"),
  gross_profit_by_ar_customer: freshRequired("gross_profit_by_ar_customer"),
  stock_balance: freshFirstWithReferenceFallback("stock_balance"),
  stock_reorder: freshRequired("stock_reorder"),
  ar_customer_movement:
    freshFirstWithReferenceFallback("ar_customer_movement"),
  ar_debt_receipt: freshRequired("ar_debt_receipt"),
} satisfies Record<ReportKey, ReportExecutionPolicy>;

export function getReportExecutionPolicy(reportKey: ReportKey) {
  return reportExecutionPolicies[reportKey];
}

export function isReferenceFallbackReport(reportKey: ReportKey) {
  return (
    reportExecutionPolicies[reportKey].mode ===
    "fresh_first_with_reference_fallback"
  );
}

export function assertReportExecutionPolicyComplete() {
  return reportKeyValues.every((reportKey) => reportKey in reportExecutionPolicies);
}

function freshRequired(reportKey: ReportKey): ReportExecutionPolicy {
  return {
    reportKey,
    mode: "fresh_required",
    cooldownMs: null,
    fallbackMaxAgeMs: null,
    coalesceGraceMs: null,
  };
}

function freshFirstWithReferenceFallback(
  reportKey: Extract<ReportKey, "stock_balance" | "ar_customer_movement">,
): ReportExecutionPolicy {
  return {
    reportKey,
    mode: "fresh_first_with_reference_fallback",
    cooldownMs: TEN_MINUTES_MS,
    fallbackMaxAgeMs: TWENTY_FOUR_HOURS_MS,
    coalesceGraceMs: THREE_MINUTES_MS,
  };
}
