import { describe, expect, it } from "vitest";
import {
  buildSalesDetailQuery,
  buildSalesDocumentDetailQuery,
  buildSalesDocumentPageQuery,
  buildSalesHeaderQuery,
  buildSalesPdfCountQuery,
  buildSmlBranchListQuery,
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

  it("applies optional time windows without shifting document page params", () => {
    const query = buildSalesDocumentPageQuery(
      {
        date_from: "2026-06-08",
        date_to: "2026-06-08",
        time_from: "00:00",
        time_to: "18:30",
      },
      { page: 2, pageSize: 10, search: "IV" },
    );

    expect(query.text).toContain("substring(h.doc_time::text");
    expect(query.text).toContain("$3::time");
    expect(query.text).toContain("$4::time");
    expect(query.text).toContain("nullif($5::text");
    expect(query.text).toContain("limit $6::int");
    expect(query.text).toContain("offset $7::int");
    expect(query.values).toEqual([
      "2026-06-08",
      "2026-06-08",
      "00:00",
      "18:30",
      "IV",
      10,
      10,
    ]);
  });

  it("uses the approved SML header filters for sale documents", () => {
    const query = buildSalesHeaderQuery({
      date_from: "2026-05-10",
      date_to: "2026-05-19",
    });

    expect(query.text).toContain("h.trans_flag in (44)");
    expect(query.text).toContain("h.last_status = 0");
    expect(query.text).toContain("(coalesce(h.doc_ref, '') = '' or h.is_pos = 0)");
    expect(query.text).toContain("h.is_doc_copy <> 1");
    expect(query.text).toContain("h.doc_ref_date");
    expect(query.text).toContain("cast(h.last_status as varchar) as last_status");
  });

  it("filters detail lines through the approved header set", () => {
    const query = buildSalesDetailQuery({
      date_from: "2026-05-10",
      date_to: "2026-05-19",
    });

    expect(query.text).toContain("with filtered_headers as");
    expect(query.text).toContain("inner join filtered_headers h");
    expect(query.text).toContain("h.doc_date = d.doc_date");
    expect(query.text).toContain("and d.last_status = 0");
    expect(query.text).toContain("coalesce(nullif(d.branch_code, ''), nullif(h.branch_code, ''), 'no_branch')");
    expect(query.text).toContain("left join ic_inventory");
    expect(query.text).toContain("left join ic_unit");
  });

  it("builds a PDF preflight count query before loading full report rows", () => {
    const query = buildSalesPdfCountQuery({
      date_from: "2026-05-10",
      date_to: "2026-05-19",
    });

    expect(query.text).toContain("count(*)::int as document_count");
    expect(query.text).toContain("detail_row_count");
    expect(query.text).toContain("left join lateral");
    expect(query.text).toContain("h.trans_flag in (44)");
    expect(query.text).toContain("h.is_doc_copy <> 1");
    expect(query.values).toEqual(["2026-05-10", "2026-05-19"]);
  });

  it("builds a parameterized document detail query scoped by date and doc_no", () => {
    const query = buildSalesDocumentDetailQuery(
      {
        date_from: "2026-05-10",
        date_to: "2026-05-19",
      },
      "IV-001",
    );

    expect(query.text).toContain("$1::date");
    expect(query.text).toContain("$2::date");
    expect(query.text).toContain("h.doc_no = $3");
    expect(query.text).toContain("h.is_doc_copy <> 1");
    expect(query.values).toEqual(["2026-05-10", "2026-05-19", "IV-001"]);
  });

  it("builds a parameterized document page query with search and pagination", () => {
    const query = buildSalesDocumentPageQuery(
      {
        date_from: "2026-05-10",
        date_to: "2026-05-19",
      },
      {
        page: 2,
        pageSize: 25,
        search: "INV-001",
      },
    );

    expect(query.text).toContain("$1::date");
    expect(query.text).toContain("$2::date");
    expect(query.text).toContain("nullif($3::text, '') is null");
    expect(query.text).toContain("limit $4::int");
    expect(query.text).toContain("offset $5::int");
    expect(query.text).toContain("count(*) over() as total_count");
    expect(query.text).toContain("left join lateral");
    expect(query.text).toContain("h.is_doc_copy <> 1");
    expect(query.values).toEqual([
      "2026-05-10",
      "2026-05-19",
      "INV-001",
      25,
      25,
    ]);
  });

  it("builds the approved SML branch master query", () => {
    const query = buildSmlBranchListQuery();

    expect(query.text).toContain("from erp_branch_list");
    expect(query.text).toContain("code");
    expect(query.text).toContain("name_1");
    expect(query.values).toEqual([]);
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
    expect(snapshot.financial_breakdown).toMatchObject({
      gross_sales: 100,
      total_discount: 0,
      before_vat_amount: 100,
      vat_amount: 7,
      net_sales: 107,
      vat_rate: 7,
    });
    expect(snapshot.reconciliation.detail_sum_amount).toBe(100);
    expect(snapshot.reconciliation.difference_amount).toBe(7);
    expect(snapshot.reconciliation.status).toBe("reconciled_with_warning");
  });

  it("separates gross sales, discount, VAT, and net sales for executive reporting", () => {
    const snapshot = summarizeSalesGoodsServices({
      tenant_id: "tenant_demo_remote",
      run_id: "run_financial_breakdown",
      params: { date_from: "2026-05-10", date_to: "2026-05-10" },
      generated_at: "2026-05-10T01:00:00.000Z",
      source: "sml_postgres",
      headers: [
        {
          rownum: 0,
          doc_date: "2026-05-10",
          doc_no: "INV-1",
          doc_time: "10:00",
          doc_ref: null,
          cust_code: null,
          cust_name: null,
          branch_code: "0000",
          total_value: 1000,
          total_discount: 100,
          total_except_discount: 900,
          total_except_vat: 841.12,
          vat_rate: 7,
          total_vat_value: 58.88,
          vat_type: "I",
          total_amount: 900,
          cashier_code: null,
        },
        {
          rownum: 0,
          doc_date: "2026-05-10",
          doc_no: "INV-2",
          doc_time: "11:00",
          doc_ref: null,
          cust_code: null,
          cust_name: null,
          branch_code: "0000",
          total_value: 500,
          total_discount: 0,
          total_except_discount: 500,
          total_except_vat: 467.29,
          vat_rate: 7,
          total_vat_value: 32.71,
          vat_type: "I",
          total_amount: 500,
          cashier_code: null,
        },
      ],
      details: [],
      branches: [{ code: "0000", name_1: "สำนักงาน" }],
    });

    expect(snapshot.financial_breakdown).toEqual({
      gross_sales: 1500,
      total_discount: 100,
      after_discount_amount: 1400,
      before_vat_amount: 1308.41,
      vat_amount: 91.59,
      net_sales: 1400,
      discount_percent: 6.667,
      vat_rate: 7,
      document_count_with_discount: 1,
    });
    expect(snapshot.branch_sales[0]).toMatchObject({
      branch_code: "0000",
      branch_label: "สำนักงาน",
      branch_name: "สำนักงาน",
      branch_note: "ชื่อสาขาจาก erp_branch_list (0000)",
    });
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
      branch_label: "สาขาหลัก (000)",
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
          item_name: "เหล็กข้ออ้อย SD40 12มม(4หุน) (8.88KG)-พับ น้ำเงิน 10ม.",
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
    expect(preview.flex_message?.altText).toContain("ขายสินค้าและบริการ");
    expect(preview.flex_message?.altText).not.toContain("token=");
    expect(preview.text).toContain("บริษัท: Demo Remote");
    expect(preview.text).toContain(
      "วันที่ข้อมูล: 10/05/2026 00:00 - 19/05/2026 23:59",
    );
    expect(preview.text).toContain("ยอดขายสุทธิ: 107.00 บาท");
    expect(preview.text).toContain("1. สาขาหลัก (0000): 107.00 บาท");
    expect(preview.text).toContain(
      "เหล็กข้ออ้อย SD40 12มม(4หุน) (8.88KG)-พับ น้ำเงิน 10ม.",
    );
    expect(preview.text).not.toContain("AI Business Center");
    expect(preview.text).not.toContain("Run ID: run_line_preview");
    expect(preview.text).not.toContain("token=signed-token");
    expect(JSON.stringify(preview.flex_message)).toContain(dashboardUrl);
    const flexPayload = JSON.stringify(preview.flex_message);
    expect(flexPayload).toContain("เปิดรายละเอียด");
    expect(flexPayload).toContain("เหล็กข้ออ้อย SD40 12มม(4หุน) (8.88KG)…");
    expect(flexPayload).not.toContain(
      "เหล็กข้ออ้อย SD40 12มม(4หุน) (8.88KG)-พับ น้ำเงิน 10ม.",
    );
    expect(flexPayload).not.toContain("branch_code");
    expect(flexPayload).not.toContain("ic_trans");
    expect(flexPayload).not.toContain("snapshot");
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

  it("renders a hybrid report-card Flex empty state without alarm wording", () => {
    const snapshot = createEmptySalesGoodsServicesSnapshot({
      tenant_id: "tenant_demo_remote",
      run_id: "empty_line_preview",
      params: { date_from: "2026-05-19", date_to: "2026-05-19" },
      generated_at: "2026-05-20T01:45:00.000Z",
    });
    snapshot.comparison = {
      previous_day: {
        label: "previous_day",
        date_from: "2026-05-18",
        date_to: "2026-05-18",
        total_sales: 6161.1,
        document_count: 4,
        difference_amount: -6161.1,
        difference_percent: -100,
        direction: "down",
      },
      same_weekday_last_week: null,
    };

    const preview = renderSalesGoodsServicesLinePreview({
      snapshot,
      dashboardUrl:
        "https://example.test/command-center/brief?tenant_id=tenant_demo_remote&run_id=empty_line_preview&token=signed-token",
      tenantName: "Demo Remote",
    });
    const flexJson = JSON.stringify(preview.flex_message);

    expect(preview.line_message_type).toBe("flex");
    expect(preview.flex_message?.altText).toContain("ไม่พบยอดขาย");
    expect(flexJson).toContain("วันนี้ควรรู้อะไร");
    expect(flexJson).toContain(
      "ต่ำกว่าวันก่อนหน้า ซึ่งมียอดขาย 6,161.10 บาท จาก 4 บิล",
    );
    expect(flexJson).toContain("บิลขาย");
    expect(flexJson).toContain("รายการขาย");
    expect(flexJson).toContain("เปิดรายละเอียด");
    expect(flexJson).not.toContain("-100%");
    expect(flexJson).not.toContain("สิ่งที่ควรตรวจ");
    expect(flexJson).not.toContain("ยังไม่มีข้อมูลสาขา");
    expect(flexJson).not.toContain("ยังไม่มีสินค้า");
    expect(flexJson).not.toContain("branch_code");
    expect(flexJson).not.toContain("ic_trans");
    expect(flexJson).not.toContain("snapshot");
    expect(preview.text).toContain("วันนี้ควรรู้อะไร");
    expect(preview.text).toContain("จำนวนรายการขาย: 0 รายการ");
    expect(preview.text).toContain("ยอดขายตามสาขา");
    expect(preview.text).toContain("สินค้าขายดี");
    expect(preview.text).not.toContain("token=signed-token");
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
