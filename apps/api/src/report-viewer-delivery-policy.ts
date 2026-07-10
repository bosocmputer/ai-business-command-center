import type { LineTargetRecord } from "@ai-bcc/shared";

export function canIssueReportViewerLink(input: {
  targetType: LineTargetRecord["target_type"];
  permissionAllowed: boolean;
  supportsSignedViewer?: boolean;
}) {
  return (
    input.targetType === "user" &&
    input.permissionAllowed &&
    (input.supportsSignedViewer ?? true)
  );
}
