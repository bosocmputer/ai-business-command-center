import { describe, expect, it } from "vitest";
import { reportKeyValues, type NotificationRuleRecord } from "@ai-bcc/shared";
import {
  buildNotificationReportPresetUpdate,
  defaultNotificationReportPresetRuleIds,
} from "./notification-report-presets.js";

describe("notification report preset apply helper", () => {
  it("pins the two pilot rule ids for executive_full rollout", () => {
    expect(defaultNotificationReportPresetRuleIds).toEqual([
      "notification_rule_seaandhill_demo_1780299602970",
      "notification_rule_tenant_demo_remote_morning_brief_digest",
    ]);
  });

  it("builds a safe rule update and audit metadata with old and new keys", () => {
    const rule = fakeRule({
      report_keys: ["sales_goods_services", "purchase_goods_payables"],
    });

    const update = buildNotificationReportPresetUpdate({
      presetKey: "executive_full",
      rule,
      updatedAt: "2026-06-08T17:00:00.000Z",
    });

    expect(update.changed).toBe(true);
    expect(update.updatedRule.report_keys).toEqual([...reportKeyValues]);
    expect(update.updatedRule.updated_at).toBe("2026-06-08T17:00:00.000Z");
    expect(update.auditMetadata).toMatchObject({
      preset_key: "executive_full",
      old_report_keys: ["sales_goods_services", "purchase_goods_payables"],
      new_report_keys: [...reportKeyValues],
      source: "cli",
    });
  });
});

function fakeRule(
  override: Partial<NotificationRuleRecord> = {},
): NotificationRuleRecord {
  return {
    id: "notification_rule_demo",
    tenant_id: "tenant_demo_remote",
    name: "Daily SML digest",
    enabled: true,
    timezone: "Asia/Bangkok",
    period_preset: "yesterday",
    period_strategy: "executive_checkpoints",
    schedule: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], times: ["08:00"] }],
    report_keys: ["sales_goods_services"],
    target_ids: ["line_target_demo"],
    message_packaging: "digest",
    digest_mode: "all_reports",
    retry_policy: { max_attempts: 2, retry_delay_minutes: 3 },
    last_run_at: null,
    last_run_status: null,
    last_safe_error_message: null,
    created_at: "2026-06-08T00:00:00.000Z",
    updated_at: "2026-06-08T00:00:00.000Z",
    ...override,
  };
}
