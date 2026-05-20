import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecretEnvelope,
  maskSecretValue,
} from "./secret-vault.js";

const encryptionSecret = "0123456789abcdef0123456789abcdef";

describe("secret vault envelope", () => {
  it("encrypts and decrypts a secret with tenant-scoped associated data", () => {
    const envelope = encryptSecret({
      plaintext: "postgres-password",
      encryptionSecret,
      aad: "tenant_demo_remote:datasource:sml_password",
      keyId: "test-key",
    });

    expect(isEncryptedSecretEnvelope(envelope)).toBe(true);
    expect(envelope).not.toContain("postgres-password");
    expect(
      decryptSecret({
        envelope,
        encryptionSecret,
        aad: "tenant_demo_remote:datasource:sml_password",
      }),
    ).toBe("postgres-password");
  });

  it("rejects decryption when associated data points to another tenant or key", () => {
    const envelope = encryptSecret({
      plaintext: "line-token",
      encryptionSecret,
      aad: "tenant_demo_remote:line_channel:channel_access_token",
    });

    expect(() =>
      decryptSecret({
        envelope,
        encryptionSecret,
        aad: "tenant_other:line_channel:channel_access_token",
      }),
    ).toThrow(/associated data/i);
  });

  it("requires a strong enough encryption secret", () => {
    expect(() =>
      encryptSecret({
        plaintext: "value",
        encryptionSecret: "too-short",
        aad: "tenant:scope:key",
      }),
    ).toThrow(/at least 32 characters/i);
  });

  it("masks display values without returning the full secret", () => {
    expect(maskSecretValue("postgres")).toBe("********");
    expect(maskSecretValue("abcdefghijklmnopqrstuvwxyz")).toBe(
      "ab********yz",
    );
  });
});
