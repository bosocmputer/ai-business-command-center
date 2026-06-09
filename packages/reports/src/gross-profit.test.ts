import { describe, expect, it } from "vitest";
import {
  buildGrossProfitByArCustomerQuery,
  buildGrossProfitByProductQuery,
  renderGrossProfitLinePreview,
  summarizeGrossProfitByArCustomer,
  summarizeGrossProfitByProduct,
  validateGrossProfitParams,
} from "./gross-profit.js";

describe("gross profit reports", () => {
  it("validates the shared date range contract", () => {
    expect(() =>
      validateGrossProfitParams({
        date_from: "2026-05-29",
        date_to: "2026-05-01",
      }),
    ).toThrow("date_from");
  });

  it("builds the approved product gross profit SQL with date params", () => {
    const query = buildGrossProfitByProductQuery({
      date_from: "2026-05-01",
      date_to: "2026-05-29",
    });

    expect(query.text).toContain("$1::date");
    expect(query.text).toContain("$2::date");
    expect(query.text).toContain("from ic_trans_detail d");
    expect(query.text).toContain("from ic_inventory i");
    expect(query.text).toContain("left join ic_unit u");
    expect(query.text).toContain("d.item_type <> 5");
    expect(query.text).toContain("d.item_type <> 3");
    expect(query.text).toContain("d.last_status = 0");
    expect(query.text).toContain("d.trans_flag in (44, 46, 48)");
    expect(query.text).toContain("d.inquiry_type in (0, 2)");
    expect(query.text).toContain("nullif(d.divide_value, 0)");
    expect(query.values).toEqual(["2026-05-01", "2026-05-29"]);
  });

  it("builds the approved AR customer gross profit SQL with date params", () => {
    const query = buildGrossProfitByArCustomerQuery({
      date_from: "2026-05-01",
      date_to: "2026-05-29",
    });

    expect(query.text).toContain("with filtered_docs as");
    expect(query.text).toContain("detail_by_doc as");
    expect(query.text).toContain("inner join filtered_docs t");
    expect(query.text).toContain("left join ar_customer c");
    expect(query.text).toContain("group by d.doc_no, d.doc_date, d.trans_flag");
    expect(query.text).toContain("group by coalesce(nullif(t.cust_code, '')");
    expect(query.values).toEqual(["2026-05-01", "2026-05-29"]);
  });

  it("pushes optional time filters through filtered document headers", () => {
    const query = buildGrossProfitByProductQuery({
      date_from: "2026-06-08",
      date_to: "2026-06-08",
      time_from: "00:00",
      time_to: "18:30",
    });

    expect(query.text).toContain("substring(h.doc_time::text");
    expect(query.text).toContain("$3::time");
    expect(query.text).toContain("$4::time");
    expect(query.values).toEqual([
      "2026-06-08",
      "2026-06-08",
      "00:00",
      "18:30",
    ]);
  });

  it("summarizes product gross profit with returns and margin", () => {
    const snapshot = summarizeGrossProfitByProduct({
      tenant_id: "tenant_demo_remote",
      run_id: "run_gp_product",
      params: { date_from: "2026-05-01", date_to: "2026-05-29" },
      generated_at: "2026-06-02T04:00:00.000Z",
      source: "sml_javaws",
      rows: [
        {
          code: "SKU-1",
          name_1: "Product A",
          unit_name: "PCS(ชิ้น)",
          qty_sale: 10,
          amount_sale: 1000,
          cost_sale: 650,
          qty_sale_return: 1,
          amount_sale_return: 100,
          cost_sale_return: 65,
          net_qty: 0,
          net_amount: 0,
          net_cost: 0,
          gross_profit: 0,
          gross_margin_percent: null,
        },
      ],
    });

    expect(snapshot.summary).toMatchObject({
      row_count: 1,
      net_amount: 900,
      net_cost: 585,
      gross_profit: 315,
      gross_margin_percent: 35,
      top_gross_profit_name: "Product A",
    });
    expect(snapshot.rows[0]).toMatchObject({
      net_qty: 9,
      gross_profit: 315,
      gross_margin_percent: 35,
    });
  });

  it("summarizes AR gross profit and warns on negative rows", () => {
    const snapshot = summarizeGrossProfitByArCustomer({
      tenant_id: "tenant_demo_remote",
      run_id: "run_gp_ar",
      params: { date_from: "2026-05-01", date_to: "2026-05-29" },
      generated_at: "2026-06-02T04:00:00.000Z",
      source: "sml_javaws",
      rows: [
        {
          ar_code: "AR-1",
          ar_detail: "Customer A",
          qty_sale: 1,
          amount_sale: 100,
          cost_sale: 120,
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
    const preview = renderGrossProfitLinePreview({
      snapshot,
      tenantName: "DEMO SHOP",
    });

    expect(snapshot.summary.gross_profit).toBe(-20);
    expect(snapshot.summary.gross_margin_percent).toBe(-20);
    expect(snapshot.summary.negative_gross_profit_count).toBe(1);
    expect(preview.text).toContain("รายงานกำไรขั้นต้นลูกหนี้");
    expect(preview.line_message_type).toBe("flex");
    expect(preview.flex_message?.contents).toMatchObject({
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        backgroundColor: "#F8FAFC",
      },
    });
    expect(JSON.stringify(preview.flex_message)).toContain(
      "ยอดรวมเดียวกัน แยกดูตามลูกหนี้",
    );
    expect(JSON.stringify(preview.flex_message)).not.toContain("snapshot");
    expect(JSON.stringify(preview.flex_message)).not.toContain("query");
    expect(preview.warnings).toContain(
      "พบรายการกำไรติดลบ ควรตรวจต้นทุนและเอกสารคืนสินค้า",
    );
  });

  it("does not show a misleading 100% margin when net sales are negative", () => {
    const snapshot = summarizeGrossProfitByProduct({
      tenant_id: "tenant_demo_remote",
      run_id: "run_gp_product_return_only",
      params: { date_from: "2026-06-01", date_to: "2026-06-01" },
      generated_at: "2026-06-02T08:00:00.000Z",
      source: "sml_javaws",
      rows: [
        {
          code: "SKU-RETURN",
          name_1: "Return only",
          unit_name: "PCS(ชิ้น)",
          qty_sale: 0,
          amount_sale: 0,
          cost_sale: 0,
          qty_sale_return: 1,
          amount_sale_return: 1401.87,
          cost_sale_return: 0,
          net_qty: 0,
          net_amount: 0,
          net_cost: 0,
          gross_profit: 0,
          gross_margin_percent: null,
        },
      ],
    });

    const preview = renderGrossProfitLinePreview({
      snapshot,
      tenantName: "DEMO SHOP",
    });

    expect(snapshot.summary.net_amount).toBe(-1401.87);
    expect(snapshot.summary.gross_profit).toBe(-1401.87);
    expect(snapshot.summary.gross_margin_percent).toBeNull();
    expect(preview.text).toContain("อัตรากำไรขั้นต้น: ตรวจสอบ");
    expect(JSON.stringify(preview.flex_message)).toContain("Margin");
  });

  it("keeps the main gross profit amount neutral when only row-level observations exist", () => {
    const snapshot = summarizeGrossProfitByProduct({
      tenant_id: "tenant_demo_remote",
      run_id: "run_gp_product_notice",
      params: { date_from: "2026-06-01", date_to: "2026-06-01" },
      generated_at: "2026-06-02T08:00:00.000Z",
      source: "sml_javaws",
      rows: [
        {
          code: "SKU-POSITIVE",
          name_1: "Positive Product",
          unit_name: "PCS(ชิ้น)",
          qty_sale: 1,
          amount_sale: 200,
          cost_sale: 100,
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
          name_1: "Negative Product",
          unit_name: "PCS(ชิ้น)",
          qty_sale: 1,
          amount_sale: 10,
          cost_sale: 60,
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

    const preview = renderGrossProfitLinePreview({
      snapshot,
      dashboardUrl: "https://example.com/command-center/brief?token=signed",
      tenantName: "DEMO SHOP",
    });
    const bubble = preview.flex_message?.contents as any;
    const primaryAmountBox = bubble.body.contents.find(
      (content: any) =>
        content.type === "box" &&
        content.layout === "baseline" &&
        JSON.stringify(content).includes("50.00"),
    );
    const primaryAmountNode = primaryAmountBox.contents.find(
      (content: any) => content.type === "text" && content.text === "50.00",
    );

    expect(JSON.stringify(preview.flex_message)).toContain("ควรตรวจรายการ");
    expect(primaryAmountNode.color).toBe("#111827");
  });

  it("adds the dashboard button when gross profit preview has a signed viewer URL", () => {
    const snapshot = summarizeGrossProfitByProduct({
      tenant_id: "tenant_demo_remote",
      run_id: "run_gp_product_url",
      params: { date_from: "2026-06-01", date_to: "2026-06-01" },
      generated_at: "2026-06-02T08:00:00.000Z",
      source: "sml_javaws",
      rows: [
        {
          code: "SKU-1",
          name_1: "Product A",
          unit_name: "PCS(ชิ้น)",
          qty_sale: 2,
          amount_sale: 200,
          cost_sale: 120,
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

    const preview = renderGrossProfitLinePreview({
      snapshot,
      dashboardUrl: "https://example.com/command-center/brief?token=signed",
      tenantName: "DEMO SHOP",
    });

    expect(preview.line_message_type).toBe("flex");
    const flexPayload = JSON.stringify(preview.flex_message);
    expect(flexPayload).toContain("กำไรขั้นต้นสินค้า");
    expect(flexPayload).not.toContain("รายงานกำไรขั้นต้นสินค้า");
    expect(flexPayload).toContain("สินค้ากำไรเด่น");
    expect(flexPayload).not.toContain("Top สินค้า");
    expect(flexPayload).toContain("เปิดรายละเอียด");
    expect(flexPayload).toContain("ยอดรวมเดียวกัน แยกดูตามสินค้า");
    expect(flexPayload).not.toContain("branch_code");
    expect(flexPayload).not.toContain("ic_trans");
    expect(flexPayload).not.toContain("snapshot");
    expect(preview.text).toContain("เปิดรายงาน: กดปุ่มใน LINE");
  });
});
