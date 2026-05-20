import { afterEach, describe, expect, it } from "vitest";
import { readLineChannelConfig, readLineChannelCredentials } from "./config.js";

const lineEnvKeys = [
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_TARGET_ID",
  "LINE_TARGET_TYPE",
  "LINE_DEMO_CHANNEL_ACCESS_TOKEN",
  "LINE_DEMO_TARGET_ID",
  "LINE_DEMO_TARGET_TYPE",
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
  it("keeps channel credentials usable when no legacy env target is configured", () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-channel-token";
    delete process.env.LINE_TARGET_ID;
    delete process.env.LINE_TARGET_TYPE;
    delete process.env.LINE_DEMO_TARGET_ID;
    delete process.env.LINE_DEMO_TARGET_TYPE;

    expect(readLineChannelCredentials("tenant_demo_remote")).toEqual({
      channelAccessToken: "line-channel-token",
    });
    expect(readLineChannelConfig("tenant_demo_remote")).toBeNull();
  });

  it("returns the legacy env target only when target id still exists", () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-channel-token";
    process.env.LINE_TARGET_ID = "C1234567890abcdef1234567890abcdef";
    process.env.LINE_TARGET_TYPE = "group";

    expect(readLineChannelConfig("tenant_demo_remote")).toMatchObject({
      channelAccessToken: "line-channel-token",
      targetId: "C1234567890abcdef1234567890abcdef",
      targetType: "group",
    });
  });
});
