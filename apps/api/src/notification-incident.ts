import type { LineSendMode } from "@ai-bcc/shared";

export function shouldSendReportFailureIncidentNotice(input: {
  enabled: boolean;
  mode: LineSendMode;
  attempt: number;
  maxAttempts: number;
}) {
  if (!input.enabled) {
    return false;
  }
  if (input.mode === "send") {
    return input.attempt >= input.maxAttempts;
  }
  return true;
}
