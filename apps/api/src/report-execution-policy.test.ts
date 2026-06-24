import { describe, expect, it } from "vitest";
import { reportKeyValues } from "@ai-bcc/shared";
import {
  assertReportExecutionPolicyComplete,
  getReportExecutionPolicy,
} from "./report-execution-policy.js";

describe("report execution policy", () => {
  it("covers every report key", () => {
    expect(assertReportExecutionPolicyComplete()).toBe(true);
    expect(reportKeyValues.map((reportKey) => getReportExecutionPolicy(reportKey).reportKey)).toEqual([
      ...reportKeyValues,
    ]);
  });

  it("keeps only the two heavy reports on reference fallback mode", () => {
    const policies = Object.fromEntries(
      reportKeyValues.map((reportKey) => [
        reportKey,
        getReportExecutionPolicy(reportKey).mode,
      ]),
    );

    expect(policies).toMatchObject({
      sales_goods_services: "fresh_required",
      purchase_goods_payables: "fresh_required",
      gross_profit_by_product: "fresh_required",
      gross_profit_by_ar_customer: "fresh_required",
      stock_balance: "fresh_first_with_reference_fallback",
      stock_reorder: "fresh_required",
      ar_customer_movement: "fresh_first_with_reference_fallback",
      ar_debt_receipt: "fresh_required",
      cash_bank_receipts: "fresh_required",
      cash_bank_payments: "fresh_required",
    });
    expect(getReportExecutionPolicy("stock_balance")).toMatchObject({
      cooldownMs: 10 * 60 * 1000,
      fallbackMaxAgeMs: 24 * 60 * 60 * 1000,
      coalesceGraceMs: 3 * 60 * 1000,
    });
  });
});
