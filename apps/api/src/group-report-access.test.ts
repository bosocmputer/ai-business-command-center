import { describe, expect, it } from "vitest";
import type { ReportLinePreview } from "@ai-bcc/shared";
import {
  buildGroupReportChatUri,
  createGroupReportLaunchCode,
  decorateGroupReportPreview,
  parseGroupReportCommand,
  parseGroupReportCommandDetails,
  redactGroupReportCommand,
} from "./group-report-access.js";

describe("group report access", () => {
  it("creates opaque fixed-length codes and parses only the exact command", () => {
    const code = createGroupReportLaunchCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(parseGroupReportCommand(`ขอลิงก์รายงาน ${code}`)).toBe(code);
    expect(parseGroupReportCommand(`เปิดรายงาน ${code}`)).toBeNull();
    expect(redactGroupReportCommand(`ขอลิงก์รายงาน ${code}`)).toBe(
      "[group_report_access_request]",
    );
  });

  it("parses a desktop pairing command without changing the mobile command", () => {
    const launchCode = "abcdefghijklmnopqrstuv";
    const pairingCode = "zyxwvutsrqponmlkjihgfe";

    expect(
      parseGroupReportCommandDetails(
        `ขอลิงก์รายงาน ${launchCode} ${pairingCode}`,
      ),
    ).toEqual({ launchCode, pairingCode });
    expect(parseGroupReportCommand(`ขอลิงก์รายงาน ${launchCode}`)).toBe(
      launchCode,
    );
    expect(
      parseGroupReportCommand(`ขอลิงก์รายงาน ${launchCode} ${pairingCode}`),
    ).toBe(launchCode);
    expect(
      redactGroupReportCommand(
        `ขอลิงก์รายงาน ${launchCode} ${pairingCode}`,
      ),
    ).toBe("[group_report_access_request]");
  });

  it("builds a bounded OA chat URI and decorates the Flex action for mobile", () => {
    const code = "abcdefghijklmnopqrstuv";
    const uri = buildGroupReportChatUri({ oaId: "@365sxedv", code });
    expect(uri).toContain("/oaMessage/%40365sxedv/");
    expect(uri).toContain(encodeURIComponent(`ขอลิงก์รายงาน ${code}`));
    expect(uri?.length).toBeLessThanOrEqual(1000);

    const pairingUri = buildGroupReportChatUri({
      oaId: "@365sxedv",
      code,
      pairingCode: "zyxwvutsrqponmlkjihgfe",
    });
    expect(pairingUri).toContain(
      encodeURIComponent(
        `ขอลิงก์รายงาน ${code} zyxwvutsrqponmlkjihgfe`,
      ),
    );

    const preview = {
      tenant_id: "tenant_demo_remote",
      report_key: "sales_goods_services",
      run_id: "run_1",
      generated_at: new Date().toISOString(),
      source: "sml_postgres",
      line_message_type: "flex",
      title: "report",
      text: "report",
      lines: ["report"],
      warnings: [],
      dashboard_url: uri,
      flex_message: {
        type: "flex",
        altText: "report",
        contents: {
          type: "bubble",
          footer: {
            type: "box",
            layout: "vertical",
            contents: [{
              type: "button",
              action: { type: "uri", label: "เปิดรายละเอียด", uri },
            }],
          },
        },
      },
    } satisfies ReportLinePreview;
    const decorated = decorateGroupReportPreview({
      preview,
      desktopFallbackUrl: "https://example.test/group-mobile-required",
    });
    expect(JSON.stringify(decorated.flex_message)).toContain("รับลิงก์ส่วนตัว");
    expect(JSON.stringify(decorated.flex_message)).toContain(
      "group-mobile-required",
    );
  });

  it("maps each carousel action to its own desktop pairing URL", () => {
    const preview = {
      tenant_id: "tenant_demo_remote",
      report_key: "sales_goods_services",
      run_id: "run_1",
      generated_at: new Date().toISOString(),
      source: "sml_postgres",
      line_message_type: "flex",
      title: "reports",
      text: "reports",
      lines: ["reports"],
      warnings: [],
      dashboard_url: "https://line.example/mobile-a",
      flex_message: {
        type: "flex",
        altText: "reports",
        contents: {
          type: "carousel",
          contents: [
            { action: { type: "uri", label: "open", uri: "mobile-a" } },
            { action: { type: "uri", label: "open", uri: "mobile-b" } },
            { action: { type: "uri", label: "keep", uri: "unmapped" } },
          ],
        },
      },
    } satisfies ReportLinePreview;
    const decorated = decorateGroupReportPreview({
      preview,
      desktopFallbackUrlsByUri: {
        "mobile-a": "desktop-a#launch=a",
        "mobile-b": "desktop-b#launch=b",
      },
    });
    const serialized = JSON.stringify(decorated.flex_message);
    expect(serialized).toContain("desktop-a#launch=a");
    expect(serialized).toContain("desktop-b#launch=b");
    expect(serialized).toContain('"label":"keep","uri":"unmapped"');
  });
});
