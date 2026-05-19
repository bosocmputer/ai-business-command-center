import { describe, expect, it } from "vitest";
import { verifyAdminToken } from "./admin-auth.js";

describe("admin mutation auth", () => {
  it("requires the server admin token to be configured", () => {
    expect(
      verifyAdminToken({
        expectedToken: "",
        headerValue: "admin-token",
      }),
    ).toEqual({
      ok: false,
      statusCode: 503,
      error: "Admin API token is not configured.",
    });
  });

  it("rejects missing and invalid request tokens", () => {
    expect(
      verifyAdminToken({
        expectedToken: "admin-token",
        headerValue: undefined,
      }),
    ).toEqual({
      ok: false,
      statusCode: 401,
      error: "Admin token is required.",
    });

    expect(
      verifyAdminToken({
        expectedToken: "admin-token",
        headerValue: "wrong-token",
      }),
    ).toEqual({
      ok: false,
      statusCode: 403,
      error: "Admin token is invalid.",
    });
  });

  it("accepts a matching request token", () => {
    expect(
      verifyAdminToken({
        expectedToken: "admin-token",
        headerValue: "admin-token",
      }),
    ).toEqual({ ok: true });
  });
});
