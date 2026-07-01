import { randomUUID } from "node:crypto";
import type {
  LineDeliveryRecord,
  LineFlexMessage,
  LineMessageType,
  ReportLinePreview,
  LineSendMode,
  TenantId,
} from "@ai-bcc/shared";
import type { LineChannelConfig } from "./config.js";

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";
const LINE_PROFILE_ENDPOINT = "https://api.line.me/v2/bot/profile";
const LINE_GROUP_SUMMARY_ENDPOINT = "https://api.line.me/v2/bot/group";
const LINE_FLEX_ALT_TEXT_MAX_LENGTH = 400;
const LINE_FLEX_MESSAGE_MAX_BYTES = 50_000;
const LINE_TEXT_MESSAGE_MAX_LENGTH = 5_000;
const LINE_PUSH_MESSAGES_MAX_COUNT = 5;

type LineTextMessage = {
  type: "text";
  text: string;
};
type LinePushMessage = LineTextMessage | LineFlexMessage;

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
  const { lineMessages, messageType } = buildSafeLineMessages(input.preview);
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
        messages: lineMessages,
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

export async function sendLineTextPush(input: {
  channelAccessToken: string;
  targetId: string;
  text: string;
}): Promise<void> {
  const response = await fetch(LINE_PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.channelAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: input.targetId,
      messages: [{ type: "text", text: truncateLineMessageText(input.text) }],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LINE push failed with status ${response.status}: ${body.slice(0, 200)}`);
  }
}

export async function sendLineReply(input: {
  channelAccessToken: string;
  replyToken: string;
  messages: Array<{ type: "text"; text: string }>;
}): Promise<void> {
  const response = await fetch(LINE_REPLY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.channelAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      replyToken: input.replyToken,
      messages: input.messages,
    }),
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LINE reply failed with status ${response.status}: ${body.slice(0, 200)}`);
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

function buildSafeLineMessages(preview: ReportLinePreview): {
  lineMessages: LinePushMessage[];
  messageType: LineMessageType;
} {
  const explicitMessages = normalizeExplicitLineMessages(preview);
  if (explicitMessages.length) {
    return {
      lineMessages: explicitMessages,
      messageType: explicitMessages.some((message) => message.type === "flex")
        ? "flex"
        : "text",
    };
  }

  if (preview.flex_message && isSafeFlexMessage(preview.flex_message)) {
    return {
      lineMessages: [preview.flex_message],
      messageType: "flex",
    };
  }

  return {
    lineMessages: [{
      type: "text",
      text: truncateLineMessageText(preview.text),
    }],
    messageType: "text",
  };
}

function normalizeExplicitLineMessages(preview: ReportLinePreview) {
  const value = (preview as ReportLinePreview & { line_messages?: unknown })
    .line_messages;
  if (!Array.isArray(value)) {
    return [];
  }

  const messages: LinePushMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Partial<LinePushMessage>;
    if (candidate.type === "text" && typeof candidate.text === "string") {
      const text = truncateLineMessageText(candidate.text.trim());
      if (text) {
        messages.push({ type: "text", text });
      }
      continue;
    }
    if (candidate.type === "flex" && isSafeFlexMessage(candidate as LineFlexMessage)) {
      messages.push(candidate as LineFlexMessage);
    }
  }

  return messages.slice(0, LINE_PUSH_MESSAGES_MAX_COUNT);
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
