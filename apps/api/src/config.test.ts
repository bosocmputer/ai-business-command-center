import { afterEach, describe, expect, it } from "vitest";
import {
  getTenantSlug,
  readLineChannelConfig,
  readLineChannelCredentials,
  resolveTenantIdFromSlug,
} from "./config.js";

const lineEnvKeys = [
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_TARGET_ID",
  "LINE_TARGET_TYPE",
  "LINE_DEMO_CHANNEL_ACCESS_TOKEN",
  "LINE_DEMO_TARGET_ID",
  "LINE_DEMO_TARGET_TYPE",
  "LINE_OFFICE_CHANNEL_ACCESS_TOKEN",
  "LINE_OFFICE_TARGET_ID",
  "LINE_OFFICE_TARGET_TYPE",
] as const;

const originalEnv = new Map<string, string | undefined>(
  lineEnvKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of lineEnvKeys) {
    const originalValue = originalEnv.get(key);
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
});

describe("LINE channel configuration", () => {
  it("does not use LINE env credentials for runtime configuration", () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-channel-token";

    expect(readLineChannelCredentials("tenant_demo_remote")).toBeNull();
    expect(readLineChannelConfig("tenant_demo_remote")).toBeNull();
  });

  it("ignores legacy LINE target env values", () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-channel-token";
    process.env.LINE_TARGET_ID = "C1234567890abcdef1234567890abcdef";
    process.env.LINE_TARGET_TYPE = "group";

    expect(readLineChannelConfig("tenant_demo_remote")).toBeNull();
  });

  it("requires LINE OA to be stored through the encrypted owner flow", () => {
    process.env.LINE_OFFICE_CHANNEL_ACCESS_TOKEN = "line-channel-token";
    process.env.LINE_OFFICE_TARGET_ID = "C1234567890abcdef1234567890abcdef";

    expect(readLineChannelCredentials("tenant_office_sml1_2026")).toBeNull();
    expect(readLineChannelConfig("tenant_office_sml1_2026")).toBeNull();
  });
});

describe("customer dashboard tenant slugs", () => {
  it("maps public customer slugs to internal tenant ids", () => {
    expect(resolveTenantIdFromSlug("demo-shop")).toBe("tenant_demo_remote");
    expect(resolveTenantIdFromSlug("248-shop")).toBe(
      "tenant_office_sml1_2026",
    );
    expect(resolveTenantIdFromSlug("unknown-shop")).toBe("unknown-shop");
    expect(resolveTenantIdFromSlug("Invalid Shop")).toBeNull();
  });

  it("keeps curated slugs and falls back to tenant_id for DB-created tenants", () => {
    expect(getTenantSlug("tenant_demo_remote")).toBe("demo-shop");
    expect(getTenantSlug("tenant_office_sml1_2026")).toBe("248-shop");
    expect(getTenantSlug("tenant_new_shop")).toBe("tenant_new_shop");
    expect(resolveTenantIdFromSlug("tenant_new_shop")).toBe("tenant_new_shop");
    expect(resolveTenantIdFromSlug("tenant_demo_remote")).toBeNull();
  });
});
