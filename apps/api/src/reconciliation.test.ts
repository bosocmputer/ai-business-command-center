import { describe, expect, it } from "vitest";
import {
  type ReportKey,
  type ReportSnapshot,
  reportKeyValues,
} from "@ai-bcc/shared";
import {
  normalizeReconciliationExpected,
  reconcileSnapshot,
} from "./reconciliation.js";

describe("notification reconciliation", () => {
  it("extracts reconciliation metrics for every report key", () => {
    const results = reportKeyValues.map((reportKey) =>
      reconcileSnapshot(fakeSnapshot(reportKey)),
    );

    expect(results.map((result) => result.report_key)).toEqual([...reportKeyValues]);
    expect(results.every((result) => result.metrics.length > 0)).toBe(true);
    expect(
      results.find((result) => result.report_key === "ar_customer_movement")
        ?.basis,
    ).toBe("ar_movement_as_of_date");
  });

  it("uses money tolerance of at least one baht or 0.01 percent", () => {
    const snapshot = fakeSnapshot("sales_goods_services");

    const tolerantMetric = reconcileSnapshot(
      snapshot,
      normalizeReconciliationExpected({
        sales_goods_services: { total_sales: 100_000.5 },
      }),
    ).metrics.find((metric) => metric.key === "total_sales");

    expect(tolerantMetric).toMatchObject({
      status: "pass",
      diff: -0.5,
    });
    expect(tolerantMetric?.tolerance).toBeCloseTo(10.00005);

    expect(
      reconcileSnapshot(
        snapshot,
        normalizeReconciliationExpected({
          sales_goods_services: { total_sales: 99_000 },
        }),
      ).status,
    ).toBe("fail");
  });

  it("marks missing expected metrics as warning without failing matched metrics", () => {
    const result = reconcileSnapshot(
      fakeSnapshot("ar_debt_receipt"),
      normalizeReconciliationExpected({
        reports: {
          ar_debt_receipt: { total_received_amount: 2500 },
        },
      }),
    );

    expect(result.status).toBe("warning");
    expect(result.warnings).toContain("expected_missing:receipt_count");
    expect(
      result.metrics.find((metric) => metric.key === "total_received_amount"),
    ).toMatchObject({ status: "pass", diff: 0 });
  });

  it("surfaces internal data quality warnings from persisted snapshots", () => {
    const result = reconcileSnapshot(fakeSnapshot("purchase_goods_payables", {
      reconciliationDifference: 25,
    }));

    expect(result.status).toBe("warning");
    expect(result.warnings).toContain("reconciliation_difference_over_tolerance");
  });
});

function fakeSnapshot(
  reportKey: ReportKey,
  options: { reconciliationDifference?: number } = {},
): ReportSnapshot {
  const base = {
    tenant_id: "tenant_demo_remote",
    report_key: reportKey,
    run_id: `run_${reportKey}`,
    params: { date_from: "2026-06-08", date_to: "2026-06-08" },
    generated_at: "2026-06-08T12:00:00.000Z",
    source: "sample_snapshot",
    quality_status: "valid",
    line_template: { title: "รายงาน", body: [] },
  };
  switch (reportKey) {
    case "sales_goods_services":
      return {
        ...base,
        report_key: reportKey,
        summary: {
          total_sales: 100_000,
          document_count: 10,
          line_count: 20,
          total_qty: 25,
          top_product_name: "สินค้า A",
        },
        branch_sales: [],
        top_products: [],
        documents: [],
        lines: [],
        reconciliation: reconciliation(options.reconciliationDifference ?? 0),
      } as unknown as ReportSnapshot;
    case "purchase_goods_payables":
      return {
        ...base,
        report_key: reportKey,
        summary: {
          total_purchase: 80_000,
          document_count: 8,
          line_count: 16,
          total_qty: 18,
          top_supplier_name: "ผู้จำหน่าย A",
          top_product_name: "สินค้า A",
        },
        top_suppliers: [],
        branch_purchases: [],
        top_products: [],
        documents: [],
        lines: [],
        reconciliation: reconciliation(options.reconciliationDifference ?? 0),
      } as unknown as ReportSnapshot;
    case "gross_profit_by_product":
    case "gross_profit_by_ar_customer":
      return {
        ...base,
        report_key: reportKey,
        summary: {
          row_count: 5,
          document_count: 4,
          line_count: 8,
          total_qty: 12,
          total_sales: 120_000,
          total_returns: 0,
          net_amount: 120_000,
          net_cost: 90_000,
          gross_profit: 30_000,
          gross_margin_percent: 25,
          negative_gross_profit_count: 1,
          top_gross_profit_name: "สินค้า A",
        },
        rows: [],
        top_rows: [],
        negative_rows: [],
      } as unknown as ReportSnapshot;
    case "stock_balance":
      return {
        ...base,
        report_key: reportKey,
        summary: {
          sku_count: 100,
          stock_value: 900_000,
          balance_qty: 500,
          qty_in: 10,
          amount_in: 20_000,
          qty_out: 12,
          amount_out: 15_000,
          negative_stock_count: 2,
          zero_or_missing_cost_count: 1,
          top_stock_item_name: "สินค้า A",
        },
        top_items_by_value: [],
        negative_items: [],
      } as unknown as ReportSnapshot;
    case "stock_reorder":
      return {
        ...base,
        report_key: reportKey,
        source_basis: "latest_inventory_balance",
        summary: {
          reorder_count: 12,
          out_of_stock_count: 3,
          low_stock_count: 9,
          purchase_balance_qty_total: 4,
          shortage_qty_total: 30,
          top_reorder_item_name: "สินค้า A",
        },
        top_items: [],
      } as unknown as ReportSnapshot;
    case "ar_customer_movement":
      return {
        ...base,
        report_key: reportKey,
        source_basis: "ar_movement_as_of_date",
        summary: {
          document_count: 50,
          customer_count: 12,
          ar_increase_amount: 10_000,
          ar_decrease_amount: 4_000,
          receipt_amount: 2_000,
          net_movement_amount: 4_000,
          top_customer_name: "ลูกค้า A",
        },
        top_customers: [],
        top_documents: [],
      } as unknown as ReportSnapshot;
    case "ar_debt_receipt":
      return {
        ...base,
        report_key: reportKey,
        source_basis: "ar_debt_receipt_doc_date",
        summary: {
          receipt_count: 3,
          customer_count: 2,
          total_received_amount: 2500,
          cash_amount: 500,
          transfer_amount: 2000,
          unmatched_payment_count: 0,
          top_customer_name: "ลูกค้า A",
        },
        top_customers: [],
        top_receipts: [],
        data_quality_notes: [],
      } as unknown as ReportSnapshot;
    case "cash_bank_receipts":
    case "cash_bank_payments":
      return {
        ...base,
        report_key: reportKey,
        source_basis:
          reportKey === "cash_bank_receipts"
            ? "cash_bank_receipts_doc_date"
            : "cash_bank_payments_doc_date",
        direction: reportKey === "cash_bank_receipts" ? "receipt" : "payment",
        summary: {
          document_count: 4,
          party_count: 3,
          total_amount: 5000,
          cash_amount: 1000,
          card_amount: 500,
          chq_amount: 0,
          transfer_amount: 3000,
          total_income_amount: 0,
          coupon_amount: 0,
          petty_cash_amount: 0,
          channel_total_amount: 4500,
          unallocated_amount: 500,
          mismatch_document_count: 1,
          top_party_name: "คู่ค้า A",
          first_doc_time: "08:00",
          last_doc_time: "12:00",
        },
        channel_summary: [],
        trans_flag_summary: [],
        top_documents: [],
        mismatch_documents: [],
        data_quality_notes: [],
      } as unknown as ReportSnapshot;
  }
}

function reconciliation(differenceAmount: number) {
  return {
    header_total_amount: 100_000,
    detail_sum_amount: 100_000 - differenceAmount,
    difference_amount: differenceAmount,
    status: differenceAmount ? "reconciled_with_warning" : "valid",
    note: "fixture",
  };
}
