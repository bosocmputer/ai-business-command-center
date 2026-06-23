import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantId } from "@ai-bcc/shared";
import type {
  FlowAccountConnectionRecord,
  SecretRecord,
  SystemStore,
} from "./system-store.js";
import {
  flowAccountAccessTokenSecretId,
  saveFlowAccountAccessToken,
  saveFlowAccountClientCredentials,
} from "./flowaccount-secret-config.js";
import {
  clearFlowAccountTokenRefreshInflightForTests,
  resolveFlowAccountAccessToken,
  testStoredFlowAccountConnection,
  type FlowAccountTokenRequester,
} from "./flowaccount-service.js";

const encryptionSecret = "0123456789abcdef0123456789abcdef";
const tenantId = "tenant_demo_remote" as TenantId;
const originalEncryptionSecret = process.env.AI_BCC_SECRET_KEY;

afterEach(() => {
  if (originalEncryptionSecret === undefined) {
    delete process.env.AI_BCC_SECRET_KEY;
  } else {
    process.env.AI_BCC_SECRET_KEY = originalEncryptionSecret;
  }
  clearFlowAccountTokenRefreshInflightForTests();
});

describe("FlowAccount service", () => {
  it("reuses cached access tokens that have more than five minutes remaining", async () => {
    process.env.AI_BCC_SECRET_KEY = encryptionSecret;
    const store = createFakeStore();
    await saveCredentials(store);
    const now = new Date();
    const credentials = await store.getSecretRecord(
      `secret_${tenantId}_flowaccount_client_credentials`,
    );
    await saveFlowAccountAccessToken({
      store,
      tenantId,
      accessToken: "cached-token",
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      tokenType: "Bearer",
      scope: "flowaccount-api",
      obtainedAt: "2026-06-23T09:00:00.000Z",
      credentialsUpdatedAt: credentials?.updated_at ?? "",
    });

    const tokenRequester = vi.fn();
    const result = await resolveFlowAccountAccessToken({
      store,
      tenantId,
      tokenRequester,
      now,
    });

    expect(result).toMatchObject({
      ok: true,
      accessToken: "cached-token",
      tokenRefreshed: false,
    });
    expect(tokenRequester).not.toHaveBeenCalled();
  });

  it("refreshes cached access tokens inside the five-minute buffer", async () => {
    process.env.AI_BCC_SECRET_KEY = encryptionSecret;
    const store = createFakeStore();
    await saveCredentials(store);
    const now = new Date();
    const credentials = await store.getSecretRecord(
      `secret_${tenantId}_flowaccount_client_credentials`,
    );
    await saveFlowAccountAccessToken({
      store,
      tenantId,
      accessToken: "stale-token",
      expiresAt: new Date(now.getTime() + 4 * 60 * 1000).toISOString(),
      tokenType: "Bearer",
      scope: "flowaccount-api",
      obtainedAt: "2026-06-23T09:00:00.000Z",
      credentialsUpdatedAt: credentials?.updated_at ?? "",
    });
    const tokenRequester = vi.fn().mockResolvedValue({
      ok: true,
      provider_status: 200,
      access_token: "fresh-token",
      expires_in: 86400,
      token_type: "Bearer",
      scope: "flowaccount-api",
      support_code: null,
    });

    const result = await resolveFlowAccountAccessToken({
      store,
      tenantId,
      tokenRequester,
      now,
    });

    expect(result).toMatchObject({
      ok: true,
      accessToken: "fresh-token",
      tokenRefreshed: true,
    });
    expect(tokenRequester).toHaveBeenCalledTimes(1);
    const storedToken = await store.getSecretRecord(
      flowAccountAccessTokenSecretId(tenantId),
    );
    expect(storedToken?.encrypted_value).not.toContain("fresh-token");
  });

  it("does not refresh more than once for concurrent tenant calls", async () => {
    process.env.AI_BCC_SECRET_KEY = encryptionSecret;
    const store = createFakeStore();
    await saveCredentials(store);

    let resolveToken!: () => void;
    const tokenRequester = vi.fn<FlowAccountTokenRequester>(
      () =>
        new Promise((resolve) => {
          resolveToken = () =>
            resolve({
              ok: true,
              provider_status: 200,
              access_token: "fresh-token",
              expires_in: 86400,
              token_type: "Bearer",
              scope: "flowaccount-api",
              support_code: "SUP-TOKEN",
            });
        }),
    );

    const first = resolveFlowAccountAccessToken({
      store,
      tenantId,
      tokenRequester,
    });
    const second = resolveFlowAccountAccessToken({
      store,
      tenantId,
      tokenRequester,
    });

    await vi.waitFor(() => expect(tokenRequester).toHaveBeenCalledTimes(1));
    resolveToken();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({
        ok: true,
        accessToken: "fresh-token",
        tokenRefreshed: true,
      }),
      expect.objectContaining({
        ok: true,
        accessToken: "fresh-token",
        tokenRefreshed: true,
      }),
    ]);
    expect(tokenRequester).toHaveBeenCalledTimes(1);
  });

  it("returns a safe missing-config result without calling FlowAccount", async () => {
    process.env.AI_BCC_SECRET_KEY = encryptionSecret;
    const store = createFakeStore();
    const tokenRequester = vi.fn();
    const companyInfoRequester = vi.fn();

    const result = await testStoredFlowAccountConnection({
      store,
      tenantId,
      tokenRequester,
      companyInfoRequester,
    });

    expect(result).toMatchObject({
      ok: false,
      provider_status: null,
      company_id: null,
      support_code: null,
      safe_error_message:
        "FlowAccount sandbox credentials are not configured.",
      failure_reason: "missing_config",
    });
    expect(tokenRequester).not.toHaveBeenCalled();
    expect(companyInfoRequester).not.toHaveBeenCalled();
  });

  it("returns safe provider failures without leaking secrets", async () => {
    process.env.AI_BCC_SECRET_KEY = encryptionSecret;
    const store = createFakeStore();
    await saveCredentials(store);
    const tokenRequester = vi.fn().mockResolvedValue({
      ok: false,
      provider_status: 200,
      provider_error: "invalid_client",
      retryable: false,
      safe_error_message:
        "FlowAccount rejected the sandbox client credentials.",
    });

    const result = await testStoredFlowAccountConnection({
      store,
      tenantId,
      tokenRequester,
      companyInfoRequester: vi.fn(),
    });

    expect(result).toMatchObject({
      ok: false,
      provider_status: 200,
      company_id: null,
      support_code: null,
      safe_error_message:
        "FlowAccount rejected the sandbox client credentials.",
      failure_reason: "token",
    });
    expect(JSON.stringify(result)).not.toContain("flow-client-secret");
  });

  it("tests company info with a refreshed token and sanitized company fields", async () => {
    process.env.AI_BCC_SECRET_KEY = encryptionSecret;
    const store = createFakeStore();
    await saveCredentials(store);
    const tokenRequester = vi.fn().mockResolvedValue({
      ok: true,
      provider_status: 200,
      access_token: "fresh-token",
      expires_in: 86400,
      token_type: "Bearer",
      scope: "flowaccount-api",
      support_code: "SUP-TOKEN",
    });
    const companyInfoRequester = vi.fn().mockResolvedValue({
      ok: true,
      provider_status: 200,
      company_id: "company-123",
      support_code: "SUP-COMPANY",
    });

    const result = await testStoredFlowAccountConnection({
      store,
      tenantId,
      tokenRequester,
      companyInfoRequester,
    });

    expect(result).toMatchObject({
      ok: true,
      provider_status: 200,
      company_id: "company-123",
      support_code: "SUP-COMPANY",
      safe_error_message: null,
      token_refreshed: true,
      support_code_source: "company_info",
      failure_reason: null,
    });
    expect(companyInfoRequester).toHaveBeenCalledWith({
      environment: "sandbox",
      accessToken: "fresh-token",
    });
  });
});

async function saveCredentials(store: SystemStore) {
  await saveFlowAccountClientCredentials({
    store,
    tenantId,
    environment: "sandbox",
    authMode: "client_credentials",
    clientId: "flow-client-id",
    clientSecret: "flow-client-secret",
  });
}

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
