import { describe, expect, it } from "vitest";
import {
  createReportViewerToken,
  maskReportViewerToken,
  verifyReportViewerToken,
} from "./report-viewer-token.js";

const secret = "0123456789abcdef0123456789abcdef";
const expiresAt = new Date("2026-05-20T01:00:00.000Z");
const now = new Date("2026-05-19T01:00:00.000Z");

describe("report viewer signed tokens", () => {
  it("validates a token bound to tenant, report, run, and expiry", () => {
    const token = createReportViewerToken({
      secret,
      tenantId: "tenant_demo_remote",
      reportKey: "sales_goods_services",
      runId: "run_tenant_demo_remote_1",
      expiresAt,
    });

    expect(
      verifyReportViewerToken({
        token,
        secret,
        tenantId: "tenant_demo_remote",
        reportKey: "sales_goods_services",
        runId: "run_tenant_demo_remote_1",
        now,
      }),
    ).toMatchObject({
      ok: true,
      payload: {
        tenant_id: "tenant_demo_remote",
        report_key: "sales_goods_services",
        run_id: "run_tenant_demo_remote_1",
      },
    });
  });

  it("rejects a token used against a different tenant or run", () => {
    const token = createReportViewerToken({
      secret,
      tenantId: "tenant_demo_remote",
      reportKey: "sales_goods_services",
      runId: "run_tenant_demo_remote_1",
      expiresAt,
    });

    expect(
      verifyReportViewerToken({
        token,
        secret,
        tenantId: "tenant_office_sml1_2026",
        reportKey: "sales_goods_services",
        runId: "run_tenant_demo_remote_1",
        now,
      }),
    ).toEqual({ ok: false, reason: "forbidden" });

    expect(
      verifyReportViewerToken({
        token,
        secret,
        tenantId: "tenant_demo_remote",
        reportKey: "sales_goods_services",
        runId: "run_other",
        now,
      }),
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("rejects expired tokens", () => {
    const token = createReportViewerToken({
      secret,
      tenantId: "tenant_demo_remote",
      reportKey: "sales_goods_services",
      runId: "run_tenant_demo_remote_1",
      expiresAt: new Date("2026-05-18T01:00:00.000Z"),
    });

    expect(
      verifyReportViewerToken({
        token,
        secret,
        tenantId: "tenant_demo_remote",
        reportKey: "sales_goods_services",
        runId: "run_tenant_demo_remote_1",
        now,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed or tampered tokens safely", () => {
    expect(
      verifyReportViewerToken({
        token: "not-a-real-token",
        secret,
        tenantId: "tenant_demo_remote",
        reportKey: "sales_goods_services",
        runId: "run_tenant_demo_remote_1",
        now,
      }),
    ).toEqual({ ok: false, reason: "malformed" });

    const token = createReportViewerToken({
      secret,
      tenantId: "tenant_demo_remote",
      reportKey: "sales_goods_services",
      runId: "run_tenant_demo_remote_1",
      expiresAt,
    });

    expect(
      verifyReportViewerToken({
        token: `${token.slice(0, -3)}abc`,
        secret,
        tenantId: "tenant_demo_remote",
        reportKey: "sales_goods_services",
        runId: "run_tenant_demo_remote_1",
        now,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("masks tokens before any debug display", () => {
    const token = createReportViewerToken({
      secret,
      tenantId: "tenant_demo_remote",
      reportKey: "sales_goods_services",
      runId: "run_tenant_demo_remote_1",
      expiresAt,
    });

    expect(maskReportViewerToken(token)).not.toContain(secret);
    expect(maskReportViewerToken(token)).toContain("...");
    expect(maskReportViewerToken("short")).toBe("********");
  });
});
