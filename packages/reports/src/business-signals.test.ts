import { describe, expect, it } from "vitest";
import {
  buildBusinessSignalDigestPreview,
  buildBusinessSignalsForSnapshots,
  buildReportFailureBusinessSignal,
  selectPriorityBusinessSignals,
} from "./business-signals.js";
import { summarizeGrossProfitByProduct } from "./gross-profit.js";
import { summarizePurchaseGoodsPayables } from "./purchase-goods-payables.js";
import { summarizeSalesGoodsServices } from "./sales-goods-services.js";

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

  it("limits the action digest to three priority signals and keeps Flex copy non-technical", () => {
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
    const priority = selectPriorityBusinessSignals(signals, 3);
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

    expect(priority).toHaveLength(3);
    expect(preview?.line_message_type).toBe("flex");
    expect(flexPayload).toContain("เปิดรายละเอียด");
    expect(flexPayload).not.toContain("branch_code");
    expect(flexPayload).not.toContain("ic_trans");
    expect(flexPayload).not.toContain("snapshot");
  });
});
