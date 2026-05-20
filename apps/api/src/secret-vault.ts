import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ENVELOPE_PREFIX = "v1.";
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;

type SecretEnvelopePayload = {
  v: 1;
  alg: "A256GCM";
  kid: string;
  iv: string;
  tag: string;
  ciphertext: string;
  aad_hash: string;
  created_at: string;
};

export type EncryptSecretInput = {
  plaintext: string;
  encryptionSecret: string;
  keyId?: string;
  aad: string;
};

export type DecryptSecretInput = {
  envelope: string;
  encryptionSecret: string;
  aad: string;
};

export function encryptSecret(input: EncryptSecretInput) {
  assertPlaintext(input.plaintext);
  const key = deriveAesKey(input.encryptionSecret);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_LENGTH_BYTES,
  });
  cipher.setAAD(Buffer.from(input.aad, "utf8"));

  const ciphertext = Buffer.concat([
    cipher.update(input.plaintext, "utf8"),
    cipher.final(),
  ]);
  const payload: SecretEnvelopePayload = {
    v: 1,
    alg: "A256GCM",
    kid: input.keyId?.trim() || "env:AI_BCC_SECRET_KEY",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    aad_hash: hashAssociatedData(input.aad),
    created_at: new Date().toISOString(),
  };

  return `${ENVELOPE_PREFIX}${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

export function decryptSecret(input: DecryptSecretInput) {
  const payload = parseEnvelope(input.envelope);
  const expectedAadHash = hashAssociatedData(input.aad);
  if (!constantTimeEqual(payload.aad_hash, expectedAadHash)) {
    throw new Error("Secret envelope associated data does not match.");
  }

  const key = deriveAesKey(input.encryptionSecret);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "base64url"),
    { authTagLength: TAG_LENGTH_BYTES },
  );
  decipher.setAAD(Buffer.from(input.aad, "utf8"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncryptedSecretEnvelope(value: string) {
  return value.startsWith(ENVELOPE_PREFIX);
}

export function maskSecretValue(value: string) {
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 8))}${value.slice(-2)}`;
}

function parseEnvelope(envelope: string): SecretEnvelopePayload {
  if (!envelope.startsWith(ENVELOPE_PREFIX)) {
    throw new Error("Unsupported secret envelope format.");
  }

  const decoded = JSON.parse(
    Buffer.from(envelope.slice(ENVELOPE_PREFIX.length), "base64url").toString(
      "utf8",
    ),
  ) as Partial<SecretEnvelopePayload>;

  if (
    decoded.v !== 1 ||
    decoded.alg !== "A256GCM" ||
    typeof decoded.iv !== "string" ||
    typeof decoded.tag !== "string" ||
    typeof decoded.ciphertext !== "string" ||
    typeof decoded.aad_hash !== "string" ||
    typeof decoded.created_at !== "string"
  ) {
    throw new Error("Invalid secret envelope.");
  }

  return {
    v: 1,
    alg: "A256GCM",
    kid: typeof decoded.kid === "string" ? decoded.kid : "unknown",
    iv: decoded.iv,
    tag: decoded.tag,
    ciphertext: decoded.ciphertext,
    aad_hash: decoded.aad_hash,
    created_at: decoded.created_at,
  };
}

function assertPlaintext(value: string) {
  if (!value || !value.trim()) {
    throw new Error("Secret plaintext must not be empty.");
  }
}

function deriveAesKey(encryptionSecret: string) {
  const trimmed = encryptionSecret.trim();
  if (trimmed.length < 32) {
    throw new Error("AI_BCC_SECRET_KEY must be at least 32 characters.");
  }

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Fall back to SHA-256 derivation for raw env secrets.
  }

  return createHash("sha256").update(trimmed, "utf8").digest();
}

function hashAssociatedData(value: string) {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function constantTimeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
