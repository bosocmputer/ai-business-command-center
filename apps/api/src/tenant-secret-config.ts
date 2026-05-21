import type { LineChannelRecord, TenantId } from "@ai-bcc/shared";
import type {
  DatasourceConfig,
  LineChannelCredentialConfig,
} from "./config.js";
import { decryptSecret, encryptSecret } from "./secret-vault.js";
import type { SecretRecord, SystemStore } from "./system-store.js";

const SECRET_KEY_ID = "env:AI_BCC_SECRET_KEY";
const DATASOURCE_SECRET_KEY = "sml_password";
const LINE_ACCESS_TOKEN_SECRET_KEY = "channel_access_token";
const LINE_CHANNEL_SECRET_KEY = "channel_secret";

export type DatasourceConfigStatus = {
  source: "encrypted_store" | "env" | "missing";
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
  password_configured: boolean;
  encryption_configured: boolean;
  updated_at: string | null;
};

export type SaveDatasourceConfigInput = DatasourceConfig & {
  tenantId: TenantId;
};

export type SaveLineChannelSecretsInput = {
  tenantId: TenantId;
  lineChannelId: string;
  channelAccessToken?: string;
  channelSecret?: string;
};

type DatasourceSecretMetadata = Omit<DatasourceConfig, "password">;

export function readSecretEncryptionSecret() {
  return process.env.AI_BCC_SECRET_KEY?.trim() || null;
}

export function datasourceSecretId(tenantId: TenantId) {
  return `secret_${tenantId}_datasource_sml_password`;
}

export function datasourceSecretAad(tenantId: TenantId) {
  return `${tenantId}:datasource:${DATASOURCE_SECRET_KEY}`;
}

export function lineChannelSecretId(
  lineChannelId: string,
  secretKey:
    | typeof LINE_ACCESS_TOKEN_SECRET_KEY
    | typeof LINE_CHANNEL_SECRET_KEY,
) {
  return `secret_${lineChannelId}_${secretKey}`;
}

export function lineChannelSecretAad(
  tenantId: TenantId,
  lineChannelId: string,
  secretKey:
    | typeof LINE_ACCESS_TOKEN_SECRET_KEY
    | typeof LINE_CHANNEL_SECRET_KEY,
) {
  return `${tenantId}:line_channel:${lineChannelId}:${secretKey}`;
}

export async function readDatasourceConfigStatus(input: {
  store: SystemStore;
  tenantId: TenantId;
  envConfig: DatasourceConfig | null;
}): Promise<DatasourceConfigStatus> {
  const record = await input.store.getSecretRecord(
    datasourceSecretId(input.tenantId),
  );
  const encryptionConfigured = Boolean(readSecretEncryptionSecret());

  if (record) {
    const metadata = parseDatasourceSecretMetadata(record.metadata_json);
    return {
      source: "encrypted_store",
      host: metadata?.host ?? null,
      port: metadata?.port ?? null,
      database: metadata?.database ?? null,
      user: metadata?.user ?? null,
      password_configured: true,
      encryption_configured: encryptionConfigured,
      updated_at: record.updated_at,
    };
  }

  if (input.envConfig) {
    return {
      source: "env",
      host: input.envConfig.host,
      port: input.envConfig.port,
      database: input.envConfig.database,
      user: input.envConfig.user,
      password_configured: true,
      encryption_configured: encryptionConfigured,
      updated_at: null,
    };
  }

  return {
    source: "missing",
    host: null,
    port: null,
    database: null,
    user: null,
    password_configured: false,
    encryption_configured: encryptionConfigured,
    updated_at: null,
  };
}

export async function readStoredDatasourceConfig(input: {
  store: SystemStore;
  tenantId: TenantId;
}): Promise<DatasourceConfig | null> {
  const record = await input.store.getSecretRecord(
    datasourceSecretId(input.tenantId),
  );
  if (!record) {
    return null;
  }

  const metadata = parseDatasourceSecretMetadata(record.metadata_json);
  if (!metadata) {
    throw new Error("Stored datasource metadata is invalid.");
  }

  const encryptionSecret = requireEncryptionSecret();
  const password = decryptSecret({
    envelope: record.encrypted_value,
    encryptionSecret,
    aad: datasourceSecretAad(input.tenantId),
  });

  return {
    ...metadata,
    password,
  };
}

export async function saveTenantDatasourceConfig(input: {
  store: SystemStore;
  config: SaveDatasourceConfigInput;
}) {
  const now = new Date().toISOString();
  const id = datasourceSecretId(input.config.tenantId);
  const existing = await input.store.getSecretRecord(id);
  const encryptionSecret = requireEncryptionSecret();
  const metadata: DatasourceSecretMetadata = {
    host: input.config.host,
    port: input.config.port,
    database: input.config.database,
    user: input.config.user,
  };

  const record: SecretRecord = {
    id,
    tenant_id: input.config.tenantId,
    scope: "datasource",
    secret_key: DATASOURCE_SECRET_KEY,
    encrypted_value: encryptSecret({
      plaintext: input.config.password,
      encryptionSecret,
      keyId: SECRET_KEY_ID,
      aad: datasourceSecretAad(input.config.tenantId),
    }),
    encryption_key_id: SECRET_KEY_ID,
    metadata_json: metadata,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  await input.store.upsertSecretRecord(record);
  return readDatasourceConfigStatus({
    store: input.store,
    tenantId: input.config.tenantId,
    envConfig: null,
  });
}

export async function saveLineChannelSecrets(input: {
  store: SystemStore;
  config: SaveLineChannelSecretsInput;
}) {
  const encryptionSecret = requireEncryptionSecret();
  const results = {
    channel_access_token_configured: false,
    channel_secret_configured: false,
  };

  if (input.config.channelAccessToken?.trim()) {
    await upsertLineChannelSecret({
      store: input.store,
      tenantId: input.config.tenantId,
      lineChannelId: input.config.lineChannelId,
      secretKey: LINE_ACCESS_TOKEN_SECRET_KEY,
      plaintext: input.config.channelAccessToken.trim(),
      encryptionSecret,
    });
    results.channel_access_token_configured = true;
  }

  if (input.config.channelSecret?.trim()) {
    await upsertLineChannelSecret({
      store: input.store,
      tenantId: input.config.tenantId,
      lineChannelId: input.config.lineChannelId,
      secretKey: LINE_CHANNEL_SECRET_KEY,
      plaintext: input.config.channelSecret.trim(),
      encryptionSecret,
    });
    results.channel_secret_configured = true;
  }

  return results;
}

export async function readStoredLineChannelCredentials(input: {
  store: SystemStore;
  tenantId: TenantId;
  preferredLineChannelId?: string | null;
}): Promise<
  | (LineChannelCredentialConfig & {
      lineChannel: LineChannelRecord;
    })
  | null
> {
  const channels = await input.store.listLineChannels(input.tenantId);
  const ordered = [
    ...channels.filter((channel) => channel.id === input.preferredLineChannelId),
    ...channels.filter((channel) => channel.id !== input.preferredLineChannelId),
  ].filter(
    (channel) =>
      channel.enabled &&
      channel.source !== "env" &&
      channel.channel_access_token_configured,
  );

  for (const channel of ordered) {
    const secret = await input.store.getSecretRecord(
      lineChannelSecretId(channel.id, LINE_ACCESS_TOKEN_SECRET_KEY),
    );
    if (!secret) {
      continue;
    }

    const channelAccessToken = decryptSecret({
      envelope: secret.encrypted_value,
      encryptionSecret: requireEncryptionSecret(),
      aad: lineChannelSecretAad(
        input.tenantId,
        channel.id,
        LINE_ACCESS_TOKEN_SECRET_KEY,
      ),
    });

    return {
      channelAccessToken,
      lineChannel: channel,
    };
  }

  return null;
}

export async function findLineChannelForWebhookSignature(input: {
  store: SystemStore;
  rawBody: string;
  signature: string | undefined;
  verify: (input: {
    rawBody: string;
    channelSecret: string;
    signature: string | undefined;
  }) => boolean;
}) {
  const channels = (await input.store.listLineChannels()).filter(
    (channel) =>
      channel.enabled &&
      channel.source !== "env" &&
      channel.channel_secret_configured,
  );

  for (const channel of channels) {
    const secret = await input.store.getSecretRecord(
      lineChannelSecretId(channel.id, LINE_CHANNEL_SECRET_KEY),
    );
    if (!secret) {
      continue;
    }

    const channelSecret = decryptSecret({
      envelope: secret.encrypted_value,
      encryptionSecret: requireEncryptionSecret(),
      aad: lineChannelSecretAad(
        channel.tenant_id,
        channel.id,
        LINE_CHANNEL_SECRET_KEY,
      ),
    });

    if (
      input.verify({
        rawBody: input.rawBody,
        channelSecret,
        signature: input.signature,
      })
    ) {
      return {
        channel,
        channelSecret,
      };
    }
  }

  return null;
}

function requireEncryptionSecret() {
  const encryptionSecret = readSecretEncryptionSecret();
  if (!encryptionSecret) {
    throw new Error("AI_BCC_SECRET_KEY is not configured.");
  }
  return encryptionSecret;
}

async function upsertLineChannelSecret(input: {
  store: SystemStore;
  tenantId: TenantId;
  lineChannelId: string;
  secretKey:
    | typeof LINE_ACCESS_TOKEN_SECRET_KEY
    | typeof LINE_CHANNEL_SECRET_KEY;
  plaintext: string;
  encryptionSecret: string;
}) {
  const now = new Date().toISOString();
  const id = lineChannelSecretId(input.lineChannelId, input.secretKey);
  const existing = await input.store.getSecretRecord(id);
  await input.store.upsertSecretRecord({
    id,
    tenant_id: input.tenantId,
    scope: "line_channel",
    secret_key: input.secretKey,
    encrypted_value: encryptSecret({
      plaintext: input.plaintext,
      encryptionSecret: input.encryptionSecret,
      keyId: SECRET_KEY_ID,
      aad: lineChannelSecretAad(
        input.tenantId,
        input.lineChannelId,
        input.secretKey,
      ),
    }),
    encryption_key_id: SECRET_KEY_ID,
    metadata_json: {
      line_channel_id: input.lineChannelId,
    },
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });
}

function parseDatasourceSecretMetadata(
  value: Record<string, unknown>,
): DatasourceSecretMetadata | null {
  if (
    typeof value.host !== "string" ||
    typeof value.database !== "string" ||
    typeof value.user !== "string"
  ) {
    return null;
  }

  const port =
    typeof value.port === "number"
      ? value.port
      : typeof value.port === "string"
        ? Number(value.port)
        : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return {
    host: value.host,
    port,
    database: value.database,
    user: value.user,
  };
}
