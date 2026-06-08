import { describe, expect, it } from "vitest";
import {
  buildNotificationIdempotencyKey,
  deriveMorningBriefDateRange,
  deriveNotificationPeriodRange,
  getDueNotificationRuleTimes,
  getSmlBranchMeaning,
  isNotificationRuleDue,
  type NotificationRuleRecord,
} from "./index.js";

describe("deriveMorningBriefDateRange", () => {
  it("uses yesterday in Asia/Bangkok as a single-day report period", () => {
    expect(
      deriveMorningBriefDateRange({
        period: "yesterday",
        now: new Date("2026-05-19T01:00:00.000Z"),
        timeZone: "Asia/Bangkok",
      }),
    ).toEqual({
      date_from: "2026-05-18",
      date_to: "2026-05-18",
    });
  });
});

describe("getSmlBranchMeaning", () => {
  it("uses erp_branch_list name before code fallback", () => {
    expect(getSmlBranchMeaning("0000", "สำนักงาน")).toEqual({
      code: "0000",
      label: "สำนักงาน",
      name: "สำนักงาน",
      note: "ชื่อสาขาจาก erp_branch_list (0000)",
      is_unmapped: false,
    });
  });
});

describe("notification rule scheduling", () => {
  const rule: NotificationRuleRecord = {
    id: "notification_rule_demo",
    tenant_id: "tenant_demo_remote",
    name: "Daily SML digest",
    enabled: true,
    timezone: "Asia/Bangkok",
    period_preset: "yesterday",
    period_strategy: "same_period_all_runs",
    schedule: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], times: ["08:00", "18:30"] }],
    report_keys: ["sales_goods_services"],
    target_ids: ["line_target_demo"],
    message_packaging: "digest",
    digest_mode: "action_only",
    retry_policy: { max_attempts: 2, retry_delay_minutes: 3 },
    last_run_at: null,
    last_run_status: null,
    last_safe_error_message: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
  };

  it("recognizes due weekdays/times in the rule timezone", () => {
    expect(
      isNotificationRuleDue({
        rule,
        now: new Date("2026-05-19T01:00:00.000Z"),
      }),
    ).toEqual({
      date: "2026-05-19",
      time: "08:00",
      isoWeekday: 2,
    });
  });

  it("derives period presets without requiring UI supplied SQL", () => {
    expect(
      deriveNotificationPeriodRange({
        periodPreset: "last_7_days",
        periodStrategy: "same_period_all_runs",
        now: new Date("2026-05-19T01:00:00.000Z"),
        timeZone: "Asia/Bangkok",
      }),
    ).toEqual({
      date_from: "2026-05-13",
      date_to: "2026-05-19",
    });
  });

  it("derives executive checkpoint periods from the scheduled local time", () => {
    expect(
      deriveNotificationPeriodRange({
        periodPreset: "yesterday",
        periodStrategy: "executive_checkpoints",
        scheduledLocalDate: "2026-06-08",
        scheduledLocalTime: "08:00",
        timeZone: "Asia/Bangkok",
      }),
    ).toEqual({
      date_from: "2026-06-07",
      date_to: "2026-06-07",
      time_from: "00:00",
      time_to: "23:59",
    });

    expect(
      deriveNotificationPeriodRange({
        periodPreset: "yesterday",
        periodStrategy: "executive_checkpoints",
        scheduledLocalDate: "2026-06-08",
        scheduledLocalTime: "18:30",
        timeZone: "Asia/Bangkok",
      }),
    ).toEqual({
      date_from: "2026-06-08",
      date_to: "2026-06-08",
      time_from: "00:00",
      time_to: "18:30",
    });
  });

  it("finds due notification times inside a catch-up window without duplicates", () => {
    expect(
      getDueNotificationRuleTimes({
        rule,
        now: new Date("2026-05-19T01:14:30.000Z"),
        catchUpMinutes: 15,
      }),
    ).toEqual([
      {
        date: "2026-05-19",
        time: "08:00",
        isoWeekday: 2,
      },
    ]);
  });

  it("builds minute-scoped idempotency keys", () => {
    expect(
      buildNotificationIdempotencyKey({
        ruleId: "notification_rule_demo",
        scheduledLocalDate: "2026-05-19",
        scheduledLocalTime: "08:00",
      }),
    ).toBe("notification_rule:notification_rule_demo:2026-05-19:08:00:1");
  });
});
