import { describe, expect, it } from "vitest";
import {
  buildSalesHeaderQuery,
  createEmptySalesGoodsServicesSnapshot,
  normalizeBranchCode,
  renderSalesGoodsServicesLinePreview,
  summarizeSalesGoodsServices,
  validateSalesGoodsServicesParams,
} from "./sales-goods-services.js";

describe("sales_goods_services contract", () => {
  it("rejects invalid dates", () => {
    expect(() =>
      validateSalesGoodsServicesParams({
        date_from: "19/05/2026",
        date_to: "2026-05-19",
      }),
    ).toThrow();
  });

  it("rejects date_from later than date_to", () => {
    expect(() =>
      validateSalesGoodsServicesParams({
        date_from: "2026-05-20",
        date_to: "2026-05-19",
      }),
    ).toThrow("date_from");
  });

  it("uses parameterized SQL for report dates", () => {
    const query = buildSalesHeaderQuery({
      date_from: "2026-05-10",
      date_to: "2026-05-19",
    });
    expect(query.text).toContain("$1::date");
    expect(query.text).toContain("$2::date");
    expect(query.values).toEqual(["2026-05-10", "2026-05-19"]);
  });

  it("returns valid zero summary for empty results", () => {
    const snapshot = createEmptySalesGoodsServicesSnapshot({
      tenant_id: "tenant_demo_remote",
      run_id: "run_empty",
      params: { date_from: "2026-05-10", date_to: "2026-05-19" },
      generated_at: "2026-05-19T01:00:00.000Z",
    });

    expect(snapshot.summary.total_sales).toBe(0);
    expect(snapshot.summary.document_count).toBe(0);
    expect(snapshot.reconciliation.status).toBe("stale");
  });

  it("falls back from detail branch to header branch to no_branch", () => {
    expect(normalizeBranchCode("", "0000")).toBe("0000");
    expect(normalizeBranchCode(null, "")).toBe("no_branch");
    expect(normalizeBranchCode("001", "0000")).toBe("001");
  });

  it("keeps header financial truth and detail analytics separate", () => {
    const snapshot = summarizeSalesGoodsServices({
      tenant_id: "tenant_demo_remote",
      run_id: "run_reconcile",
      params: { date_from: "2026-05-10", date_to: "2026-05-19" },
      generated_at: "2026-05-19T01:00:00.000Z",
      source: "sml_postgres",
      headers: [
        {
          rownum: 0,
          doc_date: "2026-05-12",
          doc_no: "INV-1",
          doc_time: "10:00",
          doc_ref: null,
          cust_code: "AR00001",
          cust_name: "Cash",
          branch_code: "0000",
          total_value: 100,
          total_discount: 0,
          total_except_discount: 100,
          total_except_vat: 0,
          vat_rate: 7,
          total_vat_value: 7,
          vat_type: "I",
          total_amount: 107,
          cashier_code: null,
        },
      ],
      details: [
        {
          doc_date: "2026-05-12",
          doc_no: "INV-1",
          doc_time: "10:00",
          cust_code: "AR00001",
          cust_name: "Cash",
          branch_code: "",
          item_code: "SKU-1",
          item_name: "Product",
          wh_code: "MAIN",
          shelf_code: null,
          unit_code: "ชิ้น",
          qty: 2,
          price: 50,
          discount: null,
          discount_amount: 0,
          sum_amount: 100,
          vat_type: "I",
        },
      ],
    });

    expect(snapshot.summary.total_sales).toBe(107);
    expect(snapshot.reconciliation.detail_sum_amount).toBe(100);
    expect(snapshot.reconciliation.difference_amount).toBe(7);
    expect(snapshot.reconciliation.status).toBe("reconciled_with_warning");
  });

  it("assigns document sales to detail branch when header branch is blank", () => {
    const snapshot = summarizeSalesGoodsServices({
      tenant_id: "tenant_office_sml1_2026",
      run_id: "run_branch_fallback",
      params: { date_from: "2026-05-10", date_to: "2026-05-19" },
      generated_at: "2026-05-19T01:00:00.000Z",
      source: "sml_postgres",
      headers: [
        {
          rownum: 0,
          doc_date: "2026-05-10",
          doc_no: "INV-1",
          doc_time: "11:00",
          doc_ref: null,
          cust_code: "AR00004",
          cust_name: "Customer",
          branch_code: "",
          total_value: 100,
          total_discount: 0,
          total_except_discount: 100,
          total_except_vat: 0,
          vat_rate: 7,
          total_vat_value: 7,
          vat_type: "I",
          total_amount: 107,
          cashier_code: null,
        },
      ],
      details: [
        {
          doc_date: "2026-05-10",
          doc_no: "INV-1",
          doc_time: "11:00",
          cust_code: "AR00004",
          cust_name: "Customer",
          branch_code: "000",
          item_code: "CON-01000",
          item_name: "Product",
          wh_code: "WH-01",
          shelf_code: "SH-01",
          unit_code: "ถุง",
          qty: 1,
          price: 100,
          discount: null,
          discount_amount: 0,
          sum_amount: 100,
          vat_type: "I",
        },
      ],
    });

    expect(snapshot.branch_sales[0]).toMatchObject({
      branch_code: "000",
      total_amount: 107,
      document_count: 1,
      line_count: 1,
    });
  });

  it("renders LINE preview as Flex with branch, top product, and report button", () => {
    const snapshot = summarizeSalesGoodsServices({
      tenant_id: "tenant_demo_remote",
      run_id: "run_line_preview",
      params: { date_from: "2026-05-10", date_to: "2026-05-19" },
      generated_at: "2026-05-19T01:00:00.000Z",
      source: "sml_postgres",
      headers: [
        {
          rownum: 0,
          doc_date: "2026-05-10",
          doc_no: "INV-1",
          doc_time: "11:00",
          doc_ref: null,
          cust_code: "AR00001",
          cust_name: "Cash",
          branch_code: "0000",
          total_value: 100,
          total_discount: 0,
          total_except_discount: 100,
          total_except_vat: 0,
          vat_rate: 7,
          total_vat_value: 7,
          vat_type: "I",
          total_amount: 107,
          cashier_code: null,
        },
      ],
      details: [
        {
          doc_date: "2026-05-10",
          doc_no: "INV-1",
          doc_time: "11:00",
          cust_code: "AR00001",
          cust_name: "Cash",
          branch_code: "0000",
          item_code: "SKU-1",
          item_name: "Product A",
          wh_code: "MAIN",
          shelf_code: null,
          unit_code: "ชิ้น",
          qty: 1,
          price: 100,
          discount: null,
          discount_amount: 0,
          sum_amount: 100,
          vat_type: "I",
        },
      ],
    });

    const dashboardUrl = "http://localhost:3000/command-center/brief?tenant_id=tenant_demo_remote&run_id=run_line_preview&token=signed-token";
    const preview = renderSalesGoodsServicesLinePreview({
      snapshot,
      dashboardUrl,
      tenantName: "Demo Remote",
    });

    expect(preview.line_message_type).toBe("flex");
    expect(preview.flex_message).toBeTruthy();
    expect(preview.flex_message?.type).toBe("flex");
    expect(preview.flex_message?.altText).toContain("รายงานขาย");
    expect(preview.flex_message?.altText).not.toContain("token=");
    expect(preview.text).toContain("บริษัท: Demo Remote");
    expect(preview.text).toContain("วันที่ข้อมูล: 10 พ.ค. 2026 - 19 พ.ค. 2026");
    expect(preview.text).toContain("ยอดขายสุทธิ: 107.00 บาท");
    expect(preview.text).toContain("1. สาขา 0000: 107.00 บาท");
    expect(preview.text).toContain("Product A");
    expect(preview.text).not.toContain("AI Business Center");
    expect(preview.text).not.toContain("Run ID: run_line_preview");
    expect(preview.text).not.toContain("token=signed-token");
    expect(JSON.stringify(preview.flex_message)).toContain(dashboardUrl);
    expect(JSON.stringify(preview.flex_message)).toContain("เปิดรายงาน");
  });

  it("falls back to text when the signed viewer URL is missing or too long", () => {
    const snapshot = createEmptySalesGoodsServicesSnapshot({
      tenant_id: "tenant_demo_remote",
      run_id: "sample_line_preview",
      params: { date_from: "2026-05-19", date_to: "2026-05-19" },
      generated_at: "2026-05-20T01:00:00.000Z",
    });

    const missingUrlPreview = renderSalesGoodsServicesLinePreview({
      snapshot,
      dashboardUrl: null,
      tenantName: "Demo Remote",
    });
    const longUrlPreview = renderSalesGoodsServicesLinePreview({
      snapshot,
      dashboardUrl: `https://example.test/${"a".repeat(1100)}`,
      tenantName: "Demo Remote",
    });

    expect(missingUrlPreview.line_message_type).toBe("text");
    expect(missingUrlPreview.flex_message).toBeUndefined();
    expect(missingUrlPreview.text).toContain("เปิดรายงาน: ยังไม่พร้อมใช้งาน");
    expect(longUrlPreview.line_message_type).toBe("text");
    expect(longUrlPreview.flex_message).toBeUndefined();
  });

  it("labels sample snapshot safely in LINE preview", () => {
    const snapshot = createEmptySalesGoodsServicesSnapshot({
      tenant_id: "tenant_demo_remote",
      run_id: "sample_line_preview",
      params: { date_from: "2026-05-10", date_to: "2026-05-19" },
      generated_at: "2026-05-19T01:00:00.000Z",
    });

    const preview = renderSalesGoodsServicesLinePreview({ snapshot });

    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ข้อมูลตัวอย่าง"),
        expect.stringContaining("ไม่พบยอดขาย"),
      ]),
    );
  });
});
