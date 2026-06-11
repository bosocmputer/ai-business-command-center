import { describe, expect, it } from "vitest";
import { shouldSendReportFailureIncidentNotice } from "./notification-incident.js";

describe("notification incident policy", () => {
  it("does not send report failure incidents when the feature flag is off", () => {
    expect(
      shouldSendReportFailureIncidentNotice({
        enabled: false,
        mode: "send",
        attempt: 2,
        maxAttempts: 2,
      }),
    ).toBe(false);
  });

  it("does not send report failure incidents before the final retry attempt", () => {
    expect(
      shouldSendReportFailureIncidentNotice({
        enabled: true,
        mode: "send",
        attempt: 1,
        maxAttempts: 2,
      }),
    ).toBe(false);
  });

  it("sends report failure incidents on the final send attempt", () => {
    expect(
      shouldSendReportFailureIncidentNotice({
        enabled: true,
        mode: "send",
        attempt: 2,
        maxAttempts: 2,
      }),
    ).toBe(true);
  });

  it("allows dry-run smoke tests without waiting for retry state", () => {
    expect(
      shouldSendReportFailureIncidentNotice({
        enabled: true,
        mode: "dry_run",
        attempt: 1,
        maxAttempts: 2,
      }),
    ).toBe(true);
  });
});
