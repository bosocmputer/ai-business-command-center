import { describe, expect, it } from "vitest";
import {
  getReportCatalogEntry,
  isReportKey,
  reportCatalog,
  reportKeySchema,
  reportKeyValues,
} from "./index.js";

describe("report catalog", () => {
  it("keeps the report key schema and catalog on the same four keys", () => {
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
      sensitive: true,
      capabilities: {
        lineCard: true,
        signedViewer: true,
        pdf: false,
      },
    });
  });

  it("validates report keys through one shared helper", () => {
    expect(isReportKey("purchase_goods_payables")).toBe(true);
    expect(isReportKey("stock_balance")).toBe(false);
  });
});
