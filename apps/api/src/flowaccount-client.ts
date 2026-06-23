export const FLOWACCOUNT_SCOPE = "flowaccount-api";
export const FLOWACCOUNT_DEFAULT_TIMEOUT_MS = 8000;

const FLOWACCOUNT_SANDBOX_BASE_URL = "https://openapi.flowaccount.com/test";
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 250;

export type FlowAccountEnvironment = "sandbox";

export type FlowAccountProviderFailure = {
  ok: false;
  provider_status: number | null;
  provider_error: string | null;
  retryable: boolean;
  safe_error_message: string;
};

export type FlowAccountTokenSuccess = {
  ok: true;
  provider_status: number;
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string | null;
  support_code: string | null;
};

export type FlowAccountCompanyInfoSuccess = {
  ok: true;
  provider_status: number;
  company_id: string | null;
  support_code: string | null;
};

type FlowAccountRequestResult =
  | {
      ok: true;
      status: number;
      body: Record<string, unknown>;
    }
  | FlowAccountProviderFailure;

export async function requestFlowAccountClientCredentialsToken(input: {
  environment: FlowAccountEnvironment;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}): Promise<FlowAccountTokenSuccess | FlowAccountProviderFailure> {
  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("scope", FLOWACCOUNT_SCOPE);
  form.set("client_id", input.clientId);
  form.set("client_secret", input.clientSecret);

  const result = await requestFlowAccountJson({
    url: `${flowAccountBaseUrl(input.environment)}/token`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    },
    timeoutMs: input.timeoutMs,
    maxRetries: input.maxRetries,
    retryDelayMs: input.retryDelayMs,
    requestKind: "token",
  });

  if (!result.ok) {
    return result;
  }

  const body = result.body;
  if (
    typeof body.access_token !== "string" ||
    !body.access_token.trim() ||
    typeof body.expires_in !== "number" ||
    !Number.isFinite(body.expires_in) ||
    body.expires_in <= 0 ||
    typeof body.token_type !== "string" ||
    !body.token_type.trim()
  ) {
    return {
      ok: false,
      provider_status: result.status,
      provider_error: "schema_drift",
      retryable: false,
      safe_error_message:
        "FlowAccount token response did not match the expected schema.",
    };
  }

  return {
    ok: true,
    provider_status: result.status,
    access_token: body.access_token,
    expires_in: Math.floor(body.expires_in),
    token_type: body.token_type,
    scope: typeof body.scope === "string" ? body.scope : null,
    support_code: readSupportCode(body),
  };
}

export async function fetchFlowAccountCompanyInfo(input: {
  environment: FlowAccountEnvironment;
  accessToken: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}): Promise<FlowAccountCompanyInfoSuccess | FlowAccountProviderFailure> {
  const result = await requestFlowAccountJson({
    url: `${flowAccountBaseUrl(input.environment)}/company/info`,
    init: {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    },
    timeoutMs: input.timeoutMs,
    maxRetries: input.maxRetries,
    retryDelayMs: input.retryDelayMs,
    requestKind: "company_info",
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    provider_status: result.status,
    company_id: readCompanyId(result.body),
    support_code: readSupportCode(result.body),
  };
}

async function requestFlowAccountJson(input: {
  url: string;
  init: RequestInit;
  requestKind: "token" | "company_info";
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}): Promise<FlowAccountRequestResult> {
  const maxRetries = Math.max(0, input.maxRetries ?? DEFAULT_MAX_RETRIES);
  const retryDelayMs = Math.max(0, input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  let latestFailure: FlowAccountProviderFailure | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const result = await fetchFlowAccountOnce(input);
    if (result.ok) {
      return result;
    }

    latestFailure = result;
    if (!result.retryable || attempt >= maxRetries) {
      return result;
    }

    if (retryDelayMs > 0) {
      await delay(retryDelayMs);
    }
  }

  return (
    latestFailure ?? {
      ok: false,
      provider_status: null,
      provider_error: "network_error",
      retryable: true,
      safe_error_message: flowAccountNetworkFailureMessage(input.requestKind),
    }
  );
}

async function fetchFlowAccountOnce(input: {
  url: string;
  init: RequestInit;
  requestKind: "token" | "company_info";
  timeoutMs?: number;
}): Promise<FlowAccountRequestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, input.timeoutMs ?? FLOWACCOUNT_DEFAULT_TIMEOUT_MS),
  );

  try {
    const response = await fetch(input.url, {
      ...input.init,
      signal: controller.signal,
    });
    const responseText = await response.text();
    const parsed = parseProviderJson(responseText);
    if (!parsed) {
      return {
        ok: false,
        provider_status: response.status,
        provider_error: "unreadable_response",
        retryable: shouldRetryHttpStatus(response.status),
        safe_error_message:
          "FlowAccount returned an unreadable JSON response.",
      };
    }

    const providerError = readProviderError(parsed);
    if (!response.ok || providerError) {
      const nonRetryable = isNonRetryableFailure(response.status, providerError);
      return {
        ok: false,
        provider_status: response.status,
        provider_error: providerError,
        retryable:
          !nonRetryable &&
          (shouldRetryHttpStatus(response.status) ||
            response.status === 0),
        safe_error_message: flowAccountProviderFailureMessage({
          requestKind: input.requestKind,
          status: response.status,
          providerError,
        }),
      };
    }

    return {
      ok: true,
      status: response.status,
      body: parsed,
    };
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      provider_status: null,
      provider_error: timedOut ? "timeout" : "network_error",
      retryable: true,
      safe_error_message: timedOut
        ? "FlowAccount request timed out."
        : flowAccountNetworkFailureMessage(input.requestKind),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseProviderJson(value: string): Record<string, unknown> | null {
  if (!value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readProviderError(body: Record<string, unknown>) {
  const error =
    typeof body.error === "string"
      ? body.error
      : readNestedString(body, ["data", "error"]);
  return error ? sanitizeProviderCode(error) : null;
}

function readCompanyId(body: Record<string, unknown>) {
  return (
    readNestedString(body, ["companyId"]) ??
    readNestedString(body, ["company_id"]) ??
    readNestedString(body, ["data", "companyId"]) ??
    readNestedString(body, ["data", "company_id"])
  );
}

function readSupportCode(body: Record<string, unknown>) {
  return (
    readNestedString(body, ["supportCode"]) ??
    readNestedString(body, ["support_code"]) ??
    readNestedString(body, ["data", "supportCode"]) ??
    readNestedString(body, ["data", "support_code"])
  );
}

function readNestedString(
  body: Record<string, unknown>,
  path: string[],
): string | null {
  let current: unknown = body;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === "string" && current.trim()
    ? current.trim()
    : null;
}

function shouldRetryHttpStatus(status: number) {
  return status === 429 || status >= 500;
}

function isNonRetryableFailure(
  status: number,
  providerError: string | null,
) {
  return (
    status === 401 ||
    status === 403 ||
    providerError === "invalid_client" ||
    providerError === "invalid_scope"
  );
}

function flowAccountProviderFailureMessage(input: {
  requestKind: "token" | "company_info";
  status: number;
  providerError: string | null;
}) {
  if (input.requestKind === "token") {
    if (input.providerError === "invalid_client") {
      return "FlowAccount rejected the sandbox client credentials.";
    }
    if (input.providerError === "invalid_scope") {
      return "FlowAccount rejected the requested sandbox API scope.";
    }
    if (input.providerError) {
      return `FlowAccount token request failed: ${input.providerError}.`;
    }
    return `FlowAccount token request failed with status ${input.status}.`;
  }

  if (input.providerError) {
    return `FlowAccount company info request failed: ${input.providerError}.`;
  }
  return `FlowAccount company info request failed with status ${input.status}.`;
}

function flowAccountNetworkFailureMessage(
  requestKind: "token" | "company_info",
) {
  return requestKind === "token"
    ? "FlowAccount token request failed due to network or provider error."
    : "FlowAccount company info request failed due to network or provider error.";
}

function sanitizeProviderCode(value: string) {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 80) || "provider_error";
}

function flowAccountBaseUrl(environment: FlowAccountEnvironment) {
  if (environment !== "sandbox") {
    throw new Error("Only FlowAccount sandbox environment is supported.");
  }
  return FLOWACCOUNT_SANDBOX_BASE_URL;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
