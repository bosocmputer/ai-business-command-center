type NotificationDeliveryKeyBaseInput = {
  ruleId: string;
  scheduledLocalDate: string;
  scheduledLocalTime: string;
  targetIdHash: string;
  source: string;
  notificationRunId?: string | null;
};

function appendManualRunKeyParts(
  parts: string[],
  input: NotificationDeliveryKeyBaseInput,
) {
  if (input.source !== "manual_run_now") {
    return parts;
  }

  const runId = input.notificationRunId?.trim();
  if (!runId) {
    throw new Error("notificationRunId is required for manual run delivery keys");
  }

  return [...parts, "manual", runId];
}

export function buildNotificationRuleDeliveryKey(
  input: NotificationDeliveryKeyBaseInput,
) {
  return appendManualRunKeyParts(
    [
      "notification_rule",
      input.ruleId,
      input.scheduledLocalDate,
      input.scheduledLocalTime,
      input.targetIdHash.slice(0, 16),
    ],
    input,
  ).join(":");
}

export function buildNotificationRuleIncidentDeliveryKey(
  input: NotificationDeliveryKeyBaseInput & { reportKey: string },
) {
  return appendManualRunKeyParts(
    [
      "notification_rule_incident",
      input.ruleId,
      input.scheduledLocalDate,
      input.scheduledLocalTime,
      input.reportKey,
      input.targetIdHash.slice(0, 16),
    ],
    input,
  ).join(":");
}
