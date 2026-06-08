import { describe, expect, it } from "vitest";
import {
  buildBusinessSignalDigestPreview,
  buildBusinessSignalsForSnapshots,
  buildReportFailureBusinessSignal,
  selectBusinessSignalDigestIssues,
} from "./business-signals.js";
import {
  summarizeGrossProfitByArCustomer,
  summarizeGrossProfitByProduct,
} from "./gross-profit.js";
import { summarizePurchaseGoodsPayables } from "./purchase-goods-payables.js";
import { summarizeSalesGoodsServices } from "./sales-goods-services.js";
import { summarizeStockBalance } from "./stock-balance.js";

const generatedAt = "2026-06-02T08:00:00.000Z";
const params = { date_from: "2026-06-01", date_to: "2026-06-01" };
const tenantId = "tenant_demo_remote";

describe("business signal engine", () => {
  it("creates deterministic profit and data quality signals from report snapshots", () => {
    const grossSnapshot = summarizeGrossProfitByProduct({
      tenant_id: tenantId,
      run_id: "run_gross_product_signal",
      params,
      generated_at: generatedAt,
      source: "sml_javaws",
      rows: [
        {
          code: "SKU-LOSS",
          name_1: "สินค้ากำไรติดลบ",
          unit_name: "PCS(ชิ้น)",
          qty_sale: 10,
          amount_sale: 1000,
          cost_sale: 990,
          qty_sale_return: 0,
          amount_sale_return: 0,
          cost_sale_return: 0,
          net_qty: 0,
          net_amount: 0,
          net_cost: 0,
          gross_profit: 0,
          gross_margin_percent: null,
        },
        {
          code: "SKU-NEGATIVE",
          name_1: "สินค้าขาดทุน",
          unit_name: "PCS(ชิ้น)",
          qty_sale: 1,
          amount_sale: 100,
          cost_sale: 150,
          qty_sale_return: 0,
          amount_sale_return: 0,
          cost_sale_return: 0,
          net_qty: 0,
          net_amount: 0,
          net_cost: 0,
          gross_profit: 0,
          gross_margin_percent: null,
        },
      ],
    });

    const signals = buildBusinessSignalsForSnapshots({
      snapshots: [grossSnapshot],
      now: generatedAt,
    });

    expect(signals.map((signal) => signal.signal_key)).toEqual([
      "gross_profit_by_product:negative_total_gross_profit",
      "gross_profit_by_product:negative_rows",
      "gross_profit_by_product:low_margin",
    ]);
    expect(signals[0]).toMatchObject({
      category: "profit",
      severity: "critical",
      amount_impact: 40,
      source_report_key: "gross_profit_by_product",
      source_run_id: "run_gross_product_signal",
      rule_version: "business_signals_v1",
    });
  });

  it("builds data quality signal for a failed report instead of fake business insight", () => {
    const signal = buildReportFailureBusinessSignal({
      tenant_id: tenantId,
      report_key: "sales_goods_services",
      run_id: "run_sales_failed",
      period_from: params.date_from,
      period_to: params.date_to,
      safe_error_message: "SML JavaWS timeout",
      now: generatedAt,
    });

    expect(signal).toMatchObject({
      category: "data_quality",
      severity: "critical",
      title: "รายงานรันไม่สำเร็จ",
      source_report_key: "sales_goods_services",
    });
    expect(JSON.stringify(signal)).not.toContain("secret");
  });

  it("does not create stock balance business signals while the catalog capability is disabled", () => {
    const stockSnapshot = summarizeStockBalance({
      tenant_id: tenantId,
      run_id: "run_stock_signal_disabled",
      params,
      generated_at: generatedAt,
      source: "sml_javaws",
      rows: [
        {
          ic_code: "SKU-NEG",
          ic_name: "สินค้าติดลบ",
          ic_unit_code: "PCS",
          balance_qty: -10,
          average_cost: 0,
          average_cost_end: 0,
          balance_amount: -100,
          qty_in: 0,
          amount_in: 0,
          average_cost_in: 0,
          qty_out: 10,
          amount_out: 100,
          average_cost_out: 10,
        },
      ],
    });

    const signals = buildBusinessSignalsForSnapshots({
      snapshots: [stockSnapshot],
      now: generatedAt,
    });

    expect(signals).toEqual([]);
  });

  it("honors tenant threshold overrides for no-sales and missing branch signals", () => {
    const emptySalesSnapshot = summarizeSalesGoodsServices({
      tenant_id: tenantId,
      run_id: "run_sales_empty_threshold",
      params,
      generated_at: generatedAt,
      source: "sml_javaws",
      headers: [],
      details: [],
      branches: [],
    });
    expect(
      buildBusinessSignalsForSnapshots({
        snapshots: [emptySalesSnapshot],
        now: generatedAt,
        thresholds: { noSalesEnabled: false },
      }).map((signal) => signal.signal_key),
    ).not.toContain("sales:no_sales");

    const missingBranchSnapshot = summarizeSalesGoodsServices({
      tenant_id: tenantId,
      run_id: "run_sales_branch_threshold",
      params,
      generated_at: generatedAt,
      source: "sml_javaws",
      branches: [],
      headers: [
        {
          rownum: 1,
          doc_date: "2026-06-01",
          doc_no: "INV-1",
          doc_time: "10:00",
          doc_ref: null,
          cust_code: "AR-1",
          cust_name: "Cash",
          branch_code: "",
          total_value: 1000,
          total_discount: 0,
          total_except_discount: 1000,
          total_except_vat: 0,
          vat_rate: 7,
          total_vat_value: 70,
          vat_type: "I",
          total_amount: 1070,
          cashier_code: null,
        },
      ],
      details: [
        {
          doc_date: "2026-06-01",
          doc_no: "INV-1",
          doc_time: "10:00",
          cust_code: "AR-1",
          cust_name: "Cash",
          branch_code: "",
          item_code: "SKU-1",
          item_name: "Product",
          wh_code: "MAIN",
          shelf_code: null,
          unit_code: "ชิ้น",
          qty: 1,
          price: 1000,
          discount: null,
          discount_amount: 0,
          sum_amount: 1000,
          vat_type: "I",
        },
      ],
    });

    expect(
      buildBusinessSignalsForSnapshots({
        snapshots: [missingBranchSnapshot],
        now: generatedAt,
        thresholds: { missingBranchAmount: 2000 },
      }).map((signal) => signal.signal_key),
    ).not.toContain("sales:missing_branch");
    expect(
      buildBusinessSignalsForSnapshots({
        snapshots: [missingBranchSnapshot],
        now: generatedAt,
        thresholds: { missingBranchAmount: 100 },
      }).map((signal) => signal.signal_key),
    ).toContain("sales:missing_branch");
  });

  it("groups duplicate negative profit signals into one owner-level digest issue", () => {
    const productSnapshot = summarizeGrossProfitByProduct({
      tenant_id: tenantId,
      run_id: "run_gross_product_duplicate",
      params,
      generated_at: generatedAt,
      source: "sml_javaws",
      rows: [
        grossProfitProductRow({
          amount_sale: 1000,
          cost_sale: 84389.09,
          name_1: "สินค้าขาดทุนหนัก",
        }),
      ],
    });
    const arSnapshot = summarizeGrossProfitByArCustomer({
      tenant_id: tenantId,
      run_id: "run_gross_ar_duplicate",
      params,
      generated_at: generatedAt,
      source: "sml_javaws",
      rows: [
        grossProfitArRow({
          amount_sale: 1000,
          cost_sale: 86663.06,
          ar_detail: "ลูกหนี้ขาดทุนหนัก",
        }),
      ],
    });
    const signals = buildBusinessSignalsForSnapshots({
      snapshots: [productSnapshot, arSnapshot],
      now: generatedAt,
    });
    const selection = selectBusinessSignalDigestIssues(signals);
    const profitIssue = selection.issues.find(
      (issue) => issue.issue_key === "profit_negative",
    );

    expect(selection.allIssueKeys.filter((key) => key === "profit_negative")).toHaveLength(1);
    expect(profitIssue).toMatchObject({
      title: "กำไรติดลบ",
      severity: "critical",
      amount_impact: 85663.06,
      source_report_keys: [
        "gross_profit_by_ar_customer",
        "gross_profit_by_product",
      ],
    });
    expect(profitIssue?.raw_signal_keys).toEqual(
      expect.arrayContaining([
        "gross_profit_by_product:negative_total_gross_profit",
        "gross_profit_by_ar_customer:negative_rows",
      ]),
    );
  });

  it("filters small negative profit issues from the digest by tenant threshold without deleting raw signals", () => {
    const grossSnapshot = summarizeGrossProfitByProduct({
      tenant_id: tenantId,
      run_id: "run_gross_small_negative",
      params,
      generated_at: generatedAt,
      source: "sml_javaws",
      rows: [
        grossProfitProductRow({
          amount_sale: 100,
          cost_sale: 137.06,
          name_1: "สินค้าขาดทุนเล็ก",
        }),
      ],
    });
    const signals = buildBusinessSignalsForSnapshots({
      snapshots: [grossSnapshot],
      now: generatedAt,
    });
    const selection = selectBusinessSignalDigestIssues(signals, {
      thresholds: { negativeGrossProfitAmount: 1000 },
    });

    expect(signals.map((signal) => signal.signal_key)).toEqual(
      expect.arrayContaining([
        "gross_profit_by_product:negative_total_gross_profit",
        "gross_profit_by_product:negative_rows",
      ]),
    );
    expect(selection.totalIssueCount).toBe(0);
    expect(selection.issues).toHaveLength(0);
  });

  it("groups only permission-filtered signals so inaccessible profit reports do not leak into digest issues", () => {
    const productSnapshot = summarizeGrossProfitByProduct({
      tenant_id: tenantId,
      run_id: "run_gross_product_permission",
      params,
      generated_at: generatedAt,
      source: "sml_javaws",
      rows: [
        grossProfitProductRow({
          amount_sale: 1000,
          cost_sale: 3000,
          name_1: "สินค้าห้ามเห็น",
        }),
      ],
    });
    const arSnapshot = summarizeGrossProfitByArCustomer({
      tenant_id: tenantId,
      run_id: "run_gross_ar_permission",
      params,
      generated_at: generatedAt,
      source: "sml_javaws",
      rows: [
        grossProfitArRow({
          amount_sale: 1000,
          cost_sale: 4000,
          ar_detail: "ลูกหนี้ที่เห็นได้",
        }),
      ],
    });
    const signals = buildBusinessSignalsForSnapshots({
      snapshots: [productSnapshot, arSnapshot],
      now: generatedAt,
    });
    const allowedSignals = signals.filter(
      (signal) => signal.source_report_key === "gross_profit_by_ar_customer",
    );
    const selection = selectBusinessSignalDigestIssues(allowedSignals);

    expect(selection.issues[0]).toMatchObject({
      issue_key: "profit_negative",
      source_report_keys: ["gross_profit_by_ar_customer"],
    });
    expect(selection.issues[0]?.raw_signal_keys.join("|")).not.toContain(
      "gross_profit_by_product",
    );
  });

  it("renders summary plus at most two issue cards and keeps Flex copy non-technical", () => {
    const salesSnapshot = summarizeSalesGoodsServices({
      tenant_id: tenantId,
      run_id: "run_sales_signal",
      params,
      generated_at: generatedAt,
      source: "sml_javaws",
      headers: [],
      details: [],
      branches: [],
    });
    const purchaseSnapshot = summarizePurchaseGoodsPayables({
      tenant_id: tenantId,
      run_id: "run_purchase_signal",
      params,
      generated_at: generatedAt,
      source: "sml_javaws",
      headers: [
        {
          rownum: 1,
          doc_date: "2026-06-01",
          doc_no: "PU-1",
          doc_time: null,
          doc_ref: null,
          cust_code: "SUP-1",
          cust_name: "ผู้จำหน่ายหลักชื่อยาวมากที่ควรถูกย่อก่อนเข้า LINE",
          branch_code: null,
          total_value: 1000,
          total_discount: 0,
          total_except_discount: 1000,
          total_except_vat: 1000,
          vat_rate: 7,
          total_vat_value: 70,
          vat_type: null,
          total_amount: 1070,
          cashier_code: null,
          last_status: "0",
        },
      ],
      details: [],
      branches: [],
    });
    const grossSnapshot = summarizeGrossProfitByProduct({
      tenant_id: tenantId,
      run_id: "run_gross_signal",
      params,
      generated_at: generatedAt,
      source: "sml_javaws",
      rows: [
        {
          code: "SKU-1",
          name_1: "สินค้ามาร์จิ้นต่ำ",
          unit_name: "PCS(ชิ้น)",
          qty_sale: 1,
          amount_sale: 1000,
          cost_sale: 990,
          qty_sale_return: 0,
          amount_sale_return: 0,
          cost_sale_return: 0,
          net_qty: 0,
          net_amount: 0,
          net_cost: 0,
          gross_profit: 0,
          gross_margin_percent: null,
        },
      ],
    });
    const signals = buildBusinessSignalsForSnapshots({
      snapshots: [salesSnapshot, purchaseSnapshot, grossSnapshot],
      now: generatedAt,
    });
    const selection = selectBusinessSignalDigestIssues(signals);
    const preview = buildBusinessSignalDigestPreview({
      tenantName: "Demo Shop",
      signals,
      dashboardUrls: {
        sales_goods_services: "https://example.com/sales",
        purchase_goods_payables: "https://example.com/purchase",
        gross_profit_by_product: "https://example.com/gross",
      },
    });
    const flexPayload = JSON.stringify(preview?.flex_message);
    const carousel = preview?.flex_message?.contents as
      | { contents?: unknown[] }
      | undefined;

    expect(selection.issues).toHaveLength(2);
    expect(carousel?.contents).toHaveLength(3);
    expect(preview?.line_message_type).toBe("flex");
    expect(preview?.flex_message?.altText.length).toBeLessThanOrEqual(300);
    expect(flexPayload).toContain("วันนี้มี");
    expect(flexPayload).toContain("เปิดภาพรวม");
    expect(flexPayload).toContain("เปิดรายละเอียด");
    expect(flexPayload).not.toContain("branch_code");
    expect(flexPayload).not.toContain("ic_trans");
    expect(flexPayload).not.toContain("snapshot");
  });
});

function grossProfitProductRow(input: {
  amount_sale: number;
  cost_sale: number;
  name_1: string;
}) {
  return {
    code: "SKU-TEST",
    name_1: input.name_1,
    unit_name: "PCS(ชิ้น)",
    qty_sale: 1,
    amount_sale: input.amount_sale,
    cost_sale: input.cost_sale,
    qty_sale_return: 0,
    amount_sale_return: 0,
    cost_sale_return: 0,
    net_qty: 0,
    net_amount: 0,
    net_cost: 0,
    gross_profit: 0,
    gross_margin_percent: null,
  };
}

function grossProfitArRow(input: {
  amount_sale: number;
  cost_sale: number;
  ar_detail: string;
}) {
  return {
    ar_code: "AR-TEST",
    ar_detail: input.ar_detail,
    qty_sale: 1,
    amount_sale: input.amount_sale,
    cost_sale: input.cost_sale,
    qty_sale_return: 0,
    amount_sale_return: 0,
    cost_sale_return: 0,
    net_qty: 0,
    net_amount: 0,
    net_cost: 0,
    gross_profit: 0,
    gross_margin_percent: null,
  };
}
