import {
  getReportPresetEntry,
  type NotificationRuleRecord,
  type ReportPresetKey,
} from "@ai-bcc/shared";

export const defaultNotificationReportPresetRuleIds = [
  "notification_rule_seaandhill_demo_1780299602970",
  "notification_rule_tenant_demo_remote_morning_brief_digest",
] as const;

export function buildNotificationReportPresetUpdate(input: {
  presetKey: ReportPresetKey;
  rule: NotificationRuleRecord;
  updatedAt: string;
}) {
  const preset = getReportPresetEntry(input.presetKey);
  const oldReportKeys = input.rule.report_keys;
  const newReportKeys = [...preset.reportKeys];
  const changed = oldReportKeys.join("|") !== newReportKeys.join("|");

  return {
    changed,
    oldReportKeys,
    newReportKeys,
    updatedRule: {
      ...input.rule,
      report_keys: newReportKeys,
      updated_at: input.updatedAt,
    },
    auditMetadata: {
      preset_key: preset.key,
      preset_label: preset.label,
      old_report_keys: oldReportKeys,
      new_report_keys: newReportKeys,
      source: "cli",
    },
  };
}
