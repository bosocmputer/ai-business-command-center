import { describe, expect, it } from "vitest";
import {
  buildStockReorderQuery,
  renderStockReorderLinePreview,
  summarizeStockReorder,
  validateStockReorderParams,
} from "./stock-reorder.js";

describe("stock reorder report", () => {
  it("validates the shared date range contract without using dates in SQL", () => {
    expect(() =>
      validateStockReorderParams({
        date_from: "2026-06-08",
        date_to: "2026-06-01",
      }),
    ).toThrow("date_from");
  });

  it("builds latest-balance stock reorder SQL without hard-coded tenant or dates", () => {
    const query = buildStockReorderQuery({
      date_from: "2026-06-01",
      date_to: "2026-06-08",
    });

    expect(query.text).toContain("with reorder_config as");
    expect(query.text).toContain("inner join reorder_config r");
    expect(query.text).toContain("coalesce(i.item_type, 0) <> 5");
    expect(query.text).toContain("r.purchase_point > 0");
    expect(query.text).toContain("coalesce(i.balance_qty, 0) < r.purchase_point");
    expect(query.text).not.toMatch(/\(\s*select\s+purchase_point\s+from/i);
    expect(query.text).not.toContain("$1");
    expect(query.text).not.toContain("2026-06-08");
    expect(query.text).not.toContain("tenant_demo_remote");
    expect(query.values).toEqual([]);
  });

  it("summarizes live-validated reorder counts and derived shortages", () => {
    const snapshot = summarizeStockReorder({
      tenant_id: "tenant_demo_remote",
      run_id: "run_reorder_sample",
      params: { date_from: "2026-06-08", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        reorderRow({
          ic_code: "OUT-1",
          ic_name: "สินค้าหมด",
          balance_qty: 0,
          purchase_point: 5,
          purchase_balance_qty: 2,
        }),
        reorderRow({
          ic_code: "LOW-1",
          ic_name: "สินค้าใกล้หมด",
          balance_qty: 3,
          purchase_point: 8,
          purchase_balance_qty: 10,
        }),
        reorderRow({
          ic_code: "OUT-2",
          ic_name: "สินค้าติดลบ",
          balance_qty: -4,
          purchase_point: 6,
          purchase_balance_qty: 0,
        }),
      ],
    });

    expect(snapshot.report_key).toBe("stock_reorder");
    expect(snapshot.source_basis).toBe("latest_inventory_balance");
    expect(snapshot.summary).toMatchObject({
      reorder_count: 3,
      out_of_stock_count: 2,
      low_stock_count: 1,
      purchase_balance_qty_total: 12,
      shortage_qty_total: 20,
      top_reorder_item_name: "สินค้าติดลบ",
    });
    expect(snapshot.top_items.map((row) => row.ic_code)).toEqual([
      "OUT-2",
      "OUT-1",
      "LOW-1",
    ]);
    expect(snapshot.top_items[0]).toMatchObject({
      status: "out_of_stock",
      shortage_qty: 10,
    });
  });

  it("normalizes blank and null numeric values to zero", () => {
    const snapshot = summarizeStockReorder({
      tenant_id: "seaandhill_demo",
      run_id: "run_reorder_blank",
      params: { date_from: "2026-06-08", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        {
          ic_code: "SKU-BLANK",
          ic_name: "Blank Item",
          ic_unit_code: "PCS~PCS",
          balance_qty: "",
          purchase_point: null,
          purchase_balance_qty: "not-a-number",
        },
      ],
    });

    expect(snapshot.summary.reorder_count).toBe(1);
    expect(snapshot.summary.shortage_qty_total).toBe(0);
    expect(snapshot.top_items[0]).toMatchObject({
      balance_qty: 0,
      purchase_point: 0,
      purchase_balance_qty: 0,
      shortage_qty: 0,
      status: "out_of_stock",
    });
  });

  it("renders LINE preview with latest SML copy and without technical fields", () => {
    const snapshot = summarizeStockReorder({
      tenant_id: "tenant_demo_remote",
      run_id: "run_reorder_line",
      params: { date_from: "2026-06-08", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [
        reorderRow({
          ic_code: "SKU-1",
          ic_name: "สินค้าควรสั่ง",
          balance_qty: 1,
          purchase_point: 5,
          purchase_balance_qty: 0,
        }),
      ],
    });
    const preview = renderStockReorderLinePreview({
      snapshot,
      dashboardUrl: "https://example.com/command-center/brief?token=signed",
      tenantName: "กระบี่",
    });
    const flex = JSON.stringify(preview.flex_message);

    expect(preview.report_key).toBe("stock_reorder");
    expect(preview.line_message_type).toBe("flex");
    expect(preview.text).toContain("รายงานสินค้าถึงจุดสั่งซื้อ");
    expect(preview.text).toContain("ข้อมูล: ข้อมูลล่าสุดจาก SML");
    expect(preview.text).toContain("สินค้าถึงจุดสั่งซื้อ: 1 รายการ");
    expect(preview.text).not.toContain("คงเหลือ ณ");
    expect(preview.text).not.toContain("token=signed");
    expect(flex).toContain("สินค้าถึงจุดสั่งซื้อ");
    expect(flex).toContain("ข้อมูลล่าสุดจาก SML");
    expect(flex).toContain("เปิดรายละเอียด");
    expect(flex.length).toBeLessThan(12000);
    expect(JSON.stringify(preview)).not.toContain("ic_inventory_detail");
    expect(JSON.stringify(preview)).not.toContain("snapshot");
    expect(JSON.stringify(preview)).not.toContain("purchase_point > 0");
  });

  it("keeps LINE altText in a LINE-safe length", () => {
    const snapshot = summarizeStockReorder({
      tenant_id: "tenant_demo_remote",
      run_id: "run_reorder_alt",
      params: { date_from: "2026-06-08", date_to: "2026-06-08" },
      generated_at: "2026-06-08T12:00:00.000Z",
      source: "sml_javaws",
      rows: [reorderRow({ ic_code: "SKU-1", purchase_point: 5 })],
    });
    const preview = renderStockReorderLinePreview({
      snapshot,
      dashboardUrl: "https://example.com/command-center/brief?token=signed",
      tenantName: "ร้านทดสอบชื่อยาวมาก".repeat(30),
    });

    expect(preview.flex_message?.altText.length).toBeLessThanOrEqual(300);
  });
});

function reorderRow(input: {
  ic_code: string;
  ic_name?: string;
  ic_unit_code?: string;
  balance_qty?: number;
  purchase_point?: number;
  purchase_balance_qty?: number;
}) {
  return {
    ic_code: input.ic_code,
    ic_name: input.ic_name ?? input.ic_code,
    ic_unit_code: input.ic_unit_code ?? "เส้น~เส้น",
    balance_qty: input.balance_qty ?? 0,
    purchase_point: input.purchase_point ?? 10,
    purchase_balance_qty: input.purchase_balance_qty ?? 0,
  };
}
