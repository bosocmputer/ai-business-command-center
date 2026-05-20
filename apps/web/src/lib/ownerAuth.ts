export const OWNER_AUTH_COOKIE = "ai_bcc_owner_session";

export type OwnerSessionPayload = {
  sub: string;
  role: "owner_admin";
  exp: number;
};

export async function createOwnerSessionToken({
  secret,
  ttlSeconds,
  username,
}: {
  secret: string;
  ttlSeconds: number;
  username: string;
}) {
  const payload: OwnerSessionPayload = {
    sub: username,
    role: "owner_admin",
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encodedPayload = base64UrlEncodeText(JSON.stringify(payload));
  const signature = await sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function verifyOwnerSessionToken(
  token: string | undefined,
  secret: string,
) {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const isValid = await verify(encodedPayload, signature, secret);
  if (!isValid) {
    return null;
  }

  try {
    const payload = JSON.parse(
      base64UrlDecodeText(encodedPayload),
    ) as OwnerSessionPayload;
    if (
      payload.role !== "owner_admin" ||
      !payload.sub ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getOwnerAuthSecret() {
  return (
    process.env.OWNER_AUTH_SECRET ||
    process.env.AI_BCC_ADMIN_TOKEN ||
    "ai-bcc-local-owner-auth-secret"
  );
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

async function verify(value: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecodeBytes(signature),
    new TextEncoder().encode(value),
  );
}

function base64UrlEncodeText(value: string) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlDecodeText(value: string) {
  return new TextDecoder().decode(base64UrlDecodeBytes(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
