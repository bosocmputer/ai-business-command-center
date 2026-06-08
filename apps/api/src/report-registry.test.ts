import { describe, expect, it } from "vitest";
import {
  reportKeyValues,
  type ReportKey,
  type ReportRunRecord,
  type ReportSnapshot,
} from "@ai-bcc/shared";
import {
  assertReportRuntimeRegistryComplete,
  createReportRuntimeRegistry,
  runReportRuntimeEntry,
  type ReportRuntimeRunInput,
  type ReportRuntimeRunOutcome,
} from "./report-registry.js";
import { reportDefinitionSeeds } from "./report-definitions.js";

const runInput: ReportRuntimeRunInput = {
  tenantId: "tenant_demo_remote",
  params: { date_from: "2026-06-04", date_to: "2026-06-04" },
  requestAction: "test_report_run_requested",
};

function fakeRunOutcome(reportKey: ReportKey): ReportRuntimeRunOutcome {
  return {
    ok: true,
    snapshot: { report_key: reportKey } as ReportSnapshot,
    runRecord: { report_key: reportKey } as ReportRunRecord,
  };
}

describe("report runtime registry", () => {
  it("constructs a complete registry without invoking runners", () => {
    let runnerCalls = 0;
    const registry = createReportRuntimeRegistry({
      runSalesGoodsServicesReport: async () => {
        runnerCalls += 1;
        return fakeRunOutcome("sales_goods_services");
      },
      runPurchaseGoodsPayablesReport: async () => {
        runnerCalls += 1;
        return fakeRunOutcome("purchase_goods_payables");
      },
      runGrossProfitReport: async (input) => {
        runnerCalls += 1;
        return fakeRunOutcome(input.reportKey);
      },
      runStockBalanceReport: async () => {
        runnerCalls += 1;
        return fakeRunOutcome("stock_balance");
      },
    });

    expect(runnerCalls).toBe(0);
    expect(assertReportRuntimeRegistryComplete(registry)).toBe(true);
    expect(Object.keys(registry)).toEqual([...reportKeyValues]);
  });

  it("routes gross profit reports through the gross profit runner with the same key", async () => {
    const calls: string[] = [];
    const registry = createReportRuntimeRegistry({
      runSalesGoodsServicesReport: async () => {
        calls.push("sales");
        return fakeRunOutcome("sales_goods_services");
      },
      runPurchaseGoodsPayablesReport: async () => {
        calls.push("purchase");
        return fakeRunOutcome("purchase_goods_payables");
      },
      runGrossProfitReport: async (input) => {
        calls.push(`gross:${input.reportKey}`);
        return fakeRunOutcome(input.reportKey);
      },
      runStockBalanceReport: async () => {
        calls.push("stock");
        return fakeRunOutcome("stock_balance");
      },
    });

    await runReportRuntimeEntry(
      registry,
      "gross_profit_by_ar_customer",
      runInput,
    );

    expect(calls).toEqual(["gross:gross_profit_by_ar_customer"]);
  });

  it("routes stock balance through its dedicated runner", async () => {
    const calls: string[] = [];
    const registry = createReportRuntimeRegistry({
      runSalesGoodsServicesReport: async () => {
        calls.push("sales");
        return fakeRunOutcome("sales_goods_services");
      },
      runPurchaseGoodsPayablesReport: async () => {
        calls.push("purchase");
        return fakeRunOutcome("purchase_goods_payables");
      },
      runGrossProfitReport: async (input) => {
        calls.push(`gross:${input.reportKey}`);
        return fakeRunOutcome(input.reportKey);
      },
      runStockBalanceReport: async () => {
        calls.push("stock");
        return fakeRunOutcome("stock_balance");
      },
    });

    await runReportRuntimeEntry(registry, "stock_balance", runInput);

    expect(calls).toEqual(["stock"]);
  });

  it("does not silently fallback to another report when a handler is missing", async () => {
    const result = await runReportRuntimeEntry(
      {},
      "purchase_goods_payables",
      runInput,
    );

    expect(result).toBeNull();
  });

  it("keeps report definitions aligned with the shared catalog", () => {
    expect(reportDefinitionSeeds.map((definition) => definition.report_key)).toEqual(
      [...reportKeyValues],
    );
    expect(reportDefinitionSeeds.map((definition) => definition.name)).toEqual([
      "Sales Goods and Services",
      "Purchase Goods and Payables",
      "Gross Profit by Product",
      "Gross Profit by AR Customer",
      "Stock Balance",
    ]);
  });
});
