import { describe, expect, it } from "vitest";
import {
  buildNotificationRuleDeliveryKey,
  buildNotificationRuleIncidentDeliveryKey,
} from "./notification-delivery-key.js";

describe("notification delivery keys", () => {
  it("keeps scheduled notification rule keys stable for send dedupe", () => {
    expect(
      buildNotificationRuleDeliveryKey({
        ruleId: "rule_sea",
        scheduledLocalDate: "2026-06-24",
        scheduledLocalTime: "08:00",
        targetIdHash: "1234567890abcdef9999",
        source: "worker_due",
        notificationRunId: "notification_run_1",
      }),
    ).toBe("notification_rule:rule_sea:2026-06-24:08:00:1234567890abcdef");
  });

  it("scopes manual run-now delivery keys by run id so each send can push LINE again", () => {
    const firstKey = buildNotificationRuleDeliveryKey({
      ruleId: "rule_sea",
      scheduledLocalDate: "2026-06-24",
      scheduledLocalTime: "08:00",
      targetIdHash: "1234567890abcdef9999",
      source: "manual_run_now",
      notificationRunId: "notification_run_first",
    });
    const secondKey = buildNotificationRuleDeliveryKey({
      ruleId: "rule_sea",
      scheduledLocalDate: "2026-06-24",
      scheduledLocalTime: "08:00",
      targetIdHash: "1234567890abcdef9999",
      source: "manual_run_now",
      notificationRunId: "notification_run_second",
    });

    expect(firstKey).toBe(
      "notification_rule:rule_sea:2026-06-24:08:00:1234567890abcdef:manual:notification_run_first",
    );
    expect(secondKey).toBe(
      "notification_rule:rule_sea:2026-06-24:08:00:1234567890abcdef:manual:notification_run_second",
    );
    expect(secondKey).not.toBe(firstKey);
  });

  it("scopes manual incident delivery keys by run id too", () => {
    expect(
      buildNotificationRuleIncidentDeliveryKey({
        ruleId: "rule_sea",
        scheduledLocalDate: "2026-06-24",
        scheduledLocalTime: "08:00",
        reportKey: "sales_goods_services",
        targetIdHash: "1234567890abcdef9999",
        source: "manual_run_now",
        notificationRunId: "notification_run_first",
      }),
    ).toBe(
      "notification_rule_incident:rule_sea:2026-06-24:08:00:sales_goods_services:1234567890abcdef:manual:notification_run_first",
    );
  });

  it("requires the run id when building a manual run-now key", () => {
    expect(() =>
      buildNotificationRuleDeliveryKey({
        ruleId: "rule_sea",
        scheduledLocalDate: "2026-06-24",
        scheduledLocalTime: "08:00",
        targetIdHash: "1234567890abcdef9999",
        source: "manual_run_now",
        notificationRunId: null,
      }),
    ).toThrow("notificationRunId is required");
  });
});
