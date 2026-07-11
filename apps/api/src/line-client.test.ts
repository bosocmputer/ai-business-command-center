import { afterEach, describe, expect, it, vi } from "vitest";
import type { SalesGoodsServicesLinePreview } from "@ai-bcc/shared";
import {
  fetchLineBotInfo,
  fetchLineTargetDisplayName,
  sendLineBrief,
  sendLineReply,
  verifyLineGroupMember,
} from "./line-client.js";

const preview = {
  tenant_id: "tenant_demo_remote",
  report_key: "sales_goods_services",
  run_id: "run_test",
  generated_at: "2026-05-19T10:00:00.000Z",
  source: "sml_postgres",
  line_message_type: "text",
  title: "Morning Brief",
  text: "Morning Brief test",
  lines: ["Morning Brief test"],
  warnings: [],
  dashboard_url: "http://example.test/command-center",
} satisfies SalesGoodsServicesLinePreview;

const flexPreview = {
  ...preview,
  line_message_type: "flex",
  text: "รายงานขาย fallback text",
  flex_message: {
    type: "flex",
    altText: "รายงานขาย Demo Remote",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "รายงานขายสินค้าและบริการ",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            action: {
              type: "uri",
              label: "เปิดรายงาน",
              uri: "https://example.test/command-center/brief?signed=1",
            },
          },
        ],
      },
    },
  },
} satisfies SalesGoodsServicesLinePreview;

describe("sendLineBrief", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records a dry run without sending to LINE", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendLineBrief({
      tenantId: "tenant_demo_remote",
      mode: "dry_run",
      preview,
      config: {
        channelAccessToken: "line-token",
        targetId: "C1234567890abcdef",
      },
      deliveryKey:
        "tenant_demo_remote:sales_goods_services:morning_brief:2026-05-18:2026-05-18",
      deliveryType: "morning_brief",
      periodFrom: "2026-05-18",
      periodTo: "2026-05-18",
    });

    expect(result.status).toBe("dry_run");
    expect(result.delivery_type).toBe("morning_brief");
    expect(result.period_from).toBe("2026-05-18");
    expect(result.target_id_masked).toBe("C123...cdef");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips live sends when channel config is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendLineBrief({
      tenantId: "tenant_demo_remote",
      mode: "send",
      preview,
      config: null,
    });

    expect(result.status).toBe("skipped");
    expect(result.safe_error_message).toContain("Set LINE OA and recipients");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends a text message to the configured target", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ sentMessages: [{ id: "msg-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendLineBrief({
      tenantId: "tenant_demo_remote",
      mode: "send",
      preview,
      config: {
        channelAccessToken: "line-token",
        targetId: "C1234567890abcdef",
      },
    });

    expect(result.status).toBe("success");
    expect(result.sent_at).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/push",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer line-token",
        }),
      }),
    );
  });

  it("sends a Flex message when the preview includes a Flex payload", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ sentMessages: [{ id: "msg-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendLineBrief({
      tenantId: "tenant_demo_remote",
      mode: "send",
      preview: flexPreview,
      config: {
        channelAccessToken: "line-token",
        targetId: "C1234567890abcdef",
      },
    });

    const [, request] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(request.body)) as {
      messages: Array<Record<string, unknown>>;
    };

    expect(result.status).toBe("success");
    expect(result.message_type).toBe("flex");
    expect(body.messages[0]).toMatchObject({
      type: "flex",
      altText: "รายงานขาย Demo Remote",
    });
    expect(JSON.stringify(body.messages[0])).toContain("เปิดรายงาน");
  });

  it("sends an AI CEO text message before report Flex cards in one push", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ sentMessages: [{ id: "msg-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendLineBrief({
      tenantId: "tenant_demo_remote",
      mode: "send",
      preview: {
        ...flexPreview,
        text: "AI CEO summary\n\n---\n\nรายงานขาย fallback text",
        line_messages: [
          { type: "text", text: "AI CEO summary" },
          flexPreview.flex_message,
        ],
      } as SalesGoodsServicesLinePreview & { line_messages: unknown[] },
      config: {
        channelAccessToken: "line-token",
        targetId: "C1234567890abcdef",
      },
    });

    const [, request] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(request.body)) as {
      messages: Array<{ type: string; text?: string; altText?: string }>;
    };

    expect(result.status).toBe("success");
    expect(result.message_type).toBe("flex");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({
      type: "text",
      text: "AI CEO summary",
    });
    expect(body.messages[1]).toMatchObject({
      type: "flex",
      altText: "รายงานขาย Demo Remote",
    });
  });

  it("falls back to text when a Flex payload is not LINE-safe", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ sentMessages: [{ id: "msg-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendLineBrief({
      tenantId: "tenant_demo_remote",
      mode: "send",
      preview: {
        ...flexPreview,
        flex_message: {
          ...flexPreview.flex_message,
          altText: "ก".repeat(401),
        },
      },
      config: {
        channelAccessToken: "line-token",
        targetId: "C1234567890abcdef",
      },
    });

    const [, request] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(request.body)) as {
      messages: Array<{ type: string; text?: string; altText?: string }>;
    };

    expect(result.status).toBe("success");
    expect(result.message_type).toBe("text");
    expect(body.messages[0]).toEqual({
      type: "text",
      text: flexPreview.text,
    });
  });

  it("truncates oversized text messages before sending to LINE", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ sentMessages: [{ id: "msg-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendLineBrief({
      tenantId: "tenant_demo_remote",
      mode: "send",
      preview: {
        ...preview,
        text: "x".repeat(5_100),
        lines: ["x".repeat(5_100)],
      },
      config: {
        channelAccessToken: "line-token",
        targetId: "C1234567890abcdef",
      },
    });

    const [, request] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(request.body)) as {
      messages: Array<{ type: string; text?: string }>;
    };

    expect(result.status).toBe("success");
    expect(result.message_type).toBe("text");
    expect(body.messages[0].type).toBe("text");
    expect(body.messages[0].text).toHaveLength(5_000);
    expect(body.messages[0].text?.endsWith("...")).toBe(true);
  });

  it("returns a safe provider failure without leaking secrets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ message: "rate limited" }),
      }),
    );

    const result = await sendLineBrief({
      tenantId: "tenant_demo_remote",
      mode: "send",
      preview,
      config: {
        channelAccessToken: "secret-token",
        targetId: "C1234567890abcdef",
      },
    });

    expect(result.status).toBe("failed");
    expect(result.safe_error_message).toBe("LINE push failed with status 429.");
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(JSON.stringify(result)).not.toContain("C1234567890abcdef");
  });

  it("handles network failures as provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    const result = await sendLineBrief({
      tenantId: "tenant_demo_remote",
      mode: "send",
      preview,
      config: {
        channelAccessToken: "line-token",
        targetId: "C1234567890abcdef",
      },
    });

    expect(result.status).toBe("failed");
    expect(result.safe_error_message).toBe(
      "LINE push failed due to network or provider error.",
    );
  });

  it("fetches a LINE group display name without exposing the raw target id", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ groupName: "ผู้บริหาร Demo" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const displayName = await fetchLineTargetDisplayName({
      config: {
        channelAccessToken: "line-token",
        targetId: "C1234567890abcdef",
        targetType: "group",
      },
      target: {
        target_id: "C1234567890abcdef",
        target_type: "group",
      },
    });

    expect(displayName).toBe("ผู้บริหาร Demo");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/group/C1234567890abcdef/summary",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer line-token",
        }),
      }),
    );
  });

  it("loads Bot Info and verifies group membership with bounded LINE calls", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          basicId: "@365sxedv",
          displayName: "AI Business Center",
        }),
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      fetchLineBotInfo({ channelAccessToken: "line-token" }),
    ).resolves.toEqual({
      basicId: "@365sxedv",
      premiumId: null,
      displayName: "AI Business Center",
    });
    await expect(
      verifyLineGroupMember({
        channelAccessToken: "line-token",
        groupId: "C1234567890abcdef",
        userId: "U1234567890abcdef",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(fetchSpy.mock.calls[1][0]).toContain(
      "/group/C1234567890abcdef/member/U1234567890abcdef",
    );
  });

  it("classifies membership denial, channel configuration, and retryable failures", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: false, status: 429 });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      verifyLineGroupMember({
        channelAccessToken: "line-token",
        groupId: "group",
        userId: "user",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "not_member" });
    await expect(
      verifyLineGroupMember({
        channelAccessToken: "line-token",
        groupId: "group",
        userId: "user",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "configuration_failure" });
    await expect(
      verifyLineGroupMember({
        channelAccessToken: "line-token",
        groupId: "group",
        userId: "user",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "temporary_failure" });
  });

  it("replies with a safe Flex message", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => "{}" });
    vi.stubGlobal("fetch", fetchSpy);

    await sendLineReply({
      channelAccessToken: "line-token",
      replyToken: "reply-token",
      messages: [flexPreview.flex_message],
    });

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].type).toBe("flex");
  });
});
