import type { LineChannelRecord, TenantId } from "@ai-bcc/shared";
import type {
  DatasourceConfig,
  JavaWsDatasourceConfig,
  LineChannelCredentialConfig,
  PostgresDatasourceConfig,
} from "./config.js";
import { decryptSecret, encryptSecret } from "./secret-vault.js";
import type { SecretRecord, SystemStore } from "./system-store.js";
import { readBootstrapSecretKey } from "./bootstrap-config.js";

const SECRET_KEY_ID = "env:AI_BCC_SECRET_KEY";
const DATASOURCE_SECRET_KEY = "sml_password";
const LINE_ACCESS_TOKEN_SECRET_KEY = "channel_access_token";
const LINE_CHANNEL_SECRET_KEY = "channel_secret";

export type DatasourceConfigStatus = {
  source: "encrypted_store" | "env" | "missing";
  kind: DatasourceConfig["kind"] | null;
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
  password_configured: boolean;
  base_url: string | null;
  webapp_path: string | null;
  endpoint: string | null;
  config_file_name: string | null;
  query_method: string | null;
  auth_mode: JavaWsDatasourceConfig["auth"]["mode"] | null;
  auth_configured: boolean;
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

type PostgresDatasourceSecretMetadata = Omit<PostgresDatasourceConfig, "password">;
type JavaWsDatasourceSecretMetadata = Omit<JavaWsDatasourceConfig, "auth"> & {
  authMode: JavaWsDatasourceConfig["auth"]["mode"];
  authUsername?: string;
};
type DatasourceSecretMetadata =
  | PostgresDatasourceSecretMetadata
  | JavaWsDatasourceSecretMetadata;

type DatasourceSecretPayload =
  | { kind: "sml_postgres"; password: string }
  | {
      kind: "sml_javaws";
      authPassword?: string;
      authToken?: string;
    };

export function readSecretEncryptionSecret() {
  return readBootstrapSecretKey();
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
    return datasourceStatusFromMetadata({
      source: "encrypted_store",
      metadata,
      encryption_configured: encryptionConfigured,
      updated_at: record.updated_at,
      secretConfigured: Boolean(record.encrypted_value),
    });
  }

  if (input.envConfig) {
    return datasourceStatusFromConfig({
      source: "env",
      config: input.envConfig,
      encryption_configured: encryptionConfigured,
      updated_at: null,
    });
  }

  return {
    source: "missing",
    kind: null,
    host: null,
    port: null,
    database: null,
    user: null,
    password_configured: false,
    base_url: null,
    webapp_path: null,
    endpoint: null,
    config_file_name: null,
    query_method: null,
    auth_mode: null,
    auth_configured: false,
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
  const plaintext = decryptSecret({
    envelope: record.encrypted_value,
    encryptionSecret,
    aad: datasourceSecretAad(input.tenantId),
  });

  const secret = parseDatasourceSecretPayload(plaintext, metadata.kind);

  if (metadata.kind === "sml_javaws") {
    return {
      kind: "sml_javaws",
      baseUrl: metadata.baseUrl,
      webappPath: metadata.webappPath,
      endpoint: metadata.endpoint,
      configFileName: metadata.configFileName,
      database: metadata.database,
      queryMethod: metadata.queryMethod,
      auth:
        metadata.authMode === "basic"
          ? {
              mode: "basic",
              username: metadata.authUsername ?? "",
              password: secret.kind === "sml_javaws" ? secret.authPassword ?? "" : "",
            }
          : metadata.authMode === "bearer"
            ? {
                mode: "bearer",
                token: secret.kind === "sml_javaws" ? secret.authToken ?? "" : "",
              }
            : { mode: "none" },
    };
  }

  return {
    ...metadata,
    password: secret.kind === "sml_postgres" ? secret.password : "",
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
  const metadata = buildDatasourceSecretMetadata(input.config);
  const secretPayload = buildDatasourceSecretPayload(input.config);

  const record: SecretRecord = {
    id,
    tenant_id: input.config.tenantId,
    scope: "datasource",
    secret_key: DATASOURCE_SECRET_KEY,
    encrypted_value: encryptSecret({
      plaintext: JSON.stringify(secretPayload),
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
  const kind =
    value.kind === "sml_javaws" || value.kind === "sml_postgres"
      ? value.kind
      : "sml_postgres";

  if (kind === "sml_javaws") {
    if (
      typeof value.baseUrl !== "string" ||
      typeof value.webappPath !== "string" ||
      typeof value.endpoint !== "string" ||
      typeof value.configFileName !== "string" ||
      typeof value.database !== "string" ||
      typeof value.queryMethod !== "string"
    ) {
      return null;
    }

    const authMode =
      value.authMode === "basic" || value.authMode === "bearer"
        ? value.authMode
        : "none";

    return {
      kind: "sml_javaws",
      baseUrl: value.baseUrl,
      webappPath: value.webappPath,
      endpoint: "DotNetFrameWork",
      configFileName: value.configFileName,
      database: value.database,
      queryMethod: "_queryCompress",
      authMode,
      authUsername:
        typeof value.authUsername === "string" ? value.authUsername : undefined,
    };
  }

  if (
    typeof value.host !== "string" ||
    typeof value.database !== "string" ||
    typeof value.user !== "string"
  ) {
    return null;
  }

  const port = coercePort(value.port);
  if (!port) {
    return null;
  }
  return {
    kind: "sml_postgres",
    host: value.host,
    port,
    database: value.database,
    user: value.user,
  };
}

function coercePort(value: unknown) {
  const port =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function buildDatasourceSecretMetadata(
  config: DatasourceConfig,
): DatasourceSecretMetadata {
  if (config.kind === "sml_javaws") {
    return {
      kind: "sml_javaws",
      baseUrl: config.baseUrl,
      webappPath: config.webappPath,
      endpoint: config.endpoint,
      configFileName: config.configFileName,
      database: config.database,
      queryMethod: config.queryMethod,
      authMode: config.auth.mode,
      authUsername: config.auth.mode === "basic" ? config.auth.username : undefined,
    };
  }

  return {
    kind: "sml_postgres",
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
  };
}

function buildDatasourceSecretPayload(
  config: DatasourceConfig,
): DatasourceSecretPayload {
  if (config.kind === "sml_javaws") {
    return {
      kind: "sml_javaws",
      authPassword: config.auth.mode === "basic" ? config.auth.password : undefined,
      authToken: config.auth.mode === "bearer" ? config.auth.token : undefined,
    };
  }

  return {
    kind: "sml_postgres",
    password: config.password,
  };
}

function parseDatasourceSecretPayload(
  plaintext: string,
  metadataKind: DatasourceConfig["kind"],
): DatasourceSecretPayload {
  try {
    const parsed = JSON.parse(plaintext) as Partial<DatasourceSecretPayload>;
    if (parsed.kind === "sml_javaws") {
      return {
        kind: "sml_javaws",
        authPassword:
          typeof parsed.authPassword === "string"
            ? parsed.authPassword
            : undefined,
        authToken:
          typeof parsed.authToken === "string" ? parsed.authToken : undefined,
      };
    }
    if (parsed.kind === "sml_postgres" && typeof parsed.password === "string") {
      return {
        kind: "sml_postgres",
        password: parsed.password,
      };
    }
  } catch {
    // Legacy datasource records encrypted only the PostgreSQL password string.
  }

  if (metadataKind === "sml_postgres") {
    return {
      kind: "sml_postgres",
      password: plaintext,
    };
  }

  return { kind: "sml_javaws" };
}

function datasourceStatusFromConfig(input: {
  source: DatasourceConfigStatus["source"];
  config: DatasourceConfig;
  encryption_configured: boolean;
  updated_at: string | null;
}): DatasourceConfigStatus {
  return datasourceStatusFromMetadata({
    source: input.source,
    metadata: buildDatasourceSecretMetadata(input.config),
    encryption_configured: input.encryption_configured,
    updated_at: input.updated_at,
    secretConfigured: true,
  });
}

function datasourceStatusFromMetadata(input: {
  source: DatasourceConfigStatus["source"];
  metadata: DatasourceSecretMetadata | null;
  encryption_configured: boolean;
  updated_at: string | null;
  secretConfigured: boolean;
}): DatasourceConfigStatus {
  const metadata = input.metadata;
  if (metadata?.kind === "sml_javaws") {
    return {
      source: input.source,
      kind: "sml_javaws",
      host: null,
      port: null,
      database: metadata.database,
      user: null,
      password_configured: false,
      base_url: metadata.baseUrl,
      webapp_path: metadata.webappPath,
      endpoint: metadata.endpoint,
      config_file_name: metadata.configFileName,
      query_method: metadata.queryMethod,
      auth_mode: metadata.authMode,
      auth_configured:
        metadata.authMode === "none" ? true : input.secretConfigured,
      encryption_configured: input.encryption_configured,
      updated_at: input.updated_at,
    };
  }

  if (metadata?.kind === "sml_postgres") {
    return {
      source: input.source,
      kind: "sml_postgres",
      host: metadata.host,
      port: metadata.port,
      database: metadata.database,
      user: metadata.user,
      password_configured: input.secretConfigured,
      base_url: null,
      webapp_path: null,
      endpoint: null,
      config_file_name: null,
      query_method: null,
      auth_mode: null,
      auth_configured: false,
      encryption_configured: input.encryption_configured,
      updated_at: input.updated_at,
    };
  }

  return {
    source: input.source,
    kind: null,
    host: null,
    port: null,
    database: null,
    user: null,
    password_configured: false,
    base_url: null,
    webapp_path: null,
    endpoint: null,
    config_file_name: null,
    query_method: null,
    auth_mode: null,
    auth_configured: false,
    encryption_configured: input.encryption_configured,
    updated_at: input.updated_at,
  };
}
