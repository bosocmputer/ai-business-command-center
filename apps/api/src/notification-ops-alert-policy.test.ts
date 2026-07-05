import { describe, expect, it } from "vitest";
import {
  buildAiCeoFailureOpsAction,
  shouldSendAiCeoFailureOpsAlert,
  shouldSendNotificationSummaryOpsAlert,
} from "./notification-ops-alert-policy.js";

describe("notification ops alert policy", () => {
  it("does not send Telegram summaries for normal successful send rounds", () => {
    expect(
      shouldSendNotificationSummaryOpsAlert({
        mode: "send",
        degradedReportCount: 0,
        deliveryStatuses: ["success", "success"],
      }),
    ).toBe(false);
  });

  it("keeps Telegram summaries for abnormal notification rounds", () => {
    expect(
      shouldSendNotificationSummaryOpsAlert({
        mode: "send",
        degradedReportCount: 1,
        deliveryStatuses: ["success"],
      }),
    ).toBe(true);
    expect(
      shouldSendNotificationSummaryOpsAlert({
        mode: "send",
        degradedReportCount: 0,
        deliveryStatuses: [],
      }),
    ).toBe(true);
    expect(
      shouldSendNotificationSummaryOpsAlert({
        mode: "dry_run",
        degradedReportCount: 1,
        deliveryStatuses: ["failed"],
      }),
    ).toBe(false);
  });

  it("alerts when AI CEO fails during a real notification send", () => {
    expect(
      shouldSendAiCeoFailureOpsAlert({
        mode: "send",
        aiCeoEnabled: true,
        aiCeoStatus: "failed",
        safeErrorMessage: "เครดิต OpenRouter ไม่พอสำหรับ API key นี้ (HTTP 402)",
      }),
    ).toBe(true);
    expect(
      shouldSendAiCeoFailureOpsAlert({
        mode: "send",
        aiCeoEnabled: true,
        aiCeoStatus: "success_with_warnings",
        safeErrorMessage: null,
      }),
    ).toBe(false);
    expect(
      shouldSendAiCeoFailureOpsAlert({
        mode: "dry_run",
        aiCeoEnabled: true,
        aiCeoStatus: "failed",
        safeErrorMessage: "OpenRouter ถูกจำกัดความถี่การเรียกใช้งาน (HTTP 429)",
      }),
    ).toBe(false);
  });

  it("turns OpenRouter failures into concrete admin actions", () => {
    expect(buildAiCeoFailureOpsAction("เครดิต OpenRouter ไม่พอ (HTTP 402)")).toContain(
      "เติมเครดิต",
    );
    expect(buildAiCeoFailureOpsAction("OpenRouter ถูกจำกัดความถี่ (HTTP 429)")).toContain(
      "rate limit",
    );
  });
});
