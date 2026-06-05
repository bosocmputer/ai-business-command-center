import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyOwnerSessionCookie } from "./owner-session-auth.js";

describe("owner session auth", () => {
  it("accepts a valid owner session cookie", () => {
    const cookieValue = createCookie({
      payload: {
        sub: "superadmin",
        role: "owner_admin",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      secret: "owner-secret",
    });

    expect(
      verifyOwnerSessionCookie({ cookieValue, secret: "owner-secret" }),
    ).toEqual({ ok: true, subject: "superadmin" });
  });

  it("rejects missing, invalid, expired, and non-owner sessions", () => {
    expect(verifyOwnerSessionCookie({ cookieValue: undefined })).toMatchObject({
      ok: false,
      statusCode: 401,
    });
    expect(
      verifyOwnerSessionCookie({
        cookieValue: createCookie({
          payload: {
            sub: "superadmin",
            role: "owner_admin",
            exp: Math.floor(Date.now() / 1000) + 60,
          },
          secret: "owner-secret",
        }),
        secret: "wrong-secret",
      }),
    ).toMatchObject({ ok: false, statusCode: 401 });
    expect(
      verifyOwnerSessionCookie({
        cookieValue: createCookie({
          payload: {
            sub: "superadmin",
            role: "owner_admin",
            exp: Math.floor(Date.now() / 1000) - 1,
          },
          secret: "owner-secret",
        }),
        secret: "owner-secret",
      }),
    ).toMatchObject({ ok: false, statusCode: 401 });
    expect(
      verifyOwnerSessionCookie({
        cookieValue: createCookie({
          payload: {
            sub: "viewer",
            role: "viewer",
            exp: Math.floor(Date.now() / 1000) + 60,
          },
          secret: "owner-secret",
        }),
        secret: "owner-secret",
      }),
    ).toMatchObject({ ok: false, statusCode: 401 });
  });
});

function createCookie({
  payload,
  secret,
}: {
  payload: Record<string, unknown>;
  secret: string;
}) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}
