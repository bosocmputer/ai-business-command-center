import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  LineWebhookEventRecord,
  LineWebhookSourceType,
} from "@ai-bcc/shared";

type LineWebhookPayload = {
  destination?: string;
  events?: unknown[];
};

type LineWebhookEvent = {
  type?: string;
  webhookEventId?: string;
  timestamp?: number;
  source?: {
    type?: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  message?: {
    type?: string;
    text?: string;
  };
};

export function verifyLineSignature(input: {
  rawBody: string;
  channelSecret: string;
  signature: string | undefined;
}) {
  if (!input.signature) {
    return false;
  }

  const expected = createHmac("sha256", input.channelSecret)
    .update(input.rawBody)
    .digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(input.signature);

  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export function normalizeLineWebhookEvents(
  payload: LineWebhookPayload,
): LineWebhookEventRecord[] {
  const now = new Date().toISOString();
  return (payload.events ?? [])
    .filter(isLineWebhookEvent)
    .map((event, index) => {
      const sourceType = normalizeSourceType(event.source?.type);
      const sourceId = getSourceId(sourceType, event.source);

      return {
        id:
          event.webhookEventId ||
          `line_webhook_${event.timestamp ?? Date.now()}_${index}`,
        event_type: event.type || "unknown",
        source_type: sourceType,
        source_id: sourceId,
        source_id_masked: sourceId ? maskLineId(sourceId) : null,
        user_id: event.source?.userId ?? null,
        message_text:
          event.message?.type === "text" ? event.message.text ?? null : null,
        raw_event_json: event as Record<string, unknown>,
        created_at: now,
      } satisfies LineWebhookEventRecord;
    });
}

export function sanitizeLineWebhookEvent(event: LineWebhookEventRecord) {
  return {
    ...event,
    source_id: null,
    user_id: event.user_id ? maskLineId(event.user_id) : null,
    raw_event_json: {},
  } satisfies LineWebhookEventRecord;
}

function isLineWebhookEvent(value: unknown): value is LineWebhookEvent {
  return Boolean(value && typeof value === "object");
}

function normalizeSourceType(value: string | undefined): LineWebhookSourceType {
  if (value === "user" || value === "group" || value === "room") {
    return value;
  }

  return "unknown";
}

function getSourceId(
  sourceType: LineWebhookSourceType,
  source: LineWebhookEvent["source"],
) {
  if (!source) {
    return null;
  }

  if (sourceType === "group") {
    return source.groupId ?? null;
  }

  if (sourceType === "room") {
    return source.roomId ?? null;
  }

  if (sourceType === "user") {
    return source.userId ?? null;
  }

  return null;
}

function maskLineId(value: string) {
  if (value.length <= 10) {
    return "********";
  }

  return `${value.slice(0, 5)}...${value.slice(-5)}`;
}
