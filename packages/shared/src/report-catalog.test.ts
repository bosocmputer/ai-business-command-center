import { describe, expect, it } from "vitest";
import {
  getReportCatalogEntry,
  getReportPresetEntry,
  isReportKey,
  matchReportPreset,
  notificationRuleRunStatusSchema,
  reportCatalog,
  reportKeySchema,
  reportKeyValues,
  reportPresetCatalog,
  reportPresetKeyValues,
  tenantFeatureFlagsSchema,
} from "./index.js";

describe("report catalog", () => {
  it("keeps the report key schema and catalog on the same eight keys", () => {
    expect(reportKeyValues).toEqual([
      "sales_goods_services",
      "purchase_goods_payables",
      "gross_profit_by_product",
      "gross_profit_by_ar_customer",
      "stock_balance",
      "stock_reorder",
      "ar_customer_movement",
      "ar_debt_receipt",
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

  it("adds AR customer movement as a sensitive AR report", () => {
    expect(getReportCatalogEntry("ar_customer_movement")).toMatchObject({
      label: "รายงานเคลื่อนไหวลูกหนี้",
      shortLabel: "เคลื่อนไหวลูกหนี้",
      category: "ar",
      sensitive: true,
      capabilities: {
        lineCard: true,
        signedViewer: true,
        pdf: false,
        businessSignals: false,
      },
    });
  });

  it("adds AR debt receipt as a sensitive AR report", () => {
    expect(getReportCatalogEntry("ar_debt_receipt")).toMatchObject({
      label: "รายงานรับชำระหนี้",
      shortLabel: "รับชำระหนี้",
      category: "ar",
      sensitive: true,
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
    expect(isReportKey("ar_customer_movement")).toBe(true);
    expect(isReportKey("ar_debt_receipt")).toBe(true);
    expect(isReportKey("unknown_report")).toBe(false);
  });

  it("keeps report presets stable for owner notification shortcuts", () => {
    expect(reportPresetKeyValues).toEqual([
      "executive_full",
      "executive_focus",
      "sales_profit",
      "inventory",
      "finance_ar",
    ]);
    expect(Object.keys(reportPresetCatalog)).toEqual([...reportPresetKeyValues]);
    expect(getReportPresetEntry("executive_full").reportKeys).toEqual([
      ...reportKeyValues,
    ]);
    expect(getReportPresetEntry("executive_full").reportKeys.length).toBeLessThanOrEqual(
      10,
    );
  });

  it("matches report presets independent of duplicate or unsorted report keys", () => {
    expect(
      matchReportPreset([
        "stock_balance",
        "sales_goods_services",
        "ar_debt_receipt",
        "gross_profit_by_product",
        "sales_goods_services",
      ]),
    ).toBe("executive_focus");
    expect(matchReportPreset(["sales_goods_services"])).toBeNull();
  });

  it("supports warning-safe notification run status and heavy report fallback flag", () => {
    expect(notificationRuleRunStatusSchema.options).toContain(
      "success_with_warnings",
    );
    expect(tenantFeatureFlagsSchema.parse({})).toMatchObject({
      line_heavy_report_fallback_enabled: true,
    });
  });
});
