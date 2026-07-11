import { describe, expect, it } from "vitest";
import type { ReportLinePreview } from "@ai-bcc/shared";
import {
  buildGroupReportChatUri,
  createGroupReportLaunchCode,
  decorateGroupReportPreview,
  parseGroupReportCommand,
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

  it("builds a bounded OA chat URI and decorates the Flex action for mobile", () => {
    const code = "abcdefghijklmnopqrstuv";
    const uri = buildGroupReportChatUri({ oaId: "@365sxedv", code });
    expect(uri).toContain("/oaMessage/%40365sxedv/");
    expect(uri).toContain(encodeURIComponent(`ขอลิงก์รายงาน ${code}`));
    expect(uri?.length).toBeLessThanOrEqual(1000);

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
});
