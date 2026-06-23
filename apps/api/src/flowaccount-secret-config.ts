import type { TenantId } from "@ai-bcc/shared";
import { readBootstrapSecretKey } from "./bootstrap-config.js";
import { decryptSecret, encryptSecret } from "./secret-vault.js";
import type {
  FlowAccountAuthMode,
  FlowAccountConnectionRecord,
  FlowAccountConnectionStatus,
  FlowAccountEnvironment,
  SecretRecord,
  SystemStore,
} from "./system-store.js";

const SECRET_KEY_ID = "env:AI_BCC_SECRET_KEY";
export const FLOWACCOUNT_CLIENT_CREDENTIALS_SECRET_KEY = "client_credentials";
export const FLOWACCOUNT_ACCESS_TOKEN_SECRET_KEY = "access_token";

export type FlowAccountConfigStatus = {
  environment: FlowAccountEnvironment;
  auth_mode: FlowAccountAuthMode;
  status: FlowAccountConnectionStatus;
  credentials_configured: boolean;
  company_id: string | null;
  support_code: string | null;
  access_token_expires_at: string | null;
  last_tested_at: string | null;
  last_error: string | null;
  updated_at: string | null;
  encryption_configured: boolean;
};

export type StoredFlowAccountClientCredentials = {
  environment: FlowAccountEnvironment;
  authMode: FlowAccountAuthMode;
  clientId: string;
  clientSecret: string;
  updatedAt: string;
};

export type StoredFlowAccountAccessToken = {
  accessToken: string;
  expiresAt: string;
  tokenType: string | null;
  scope: string | null;
  obtainedAt: string | null;
  credentialsUpdatedAt: string | null;
};

type FlowAccountClientCredentialsPayload = {
  auth_mode: FlowAccountAuthMode;
  client_id: string;
  client_secret: string;
};

type FlowAccountAccessTokenPayload = {
  access_token: string;
};

export function readFlowAccountEncryptionSecret() {
  return readBootstrapSecretKey();
}

export function flowAccountClientCredentialsSecretId(tenantId: TenantId) {
  return `secret_${tenantId}_flowaccount_${FLOWACCOUNT_CLIENT_CREDENTIALS_SECRET_KEY}`;
}

export function flowAccountAccessTokenSecretId(tenantId: TenantId) {
  return `secret_${tenantId}_flowaccount_${FLOWACCOUNT_ACCESS_TOKEN_SECRET_KEY}`;
}

export function flowAccountSecretAad(
  tenantId: TenantId,
  secretKey:
    | typeof FLOWACCOUNT_CLIENT_CREDENTIALS_SECRET_KEY
    | typeof FLOWACCOUNT_ACCESS_TOKEN_SECRET_KEY,
) {
  return `${tenantId}:flowaccount:${secretKey}`;
}

export async function readFlowAccountConfigStatus(input: {
  store: SystemStore;
  tenantId: TenantId;
}): Promise<FlowAccountConfigStatus> {
  const [credentialRecord, connection] = await Promise.all([
    input.store.getSecretRecord(
      flowAccountClientCredentialsSecretId(input.tenantId),
    ),
    input.store.getFlowAccountConnection(input.tenantId),
  ]);
  const encryptionConfigured = Boolean(readFlowAccountEncryptionSecret());
  const credentialsConfigured = Boolean(credentialRecord?.encrypted_value);

  return {
    environment: connection?.environment ?? "sandbox",
    auth_mode: connection?.auth_mode ?? "client_credentials",
    status:
      connection?.status ??
      (credentialsConfigured ? "configured_untested" : "missing"),
    credentials_configured: credentialsConfigured,
    company_id: connection?.company_id ?? null,
    support_code: connection?.support_code ?? null,
    access_token_expires_at: connection?.access_token_expires_at ?? null,
    last_tested_at: connection?.last_tested_at ?? null,
    last_error: connection?.last_error ?? null,
    updated_at: connection?.updated_at ?? credentialRecord?.updated_at ?? null,
    encryption_configured: encryptionConfigured,
  };
}

export async function saveFlowAccountClientCredentials(input: {
  store: SystemStore;
  tenantId: TenantId;
  environment: FlowAccountEnvironment;
  authMode: FlowAccountAuthMode;
  clientId: string;
  clientSecret: string;
}) {
  assertSandboxClientCredentials(input.environment, input.authMode);
  const now = new Date().toISOString();
  const id = flowAccountClientCredentialsSecretId(input.tenantId);
  const existing = await input.store.getSecretRecord(id);
  const existingConnection = await input.store.getFlowAccountConnection(
    input.tenantId,
  );
  const encryptionSecret = requireFlowAccountEncryptionSecret();
  const payload: FlowAccountClientCredentialsPayload = {
    auth_mode: "client_credentials",
    client_id: input.clientId.trim(),
    client_secret: input.clientSecret.trim(),
  };

  const record: SecretRecord = {
    id,
    tenant_id: input.tenantId,
    scope: "flowaccount",
    secret_key: FLOWACCOUNT_CLIENT_CREDENTIALS_SECRET_KEY,
    encrypted_value: encryptSecret({
      plaintext: JSON.stringify(payload),
      encryptionSecret,
      keyId: SECRET_KEY_ID,
      aad: flowAccountSecretAad(
        input.tenantId,
        FLOWACCOUNT_CLIENT_CREDENTIALS_SECRET_KEY,
      ),
    }),
    encryption_key_id: SECRET_KEY_ID,
    metadata_json: {
      environment: "sandbox",
      auth_mode: "client_credentials",
    },
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  await input.store.upsertSecretRecord(record);
  await input.store.upsertFlowAccountConnection({
    tenant_id: input.tenantId,
    environment: "sandbox",
    auth_mode: "client_credentials",
    status: "configured_untested",
    company_id: null,
    support_code: null,
    access_token_expires_at: null,
    last_tested_at: null,
    last_error: null,
    created_at: existingConnection?.created_at ?? now,
    updated_at: now,
  });

  return readFlowAccountConfigStatus({
    store: input.store,
    tenantId: input.tenantId,
  });
}

export async function readStoredFlowAccountClientCredentials(input: {
  store: SystemStore;
  tenantId: TenantId;
}): Promise<StoredFlowAccountClientCredentials | null> {
  const record = await input.store.getSecretRecord(
    flowAccountClientCredentialsSecretId(input.tenantId),
  );
  if (!record) {
    return null;
  }

  const plaintext = decryptSecret({
    envelope: record.encrypted_value,
    encryptionSecret: requireFlowAccountEncryptionSecret(),
    aad: flowAccountSecretAad(
      input.tenantId,
      FLOWACCOUNT_CLIENT_CREDENTIALS_SECRET_KEY,
    ),
  });
  const payload = parseClientCredentialsPayload(plaintext);
  if (!payload) {
    throw new Error("Stored FlowAccount client credentials are invalid.");
  }

  return {
    environment: "sandbox",
    authMode: "client_credentials",
    clientId: payload.client_id,
    clientSecret: payload.client_secret,
    updatedAt: record.updated_at,
  };
}

export async function readStoredFlowAccountAccessToken(input: {
  store: SystemStore;
  tenantId: TenantId;
}): Promise<StoredFlowAccountAccessToken | null> {
  const record = await input.store.getSecretRecord(
    flowAccountAccessTokenSecretId(input.tenantId),
  );
  if (!record) {
    return null;
  }

  const plaintext = decryptSecret({
    envelope: record.encrypted_value,
    encryptionSecret: requireFlowAccountEncryptionSecret(),
    aad: flowAccountSecretAad(
      input.tenantId,
      FLOWACCOUNT_ACCESS_TOKEN_SECRET_KEY,
    ),
  });
  const payload = parseAccessTokenPayload(plaintext);
  if (!payload) {
    throw new Error("Stored FlowAccount access token is invalid.");
  }

  return {
    accessToken: payload.access_token,
    expiresAt:
      typeof record.metadata_json.expires_at === "string"
        ? record.metadata_json.expires_at
        : "",
    tokenType:
      typeof record.metadata_json.token_type === "string"
        ? record.metadata_json.token_type
        : null,
    scope:
      typeof record.metadata_json.scope === "string"
        ? record.metadata_json.scope
        : null,
    obtainedAt:
      typeof record.metadata_json.obtained_at === "string"
        ? record.metadata_json.obtained_at
        : null,
    credentialsUpdatedAt:
      typeof record.metadata_json.credentials_updated_at === "string"
        ? record.metadata_json.credentials_updated_at
        : null,
  };
}

export async function saveFlowAccountAccessToken(input: {
  store: SystemStore;
  tenantId: TenantId;
  accessToken: string;
  expiresAt: string;
  tokenType: string | null;
  scope: string | null;
  obtainedAt: string;
  credentialsUpdatedAt: string;
}) {
  const now = new Date().toISOString();
  const id = flowAccountAccessTokenSecretId(input.tenantId);
  const existing = await input.store.getSecretRecord(id);
  const encryptionSecret = requireFlowAccountEncryptionSecret();
  const payload: FlowAccountAccessTokenPayload = {
    access_token: input.accessToken,
  };

  const record: SecretRecord = {
    id,
    tenant_id: input.tenantId,
    scope: "flowaccount",
    secret_key: FLOWACCOUNT_ACCESS_TOKEN_SECRET_KEY,
    encrypted_value: encryptSecret({
      plaintext: JSON.stringify(payload),
      encryptionSecret,
      keyId: SECRET_KEY_ID,
      aad: flowAccountSecretAad(
        input.tenantId,
        FLOWACCOUNT_ACCESS_TOKEN_SECRET_KEY,
      ),
    }),
    encryption_key_id: SECRET_KEY_ID,
    metadata_json: {
      environment: "sandbox",
      auth_mode: "client_credentials",
      token_type: input.tokenType,
      scope: input.scope,
      expires_at: input.expiresAt,
      obtained_at: input.obtainedAt,
      credentials_updated_at: input.credentialsUpdatedAt,
    },
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  await input.store.upsertSecretRecord(record);
  return record;
}

export function buildFlowAccountConnectionRecord(input: {
  tenantId: TenantId;
  existing: FlowAccountConnectionRecord | null;
  status: Exclude<FlowAccountConnectionStatus, "missing">;
  companyId: string | null;
  supportCode: string | null;
  accessTokenExpiresAt: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
}) {
  const now = new Date().toISOString();
  return {
    tenant_id: input.tenantId,
    environment: "sandbox",
    auth_mode: "client_credentials",
    status: input.status,
    company_id: input.companyId,
    support_code: input.supportCode,
    access_token_expires_at: input.accessTokenExpiresAt,
    last_tested_at: input.lastTestedAt,
    last_error: input.lastError,
    created_at: input.existing?.created_at ?? now,
    updated_at: now,
  } satisfies FlowAccountConnectionRecord;
}

function assertSandboxClientCredentials(
  environment: FlowAccountEnvironment,
  authMode: FlowAccountAuthMode,
) {
  if (environment !== "sandbox") {
    throw new Error("Only FlowAccount sandbox environment is supported.");
  }
  if (authMode !== "client_credentials") {
    throw new Error("Only FlowAccount client credentials auth is supported.");
  }
}

function requireFlowAccountEncryptionSecret() {
  const encryptionSecret = readFlowAccountEncryptionSecret();
  if (!encryptionSecret) {
    throw new Error("AI_BCC_SECRET_KEY is not configured.");
  }
  return encryptionSecret;
}

function parseClientCredentialsPayload(
  plaintext: string,
): FlowAccountClientCredentialsPayload | null {
  const parsed = parseJsonRecord(plaintext);
  if (
    parsed?.auth_mode !== "client_credentials" ||
    typeof parsed.client_id !== "string" ||
    !parsed.client_id.trim() ||
    typeof parsed.client_secret !== "string" ||
    !parsed.client_secret.trim()
  ) {
    return null;
  }

  return {
    auth_mode: "client_credentials",
    client_id: parsed.client_id,
    client_secret: parsed.client_secret,
  };
}

function parseAccessTokenPayload(
  plaintext: string,
): FlowAccountAccessTokenPayload | null {
  const parsed = parseJsonRecord(plaintext);
  if (typeof parsed?.access_token !== "string" || !parsed.access_token.trim()) {
    return null;
  }

  return {
    access_token: parsed.access_token,
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
