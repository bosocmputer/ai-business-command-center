import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeLineWebhookEvents,
  sanitizeLineWebhookEvent,
  verifyLineSignature,
} from "./line-webhook.js";

describe("LINE webhook helpers", () => {
  it("verifies LINE signatures against the raw request body", () => {
    const rawBody = JSON.stringify({ events: [] });
    const channelSecret = "test_secret";
    const signature = createHmac("sha256", channelSecret)
      .update(rawBody)
      .digest("base64");

    expect(
      verifyLineSignature({ rawBody, channelSecret, signature }),
    ).toBe(true);
    expect(
      verifyLineSignature({
        rawBody,
        channelSecret,
        signature: "invalid",
      }),
    ).toBe(false);
  });

  it("extracts a group target id from message events", () => {
    const records = normalizeLineWebhookEvents({
      events: [
        {
          type: "message",
          webhookEventId: "event-1",
          source: {
            type: "group",
            groupId: "C1234567890abcdef1234567890abcdef",
            userId: "U1234567890abcdef1234567890abcdef",
          },
          message: {
            type: "text",
            text: "test",
          },
        },
      ],
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "event-1",
      event_type: "message",
      source_type: "group",
      source_id: "C1234567890abcdef1234567890abcdef",
      message_text: "test",
    });
  });

  it("sanitizes event ids for public debug responses", () => {
    const [event] = normalizeLineWebhookEvents({
      events: [
        {
          type: "join",
          source: {
            type: "group",
            groupId: "C1234567890abcdef1234567890abcdef",
          },
        },
      ],
    });

    expect(sanitizeLineWebhookEvent(event).source_id).toBeNull();
    expect(sanitizeLineWebhookEvent(event).source_id_masked).toBe(
      "C1234...bcdef",
    );
  });
});
