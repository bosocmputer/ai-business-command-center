import type { TenantId } from "@ai-bcc/shared";
import {
  fetchFlowAccountCompanyInfo,
  requestFlowAccountClientCredentialsToken,
  type FlowAccountCompanyInfoSuccess,
  type FlowAccountProviderFailure,
  type FlowAccountTokenSuccess,
} from "./flowaccount-client.js";
import {
  readStoredFlowAccountAccessToken,
  readStoredFlowAccountClientCredentials,
  saveFlowAccountAccessToken,
  type StoredFlowAccountClientCredentials,
} from "./flowaccount-secret-config.js";
import type { SystemStore } from "./system-store.js";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_LOCK_WAIT_MS = 3000;
const TOKEN_REFRESH_LOCK_POLL_MS = 100;

export type FlowAccountTokenRequester = (input: {
  environment: "sandbox";
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}) => Promise<FlowAccountTokenSuccess | FlowAccountProviderFailure>;

export type FlowAccountCompanyInfoRequester = (input: {
  environment: "sandbox";
  accessToken: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}) => Promise<FlowAccountCompanyInfoSuccess | FlowAccountProviderFailure>;

export type FlowAccountAccessTokenResolution =
  | {
      ok: true;
      accessToken: string;
      expiresAt: string;
      providerStatus: number | null;
      supportCode: string | null;
      tokenRefreshed: boolean;
    }
  | {
      ok: false;
      providerStatus: number | null;
      safeErrorMessage: string;
      failureReason: "missing_config" | "secret_error" | "provider_error";
    };

export type FlowAccountStoredTestResult = {
  ok: boolean;
  checked_at: string;
  environment: "sandbox";
  latency_ms: number;
  provider_status: number | null;
  company_id: string | null;
  support_code: string | null;
  safe_error_message: string | null;
  access_token_expires_at: string | null;
  token_refreshed: boolean;
  token_provider_status: number | null;
  support_code_source: "token_response" | "company_info" | "missing";
  failure_reason:
    | "missing_config"
    | "secret_error"
    | "token"
    | "company_info"
    | null;
};

const tokenRefreshInflight = new Map<
  string,
  Promise<FlowAccountAccessTokenResolution>
>();

export async function resolveFlowAccountAccessToken(input: {
  store: SystemStore;
  tenantId: TenantId;
  tokenRequester?: FlowAccountTokenRequester;
  now?: Date;
}): Promise<FlowAccountAccessTokenResolution> {
  let credentials: StoredFlowAccountClientCredentials | null = null;
  try {
    credentials = await readStoredFlowAccountClientCredentials({
      store: input.store,
      tenantId: input.tenantId,
    });
  } catch {
    return {
      ok: false,
      providerStatus: null,
      safeErrorMessage:
        "FlowAccount sandbox credentials could not be decrypted.",
      failureReason: "secret_error",
    };
  }

  if (!credentials) {
    return {
      ok: false,
      providerStatus: null,
      safeErrorMessage: "FlowAccount sandbox credentials are not configured.",
      failureReason: "missing_config",
    };
  }

  const cached = await readUsableCachedToken({
    store: input.store,
    tenantId: input.tenantId,
    credentialsUpdatedAt: credentials.updatedAt,
    now: input.now ?? new Date(),
  });
  if (cached) {
    return cached;
  }

  const inflightKey = `${input.tenantId}:${credentials.environment}`;
  const existing = tokenRefreshInflight.get(inflightKey);
  if (existing) {
    return existing;
  }

  const refreshPromise = refreshFlowAccountAccessToken({
    store: input.store,
    tenantId: input.tenantId,
    credentials,
    tokenRequester:
      input.tokenRequester ?? requestFlowAccountClientCredentialsToken,
    now: input.now ?? new Date(),
  }).finally(() => {
    tokenRefreshInflight.delete(inflightKey);
  });
  tokenRefreshInflight.set(inflightKey, refreshPromise);
  return refreshPromise;
}

export async function testStoredFlowAccountConnection(input: {
  store: SystemStore;
  tenantId: TenantId;
  tokenRequester?: FlowAccountTokenRequester;
  companyInfoRequester?: FlowAccountCompanyInfoRequester;
}): Promise<FlowAccountStoredTestResult> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const tokenResult = await resolveFlowAccountAccessToken({
    store: input.store,
    tenantId: input.tenantId,
    tokenRequester: input.tokenRequester,
  });

  if (!tokenResult.ok) {
    return {
      ok: false,
      checked_at: checkedAt,
      environment: "sandbox",
      latency_ms: Date.now() - startedAt,
      provider_status: tokenResult.providerStatus,
      company_id: null,
      support_code: null,
      safe_error_message: tokenResult.safeErrorMessage,
      access_token_expires_at: null,
      token_refreshed: false,
      token_provider_status: tokenResult.providerStatus,
      support_code_source: "missing",
      failure_reason:
        tokenResult.failureReason === "missing_config"
          ? "missing_config"
          : tokenResult.failureReason === "secret_error"
            ? "secret_error"
            : "token",
    };
  }

  const companyInfoRequester =
    input.companyInfoRequester ?? fetchFlowAccountCompanyInfo;
  const companyInfo = await companyInfoRequester({
    environment: "sandbox",
    accessToken: tokenResult.accessToken,
  });

  if (!companyInfo.ok) {
    return {
      ok: false,
      checked_at: checkedAt,
      environment: "sandbox",
      latency_ms: Date.now() - startedAt,
      provider_status: companyInfo.provider_status,
      company_id: null,
      support_code: tokenResult.supportCode,
      safe_error_message: companyInfo.safe_error_message,
      access_token_expires_at: tokenResult.expiresAt,
      token_refreshed: tokenResult.tokenRefreshed,
      token_provider_status: tokenResult.providerStatus,
      support_code_source: tokenResult.supportCode
        ? "token_response"
        : "missing",
      failure_reason: "company_info",
    };
  }

  const supportCode = companyInfo.support_code ?? tokenResult.supportCode;
  return {
    ok: true,
    checked_at: checkedAt,
    environment: "sandbox",
    latency_ms: Date.now() - startedAt,
    provider_status: companyInfo.provider_status,
    company_id: companyInfo.company_id,
    support_code: supportCode,
    safe_error_message: null,
    access_token_expires_at: tokenResult.expiresAt,
    token_refreshed: tokenResult.tokenRefreshed,
    token_provider_status: tokenResult.providerStatus,
    support_code_source: companyInfo.support_code
      ? "company_info"
      : tokenResult.supportCode
        ? "token_response"
        : "missing",
    failure_reason: null,
  };
}

export function clearFlowAccountTokenRefreshInflightForTests() {
  tokenRefreshInflight.clear();
}

async function refreshFlowAccountAccessToken(input: {
  store: SystemStore;
  tenantId: TenantId;
  credentials: StoredFlowAccountClientCredentials;
  tokenRequester: FlowAccountTokenRequester;
  now: Date;
}): Promise<FlowAccountAccessTokenResolution> {
  const lockKey = `flowaccount_token_refresh:${input.tenantId}`;
  const lockAcquired = await input.store
    .tryAcquireLock({ lockKey })
    .catch(() => true);
  if (!lockAcquired) {
    const cached = await waitForCachedToken({
      store: input.store,
      tenantId: input.tenantId,
      credentialsUpdatedAt: input.credentials.updatedAt,
    });
    if (cached) {
      return cached;
    }

    return {
      ok: false,
      providerStatus: null,
      safeErrorMessage:
        "FlowAccount token refresh is already in progress. Please try again.",
      failureReason: "provider_error",
    };
  }

  try {
    const cached = await readUsableCachedToken({
      store: input.store,
      tenantId: input.tenantId,
      credentialsUpdatedAt: input.credentials.updatedAt,
      now: new Date(),
    });
    if (cached) {
      return cached;
    }

    const obtainedAt = new Date().toISOString();
    const tokenResult = await input.tokenRequester({
      environment: input.credentials.environment,
      clientId: input.credentials.clientId,
      clientSecret: input.credentials.clientSecret,
    });
    if (!tokenResult.ok) {
      return {
        ok: false,
        providerStatus: tokenResult.provider_status,
        safeErrorMessage: tokenResult.safe_error_message,
        failureReason: "provider_error",
      };
    }

    const expiresAt = new Date(
      new Date(obtainedAt).getTime() + tokenResult.expires_in * 1000,
    ).toISOString();
    await saveFlowAccountAccessToken({
      store: input.store,
      tenantId: input.tenantId,
      accessToken: tokenResult.access_token,
      expiresAt,
      tokenType: tokenResult.token_type,
      scope: tokenResult.scope,
      obtainedAt,
      credentialsUpdatedAt: input.credentials.updatedAt,
    });

    return {
      ok: true,
      accessToken: tokenResult.access_token,
      expiresAt,
      providerStatus: tokenResult.provider_status,
      supportCode: tokenResult.support_code,
      tokenRefreshed: true,
    };
  } catch {
    return {
      ok: false,
      providerStatus: null,
      safeErrorMessage: "FlowAccount access token could not be refreshed.",
      failureReason: "secret_error",
    };
  } finally {
    await input.store.releaseLock({ lockKey }).catch(() => undefined);
  }
}

async function waitForCachedToken(input: {
  store: SystemStore;
  tenantId: TenantId;
  credentialsUpdatedAt: string;
}) {
  const deadline = Date.now() + TOKEN_REFRESH_LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    const cached = await readUsableCachedToken({
      store: input.store,
      tenantId: input.tenantId,
      credentialsUpdatedAt: input.credentialsUpdatedAt,
      now: new Date(),
    });
    if (cached) {
      return cached;
    }
    await delay(TOKEN_REFRESH_LOCK_POLL_MS);
  }

  return null;
}

async function readUsableCachedToken(input: {
  store: SystemStore;
  tenantId: TenantId;
  credentialsUpdatedAt: string;
  now: Date;
}): Promise<FlowAccountAccessTokenResolution | null> {
  let cachedToken;
  try {
    cachedToken = await readStoredFlowAccountAccessToken({
      store: input.store,
      tenantId: input.tenantId,
    });
  } catch {
    return null;
  }

  if (!cachedToken) {
    return null;
  }

  const expiresAt = new Date(cachedToken.expiresAt).getTime();
  if (
    cachedToken.credentialsUpdatedAt !== input.credentialsUpdatedAt ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= input.now.getTime() + TOKEN_REFRESH_BUFFER_MS
  ) {
    return null;
  }

  return {
    ok: true,
    accessToken: cachedToken.accessToken,
    expiresAt: cachedToken.expiresAt,
    providerStatus: null,
    supportCode: null,
    tokenRefreshed: false,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
