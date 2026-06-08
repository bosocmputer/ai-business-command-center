import { randomUUID } from "node:crypto";
import type {
  LineDeliveryRecord,
  LineMessageType,
  ReportLinePreview,
  LineSendMode,
  TenantId,
} from "@ai-bcc/shared";
import type { LineChannelConfig } from "./config.js";

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
const LINE_PROFILE_ENDPOINT = "https://api.line.me/v2/bot/profile";
const LINE_GROUP_SUMMARY_ENDPOINT = "https://api.line.me/v2/bot/group";
const LINE_FLEX_ALT_TEXT_MAX_LENGTH = 400;
const LINE_FLEX_MESSAGE_MAX_BYTES = 50_000;
const LINE_TEXT_MESSAGE_MAX_LENGTH = 5_000;

export type SendLineBriefInput = {
  tenantId: TenantId;
  mode: LineSendMode;
  preview: ReportLinePreview;
  config: LineChannelConfig | null;
  deliveryKey?: string | null;
  deliveryType?: LineDeliveryRecord["delivery_type"];
  periodFrom?: string | null;
  periodTo?: string | null;
};

export async function sendLineBrief(
  input: SendLineBriefInput,
): Promise<LineDeliveryRecord> {
  const now = new Date().toISOString();
  const configured = Boolean(input.config);
  const { lineMessage, messageType } = buildSafeLineMessage(input.preview);
  const baseDelivery = {
    id: createLineDeliveryId(input.tenantId),
    tenant_id: input.tenantId,
    report_key: input.preview.report_key,
    report_run_id: input.preview.run_id,
    delivery_key: input.deliveryKey ?? null,
    delivery_type: input.deliveryType ?? "manual_test",
    period_from: input.periodFrom ?? null,
    period_to: input.periodTo ?? null,
    target_id_masked: input.config ? maskTargetId(input.config.targetId) : null,
    message_type: messageType,
    sent_at: null,
    provider_response_json: null,
    safe_error_message: null,
    created_at: now,
  };

  if (input.mode === "dry_run") {
    return {
      ...baseDelivery,
      status: "dry_run",
      safe_error_message: configured
        ? null
        : "LINE channel or approved target is not configured. Set LINE OA and recipients in Owner UI.",
    };
  }

  if (!input.config) {
    return {
      ...baseDelivery,
      status: "skipped",
      safe_error_message:
        "LINE channel or approved target is not configured. Set LINE OA and recipients in Owner UI.",
    };
  }

  try {
    const response = await fetch(LINE_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.config.channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: input.config.targetId,
        messages: [lineMessage],
      }),
    });

    const responseText = await response.text();
    const providerResponse = parseProviderResponse(responseText);

    if (!response.ok) {
      return {
        ...baseDelivery,
        status: "failed",
        provider_response_json: providerResponse,
        safe_error_message: `LINE push failed with status ${response.status}.`,
      };
    }

    return {
      ...baseDelivery,
      status: "success",
      sent_at: new Date().toISOString(),
      provider_response_json: providerResponse,
    };
  } catch {
    return {
      ...baseDelivery,
      status: "failed",
      safe_error_message: "LINE push failed due to network or provider error.",
    };
  }
}

export async function fetchLineTargetDisplayName(input: {
  config: LineChannelConfig | null;
  target: {
    target_id: string;
    target_type: "group" | "room" | "user";
  };
}) {
  if (!input.config) {
    return null;
  }

  const endpoint = buildLineTargetProfileEndpoint(input.target);
  if (!endpoint) {
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.config.channelAccessToken}`,
      },
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const name =
      typeof payload.groupName === "string"
        ? payload.groupName
        : typeof payload.displayName === "string"
        ? payload.displayName
        : null;

    return name?.trim() || null;
  } catch {
    return null;
  }
}

function buildLineTargetProfileEndpoint(input: {
  target_id: string;
  target_type: "group" | "room" | "user";
}) {
  if (input.target_type === "group") {
    return `${LINE_GROUP_SUMMARY_ENDPOINT}/${encodeURIComponent(
      input.target_id,
    )}/summary`;
  }

  if (input.target_type === "user") {
    return `${LINE_PROFILE_ENDPOINT}/${encodeURIComponent(input.target_id)}`;
  }

  return null;
}

function createLineDeliveryId(tenantId: TenantId) {
  return `line_${tenantId}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function buildSafeLineMessage(preview: ReportLinePreview): {
  lineMessage: Record<string, unknown>;
  messageType: LineMessageType;
} {
  if (preview.flex_message && isSafeFlexMessage(preview.flex_message)) {
    return {
      lineMessage: preview.flex_message,
      messageType: "flex",
    };
  }

  return {
    lineMessage: {
      type: "text",
      text: truncateLineMessageText(preview.text),
    },
    messageType: "text",
  };
}

function isSafeFlexMessage(message: ReportLinePreview["flex_message"]) {
  if (!message) {
    return false;
  }
  if (
    typeof message.altText !== "string" ||
    !message.altText.trim() ||
    message.altText.length > LINE_FLEX_ALT_TEXT_MAX_LENGTH
  ) {
    return false;
  }

  try {
    return (
      Buffer.byteLength(JSON.stringify(message), "utf8") <=
      LINE_FLEX_MESSAGE_MAX_BYTES
    );
  } catch {
    return false;
  }
}

function truncateLineMessageText(value: string) {
  if (value.length <= LINE_TEXT_MESSAGE_MAX_LENGTH) {
    return value;
  }

  return `${value.slice(0, LINE_TEXT_MESSAGE_MAX_LENGTH - 3)}...`;
}

function maskTargetId(value: string) {
  if (value.length <= 8) {
    return "********";
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseProviderResponse(value: string): Record<string, unknown> {
  if (!value.trim()) {
    return {};
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return { raw: value.slice(0, 500) };
  }
}
