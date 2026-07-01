import { describe, expect, it } from "vitest";
import type {
  NotificationReportResult,
  NotificationRuleRecord,
  NotificationRuleRunRecord,
} from "@ai-bcc/shared";
import { selectDeliveryRetryReportResults } from "./notification-delivery-retry.js";

const rule: NotificationRuleRecord = {
  id: "notification_rule_test",
  tenant_id: "tenant_demo_remote",
  name: "Test digest",
  enabled: true,
  timezone: "Asia/Bangkok",
  period_preset: "today_so_far",
  period_strategy: "executive_checkpoints",
  schedule: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], times: ["18:30"] }],
  report_keys: ["sales_goods_services", "stock_balance"],
  target_ids: ["line_target_test"],
  message_packaging: "digest",
  digest_mode: "action_only",
  retry_policy: { max_attempts: 2, retry_delay_minutes: 3 },
  last_run_at: null,
  last_run_status: null,
  last_safe_error_message: null,
  created_at: "2026-06-18T11:30:00.000Z",
  updated_at: "2026-06-18T11:30:00.000Z",
};

const freshResult = (
  reportKey: NotificationRuleRecord["report_keys"][number],
  runId: string,
): NotificationReportResult => ({
  report_key: reportKey,
  status: "success",
  freshness: "fresh",
  run_id: runId,
  snapshot_generated_at: "2026-06-18T11:30:00.000Z",
  duration_ms: 1000,
  row_count: 10,
  degraded_reason: null,
});

const buildRun = (
  overrides: Partial<NotificationRuleRunRecord> = {},
): NotificationRuleRunRecord => ({
  id: "notification_run_attempt_1",
  rule_id: rule.id,
  tenant_id: "tenant_demo_remote",
  scheduled_local_date: "2026-06-18",
  scheduled_local_time: "18:30",
  timezone: "Asia/Bangkok",
  period_from: "2026-06-18",
  period_to: "2026-06-18",
  period_from_time: "00:00",
  period_to_time: "18:30",
  period_strategy: "executive_checkpoints",
  unknown_doc_time_count: 0,
  status: "failed",
  mode: "send",
  source: "worker_due",
  attempt: 1,
  idempotency_key: "notification_rule:notification_rule_test:2026-06-18:18:30:1",
  report_run_ids: ["run_sales", "run_stock"],
  report_results: [
    freshResult("sales_goods_services", "run_sales"),
    freshResult("stock_balance", "run_stock"),
  ],
  delivery_ids: ["line_failed"],
  safe_error_message: "LINE push failed due to network or provider error.",
  started_at: "2026-06-18T11:30:00.000Z",
  finished_at: "2026-06-18T11:35:00.000Z",
  queued_at: "2026-06-18T11:30:00.000Z",
  claimed_at: "2026-06-18T11:30:00.000Z",
  worker_id: "worker_morning_brief_1",
  client_request_id: null,
  target_ids_override: null,
  next_retry_at: "2026-06-18T11:38:00.000Z",
  progress_stage: "failed",
  progress_percent: 100,
  progress_current_report_key: null,
  progress_done_reports: 2,
  progress_total_reports: 2,
  progress_updated_at: "2026-06-18T11:35:00.000Z",
  created_at: "2026-06-18T11:30:00.000Z",
  updated_at: "2026-06-18T11:35:00.000Z",
  ...overrides,
});

describe("selectDeliveryRetryReportResults", () => {
  it("reuses fresh completed report results after a LINE delivery failure", () => {
    const selected = selectDeliveryRetryReportResults({
      rule,
      retryFromRun: buildRun({
        report_results: [
          freshResult("stock_balance", "run_stock"),
          freshResult("sales_goods_services", "run_sales"),
        ],
      }),
    });

    expect(selected).toEqual([
      expect.objectContaining({
        report_key: "sales_goods_services",
        run_id: "run_sales",
      }),
      expect.objectContaining({
        report_key: "stock_balance",
        run_id: "run_stock",
      }),
    ]);
  });

  it("does not reuse results when the previous failure happened before delivery", () => {
    expect(
      selectDeliveryRetryReportResults({
        rule,
        retryFromRun: buildRun({ delivery_ids: [] }),
      }),
    ).toBeNull();
  });

  it("does not reuse partial, failed, or reference report results", () => {
    const failedResult = {
      ...freshResult("stock_balance", "run_stock"),
      status: "failed" as const,
      freshness: "unavailable" as const,
    };
    const referenceResult = {
      ...freshResult("stock_balance", "run_stock"),
      status: "success_with_warning" as const,
      freshness: "reference" as const,
    };

    expect(
      selectDeliveryRetryReportResults({
        rule,
        retryFromRun: buildRun({
          report_results: [freshResult("sales_goods_services", "run_sales")],
        }),
      }),
    ).toBeNull();
    expect(
      selectDeliveryRetryReportResults({
        rule,
        retryFromRun: buildRun({
          report_results: [
            freshResult("sales_goods_services", "run_sales"),
            failedResult,
          ],
        }),
      }),
    ).toBeNull();
    expect(
      selectDeliveryRetryReportResults({
        rule,
        retryFromRun: buildRun({
          report_results: [
            freshResult("sales_goods_services", "run_sales"),
            referenceResult,
          ],
        }),
      }),
    ).toBeNull();
  });
});
