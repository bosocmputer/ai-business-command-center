import { describe, expect, it } from "vitest";
import {
  buildStockBalanceQuery,
  renderStockBalanceLinePreview,
  summarizeStockBalance,
  validateStockBalanceParams,
} from "./stock-balance.js";

describe("stock balance report", () => {
  it("validates the shared date range contract", () => {
    expect(() =>
      validateStockBalanceParams({
        date_from: "2026-06-08",
        date_to: "2026-06-01",
      }),
    ).toThrow("date_from");
  });

  it("builds parameterized stock SQL without hard-coded date or item filters", () => {
    const query = buildStockBalanceQuery({
      date_from: "2026-06-01",
      date_to: "2026-06-08",
    });

    expect(query.text).toContain("$1::date");
    expect(query.text).toContain("$2::date");
    expect(query.text).toContain("with inventory_scope as");
    expect(query.text).toContain("inner join inventory_scope inv");
    expect(query.text).toContain("nullif(d.divide_value, 0)");
    expect(query.text).toContain("nullif(i.unit_standard_divide_value, 0)");
    expect(query.text).not.toContain("2026-06-08");
    expect(query.text).not.toContain("1525634492179");
    expect(query.values).toEqual(["2026-06-01", "2026-06-08"]);
  });

  it("pushes optional item filters into inventory scope before the detail scan", () => {
    const query = buildStockBalanceQuery(
      {
        date_from: "2026-06-01",
        date_to: "2026-06-08",
      },
      { itemCode: "8852437100080", search: "ปูนเสือ" },
    );

    expect(query.text).toContain("and i.code = $3");
    expect(query.text).toContain("i.name_1 ilike $4");
    expect(query.values).toEqual([
      "2026-06-01",
      "2026-06-08",
      "8852437100080",
      "%ปูนเสือ%",
    ]);
  });

  it("summarizes the live-validated seaandhill sample row", () => {
    const snapshot = summarizeStockBalance({
      tenant_id: "seaandhill_demo",
      run_id: "run_stock_sample",
      params: { date_from: "2026-06-01", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        {
          ic_code: "8852437100080",
          ic_name: "ปูนเสือซิเมนต์ผสม 50 กก.(20ถุง/ตัน)",
          ic_unit_code: "ถุง",
          balance_qty: "471.0000000000",
          average_cost: "134.5761358811",
          average_cost_end: "134.5800000000",
          balance_amount: "63385.3600000000",
          qty_in: "1357.0000000000",
          amount_in: "182624.2900000000",
          average_cost_in: "134.5794325718",
          qty_out: "1678.0000000000",
          amount_out: "225824.0400000000",
          average_cost_out: "134.5792848629",
        },
      ],
    });

    expect(snapshot.summary).toMatchObject({
      sku_count: 1,
      stock_value: 63385.36,
      balance_qty: 471,
      qty_in: 1357,
      amount_in: 182624.29,
      qty_out: 1678,
      amount_out: 225824.04,
      negative_stock_count: 0,
      zero_or_missing_cost_count: 0,
      top_stock_item_name: "ปูนเสือซิเมนต์ผสม 50 กก.(20ถุง/ตัน)",
    });
    expect(snapshot.top_items_by_value).toHaveLength(1);
    expect(snapshot.top_items_by_value[0]).toMatchObject({
      balance_qty: 471,
      average_cost: 134.58,
      average_cost_end: 134.58,
      balance_amount: 63385.36,
    });
  });

  it("normalizes blank and null numeric values to zero", () => {
    const snapshot = summarizeStockBalance({
      tenant_id: "tenant_demo_remote",
      run_id: "run_stock_blank",
      params: { date_from: "2026-06-01", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        {
          ic_code: "SKU-EMPTY",
          ic_name: "Blank Item",
          ic_unit_code: "PCS",
          balance_qty: "",
          average_cost: null,
          average_cost_end: undefined,
          balance_amount: "not-a-number",
          qty_in: null,
          amount_in: "",
          average_cost_in: "",
          qty_out: undefined,
          amount_out: "",
          average_cost_out: "",
        },
      ],
    });

    expect(snapshot.summary.stock_value).toBe(0);
    expect(snapshot.summary.balance_qty).toBe(0);
    expect(snapshot.top_items_by_value[0]).toMatchObject({
      balance_qty: 0,
      average_cost: 0,
      average_cost_end: 0,
      balance_amount: 0,
    });
  });

  it("counts negative stock and zero or missing cost rows", () => {
    const snapshot = summarizeStockBalance({
      tenant_id: "tenant_demo_remote",
      run_id: "run_stock_warning",
      params: { date_from: "2026-06-01", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        stockRow({ ic_code: "NEG-1", balance_qty: -3, balance_amount: -90 }),
        stockRow({ ic_code: "MISS-COST", balance_qty: 5, balance_amount: 0 }),
      ],
    });

    expect(snapshot.summary.negative_stock_count).toBe(1);
    expect(snapshot.summary.zero_or_missing_cost_count).toBe(1);
    expect(snapshot.negative_items).toHaveLength(1);
    expect(snapshot.negative_items[0].ic_code).toBe("NEG-1");
  });

  it("renders LINE preview with business copy and without technical fields", () => {
    const snapshot = summarizeStockBalance({
      tenant_id: "seaandhill_demo",
      run_id: "run_stock_line",
      params: { date_from: "2026-06-01", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [stockRow({ ic_code: "SKU-1", ic_name: "สินค้าหลัก", balance_amount: 9000 })],
    });
    const preview = renderStockBalanceLinePreview({
      snapshot,
      dashboardUrl: "https://example.com/command-center/brief?token=signed",
      tenantName: "seaandhill THAPPUT",
    });

    expect(preview.report_key).toBe("stock_balance");
    expect(preview.line_message_type).toBe("flex");
    expect(preview.text).toContain("รายงานสต็อกคงเหลือ");
    expect(preview.text).toContain("มูลค่าสต็อกคงเหลือ");
    expect(preview.text).toContain("ข้อมูล: คงเหลือ ณ 08/06/2026");
    expect(preview.text).toContain("รับเข้าในช่วง");
    expect(preview.text).toContain("จ่ายออกในช่วง");
    expect(preview.text).not.toContain("ช่วงข้อมูล");
    const flex = JSON.stringify(preview.flex_message);
    expect(flex).toContain("สต็อกคงเหลือ");
    expect(flex).toContain("คงเหลือ ณ 08/06/2026");
    expect(flex).toContain("รับเข้าในช่วง");
    expect(flex).toContain("จ่ายออกในช่วง");
    expect(flex).toContain("เปิดรายละเอียด");
    expect(preview.text).not.toContain("token=signed");
    expect(JSON.stringify(preview)).not.toContain("ic_trans_detail");
    expect(JSON.stringify(preview)).not.toContain("trans_flag");
    expect(JSON.stringify(preview)).not.toContain("snapshot");
  });

  it("renders single-day LINE preview as stock balance as-of date", () => {
    const snapshot = summarizeStockBalance({
      tenant_id: "tenant_demo_remote",
      run_id: "run_stock_single_day",
      params: { date_from: "2026-06-07", date_to: "2026-06-07" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [stockRow({ ic_code: "SKU-1", ic_name: "สินค้าหลัก", balance_amount: 9000 })],
    });
    const preview = renderStockBalanceLinePreview({
      snapshot,
      dashboardUrl: "https://example.com/command-center/brief?token=signed",
      tenantName: "กระบี่",
    });
    const flex = JSON.stringify(preview.flex_message);

    expect(preview.text).toContain("ข้อมูล: คงเหลือ ณ 07/06/2026");
    expect(preview.text).toContain("รับเข้าในวัน");
    expect(preview.text).toContain("จ่ายออกในวัน");
    expect(flex).toContain("กระบี่ · คงเหลือ ณ 07/06/2026");
    expect(flex).toContain("รับเข้าในวัน");
    expect(flex).toContain("จ่ายออกในวัน");
    expect(flex).not.toContain("07/06/2026 00:00 - 07/06/2026 23:59");
  });
});

function stockRow(input: {
  ic_code: string;
  ic_name?: string;
  balance_qty?: number;
  balance_amount?: number;
}) {
  return {
    ic_code: input.ic_code,
    ic_name: input.ic_name ?? input.ic_code,
    ic_unit_code: "PCS",
    balance_qty: input.balance_qty ?? 10,
    average_cost: input.balance_amount === 0 ? 0 : 10,
    average_cost_end: input.balance_amount === 0 ? 0 : 10,
    balance_amount: input.balance_amount ?? 100,
    qty_in: 0,
    amount_in: 0,
    average_cost_in: 0,
    qty_out: 0,
    amount_out: 0,
    average_cost_out: 0,
  };
}
