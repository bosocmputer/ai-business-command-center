import { describe, expect, it } from "vitest";
import type { LineChannelRecord, TenantId } from "@ai-bcc/shared";
import type { SecretRecord, SystemStore } from "./system-store.js";
import {
  datasourceSecretAad,
  datasourceSecretId,
  lineChannelSecretAad,
  lineChannelSecretId,
  readDatasourceConfigStatus,
  readStoredDatasourceConfig,
  readStoredLineChannelCredentials,
  saveLineChannelSecrets,
  saveTenantDatasourceConfig,
} from "./tenant-secret-config.js";

const encryptionSecret = "0123456789abcdef0123456789abcdef";
const tenantId = "tenant_demo_remote" as TenantId;

describe("tenant secret config", () => {
  it("builds tenant-scoped secret ids and associated data", () => {
    expect(datasourceSecretId(tenantId)).toBe(
      "secret_tenant_demo_remote_datasource_sml_password",
    );
    expect(datasourceSecretAad(tenantId)).toBe(
      "tenant_demo_remote:datasource:sml_password",
    );
    expect(lineChannelSecretId("line_channel_1", "channel_access_token")).toBe(
      "secret_line_channel_1_channel_access_token",
    );
    expect(lineChannelSecretAad(tenantId, "line_channel_1", "channel_secret")).toBe(
      "tenant_demo_remote:line_channel:line_channel_1:channel_secret",
    );
  });

  it("saves datasource password encrypted and returns decrypted runtime config", async () => {
    const store = createFakeStore();
    const previousKey = process.env.AI_BCC_SECRET_KEY;
    process.env.AI_BCC_SECRET_KEY = encryptionSecret;

    try {
      await saveTenantDatasourceConfig({
        store,
        config: {
          tenantId,
          kind: "sml_postgres",
          host: "demserver.3bbddns.com",
          port: 47309,
          database: "demo",
          user: "readonly",
          password: "secret-password",
        },
      });

      const secret = await store.getSecretRecord(datasourceSecretId(tenantId));
      expect(secret?.encrypted_value).not.toContain("secret-password");
      expect(secret?.metadata_json).toEqual({
        kind: "sml_postgres",
        host: "demserver.3bbddns.com",
        port: 47309,
        database: "demo",
        user: "readonly",
      });

      await expect(
        readStoredDatasourceConfig({ store, tenantId }),
      ).resolves.toMatchObject({
        host: "demserver.3bbddns.com",
        port: 47309,
        database: "demo",
        user: "readonly",
        password: "secret-password",
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.AI_BCC_SECRET_KEY;
      } else {
        process.env.AI_BCC_SECRET_KEY = previousKey;
      }
    }
  });

  it("saves JavaWS datasource config without exposing reverse-proxy auth", async () => {
    const store = createFakeStore();
    const previousKey = process.env.AI_BCC_SECRET_KEY;
    process.env.AI_BCC_SECRET_KEY = encryptionSecret;

    try {
      const status = await saveTenantDatasourceConfig({
        store,
        config: {
          tenantId,
          kind: "sml_javaws",
          baseUrl: "http://sml-tomcat.local:8080",
          webappPath: "/SMLJavaWebService",
          endpoint: "DotNetFrameWork",
          configFileName: "SMLConfigDATA.xml",
          database: "sml1_2026",
          queryMethod: "_queryCompress",
          auth: {
            mode: "bearer",
            token: "reverse-proxy-token",
          },
        },
      });

      const secret = await store.getSecretRecord(datasourceSecretId(tenantId));
      expect(status).toMatchObject({
        source: "encrypted_store",
        kind: "sml_javaws",
        base_url: "http://sml-tomcat.local:8080",
        auth_configured: true,
      });
      expect(JSON.stringify(secret?.metadata_json)).not.toContain(
        "reverse-proxy-token",
      );
      await expect(
        readStoredDatasourceConfig({ store, tenantId }),
      ).resolves.toMatchObject({
        kind: "sml_javaws",
        baseUrl: "http://sml-tomcat.local:8080",
        configFileName: "SMLConfigDATA.xml",
        auth: { mode: "bearer", token: "reverse-proxy-token" },
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.AI_BCC_SECRET_KEY;
      } else {
        process.env.AI_BCC_SECRET_KEY = previousKey;
      }
    }
  });

  it("reports env datasource status without exposing password", async () => {
    const store = createFakeStore();
    const status = await readDatasourceConfigStatus({
      store,
      tenantId,
      envConfig: {
        kind: "sml_postgres",
        host: "127.0.0.1",
        port: 5432,
        database: "sml",
        user: "postgres",
        password: "must-not-return",
      },
    });

    expect(status).toMatchObject({
      source: "env",
      password_configured: true,
      host: "127.0.0.1",
      database: "sml",
    });
    expect(JSON.stringify(status)).not.toContain("must-not-return");
  });

  it("saves LINE channel token encrypted and resolves it by preferred channel", async () => {
    const store = createFakeStore([
      {
        id: "line_channel_1",
        tenant_id: tenantId,
        display_name: "Demo OA",
        channel_type: "line_oa",
        channel_access_token_configured: true,
        channel_secret_configured: false,
        enabled: true,
        source: "manual",
        created_at: "2026-05-21T00:00:00.000Z",
        updated_at: "2026-05-21T00:00:00.000Z",
      },
    ]);
    const previousKey = process.env.AI_BCC_SECRET_KEY;
    process.env.AI_BCC_SECRET_KEY = encryptionSecret;

    try {
      await saveLineChannelSecrets({
        store,
        config: {
          tenantId,
          lineChannelId: "line_channel_1",
          channelAccessToken: "line-token",
        },
      });

      const secret = await store.getSecretRecord(
        lineChannelSecretId("line_channel_1", "channel_access_token"),
      );
      expect(secret?.encrypted_value).not.toContain("line-token");
      await expect(
        readStoredLineChannelCredentials({
          store,
          tenantId,
          preferredLineChannelId: "line_channel_1",
        }),
      ).resolves.toMatchObject({
        channelAccessToken: "line-token",
        lineChannel: { id: "line_channel_1" },
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.AI_BCC_SECRET_KEY;
      } else {
        process.env.AI_BCC_SECRET_KEY = previousKey;
      }
    }
  });
});

function createFakeStore(lineChannels: LineChannelRecord[] = []) {
  const secrets = new Map<string, SecretRecord>();
  return {
    getSecretRecord: async (id: string) => secrets.get(id) ?? null,
    upsertSecretRecord: async (secret: SecretRecord) => {
      secrets.set(secret.id, secret);
      return secret;
    },
    listLineChannels: async (requestedTenantId?: TenantId) =>
      lineChannels.filter(
        (channel) => !requestedTenantId || channel.tenant_id === requestedTenantId,
      ),
  } as unknown as SystemStore;
}
