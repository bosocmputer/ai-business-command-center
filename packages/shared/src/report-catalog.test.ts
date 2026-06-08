import { describe, expect, it } from "vitest";
import {
  getReportCatalogEntry,
  isReportKey,
  reportCatalog,
  reportKeySchema,
  reportKeyValues,
} from "./index.js";

describe("report catalog", () => {
  it("keeps the report key schema and catalog on the same six keys", () => {
    expect(reportKeyValues).toEqual([
      "sales_goods_services",
      "purchase_goods_payables",
      "gross_profit_by_product",
      "gross_profit_by_ar_customer",
      "stock_balance",
      "stock_reorder",
    ]);
    expect(reportKeySchema.options).toEqual([...reportKeyValues]);
    expect(Object.keys(reportCatalog)).toEqual([...reportKeyValues]);
  });

  it("exposes stable public metadata for existing reports", () => {
    expect(getReportCatalogEntry("sales_goods_services")).toMatchObject({
      label: "รายงานขายสินค้าและบริการ",
      permissionLabel: "รายงานขายสินค้าและบริการ",
      capabilities: {
        lineCard: true,
        signedViewer: true,
        pdf: true,
      },
    });
    expect(getReportCatalogEntry("gross_profit_by_product")).toMatchObject({
      category: "gross_profit",
      sensitive: true,
      capabilities: {
        lineCard: true,
        signedViewer: true,
        pdf: false,
        businessSignals: true,
      },
    });
    expect(getReportCatalogEntry("gross_profit_by_ar_customer")).toMatchObject({
      category: "gross_profit",
      sensitive: true,
      capabilities: {
        lineCard: true,
        signedViewer: true,
        pdf: false,
        businessSignals: true,
      },
    });
  });

  it("adds stock balance as an inventory report with cost-sensitive access", () => {
    expect(getReportCatalogEntry("stock_balance")).toMatchObject({
      label: "รายงานสต็อกคงเหลือ",
      shortLabel: "สต็อกคงเหลือ",
      category: "inventory",
      sensitive: true,
      capabilities: {
        lineCard: true,
        signedViewer: true,
        pdf: false,
        businessSignals: false,
      },
    });
  });

  it("adds stock reorder as an inventory report without cost-sensitive access", () => {
    expect(getReportCatalogEntry("stock_reorder")).toMatchObject({
      label: "รายงานสินค้าถึงจุดสั่งซื้อ",
      shortLabel: "ถึงจุดสั่งซื้อ",
      category: "inventory",
      sensitive: false,
      capabilities: {
        lineCard: true,
        signedViewer: true,
        pdf: false,
        businessSignals: false,
      },
    });
  });

  it("validates report keys through one shared helper", () => {
    expect(isReportKey("purchase_goods_payables")).toBe(true);
    expect(isReportKey("stock_balance")).toBe(true);
    expect(isReportKey("stock_reorder")).toBe(true);
    expect(isReportKey("unknown_report")).toBe(false);
  });
});
