import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ReportLinePreview } from "@ai-bcc/shared";
import type { GroupReportLaunchRecord } from "./system-store.js";

const GROUP_REPORT_COMMAND_PREFIX = "ขอลิงก์รายงาน";
const GROUP_REPORT_CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function createGroupReportLaunchCode() {
  return randomBytes(16).toString("base64url");
}

export function hashGroupReportLaunchCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export function parseGroupReportCommand(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  const prefix = `${GROUP_REPORT_COMMAND_PREFIX} `;
  if (!trimmed.startsWith(prefix)) {
    return null;
  }
  const code = trimmed.slice(prefix.length).trim();
  return GROUP_REPORT_CODE_PATTERN.test(code) ? code : null;
}

export function buildGroupReportChatUri(input: {
  oaId: string;
  code: string;
}) {
  if (!GROUP_REPORT_CODE_PATTERN.test(input.code)) {
    return null;
  }
  const oaId = input.oaId.trim();
  if (!oaId.startsWith("@") || oaId.length > 64) {
    return null;
  }
  const message = `${GROUP_REPORT_COMMAND_PREFIX} ${input.code}`;
  const uri = `https://line.me/R/oaMessage/${encodeURIComponent(oaId)}/?${encodeURIComponent(message)}`;
  return uri.length <= 1000 ? uri : null;
}

export function createGroupReportLaunch(input: {
  code: string;
  tenantId: GroupReportLaunchRecord["tenantId"];
  reportKey: GroupReportLaunchRecord["reportKey"];
  runId: string;
  groupTargetId: string;
  groupTargetIdHash: string;
  lineChannelId: string;
  notificationRunId: string | null;
  expiresAt: Date;
  now?: Date;
}): GroupReportLaunchRecord {
  const now = input.now ?? new Date();
  return {
    id: `group_launch_${randomUUID()}`,
    codeHash: hashGroupReportLaunchCode(input.code),
    tenantId: input.tenantId,
    reportKey: input.reportKey,
    runId: input.runId,
    groupTargetId: input.groupTargetId,
    groupTargetIdHash: input.groupTargetIdHash,
    lineChannelId: input.lineChannelId,
    notificationRunId: input.notificationRunId,
    expiresAt: input.expiresAt.toISOString(),
    revokedAt: null,
    createdAt: now.toISOString(),
  };
}

export function decorateGroupReportPreview(input: {
  preview: ReportLinePreview;
  desktopFallbackUrl: string;
}) {
  if (!input.preview.flex_message) {
    return input.preview;
  }
  const flexMessage = structuredClone(input.preview.flex_message);
  visitObjects(flexMessage.contents, (item) => {
    const action = item.action;
    if (!action || typeof action !== "object") {
      return;
    }
    const typedAction = action as Record<string, unknown>;
    if (typedAction.type !== "uri" || typeof typedAction.uri !== "string") {
      return;
    }
    typedAction.label = "รับลิงก์ส่วนตัว";
    typedAction.altUri = { desktop: input.desktopFallbackUrl };
  });
  return {
    ...input.preview,
    flex_message: flexMessage,
  };
}

export function redactGroupReportCommand(value: string | null) {
  return parseGroupReportCommand(value) ? "[group_report_access_request]" : value;
}

function visitObjects(value: unknown, visitor: (item: Record<string, unknown>) => void) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => visitObjects(item, visitor));
    return;
  }
  const item = value as Record<string, unknown>;
  visitor(item);
  Object.values(item).forEach((child) => visitObjects(child, visitor));
}
