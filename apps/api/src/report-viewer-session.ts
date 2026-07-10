import { createHmac, timingSafeEqual } from "node:crypto";

export type ReportViewerSessionVerifyResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" };

export function createReportViewerSessionCookie(input: {
  secret: string;
  sessionId: string;
}) {
  assertUsableSecret(input.secret);
  if (!input.sessionId.trim()) {
    throw new Error("sessionId is required for report viewer session cookie.");
  }

  const encodedSessionId = Buffer.from(input.sessionId, "utf8").toString(
    "base64url",
  );
  const signature = sign(encodedSessionId, input.secret);
  return `vs1.${encodedSessionId}.${signature}`;
}

export function verifyReportViewerSessionCookie(input: {
  secret: string;
  cookieValue: string | undefined;
}): ReportViewerSessionVerifyResult {
  if (!input.cookieValue?.trim()) {
    return { ok: false, reason: "missing" };
  }

  try {
    assertUsableSecret(input.secret);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const parts = input.cookieValue.split(".");
  if (parts.length !== 3 || parts[0] !== "vs1") {
    return { ok: false, reason: "malformed" };
  }

  const [, encodedSessionId, signature] = parts;
  if (!safeEqual(signature, sign(encodedSessionId, input.secret))) {
    return { ok: false, reason: "bad_signature" };
  }

  try {
    const sessionId = Buffer.from(encodedSessionId, "base64url").toString("utf8");
    if (!sessionId.trim()) {
      return { ok: false, reason: "malformed" };
    }
    return { ok: true, sessionId };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

function assertUsableSecret(secret: string) {
  if (!secret || secret.trim().length < 32) {
    throw new Error("REPORT_VIEWER_SIGNING_SECRET must be at least 32 characters.");
  }
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
