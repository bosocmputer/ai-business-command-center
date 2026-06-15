const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

export type TelegramBotInfo = {
  id: number;
  username: string | null;
  first_name: string | null;
};

export type TelegramChatPreview = {
  chat_id: string;
  display_name: string;
  type: string;
};

export type TelegramSendResult = {
  ok: boolean;
  status: number | null;
  provider_response_json: Record<string, unknown> | null;
  safe_error_message: string | null;
};

export async function validateTelegramBotToken(input: {
  token: string;
  timeoutMs?: number;
}): Promise<
  | { ok: true; bot: TelegramBotInfo }
  | { ok: false; safe_error_message: string; provider_status: number | null }
> {
  const result = await requestTelegramApi({
    token: input.token,
    method: "getMe",
    timeoutMs: input.timeoutMs,
  });
  if (!result.ok) {
    return {
      ok: false,
      safe_error_message:
        result.safe_error_message ?? "Telegram bot token could not be verified.",
      provider_status: result.status,
    };
  }

  const payload = result.provider_response_json?.result;
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      safe_error_message: "Telegram getMe returned an unreadable response.",
      provider_status: result.status,
    };
  }

  const bot = payload as Record<string, unknown>;
  return {
    ok: true,
    bot: {
      id: typeof bot.id === "number" ? bot.id : 0,
      username: typeof bot.username === "string" ? bot.username : null,
      first_name: typeof bot.first_name === "string" ? bot.first_name : null,
    },
  };
}

export async function fetchTelegramUpdates(input: {
  token: string;
  timeoutMs?: number;
}): Promise<
  | { ok: true; chats: TelegramChatPreview[] }
  | { ok: false; safe_error_message: string; provider_status: number | null }
> {
  const result = await requestTelegramApi({
    token: input.token,
    method: "getUpdates",
    timeoutMs: input.timeoutMs,
  });
  if (!result.ok) {
    return {
      ok: false,
      safe_error_message:
        result.safe_error_message ?? "Telegram updates could not be loaded.",
      provider_status: result.status,
    };
  }

  const updates = Array.isArray(result.provider_response_json?.result)
    ? (result.provider_response_json.result as unknown[])
    : [];
  const byChatId = new Map<string, TelegramChatPreview>();
  for (const update of updates) {
    const message = readTelegramMessage(update);
    const chat = message?.chat;
    if (!chat || typeof chat !== "object") {
      continue;
    }
    const chatRecord = chat as Record<string, unknown>;
    const chatId =
      typeof chatRecord.id === "number" || typeof chatRecord.id === "string"
        ? String(chatRecord.id)
        : null;
    if (!chatId) {
      continue;
    }
    byChatId.set(chatId, {
      chat_id: chatId,
      display_name: buildChatDisplayName(chatRecord),
      type: typeof chatRecord.type === "string" ? chatRecord.type : "unknown",
    });
  }

  return { ok: true, chats: Array.from(byChatId.values()) };
}

export async function sendTelegramMessage(input: {
  token: string;
  chatId: string;
  text: string;
  timeoutMs?: number;
}): Promise<TelegramSendResult> {
  return requestTelegramApi({
    token: input.token,
    method: "sendMessage",
    timeoutMs: input.timeoutMs,
    body: {
      chat_id: input.chatId,
      text: truncateTelegramMessage(input.text),
      disable_web_page_preview: true,
    },
  });
}

async function requestTelegramApi(input: {
  token: string;
  method: string;
  timeoutMs?: number;
  body?: Record<string, unknown>;
}): Promise<TelegramSendResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, input.timeoutMs ?? 8000),
  );
  try {
    const response = await fetch(
      `${TELEGRAM_API_BASE}/bot${input.token}/${input.method}`,
      {
        method: input.body ? "POST" : "GET",
        headers: input.body ? { "Content-Type": "application/json" } : undefined,
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      },
    );
    const responseText = await response.text();
    const providerResponse = parseProviderResponse(responseText);
    const telegramOk = providerResponse?.ok === true;
    if (!response.ok || !telegramOk) {
      return {
        ok: false,
        status: response.status,
        provider_response_json: sanitizeTelegramProviderResponse(providerResponse),
        safe_error_message: `Telegram API failed with status ${response.status}.`,
      };
    }

    return {
      ok: true,
      status: response.status,
      provider_response_json: sanitizeTelegramProviderResponse(providerResponse),
      safe_error_message: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      provider_response_json: null,
      safe_error_message:
        error instanceof DOMException && error.name === "AbortError"
          ? "Telegram API request timed out."
          : "Telegram API request failed due to network or provider error.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseProviderResponse(value: string): Record<string, unknown> | null {
  if (!value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return { unreadable_response: true, byte_count: Buffer.byteLength(value) };
  }
}

function sanitizeTelegramProviderResponse(
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  const sanitized: Record<string, unknown> = {};
  if (typeof value.ok === "boolean") {
    sanitized.ok = value.ok;
  }
  if (typeof value.error_code === "number") {
    sanitized.error_code = value.error_code;
  }
  if (typeof value.description === "string") {
    sanitized.description = value.description.slice(0, 200);
  }
  if (typeof value.unreadable_response === "boolean") {
    sanitized.unreadable_response = value.unreadable_response;
  }
  if (typeof value.byte_count === "number") {
    sanitized.byte_count = value.byte_count;
  }
  if (value.result && typeof value.result === "object") {
    sanitized.result = sanitizeTelegramResult(value.result as Record<string, unknown>);
  }
  return sanitized;
}

function sanitizeTelegramResult(value: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {};
  if (typeof value.message_id === "number") {
    sanitized.message_id = value.message_id;
  }
  if (typeof value.id === "number") {
    sanitized.id = value.id;
  }
  if (typeof value.username === "string") {
    sanitized.username = value.username;
  }
  if (typeof value.first_name === "string") {
    sanitized.first_name = value.first_name;
  }
  return sanitized;
}

function readTelegramMessage(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const update = value as Record<string, unknown>;
  const candidate =
    update.message ??
    update.edited_message ??
    update.channel_post ??
    update.my_chat_member;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : null;
}

function buildChatDisplayName(chat: Record<string, unknown>) {
  const title =
    typeof chat.title === "string"
      ? chat.title
      : [chat.first_name, chat.last_name]
          .filter((part): part is string => typeof part === "string" && Boolean(part))
          .join(" ");
  return title.trim() || "Telegram chat";
}

function truncateTelegramMessage(value: string) {
  if (value.length <= TELEGRAM_MESSAGE_MAX_LENGTH) {
    return value;
  }
  return `${value.slice(0, TELEGRAM_MESSAGE_MAX_LENGTH - 3)}...`;
}
