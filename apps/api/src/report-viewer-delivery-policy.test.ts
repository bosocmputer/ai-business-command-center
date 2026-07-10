import { describe, expect, it } from "vitest";
import { canIssueReportViewerLink } from "./report-viewer-delivery-policy.js";

describe("report viewer LINE delivery policy", () => {
  it("allows signed viewer links only for permitted user targets", () => {
    expect(
      canIssueReportViewerLink({ targetType: "user", permissionAllowed: true }),
    ).toBe(true);
    expect(
      canIssueReportViewerLink({ targetType: "user", permissionAllowed: false }),
    ).toBe(false);
  });

  it("never issues viewer links for group or room targets", () => {
    expect(
      canIssueReportViewerLink({ targetType: "group", permissionAllowed: true }),
    ).toBe(false);
    expect(
      canIssueReportViewerLink({ targetType: "room", permissionAllowed: true }),
    ).toBe(false);
  });
});
