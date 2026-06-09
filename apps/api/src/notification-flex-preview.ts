import {
  reportKeyValues,
  type ReportLinePreview,
} from "@ai-bcc/shared";

export function buildMorningBriefCarouselPreview(input: {
  salesPreview: ReportLinePreview | null;
  purchasePreview: ReportLinePreview | null;
}): ReportLinePreview {
  const previews = [input.salesPreview, input.purchasePreview].filter(
    (preview): preview is ReportLinePreview => Boolean(preview),
  );
  const primaryPreview = previews[0];
  if (!primaryPreview) {
    throw new Error("At least one report preview is required.");
  }
  const flexBubbles = previews
    .map((preview) => preview.flex_message?.contents)
    .filter((contents): contents is Record<string, unknown> => Boolean(contents));
  const allPreviewsHaveFlex = flexBubbles.length === previews.length;
  const flexMessage =
    allPreviewsHaveFlex && flexBubbles.length > 1
      ? {
          type: "flex" as const,
          altText: "AI Business Morning Brief: รายงานขายและรายงานซื้อ",
          contents: {
            type: "carousel",
            contents: flexBubbles,
          },
        }
      : allPreviewsHaveFlex
        ? primaryPreview.flex_message
        : undefined;

  return {
    ...primaryPreview,
    line_message_type: flexMessage ? "flex" : "text",
    title: "AI Business Morning Brief",
    text: previews.map((preview) => preview.text).join("\n\n---\n\n"),
    lines: previews.flatMap((preview, index) =>
      index === 0 ? preview.lines : ["", "---", "", ...preview.lines],
    ),
    flex_message: flexMessage,
    warnings: previews.flatMap((preview) => preview.warnings),
  };
}

export function buildNotificationDigestPreview(
  previews: ReportLinePreview[],
): ReportLinePreview {
  const primaryPreview = previews[0];
  if (!primaryPreview) {
    throw new Error("At least one report preview is required.");
  }

  const flexBubbles = previews
    .map((preview) => preview.flex_message?.contents)
    .filter((contents): contents is Record<string, unknown> => Boolean(contents));
  const allPreviewsHaveFlex = flexBubbles.length === previews.length;
  const flexMessage =
    allPreviewsHaveFlex && flexBubbles.length > 1
      ? {
          type: "flex" as const,
          altText: isExecutiveFullReportDigest(previews)
            ? "AI Business: รายงานผู้บริหารครบ 8 ใบ"
            : "AI Business: สรุปรายงานจาก SML",
          contents: {
            type: "carousel",
            contents: flexBubbles,
          },
        }
      : allPreviewsHaveFlex
        ? primaryPreview.flex_message
        : undefined;

  return {
    ...primaryPreview,
    line_message_type: flexMessage ? "flex" : "text",
    title: previews.length > 1 ? "AI Business SML Digest" : primaryPreview.title,
    text: previews.map((preview) => preview.text).join("\n\n---\n\n"),
    lines: previews.flatMap((preview, index) =>
      index === 0 ? preview.lines : ["", "---", "", ...preview.lines],
    ),
    flex_message: flexMessage,
    warnings: previews.flatMap((preview) => preview.warnings),
  } as ReportLinePreview;
}

function isExecutiveFullReportDigest(previews: ReportLinePreview[]) {
  return (
    previews.length === reportKeyValues.length &&
    reportKeyValues.every((reportKey, index) => previews[index]?.report_key === reportKey)
  );
}
