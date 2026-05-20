import { afterEach, describe, expect, it, vi } from "vitest";
import type { SalesGoodsServicesLinePreview } from "@ai-bcc/shared";
import { sendLineBrief } from "./line-client.js";

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
    expect(result.safe_error_message).toContain("LINE channel is not configured");
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
});
