import { describe, expect, it } from "vitest";
import {
  buildPurchaseDetailQuery,
  buildPurchaseDocumentDetailQuery,
  buildPurchaseDocumentPageQuery,
  buildPurchaseHeaderQuery,
  buildPurchasePdfCountQuery,
  renderPurchaseGoodsPayablesLinePreview,
  summarizePurchaseGoodsPayables,
  validatePurchaseGoodsPayablesParams,
} from "./purchase-goods-payables.js";

describe("purchase_goods_payables contract", () => {
  it("rejects invalid date ranges", () => {
    expect(() =>
      validatePurchaseGoodsPayablesParams({
        date_from: "2026-05-21",
        date_to: "2026-05-01",
      }),
    ).toThrow("date_from");
  });

  it("uses the approved SML header filters for purchase/payable documents", () => {
    const query = buildPurchaseHeaderQuery({
      date_from: "2026-05-01",
      date_to: "2026-05-21",
    });

    expect(query.text).toContain("$1::date");
    expect(query.text).toContain("$2::date");
    expect(query.text).toContain("h.trans_flag in (12)");
    expect(query.text).toContain("h.last_status = 0");
    expect(query.text).toContain("h.is_doc_copy <> 1");
    expect(query.text).toContain("left join ap_supplier");
    expect(query.values).toEqual(["2026-05-01", "2026-05-21"]);
  });

  it("filters detail rows through the approved purchase header set", () => {
    const query = buildPurchaseDetailQuery({
      date_from: "2026-05-01",
      date_to: "2026-05-21",
    });

    expect(query.text).toContain("with filtered_headers as");
    expect(query.text).toContain("h.trans_flag in (12)");
    expect(query.text).toContain("inner join filtered_headers h");
    expect(query.text).toContain("and h.trans_flag = d.trans_flag");
    expect(query.text).toContain("left join ic_inventory");
    expect(query.text).toContain("left join ic_unit");
    expect(query.values).toEqual(["2026-05-01", "2026-05-21"]);
  });

  it("builds a PDF preflight count query before loading full purchase rows", () => {
    const query = buildPurchasePdfCountQuery({
      date_from: "2026-05-01",
      date_to: "2026-05-21",
    });

    expect(query.text).toContain("count(*)::int as document_count");
    expect(query.text).toContain("detail_row_count");
    expect(query.text).toContain("left join lateral");
    expect(query.text).toContain("h.trans_flag in (12)");
    expect(query.text).toContain("h.is_doc_copy <> 1");
    expect(query.values).toEqual(["2026-05-01", "2026-05-21"]);
  });

  it("builds parameterized document detail and page queries", () => {
    const params = { date_from: "2026-05-01", date_to: "2026-05-21" };
    const detail = buildPurchaseDocumentDetailQuery(params, "PU-001");
    const page = buildPurchaseDocumentPageQuery(params, {
      page: 2,
      pageSize: 25,
      search: "vendor",
    });

    expect(detail.text).toContain("h.doc_no = $3");
    expect(detail.text).toContain("h.is_doc_copy <> 1");
    expect(detail.values).toEqual(["2026-05-01", "2026-05-21", "PU-001"]);
    expect(page.text).toContain("nullif($3::text, '') is null");
    expect(page.text).toContain("limit $4::int");
    expect(page.text).toContain("offset $5::int");
    expect(page.text).toContain("count(*) over() as total_count");
    expect(page.values).toEqual(["2026-05-01", "2026-05-21", "vendor", 25, 25]);
  });

  it("applies optional time windows before document query params", () => {
    const params = {
      date_from: "2026-06-08",
      date_to: "2026-06-08",
      time_from: "00:00",
      time_to: "18:30",
    };
    const detail = buildPurchaseDocumentDetailQuery(params, "PU-001");
    const page = buildPurchaseDocumentPageQuery(params, {
      page: 2,
      pageSize: 25,
      search: "vendor",
    });

    expect(detail.text).toContain("h.doc_no = $5");
    expect(detail.values).toEqual([
      "2026-06-08",
      "2026-06-08",
      "00:00",
      "18:30",
      "PU-001",
    ]);
    expect(page.text).toContain("nullif($5::text");
    expect(page.text).toContain("limit $6::int");
    expect(page.text).toContain("offset $7::int");
    expect(page.values).toEqual([
      "2026-06-08",
      "2026-06-08",
      "00:00",
      "18:30",
      "vendor",
      25,
      25,
    ]);
  });

  it("summarizes header truth, suppliers, products, and reconciliation separately", () => {
    const snapshot = summarizePurchaseGoodsPayables({
      tenant_id: "tenant_demo_remote",
      run_id: "run_purchase",
      params: { date_from: "2026-05-01", date_to: "2026-05-21" },
      generated_at: "2026-05-21T01:00:00.000Z",
      source: "sml_postgres",
      branches: [{ code: "0000", name_1: "สาขาหลัก" }],
      headers: [
        {
          rownum: 0,
          doc_date: "2026-05-02",
          doc_no: "PU-1",
          doc_time: "10:00",
          doc_ref: null,
          cust_code: "AP001",
          cust_name: "ผู้จำหน่าย A",
          branch_code: "0000",
          total_value: 1000,
          total_discount: 100,
          total_except_discount: 900,
          total_except_vat: 900,
          vat_rate: 7,
          total_vat_value: 63,
          vat_type: "I",
          total_amount: 963,
          cashier_code: "BUYER",
        },
        {
          rownum: 0,
          doc_date: "2026-05-03",
          doc_no: "PU-2",
          doc_time: "11:00",
          doc_ref: null,
          cust_code: "AP002",
          cust_name: "ผู้จำหน่าย B",
          branch_code: "",
          total_value: 500,
          total_discount: 0,
          total_except_discount: 500,
          total_except_vat: 500,
          vat_rate: 7,
          total_vat_value: 35,
          vat_type: "I",
          total_amount: 535,
          cashier_code: "BUYER",
        },
      ],
      details: [
        {
          doc_date: "2026-05-02",
          doc_no: "PU-1",
          doc_time: "10:00",
          cust_code: "AP001",
          cust_name: "ผู้จำหน่าย A",
          branch_code: "0000",
          item_code: "SKU-1",
          item_name: "สินค้า A",
          wh_code: "MAIN",
          shelf_code: null,
          unit_code: "ชิ้น",
          qty: 10,
          price: 90,
          discount: null,
          discount_amount: 0,
          sum_amount: 900,
          vat_type: "I",
        },
        {
          doc_date: "2026-05-03",
          doc_no: "PU-2",
          doc_time: "11:00",
          cust_code: "AP002",
          cust_name: "ผู้จำหน่าย B",
          branch_code: "",
          item_code: "SKU-2",
          item_name: "สินค้า B",
          wh_code: "MAIN",
          shelf_code: null,
          unit_code: "ชิ้น",
          qty: 5,
          price: 100,
          discount: null,
          discount_amount: 0,
          sum_amount: 500,
          vat_type: "I",
        },
      ],
    });

    expect(snapshot.report_key).toBe("purchase_goods_payables");
    expect(snapshot.summary).toMatchObject({
      total_purchase: 1498,
      document_count: 2,
      line_count: 2,
      total_qty: 15,
      top_supplier_name: "ผู้จำหน่าย A",
      top_product_name: "สินค้า A",
    });
    expect(snapshot.top_suppliers[0]).toMatchObject({
      supplier_code: "AP001",
      supplier_name: "ผู้จำหน่าย A",
      total_amount: 963,
    });
    expect(snapshot.branch_purchases[0]).toMatchObject({
      branch_code: "0000",
      branch_name: "สาขาหลัก",
    });
    expect(snapshot.reconciliation).toMatchObject({
      header_total_amount: 1498,
      detail_sum_amount: 1400,
      difference_amount: 98,
      status: "reconciled_with_warning",
    });
  });

  it("renders a Flex preview with a safe signed report button", () => {
    const snapshot = summarizePurchaseGoodsPayables({
      tenant_id: "tenant_demo_remote",
      run_id: "run_purchase_flex",
      params: { date_from: "2026-05-01", date_to: "2026-05-21" },
      generated_at: "2026-05-21T01:00:00.000Z",
      source: "sml_postgres",
      headers: [],
      details: [],
    });
    const preview = renderPurchaseGoodsPayablesLinePreview({
      snapshot,
      tenantName: "DEMO SHOP",
      dashboardUrl: "https://example.com/command-center/brief?report_key=purchase_goods_payables",
    });

    expect(preview.line_message_type).toBe("flex");
    expect(preview.flex_message?.type).toBe("flex");
    expect(preview.flex_message?.altText).toContain("ซื้อ/ตั้งหนี้");
    expect(preview.text).not.toContain("token=");
    const flexPayload = JSON.stringify(preview.flex_message);
    expect(flexPayload).toContain("เปิดรายละเอียด");
    expect(flexPayload).not.toContain("branch_code");
    expect(flexPayload).not.toContain("ic_trans");
    expect(flexPayload).not.toContain("snapshot");
  });
});
