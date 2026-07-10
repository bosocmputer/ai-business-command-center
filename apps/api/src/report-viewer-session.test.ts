import { describe, expect, it } from "vitest";
import {
  createReportViewerSessionCookie,
  verifyReportViewerSessionCookie,
} from "./report-viewer-session.js";

const secret = "0123456789abcdef0123456789abcdef";

describe("report viewer browser session cookie", () => {
  it("round-trips a signed opaque session id", () => {
    const cookie = createReportViewerSessionCookie({
      secret,
      sessionId: "session-a",
    });

    expect(cookie).not.toContain(secret);
    expect(
      verifyReportViewerSessionCookie({ secret, cookieValue: cookie }),
    ).toEqual({ ok: true, sessionId: "session-a" });
  });

  it("rejects missing, malformed, and tampered cookies", () => {
    expect(
      verifyReportViewerSessionCookie({ secret, cookieValue: undefined }),
    ).toEqual({ ok: false, reason: "missing" });
    expect(
      verifyReportViewerSessionCookie({ secret, cookieValue: "not-signed" }),
    ).toEqual({ ok: false, reason: "malformed" });

    const cookie = createReportViewerSessionCookie({
      secret,
      sessionId: "session-a",
    });
    expect(
      verifyReportViewerSessionCookie({
        secret,
        cookieValue: `${cookie.slice(0, -2)}xx`,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });
});
