import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTelegramUpdates, sendTelegramMessage } from "./telegram-client.js";

function mockTelegramResponse(payload: Record<string, unknown>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

describe("Telegram client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads chats from getUpdates array results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockTelegramResponse({
          ok: true,
          result: [
            {
              update_id: 175541469,
              message: {
                message_id: 1,
                text: "/start",
                chat: {
                  id: 7500012341,
                  type: "private",
                  first_name: "Bos",
                },
              },
            },
          ],
        }),
      ),
    );

    const result = await fetchTelegramUpdates({ token: "telegram-token" });

    expect(result).toEqual({
      ok: true,
      chats: [
        {
          chat_id: "7500012341",
          display_name: "Bos",
          type: "private",
        },
      ],
    });
  });

  it("keeps sendMessage provider response sanitized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockTelegramResponse({
          ok: true,
          result: {
            message_id: 12,
            text: "do not persist this text",
            chat: {
              id: 7500012341,
              type: "private",
              first_name: "Bos",
            },
          },
        }),
      ),
    );

    const result = await sendTelegramMessage({
      token: "telegram-token",
      chatId: "7500012341",
      text: "test alert",
    });

    expect(result.provider_response_json).toEqual({
      ok: true,
      result: {
        message_id: 12,
      },
    });
    expect(JSON.stringify(result.provider_response_json)).not.toContain(
      "do not persist this text",
    );
    expect(JSON.stringify(result.provider_response_json)).not.toContain(
      "7500012341",
    );
  });
});
