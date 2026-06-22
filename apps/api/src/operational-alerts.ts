import { createHash, randomUUID } from "node:crypto";
import type {
  OperationalAlertDeliveryRecord,
  OperationalAlertSeverity,
  OperationalAlertTargetRecord,
  Tenant,
} from "@ai-bcc/shared";
import { tenantFeatureFlagsSchema } from "@ai-bcc/shared";
import { decryptSecret, encryptSecret } from "./secret-vault.js";
import type { SecretRecord, SystemStore } from "./system-store.js";
import { readSecretEncryptionSecret } from "./tenant-secret-config.js";
import {
  fetchTelegramUpdates,
  sendTelegramMessage,
  validateTelegramBotToken,
  type TelegramChatPreview,
} from "./telegram-client.js";

const SECRET_KEY_ID = "env:AI_BCC_SECRET_KEY";
const TELEGRAM_BOT_TOKEN_SECRET_ID = "secret_system_operational_telegram_bot_token";
const TELEGRAM_BOT_TOKEN_SECRET_KEY = "telegram_bot_token";
const TELEGRAM_BOT_TOKEN_AAD = "system:operational_alerts:telegram_bot_token";

export type OperationalAlertType =
  | "test"
  | "incident_dry_run"
  | "javaws_diagnostic"
  | "heavy_report_slow"
  | "notification_summary"
  | "notification_run_slow"
  | "notification_run_failed"
  | "javaws_failure"
  | "line_delivery_failed"
  | "worker_tick_failed"
  | "heartbeat_stale";

export type TelegramOperationalAlertStatus = {
  configured: boolean;
  encryption_configured: boolean;
  verified: boolean;
  bot_username: string | null;
  bot_first_name: string | null;
  updated_at: string | null;
  targets: Array<
    Pick<
      OperationalAlertTargetRecord,
      "id" | "display_name" | "target_id_masked" | "enabled" | "updated_at"
    >
  >;
};

export async function saveTelegramOperationalAlertToken(input: {
  store: SystemStore;
  token: string;
}) {
  const token = input.token.trim();
  if (!token) {
    throw new Error("Telegram bot token is required.");
  }
  const verification = await validateTelegramBotToken({ token });
  if (!verification.ok) {
    return {
      ok: false as const,
      safe_error_message: verification.safe_error_message,
      provider_status: verification.provider_status,
    };
  }

  const encryptionSecret = requireEncryptionSecret();
  const now = new Date().toISOString();
  const existing = await input.store.getSecretRecord(TELEGRAM_BOT_TOKEN_SECRET_ID);
  const record: SecretRecord = {
    id: TELEGRAM_BOT_TOKEN_SECRET_ID,
    tenant_id: null,
    scope: "system",
    secret_key: TELEGRAM_BOT_TOKEN_SECRET_KEY,
    encrypted_value: encryptSecret({
      plaintext: token,
      encryptionSecret,
      keyId: SECRET_KEY_ID,
      aad: TELEGRAM_BOT_TOKEN_AAD,
    }),
    encryption_key_id: SECRET_KEY_ID,
    metadata_json: {
      bot_id: verification.bot.id,
      bot_username: verification.bot.username,
      bot_first_name: verification.bot.first_name,
      verified_at: now,
    },
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await input.store.upsertSecretRecord(record);

  return {
    ok: true as const,
    bot: verification.bot,
    status: await readTelegramOperationalAlertStatus(input.store),
  };
}

export async function readTelegramOperationalAlertStatus(
  store: SystemStore,
): Promise<TelegramOperationalAlertStatus> {
  const secret = await store.getSecretRecord(TELEGRAM_BOT_TOKEN_SECRET_ID);
  const targets = await store.listOperationalAlertTargets("telegram");
  return {
    configured: Boolean(secret?.encrypted_value),
    encryption_configured: Boolean(readSecretEncryptionSecret()),
    verified:
      typeof secret?.metadata_json?.verified_at === "string" &&
      Boolean(secret.encrypted_value),
    bot_username:
      typeof secret?.metadata_json?.bot_username === "string"
        ? secret.metadata_json.bot_username
        : null,
    bot_first_name:
      typeof secret?.metadata_json?.bot_first_name === "string"
        ? secret.metadata_json.bot_first_name
        : null,
    updated_at: secret?.updated_at ?? null,
    targets: targets.map((target) => ({
      id: target.id,
      display_name: target.display_name,
      target_id_masked: target.target_id_masked,
      enabled: target.enabled,
      updated_at: target.updated_at,
    })),
  };
}

export async function loadTelegramUpdateChats(input: {
  store: SystemStore;
}): Promise<
  | { ok: true; chats: Array<TelegramChatPreview & { chat_id_masked: string }> }
  | { ok: false; safe_error_message: string; provider_status: number | null }
> {
  const token = await readTelegramBotToken(input.store);
  if (!token) {
    return {
      ok: false,
      safe_error_message:
        "ยังไม่ได้ตั้งค่า Telegram bot token ใน Owner UI",
      provider_status: null,
    };
  }
  const updates = await fetchTelegramUpdates({ token });
  if (!updates.ok) {
    return updates;
  }
  return {
    ok: true,
    chats: updates.chats.map((chat) => ({
      ...chat,
      chat_id_masked: maskTelegramChatId(chat.chat_id),
    })),
  };
}

export async function upsertTelegramOperationalAlertTarget(input: {
  store: SystemStore;
  chatId: string;
  displayName?: string | null;
  enabled?: boolean;
}) {
  const chatId = input.chatId.trim();
  if (!chatId) {
    throw new Error("Telegram chat is required.");
  }
  const encryptionSecret = requireEncryptionSecret();
  const targetHash = hashStableValue(chatId);
  const existing = (await input.store.listOperationalAlertTargets("telegram")).find(
    (target) => target.target_id_hash === targetHash,
  );
  const now = new Date().toISOString();
  const target: OperationalAlertTargetRecord = {
    id: existing?.id ?? `op_alert_tg_${targetHash.slice(0, 16)}`,
    channel: "telegram",
    display_name: input.displayName?.trim() || existing?.display_name || "Telegram",
    target_id_encrypted: encryptSecret({
      plaintext: chatId,
      encryptionSecret,
      keyId: SECRET_KEY_ID,
      aad: telegramTargetAad(targetHash),
    }),
    target_id_masked: maskTelegramChatId(chatId),
    target_id_hash: targetHash,
    enabled: input.enabled ?? existing?.enabled ?? true,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  return input.store.upsertOperationalAlertTarget(target);
}

export async function sendOperationalTelegramAlert(input: {
  store: SystemStore;
  tenant?: Tenant | null;
  alertType: OperationalAlertType;
  severity: OperationalAlertSeverity;
  dedupeKey?: string | null;
  messageText: string;
  dryRun?: boolean;
  forceEnabled?: boolean;
}) {
  const enabled =
    input.forceEnabled ||
    input.dryRun ||
    tenantFeatureFlagsSchema.parse(input.tenant?.featureFlags ?? {})
      .telegram_operational_alerts_enabled === true;
  if (!enabled) {
    return [
      await saveAlertDelivery(input.store, {
        alertType: input.alertType,
        severity: input.severity,
        status: "skipped",
        targetIdMasked: null,
        dedupeKey: input.dedupeKey ?? null,
        messageText: input.messageText,
        providerResponse: { disabled: true },
        safeErrorMessage:
          "Telegram operational alerts are disabled for this tenant.",
      }),
    ];
  }

  if (input.dedupeKey) {
    const existing =
      await input.store.findSuccessfulOperationalAlertDeliveryByDedupeKey({
        channel: "telegram",
        dedupeKey: input.dedupeKey,
      });
    if (existing) {
      return [
        await saveAlertDelivery(input.store, {
          alertType: input.alertType,
          severity: input.severity,
          status: "skipped",
          targetIdMasked: null,
          dedupeKey: input.dedupeKey,
          messageText: input.messageText,
          providerResponse: { deduped_delivery_id: existing.id },
          safeErrorMessage: "Telegram operational alert already delivered.",
        }),
      ];
    }
  }

  const targets = (await input.store.listOperationalAlertTargets("telegram")).filter(
    (target) => target.enabled,
  );
  if (input.dryRun) {
    return targets.length
      ? Promise.all(
          targets.map((target) =>
            saveAlertDelivery(input.store, {
              alertType: input.alertType,
              severity: input.severity,
              status: "dry_run",
              targetIdMasked: target.target_id_masked,
              dedupeKey: input.dedupeKey ?? null,
              messageText: input.messageText,
              providerResponse: { dry_run: true },
              safeErrorMessage: null,
            }),
          ),
        )
      : [
          await saveAlertDelivery(input.store, {
            alertType: input.alertType,
            severity: input.severity,
            status: "dry_run",
            targetIdMasked: null,
            dedupeKey: input.dedupeKey ?? null,
            messageText: input.messageText,
            providerResponse: { dry_run: true, no_target: true },
            safeErrorMessage: "ยังไม่ได้เลือก Telegram chat",
          }),
        ];
  }

  const token = await readTelegramBotToken(input.store);
  if (!token) {
    return [
      await saveAlertDelivery(input.store, {
        alertType: input.alertType,
        severity: input.severity,
        status: "skipped",
        targetIdMasked: null,
        dedupeKey: input.dedupeKey ?? null,
        messageText: input.messageText,
        providerResponse: null,
        safeErrorMessage: "Telegram bot token is not configured.",
      }),
    ];
  }
  if (!targets.length) {
    return [
      await saveAlertDelivery(input.store, {
        alertType: input.alertType,
        severity: input.severity,
        status: "skipped",
        targetIdMasked: null,
        dedupeKey: input.dedupeKey ?? null,
        messageText: input.messageText,
        providerResponse: null,
        safeErrorMessage: "Telegram alert target is not configured.",
      }),
    ];
  }

  const encryptionSecret = requireEncryptionSecret();
  const deliveries: OperationalAlertDeliveryRecord[] = [];
  for (const target of targets) {
    const chatId = decryptSecret({
      envelope: target.target_id_encrypted,
      encryptionSecret,
      aad: telegramTargetAad(target.target_id_hash),
    });
    const result = await sendTelegramMessage({
      token,
      chatId,
      text: input.messageText,
    });
    deliveries.push(
      await saveAlertDelivery(input.store, {
        alertType: input.alertType,
        severity: input.severity,
        status: result.ok ? "success" : "failed",
        targetIdMasked: target.target_id_masked,
        dedupeKey: input.dedupeKey ?? null,
        messageText: input.messageText,
        providerResponse: result.provider_response_json,
        safeErrorMessage: result.safe_error_message,
      }),
    );
  }

  return deliveries;
}

export function buildOperationalAlertMessage(input: {
  title: string;
  severity: OperationalAlertSeverity;
  tenantName?: string | null;
  scheduledTime?: string | null;
  reportKey?: string | null;
  runId?: string | null;
  status?: string | null;
  details?: string[];
  action?: string;
}) {
  const severityLabel =
    input.severity === "critical"
      ? "วิกฤต"
      : input.severity === "warning"
        ? "เตือน"
        : "ข้อมูล";
  const lines = [
    `แจ้งเตือน AI-BCC Ops (${severityLabel})`,
    input.title,
    input.tenantName ? `ร้าน: ${input.tenantName}` : null,
    input.scheduledTime ? `รอบเวลา: ${input.scheduledTime}` : null,
    input.reportKey ? `รายงาน: ${input.reportKey}` : null,
    input.status ? `สถานะ: ${input.status}` : null,
    input.runId ? `Run ID: ${input.runId}` : null,
    ...(input.details ?? []),
    input.action ? `สิ่งที่ควรทำ: ${input.action}` : null,
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}

export function buildOperationalAlertDedupeKey(input: {
  alertType: string;
  tenantId?: string | null;
  ruleId?: string | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  reportKey?: string | null;
  severity: OperationalAlertSeverity;
}) {
  return [
    input.alertType,
    input.tenantId ?? "system",
    input.ruleId ?? "none",
    input.scheduledDate ?? "none",
    input.scheduledTime ?? "none",
    input.reportKey ?? "none",
    input.severity,
  ].join(":");
}

export function maskTelegramChatId(chatId: string) {
  const normalized = chatId.trim();
  if (normalized.length <= 4) {
    return "***";
  }
  return `${normalized.slice(0, 2)}...${normalized.slice(-4)}`;
}

async function readTelegramBotToken(store: SystemStore) {
  const secret = await store.getSecretRecord(TELEGRAM_BOT_TOKEN_SECRET_ID);
  if (!secret) {
    return null;
  }
  return decryptSecret({
    envelope: secret.encrypted_value,
    encryptionSecret: requireEncryptionSecret(),
    aad: TELEGRAM_BOT_TOKEN_AAD,
  });
}

async function saveAlertDelivery(
  store: SystemStore,
  input: {
    alertType: string;
    severity: OperationalAlertSeverity;
    status: OperationalAlertDeliveryRecord["status"];
    targetIdMasked: string | null;
    dedupeKey: string | null;
    messageText: string;
    providerResponse: Record<string, unknown> | null;
    safeErrorMessage: string | null;
  },
) {
  const now = new Date().toISOString();
  const delivery: OperationalAlertDeliveryRecord = {
    id: `op_alert_delivery_${Date.now()}_${randomUUID().slice(0, 8)}`,
    channel: "telegram",
    target_id_masked: input.targetIdMasked,
    alert_type: input.alertType,
    severity: input.severity,
    status: input.status,
    dedupe_key: input.dedupeKey,
    message_text: input.messageText,
    provider_response_json: input.providerResponse,
    safe_error_message: input.safeErrorMessage,
    created_at: now,
    sent_at: input.status === "success" ? now : null,
  };
  return store.saveOperationalAlertDelivery(delivery);
}

function requireEncryptionSecret() {
  const encryptionSecret = readSecretEncryptionSecret();
  if (!encryptionSecret) {
    throw new Error("AI_BCC_SECRET_KEY is not configured.");
  }
  return encryptionSecret;
}

function telegramTargetAad(targetHash: string) {
  return `system:operational_alerts:telegram_target:${targetHash}`;
}

function hashStableValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
