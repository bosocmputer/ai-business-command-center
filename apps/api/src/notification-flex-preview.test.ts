import { describe, expect, it } from "vitest";
import {
  reportKeyValues,
  type ReportKey,
  type ReportLinePreview,
} from "@ai-bcc/shared";
import { buildNotificationDigestPreview } from "./notification-flex-preview.js";

describe("buildNotificationDigestPreview", () => {
  it("labels the full executive report carousel with 8 bubbles", () => {
    const preview = buildNotificationDigestPreview(
      reportKeyValues.map((reportKey) => mockPreview(reportKey)),
    );
    const contents = preview.flex_message?.contents as
      | { type?: string; contents?: unknown[] }
      | undefined;

    expect(preview.line_message_type).toBe("flex");
    expect(preview.flex_message?.altText).toBe(
      "AI Business: รายงานผู้บริหารครบ 8 ใบ",
    );
    expect(contents?.type).toBe("carousel");
    expect(contents?.contents).toHaveLength(8);
    expect(Buffer.byteLength(JSON.stringify(preview.flex_message), "utf8")).toBeLessThan(
      50_000,
    );
  });

  it("keeps the generic digest alt text for custom report selections", () => {
    const preview = buildNotificationDigestPreview([
      mockPreview("sales_goods_services"),
      mockPreview("purchase_goods_payables"),
    ]);

    expect(preview.flex_message?.altText).toBe("AI Business: สรุปรายงานจาก SML");
  });
});

function mockPreview(reportKey: ReportKey): ReportLinePreview {
  return {
    tenant_id: "tenant_demo_remote",
    report_key: reportKey,
    run_id: `run_${reportKey}`,
    generated_at: "2026-06-09T01:00:00.000Z",
    source: "sml_javaws",
    line_message_type: "flex",
    title: reportKey,
    text: `${reportKey} fallback`,
    lines: [`${reportKey} fallback`],
    warnings: [],
    dashboard_url: "https://example.com/command-center/brief?token=signed",
    flex_message: {
      type: "flex",
      altText: reportKey,
      contents: {
        type: "bubble",
        size: "mega",
        body: {
          type: "box",
          layout: "vertical",
          contents: [{ type: "text", text: reportKey }],
        },
      },
    },
  } as ReportLinePreview;
}
