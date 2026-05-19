import { createHmac, timingSafeEqual } from "node:crypto";
import type { ReportKey, TenantId } from "@ai-bcc/shared";

export type ReportViewerTokenPayload = {
  v: 1;
  tenant_id: TenantId;
  report_key: ReportKey;
  run_id: string;
  exp: number;
};

export type ReportViewerTokenFailureReason =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "forbidden";

export type ReportViewerTokenVerifyResult =
  | { ok: true; payload: ReportViewerTokenPayload }
  | { ok: false; reason: ReportViewerTokenFailureReason };

export function createReportViewerToken(input: {
  secret: string;
  tenantId: TenantId;
  reportKey: ReportKey;
  runId: string;
  expiresAt: Date;
}) {
  assertUsableSecret(input.secret);
  if (!input.runId.trim()) {
    throw new Error("runId is required for report viewer token.");
  }

  const payload: ReportViewerTokenPayload = {
    v: 1,
    tenant_id: input.tenantId,
    report_key: input.reportKey,
    run_id: input.runId,
    exp: Math.floor(input.expiresAt.getTime() / 1000),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, input.secret);
  return `v1.${encodedPayload}.${signature}`;
}

export function verifyReportViewerToken(input: {
  token: string | undefined;
  secret: string;
  tenantId: TenantId;
  reportKey: ReportKey;
  runId: string;
  now?: Date;
}): ReportViewerTokenVerifyResult {
  if (!input.token?.trim()) {
    return { ok: false, reason: "missing" };
  }

  try {
    assertUsableSecret(input.secret);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const parts = input.token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return { ok: false, reason: "malformed" };
  }

  const [, encodedPayload, signature] = parts;
  const expectedSignature = signPayload(encodedPayload, input.secret);
  if (!safeEqual(signature, expectedSignature)) {
    return { ok: false, reason: "bad_signature" };
  }

  const payload = decodePayload(encodedPayload);
  if (!payload) {
    return { ok: false, reason: "malformed" };
  }

  if (
    payload.tenant_id !== input.tenantId ||
    payload.report_key !== input.reportKey ||
    payload.run_id !== input.runId
  ) {
    return { ok: false, reason: "forbidden" };
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (payload.exp < nowSeconds) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}

export function maskReportViewerToken(token: string | null | undefined) {
  if (!token) {
    return null;
  }

  if (token.length <= 12) {
    return "********";
  }

  return `${token.slice(0, 6)}...${token.slice(-6)}`;
}

function assertUsableSecret(secret: string) {
  if (!secret || secret.trim().length < 32) {
    throw new Error("REPORT_VIEWER_SIGNING_SECRET must be at least 32 characters.");
  }
}

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodePayload(encodedPayload: string): ReportViewerTokenPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<ReportViewerTokenPayload>;

    if (
      parsed.v !== 1 ||
      typeof parsed.tenant_id !== "string" ||
      typeof parsed.report_key !== "string" ||
      typeof parsed.run_id !== "string" ||
      typeof parsed.exp !== "number" ||
      !Number.isFinite(parsed.exp)
    ) {
      return null;
    }

    return parsed as ReportViewerTokenPayload;
  } catch {
    return null;
  }
}
