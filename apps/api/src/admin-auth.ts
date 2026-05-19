export type AdminAuthResult =
  | { ok: true }
  | { ok: false; statusCode: 401 | 403 | 503; error: string };

export function verifyAdminToken(input: {
  expectedToken: string | undefined;
  headerValue: string | string[] | undefined;
}): AdminAuthResult {
  const expectedToken = input.expectedToken?.trim();
  if (!expectedToken) {
    return {
      ok: false,
      statusCode: 503,
      error: "Admin API token is not configured.",
    };
  }

  const actualToken = Array.isArray(input.headerValue)
    ? input.headerValue[0]
    : input.headerValue;
  if (!actualToken?.trim()) {
    return {
      ok: false,
      statusCode: 401,
      error: "Admin token is required.",
    };
  }

  if (actualToken !== expectedToken) {
    return {
      ok: false,
      statusCode: 403,
      error: "Admin token is invalid.",
    };
  }

  return { ok: true };
}
