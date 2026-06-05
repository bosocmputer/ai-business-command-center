import { createHmac, timingSafeEqual } from "node:crypto";

export const OWNER_AUTH_COOKIE = "ai_bcc_owner_session";

export type OwnerSessionAuthResult =
  | { ok: true; subject: string }
  | { ok: false; statusCode: 401; error: string };

type OwnerSessionPayload = {
  sub: string;
  role: "owner_admin";
  exp: number;
};

export function verifyOwnerSessionCookie(input: {
  cookieValue: string | undefined;
  secret?: string;
}): OwnerSessionAuthResult {
  const secret = getOwnerAuthSecret(input.secret);
  const [encodedPayload, signature] = input.cookieValue?.split(".") ?? [];
  if (!encodedPayload || !signature) {
    return {
      ok: false,
      statusCode: 401,
      error: "Owner session is required.",
    };
  }

  if (!verifySignature(encodedPayload, signature, secret)) {
    return {
      ok: false,
      statusCode: 401,
      error: "Owner session is invalid.",
    };
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as OwnerSessionPayload;
    if (
      payload.role !== "owner_admin" ||
      !payload.sub ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return {
        ok: false,
        statusCode: 401,
        error: "Owner session has expired.",
      };
    }

    return { ok: true, subject: payload.sub };
  } catch {
    return {
      ok: false,
      statusCode: 401,
      error: "Owner session is invalid.",
    };
  }
}

function getOwnerAuthSecret(secret?: string) {
  return (
    secret?.trim() ||
    process.env.OWNER_AUTH_SECRET?.trim() ||
    "ai-bcc-local-owner-auth-secret"
  );
}

function verifySignature(payload: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
