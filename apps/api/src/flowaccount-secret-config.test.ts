import { afterEach, describe, expect, it } from "vitest";
import type { TenantId } from "@ai-bcc/shared";
import type {
  FlowAccountConnectionRecord,
  SecretRecord,
  SystemStore,
} from "./system-store.js";
import {
  FLOWACCOUNT_ACCESS_TOKEN_SECRET_KEY,
  FLOWACCOUNT_CLIENT_CREDENTIALS_SECRET_KEY,
  flowAccountAccessTokenSecretId,
  flowAccountClientCredentialsSecretId,
  flowAccountSecretAad,
  readFlowAccountConfigStatus,
  readStoredFlowAccountAccessToken,
  readStoredFlowAccountClientCredentials,
  saveFlowAccountAccessToken,
  saveFlowAccountClientCredentials,
} from "./flowaccount-secret-config.js";

const encryptionSecret = "0123456789abcdef0123456789abcdef";
const tenantId = "tenant_demo_remote" as TenantId;
const originalEncryptionSecret = process.env.AI_BCC_SECRET_KEY;

afterEach(() => {
  if (originalEncryptionSecret === undefined) {
    delete process.env.AI_BCC_SECRET_KEY;
  } else {
    process.env.AI_BCC_SECRET_KEY = originalEncryptionSecret;
  }
});

describe("FlowAccount secret config", () => {
  it("builds tenant-scoped secret ids and associated data", () => {
    expect(flowAccountClientCredentialsSecretId(tenantId)).toBe(
      "secret_tenant_demo_remote_flowaccount_client_credentials",
    );
    expect(flowAccountAccessTokenSecretId(tenantId)).toBe(
      "secret_tenant_demo_remote_flowaccount_access_token",
    );
    expect(
      flowAccountSecretAad(
        tenantId,
        FLOWACCOUNT_CLIENT_CREDENTIALS_SECRET_KEY,
      ),
    ).toBe("tenant_demo_remote:flowaccount:client_credentials");
    expect(
      flowAccountSecretAad(tenantId, FLOWACCOUNT_ACCESS_TOKEN_SECRET_KEY),
    ).toBe("tenant_demo_remote:flowaccount:access_token");
  });

  it("saves client credentials encrypted without exposing metadata secrets", async () => {
    process.env.AI_BCC_SECRET_KEY = encryptionSecret;
    const store = createFakeStore();

    const status = await saveFlowAccountClientCredentials({
      store,
      tenantId,
      environment: "sandbox",
      authMode: "client_credentials",
      clientId: "flow-client-id",
      clientSecret: "flow-client-secret",
    });

    const secret = await store.getSecretRecord(
      flowAccountClientCredentialsSecretId(tenantId),
    );
    expect(status).toMatchObject({
      environment: "sandbox",
      auth_mode: "client_credentials",
      status: "configured_untested",
      credentials_configured: true,
      encryption_configured: true,
    });
    expect(secret?.scope).toBe("flowaccount");
    expect(secret?.secret_key).toBe("client_credentials");
    expect(secret?.encrypted_value).not.toContain("flow-client-id");
    expect(secret?.encrypted_value).not.toContain("flow-client-secret");
    expect(JSON.stringify(secret?.metadata_json)).not.toContain("flow-client-id");
    expect(JSON.stringify(secret?.metadata_json)).not.toContain(
      "flow-client-secret",
    );

    await expect(
      readStoredFlowAccountClientCredentials({ store, tenantId }),
    ).resolves.toMatchObject({
      environment: "sandbox",
      authMode: "client_credentials",
      clientId: "flow-client-id",
      clientSecret: "flow-client-secret",
    });
  });

  it("saves access tokens encrypted and reports metadata only", async () => {
    process.env.AI_BCC_SECRET_KEY = encryptionSecret;
    const store = createFakeStore();

    await saveFlowAccountAccessToken({
      store,
      tenantId,
      accessToken: "flow-access-token",
      expiresAt: "2026-06-24T10:00:00.000Z",
      tokenType: "Bearer",
      scope: "flowaccount-api",
      obtainedAt: "2026-06-23T10:00:00.000Z",
      credentialsUpdatedAt: "2026-06-23T09:00:00.000Z",
    });

    const secret = await store.getSecretRecord(
      flowAccountAccessTokenSecretId(tenantId),
    );
    expect(secret?.scope).toBe("flowaccount");
    expect(secret?.encrypted_value).not.toContain("flow-access-token");
    expect(JSON.stringify(secret?.metadata_json)).toContain(
      "2026-06-24T10:00:00.000Z",
    );
    expect(JSON.stringify(secret?.metadata_json)).not.toContain(
      "flow-access-token",
    );
    await expect(
      readStoredFlowAccountAccessToken({ store, tenantId }),
    ).resolves.toMatchObject({
      accessToken: "flow-access-token",
      expiresAt: "2026-06-24T10:00:00.000Z",
      credentialsUpdatedAt: "2026-06-23T09:00:00.000Z",
    });
  });

  it("reports missing status without decrypting secrets", async () => {
    process.env.AI_BCC_SECRET_KEY = encryptionSecret;
    const store = createFakeStore();

    await expect(
      readFlowAccountConfigStatus({ store, tenantId }),
    ).resolves.toEqual({
      environment: "sandbox",
      auth_mode: "client_credentials",
      status: "missing",
      credentials_configured: false,
      company_id: null,
      support_code: null,
      access_token_expires_at: null,
      last_tested_at: null,
      last_error: null,
      updated_at: null,
      encryption_configured: true,
    });
  });
});

function createFakeStore() {
  const secrets = new Map<string, SecretRecord>();
  const connections = new Map<TenantId, FlowAccountConnectionRecord>();
  const locks = new Set<string>();
  return {
    getSecretRecord: async (id: string) => secrets.get(id) ?? null,
    upsertSecretRecord: async (secret: SecretRecord) => {
      secrets.set(secret.id, secret);
      return secret;
    },
    getFlowAccountConnection: async (requestedTenantId: TenantId) =>
      connections.get(requestedTenantId) ?? null,
    upsertFlowAccountConnection: async (
      connection: FlowAccountConnectionRecord,
    ) => {
      connections.set(connection.tenant_id, connection);
      return connection;
    },
    tryAcquireLock: async ({ lockKey }: { lockKey: string }) => {
      if (locks.has(lockKey)) {
        return false;
      }
      locks.add(lockKey);
      return true;
    },
    releaseLock: async ({ lockKey }: { lockKey: string }) => {
      locks.delete(lockKey);
    },
  } as unknown as SystemStore;
}
