import type {
  NotificationReportResult,
  NotificationRuleRecord,
  NotificationRuleRunRecord,
} from "@ai-bcc/shared";

function isFreshSuccessfulReportResult(
  result: NotificationReportResult | null,
): result is NotificationReportResult {
  return (
    result !== null &&
    result.status === "success" &&
    result.freshness === "fresh" &&
    Boolean(result.run_id)
  );
}

export function selectDeliveryRetryReportResults(input: {
  rule: Pick<NotificationRuleRecord, "report_keys">;
  retryFromRun?: NotificationRuleRunRecord | null;
}): NotificationReportResult[] | null {
  const retryFromRun = input.retryFromRun;
  if (!retryFromRun || retryFromRun.mode !== "send") {
    return null;
  }
  if (retryFromRun.status !== "failed" || retryFromRun.delivery_ids.length === 0) {
    return null;
  }

  const resultsByReportKey = new Map(
    (retryFromRun.report_results ?? []).map((result) => [
      result.report_key,
      result,
    ]),
  );
  const reusableResults = input.rule.report_keys.map(
    (reportKey) => resultsByReportKey.get(reportKey) ?? null,
  );
  const allReportsAreFreshAndSuccessful = reusableResults.every(
    isFreshSuccessfulReportResult,
  );

  if (!allReportsAreFreshAndSuccessful) {
    return null;
  }

  return reusableResults.filter(
    (result): result is NotificationReportResult => Boolean(result),
  );
}
