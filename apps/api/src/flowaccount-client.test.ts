import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchFlowAccountCompanyInfo,
  requestFlowAccountClientCredentialsToken,
} from "./flowaccount-client.js";

describe("FlowAccount client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests a sandbox client-credentials token with the documented form body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      response(200, {
        access_token: "flow-token",
        expires_in: 86400,
        token_type: "Bearer",
        scope: "flowaccount-api",
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await requestFlowAccountClientCredentialsToken({
      environment: "sandbox",
      clientId: "client-id",
      clientSecret: "client-secret",
      retryDelayMs: 0,
    });

    expect(result).toMatchObject({
      ok: true,
      access_token: "flow-token",
      expires_in: 86400,
      token_type: "Bearer",
      scope: "flowaccount-api",
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openapi.flowaccount.com/test/token");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("grant_type=client_credentials");
    expect(String(init.body)).toContain("scope=flowaccount-api");
    expect(String(init.body)).toContain("client_id=client-id");
    expect(String(init.body)).toContain("client_secret=client-secret");
  });

  it("treats HTTP 200 with provider error as a failed token response", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(response(200, { error: "invalid_client" }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await requestFlowAccountClientCredentialsToken({
      environment: "sandbox",
      clientId: "bad-client",
      clientSecret: "bad-secret",
      maxRetries: 2,
      retryDelayMs: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      provider_status: 200,
      provider_error: "invalid_client",
      retryable: false,
      safe_error_message:
        "FlowAccount rejected the sandbox client credentials.",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry 401 or 403 credential failures", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(response(401, { error: "invalid_client" }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await requestFlowAccountClientCredentialsToken({
      environment: "sandbox",
      clientId: "bad-client",
      clientSecret: "bad-secret",
      maxRetries: 2,
      retryDelayMs: 0,
    });

    expect(result).toMatchObject({
      ok: false,
      provider_status: 401,
      retryable: false,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries 429 and 5xx responses before returning a token", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(response(429, { error: "rate_limited" }))
      .mockResolvedValueOnce(response(500, { error: "server_error" }))
      .mockResolvedValueOnce(
        response(200, {
          access_token: "flow-token",
          expires_in: 86400,
          token_type: "Bearer",
          scope: "flowaccount-api",
        }),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await requestFlowAccountClientCredentialsToken({
      environment: "sandbox",
      clientId: "client-id",
      clientSecret: "client-secret",
      maxRetries: 2,
      retryDelayMs: 0,
    });

    expect(result).toMatchObject({ ok: true, access_token: "flow-token" });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("returns safe failures for network errors and malformed JSON", async () => {
    const networkFetch = vi.fn().mockRejectedValue(new Error("socket secret"));
    vi.stubGlobal("fetch", networkFetch);
    await expect(
      requestFlowAccountClientCredentialsToken({
        environment: "sandbox",
        clientId: "client-id",
        clientSecret: "client-secret",
        maxRetries: 0,
      }),
    ).resolves.toMatchObject({
      ok: false,
      provider_status: null,
      provider_error: "network_error",
      safe_error_message:
        "FlowAccount token request failed due to network or provider error.",
    });

    const malformedFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html>not json</html>",
    });
    vi.stubGlobal("fetch", malformedFetch);
    await expect(
      requestFlowAccountClientCredentialsToken({
        environment: "sandbox",
        clientId: "client-id",
        clientSecret: "client-secret",
        maxRetries: 0,
      }),
    ).resolves.toMatchObject({
      ok: false,
      provider_status: 200,
      provider_error: "unreadable_response",
      safe_error_message:
        "FlowAccount returned an unreadable JSON response.",
    });
  });

  it("sanitizes company info to company id and support code only", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      response(200, {
        data: {
          companyId: "company-123",
          supportCode: "SUP-001",
          taxId: "0105559999999",
          address: "secret address",
          phone: "02-000-0000",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchFlowAccountCompanyInfo({
      environment: "sandbox",
      accessToken: "flow-token",
      retryDelayMs: 0,
    });

    expect(result).toEqual({
      ok: true,
      provider_status: 200,
      company_id: "company-123",
      support_code: "SUP-001",
    });
    expect(JSON.stringify(result)).not.toContain("0105559999999");
    expect(JSON.stringify(result)).not.toContain("secret address");
    expect(JSON.stringify(result)).not.toContain("02-000-0000");
  });
});

function response(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}
