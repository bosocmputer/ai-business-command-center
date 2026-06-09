import { describe, expect, it } from "vitest";
import type {
  ArCustomerMovementSnapshot,
  ReportRunRecord,
  StockBalanceSnapshot,
} from "@ai-bcc/shared";
import {
  buildDegradedArCustomerMovementPreview,
  buildDegradedStockBalancePreview,
  findRecentArCustomerMovementTimeoutRun,
  findRecentStockBalanceTimeoutRun,
  isArCustomerMovementTimeoutMessage,
  isStockBalanceTimeoutMessage,
  resolveArCustomerMovementFallbackSnapshot,
  resolveStockBalanceFallbackSnapshot,
} from "./heavy-report-resilience.js";

describe("heavy report resilience", () => {
  it("recognizes stock balance timeout messages", () => {
    expect(
      isStockBalanceTimeoutMessage(
        "รายงานสต็อกคงเหลือใช้เวลานานเกินไป กรุณาลองช่วงวันที่สั้นลง",
      ),
    ).toBe(true);
    expect(isStockBalanceTimeoutMessage("stock_balance query timeout")).toBe(true);
    expect(isStockBalanceTimeoutMessage("ส่ง LINE ไม่สำเร็จ")).toBe(false);
  });

  it("recognizes AR customer movement timeout messages", () => {
    expect(
      isArCustomerMovementTimeoutMessage(
        "รายงานเคลื่อนไหวลูกหนี้ใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง",
      ),
    ).toBe(true);
    expect(
      isArCustomerMovementTimeoutMessage("ar_customer_movement query timeout"),
    ).toBe(true);
    expect(isArCustomerMovementTimeoutMessage("ส่ง LINE ไม่สำเร็จ")).toBe(false);
  });

  it("uses cooldown only for recent stock balance timeout runs", () => {
    const now = new Date("2026-06-09T11:00:00.000Z");
    const runs: ReportRunRecord[] = [
      {
        id: "run_timeout_recent",
        tenant_id: "tenant_demo_remote",
        report_key: "stock_balance",
        params: { date_from: "2026-06-09", date_to: "2026-06-09" },
        status: "failed",
        started_at: "2026-06-09T10:58:00.000Z",
        finished_at: "2026-06-09T10:59:00.000Z",
        row_count: 0,
        safe_error_message: "รายงานสต็อกคงเหลือใช้เวลานานเกินไป",
      },
      {
        id: "run_timeout_old",
        tenant_id: "tenant_demo_remote",
        report_key: "stock_balance",
        params: { date_from: "2026-06-09", date_to: "2026-06-09" },
        status: "failed",
        started_at: "2026-06-09T10:00:00.000Z",
        finished_at: "2026-06-09T10:01:00.000Z",
        row_count: 0,
        safe_error_message: "รายงานสต็อกคงเหลือใช้เวลานานเกินไป",
      },
    ];

    expect(findRecentStockBalanceTimeoutRun({ runs, now })?.id).toBe(
      "run_timeout_recent",
    );
  });

  it("uses cooldown only for recent AR customer movement timeout runs", () => {
    const now = new Date("2026-06-09T11:00:00.000Z");
    const runs: ReportRunRecord[] = [
      {
        id: "run_ar_timeout_recent",
        tenant_id: "tenant_demo_remote",
        report_key: "ar_customer_movement",
        params: { date_from: "2026-06-09", date_to: "2026-06-09" },
        status: "failed",
        started_at: "2026-06-09T10:58:00.000Z",
        finished_at: "2026-06-09T10:59:00.000Z",
        row_count: 0,
        safe_error_message: "รายงานเคลื่อนไหวลูกหนี้ใช้เวลานานเกินไป",
      },
      {
        id: "run_stock_timeout_recent",
        tenant_id: "tenant_demo_remote",
        report_key: "stock_balance",
        params: { date_from: "2026-06-09", date_to: "2026-06-09" },
        status: "failed",
        started_at: "2026-06-09T10:58:00.000Z",
        finished_at: "2026-06-09T10:59:00.000Z",
        row_count: 0,
        safe_error_message: "รายงานสต็อกคงเหลือใช้เวลานานเกินไป",
      },
    ];

    expect(findRecentArCustomerMovementTimeoutRun({ runs, now })?.id).toBe(
      "run_ar_timeout_recent",
    );
  });

  it("accepts only recent real stock balance snapshots as fallback", () => {
    const snapshot = buildStockBalanceSnapshot({
      generated_at: "2026-06-09T10:30:00.000Z",
      source: "sml_javaws",
    });

    expect(
      resolveStockBalanceFallbackSnapshot({
        snapshot,
        now: new Date("2026-06-09T11:00:00.000Z"),
      })?.ageHours,
    ).toBe(0.5);
    expect(
      resolveStockBalanceFallbackSnapshot({
        snapshot: {
          ...snapshot,
          generated_at: "2026-06-07T10:30:00.000Z",
        },
        now: new Date("2026-06-09T11:00:00.000Z"),
      }),
    ).toBeNull();
    expect(
      resolveStockBalanceFallbackSnapshot({
        snapshot: buildStockBalanceSnapshot({
          generated_at: "2026-06-09T10:30:00.000Z",
          source: "sample_snapshot",
        }),
        now: new Date("2026-06-09T11:00:00.000Z"),
      }),
    ).toBeNull();
  });

  it("accepts only recent real AR customer movement snapshots as fallback", () => {
    const snapshot = buildArCustomerMovementSnapshot({
      generated_at: "2026-06-09T10:30:00.000Z",
      source: "sml_javaws",
    });

    expect(
      resolveArCustomerMovementFallbackSnapshot({
        snapshot,
        now: new Date("2026-06-09T11:00:00.000Z"),
      })?.ageHours,
    ).toBe(0.5);
    expect(
      resolveArCustomerMovementFallbackSnapshot({
        snapshot: {
          ...snapshot,
          generated_at: "2026-06-07T10:30:00.000Z",
        },
        now: new Date("2026-06-09T11:00:00.000Z"),
      }),
    ).toBeNull();
    expect(
      resolveArCustomerMovementFallbackSnapshot({
        snapshot: buildArCustomerMovementSnapshot({
          generated_at: "2026-06-09T10:30:00.000Z",
          source: "sample_snapshot",
        }),
        now: new Date("2026-06-09T11:00:00.000Z"),
      }),
    ).toBeNull();
  });

  it("builds a LINE-safe degraded stock balance preview", () => {
    const fallback = resolveStockBalanceFallbackSnapshot({
      snapshot: buildStockBalanceSnapshot({
        generated_at: "2026-06-09T10:30:00.000Z",
        source: "sml_javaws",
      }),
      now: new Date("2026-06-09T11:00:00.000Z"),
    });
    const preview = buildDegradedStockBalancePreview({
      tenantId: "tenant_demo_remote",
      tenantName: "กระบี่",
      failedRunId: "run_timeout",
      generatedAt: "2026-06-09T11:00:00.000Z",
      fallback,
      cooldownUsed: true,
    });

    expect(preview.report_key).toBe("stock_balance");
    expect(preview.source).toBe("degraded_notice");
    expect(preview.degraded).toBe(true);
    expect(preview.text).toContain("ข้อมูลอ้างอิงล่าสุด");
    expect(preview.text).toContain("ไม่ใช่ข้อมูลสด");
    expect(preview.flex_message?.altText.length).toBeLessThanOrEqual(400);
    expect(JSON.stringify(preview.flex_message)).not.toContain("ic_trans_detail");
  });

  it("builds a LINE-safe degraded AR customer movement preview", () => {
    const fallback = resolveArCustomerMovementFallbackSnapshot({
      snapshot: buildArCustomerMovementSnapshot({
        generated_at: "2026-06-09T10:30:00.000Z",
        source: "sml_javaws",
      }),
      now: new Date("2026-06-09T11:00:00.000Z"),
    });
    const preview = buildDegradedArCustomerMovementPreview({
      tenantId: "tenant_demo_remote",
      tenantName: "กระบี่",
      failedRunId: "run_ar_timeout",
      generatedAt: "2026-06-09T11:00:00.000Z",
      fallback,
      cooldownUsed: true,
    });

    expect(preview.report_key).toBe("ar_customer_movement");
    expect(preview.source).toBe("degraded_notice");
    expect(preview.degraded).toBe(true);
    expect(preview.text).toContain("ข้อมูลอ้างอิงล่าสุด");
    expect(preview.text).toContain("ไม่ใช่ข้อมูลสด");
    expect(preview.flex_message?.altText.length).toBeLessThanOrEqual(400);
    expect(JSON.stringify(preview.flex_message)).not.toContain("trans_flag");
  });
});

function buildStockBalanceSnapshot(input: {
  generated_at: string;
  source: StockBalanceSnapshot["source"];
}): StockBalanceSnapshot {
  return {
    tenant_id: "tenant_demo_remote",
    report_key: "stock_balance",
    run_id: "run_stock_reference",
    params: {
      date_from: "2026-06-09",
      date_to: "2026-06-09",
      time_from: "00:00",
      time_to: "18:30",
    },
    generated_at: input.generated_at,
    source: input.source,
    quality_status: "valid",
    summary: {
      sku_count: 7880,
      stock_value: 308885318.09,
      balance_qty: 12000,
      qty_in: 100,
      amount_in: 4149246.51,
      qty_out: 80,
      amount_out: 5175628.01,
      negative_stock_count: 30,
      zero_or_missing_cost_count: 0,
      top_stock_item_name: "MCT 225/75 R14 XCD2",
    },
    top_items_by_value: [],
    negative_items: [],
    line_template: {
      title: "รายงานสต็อกคงเหลือ",
      body: [],
    },
  };
}

function buildArCustomerMovementSnapshot(input: {
  generated_at: string;
  source: ArCustomerMovementSnapshot["source"];
}): ArCustomerMovementSnapshot {
  return {
    tenant_id: "tenant_demo_remote",
    report_key: "ar_customer_movement",
    run_id: "run_ar_reference",
    params: {
      date_from: "2026-06-09",
      date_to: "2026-06-09",
      time_from: "00:00",
      time_to: "18:30",
    },
    generated_at: input.generated_at,
    source: input.source,
    quality_status: "valid",
    source_basis: "ar_movement_as_of_date",
    summary: {
      document_count: 478536,
      customer_count: 5304,
      ar_increase_amount: 8741057021.81,
      ar_decrease_amount: 125000000.14,
      receipt_amount: 8615861884.09,
      net_movement_amount: 135197722.72,
      top_customer_name: "บริษัท ซ้อปปี (ประเทศไทย) จำกัด",
    },
    top_customers: [
      {
        cust_code: "C001",
        cust_name: "บริษัท ซ้อปปี (ประเทศไทย) จำกัด",
        document_count: 1200,
        ar_increase_amount: 8700000,
        ar_decrease_amount: 700000,
        receipt_amount: 78102.47,
        net_movement_amount: 7921897.53,
      },
    ],
    top_documents: [],
    line_template: {
      title: "รายงานเคลื่อนไหวลูกหนี้",
      body: [],
    },
  };
}
