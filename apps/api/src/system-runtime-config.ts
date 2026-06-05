import { BANGKOK_TIME_ZONE, type LineSendMode } from "@ai-bcc/shared";
import {
  readBootstrapConfig,
  readBootstrapConfigStatus,
} from "./bootstrap-config.js";
import { decryptSecret, encryptSecret } from "./secret-vault.js";
import type { SecretRecord, SystemStore } from "./system-store.js";
import { readSecretEncryptionSecret } from "./tenant-secret-config.js";

const SYSTEM_RUNTIME_CONFIG_ID = "secret_system_runtime_config";
const SYSTEM_RUNTIME_CONFIG_AAD = "system:runtime:config";
const SYSTEM_RUNTIME_CONFIG_SECRET_KEY = "runtime_config";
const SYSTEM_RUNTIME_CONFIG_KEY_ID = "bootstrap:secret_key";

export type SystemRuntimeConfig = {
  app_base_url: string | null;
  public_api_base_url: string | null;
  report_viewer_signing_secret: string | null;
  report_viewer_link_ttl_hours: number;
  morning_brief_enabled: boolean;
  morning_brief_tenant_ids: string[];
  morning_brief_time: string;
  morning_brief_timezone: string;
  morning_brief_mode: LineSendMode;
  morning_brief_force: boolean;
  worker_id: string;
  worker_heartbeat_token: string | null;
  backup_configured: boolean;
  system_last_backup_at: string | null;
};

export type SystemRuntimeConfigStatus = Omit<
  SystemRuntimeConfig,
  "report_viewer_signing_secret" | "worker_heartbeat_token"
> & {
  source: "encrypted_store" | "bootstrap_file" | "env";
  report_viewer_signing_secret_configured: boolean;
  worker_heartbeat_token_configured: boolean;
  encryption_configured: boolean;
  updated_at: string | null;
  bootstrap: ReturnType<typeof readBootstrapConfigStatus>;
  restart_required_for_bootstrap_changes: boolean;
};

export type SaveSystemRuntimeConfigInput = Omit<
  SystemRuntimeConfig,
  "report_viewer_signing_secret" | "worker_heartbeat_token"
> & {
  report_viewer_signing_secret?: string | null;
  worker_heartbeat_token?: string | null;
};

type RuntimeSecretPayload = {
  report_viewer_signing_secret?: string | null;
  worker_heartbeat_token?: string | null;
};

export async function readEffectiveSystemRuntimeConfig(
  store: SystemStore,
): Promise<SystemRuntimeConfig> {
  const status = await readSystemRuntimeConfigStatus(store);
  const record = await store.getSecretRecord(SYSTEM_RUNTIME_CONFIG_ID);
  return {
    app_base_url: status.app_base_url,
    public_api_base_url: status.public_api_base_url,
    report_viewer_signing_secret: record
      ? readRuntimeSecretPayload(record).report_viewer_signing_secret ?? null
      : readBootstrapOrEnvRuntimeConfig().report_viewer_signing_secret,
    report_viewer_link_ttl_hours: status.report_viewer_link_ttl_hours,
    morning_brief_enabled: status.morning_brief_enabled,
    morning_brief_tenant_ids: status.morning_brief_tenant_ids,
    morning_brief_time: status.morning_brief_time,
    morning_brief_timezone: status.morning_brief_timezone,
    morning_brief_mode: status.morning_brief_mode,
    morning_brief_force: status.morning_brief_force,
    worker_id: status.worker_id,
    worker_heartbeat_token: record
      ? readRuntimeSecretPayload(record).worker_heartbeat_token ?? null
      : readBootstrapOrEnvRuntimeConfig().worker_heartbeat_token,
    backup_configured: status.backup_configured,
    system_last_backup_at: status.system_last_backup_at,
  };
}

export async function readSystemRuntimeConfigStatus(
  store: SystemStore,
): Promise<SystemRuntimeConfigStatus> {
  const record = await store.getSecretRecord(SYSTEM_RUNTIME_CONFIG_ID);
  const encryptionConfigured = Boolean(readSecretEncryptionSecret());
  if (record) {
    const metadata = normalizeRuntimeMetadata(record.metadata_json);
    const payload = readRuntimeSecretPayload(record);
    return {
      ...metadata,
      source: "encrypted_store",
      report_viewer_signing_secret_configured: Boolean(
        payload.report_viewer_signing_secret,
      ),
      worker_heartbeat_token_configured: Boolean(payload.worker_heartbeat_token),
      encryption_configured: encryptionConfigured,
      updated_at: record.updated_at,
      bootstrap: readBootstrapConfigStatus(),
      restart_required_for_bootstrap_changes: true,
    };
  }

  const fallback = readBootstrapOrEnvRuntimeConfig();
  const {
    report_viewer_signing_secret: fallbackReportViewerSigningSecret,
    worker_heartbeat_token: fallbackWorkerHeartbeatToken,
    ...fallbackStatus
  } = fallback;
  return {
    ...fallbackStatus,
    source: hasBootstrapRuntimeConfig() ? "bootstrap_file" : "env",
    report_viewer_signing_secret_configured: Boolean(
      fallbackReportViewerSigningSecret,
    ),
    worker_heartbeat_token_configured: Boolean(fallbackWorkerHeartbeatToken),
    encryption_configured: encryptionConfigured,
    updated_at: null,
    bootstrap: readBootstrapConfigStatus(),
    restart_required_for_bootstrap_changes: true,
  };
}

export async function saveSystemRuntimeConfig(input: {
  store: SystemStore;
  config: SaveSystemRuntimeConfigInput;
}) {
  const encryptionSecret = readSecretEncryptionSecret();
  if (!encryptionSecret) {
    throw new Error("AI_BCC_SECRET_KEY is not configured.");
  }

  const existing = await input.store.getSecretRecord(SYSTEM_RUNTIME_CONFIG_ID);
  const existingPayload = existing ? readRuntimeSecretPayload(existing) : {};
  const payload: RuntimeSecretPayload = {
    report_viewer_signing_secret:
      input.config.report_viewer_signing_secret?.trim() ||
      existingPayload.report_viewer_signing_secret ||
      null,
    worker_heartbeat_token:
      input.config.worker_heartbeat_token?.trim() ||
      existingPayload.worker_heartbeat_token ||
      null,
  };
  const now = new Date().toISOString();
  const record: SecretRecord = {
    id: SYSTEM_RUNTIME_CONFIG_ID,
    tenant_id: null,
    scope: "system",
    secret_key: SYSTEM_RUNTIME_CONFIG_SECRET_KEY,
    encrypted_value: encryptSecret({
      plaintext: JSON.stringify(payload),
      encryptionSecret,
      keyId: SYSTEM_RUNTIME_CONFIG_KEY_ID,
      aad: SYSTEM_RUNTIME_CONFIG_AAD,
    }),
    encryption_key_id: SYSTEM_RUNTIME_CONFIG_KEY_ID,
    metadata_json: normalizeRuntimeMetadata(input.config),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  await input.store.upsertSecretRecord(record);
  return readSystemRuntimeConfigStatus(input.store);
}

function readRuntimeSecretPayload(record: SecretRecord): RuntimeSecretPayload {
  const encryptionSecret = readSecretEncryptionSecret();
  if (!encryptionSecret) {
    return {};
  }
  const plaintext = decryptSecret({
    envelope: record.encrypted_value,
    encryptionSecret,
    aad: SYSTEM_RUNTIME_CONFIG_AAD,
  });
  try {
    const parsed = JSON.parse(plaintext) as RuntimeSecretPayload;
    return {
      report_viewer_signing_secret:
        typeof parsed.report_viewer_signing_secret === "string"
          ? parsed.report_viewer_signing_secret
          : null,
      worker_heartbeat_token:
        typeof parsed.worker_heartbeat_token === "string"
          ? parsed.worker_heartbeat_token
          : null,
    };
  } catch {
    return {};
  }
}

function readBootstrapOrEnvRuntimeConfig(): SystemRuntimeConfig {
  const bootstrap = readBootstrapConfig();
  return {
    app_base_url:
      bootstrap.app_base_url?.trim() || process.env.APP_BASE_URL?.trim() || null,
    public_api_base_url:
      bootstrap.public_api_base_url?.trim() ||
      process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
      null,
    report_viewer_signing_secret:
      bootstrap.report_viewer_signing_secret?.trim() || null,
    report_viewer_link_ttl_hours: normalizeReportViewerTtlHours(
      bootstrap.report_viewer_link_ttl_hours ?? 72,
    ),
    morning_brief_enabled: false,
    morning_brief_tenant_ids: [],
    morning_brief_time: "08:00",
    morning_brief_timezone: BANGKOK_TIME_ZONE,
    morning_brief_mode: "dry_run",
    morning_brief_force: false,
    worker_id:
      bootstrap.worker?.worker_id ||
      process.env.WORKER_ID ||
      "worker_notification_rules_1",
    worker_heartbeat_token:
      bootstrap.worker?.heartbeat_token?.trim() ||
      process.env.WORKER_HEARTBEAT_TOKEN?.trim() ||
      null,
    backup_configured: readBoolean(
      bootstrap.backup?.configured,
      process.env.SYSTEM_BACKUP_CONFIGURED,
      false,
    ),
    system_last_backup_at:
      bootstrap.backup?.last_backup_at ||
      process.env.SYSTEM_LAST_BACKUP_AT?.trim() ||
      null,
  };
}

function hasBootstrapRuntimeConfig() {
  const bootstrap = readBootstrapConfig();
  return Boolean(
    bootstrap.app_base_url ||
      bootstrap.public_api_base_url ||
      bootstrap.report_viewer_signing_secret ||
      bootstrap.report_viewer_link_ttl_hours ||
      bootstrap.worker ||
      bootstrap.backup,
  );
}

function normalizeRuntimeMetadata(
  value: Partial<SaveSystemRuntimeConfigInput> | Record<string, unknown>,
): Omit<
  SystemRuntimeConfig,
  "report_viewer_signing_secret" | "worker_heartbeat_token"
> {
  return {
    app_base_url: toNullableString(value.app_base_url),
    public_api_base_url: toNullableString(value.public_api_base_url),
    report_viewer_link_ttl_hours: normalizeReportViewerTtlHours(
      value.report_viewer_link_ttl_hours,
    ),
    morning_brief_enabled: toBoolean(value.morning_brief_enabled, true),
    morning_brief_tenant_ids: Array.isArray(value.morning_brief_tenant_ids)
      ? value.morning_brief_tenant_ids.map(String).filter(Boolean)
      : parseTenantIds(String(value.morning_brief_tenant_ids ?? "")),
    morning_brief_time: String(value.morning_brief_time || "08:00"),
    morning_brief_timezone: String(
      value.morning_brief_timezone || BANGKOK_TIME_ZONE,
    ),
    morning_brief_mode:
      value.morning_brief_mode === "dry_run" ? "dry_run" : "send",
    morning_brief_force: toBoolean(value.morning_brief_force, false),
    worker_id: String(value.worker_id || "worker_morning_brief_1"),
    backup_configured: toBoolean(value.backup_configured, false),
    system_last_backup_at: toNullableString(value.system_last_backup_at),
  };
}

function normalizeReportViewerTtlHours(value: unknown) {
  const numeric =
    typeof value === "number" ? value : Number(String(value ?? 72).trim());
  if (!Number.isFinite(numeric)) {
    return 72;
  }
  return Math.max(1, Math.min(Math.round(numeric), 2160));
}

function parseTenantIds(value: string | undefined) {
  const tenantIds = (value?.trim() || "tenant_demo_remote")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return tenantIds.length ? tenantIds : ["tenant_demo_remote"];
}

function readBoolean(
  bootstrapValue: boolean | undefined,
  envValue: string | undefined,
  fallback: boolean,
) {
  if (bootstrapValue !== undefined) {
    return bootstrapValue;
  }
  return toBoolean(envValue, fallback);
}

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (["1", "true", "yes", "on"].includes(value.toLowerCase())) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(value.toLowerCase())) {
      return false;
    }
  }
  return fallback;
}

function toNullableString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim() || null;
}
