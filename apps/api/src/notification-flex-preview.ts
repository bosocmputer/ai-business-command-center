import {
  type LineFlexMessage,
  reportKeyValues,
  type ReportLinePreview,
} from "@ai-bcc/shared";

type LineTextMessage = {
  type: "text";
  text: string;
};
type DigestLineMessage = LineTextMessage | LineFlexMessage;

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

  const flexPreviews = previews.filter((preview) => preview.flex_message);
  const flexMessage = buildFlexMessageForPreviews(flexPreviews);
  const allPreviewsHaveFlex = flexPreviews.length === previews.length;
  const lineMessages = allPreviewsHaveFlex
    ? undefined
    : buildDigestLineMessages(previews);

  return {
    ...primaryPreview,
    line_message_type: flexMessage ? "flex" : "text",
    title: previews.length > 1 ? "AI Business SML Digest" : primaryPreview.title,
    text: previews.map((preview) => preview.text).join("\n\n---\n\n"),
    lines: previews.flatMap((preview, index) =>
      index === 0 ? preview.lines : ["", "---", "", ...preview.lines],
    ),
    flex_message: flexMessage,
    line_messages: lineMessages,
    warnings: previews.flatMap((preview) => preview.warnings),
  } as unknown as ReportLinePreview;
}

function buildFlexMessageForPreviews(previews: ReportLinePreview[]) {
  const primaryPreview = previews[0];
  if (!primaryPreview) {
    return undefined;
  }

  const flexBubbles = previews
    .map((preview) => preview.flex_message?.contents)
    .filter((contents): contents is Record<string, unknown> => Boolean(contents));
  const flexMessage =
    flexBubbles.length === previews.length && flexBubbles.length > 1
      ? {
          type: "flex" as const,
          altText: isExecutiveFullReportDigest(previews)
            ? `AI Business: รายงานผู้บริหารครบ ${reportKeyValues.length} ใบ`
            : "AI Business: สรุปรายงานจาก SML",
          contents: {
            type: "carousel",
            contents: flexBubbles,
          },
        }
      : flexBubbles.length === previews.length
        ? primaryPreview.flex_message
        : undefined;

  return flexMessage;
}

function buildDigestLineMessages(previews: ReportLinePreview[]) {
  const messages: DigestLineMessage[] = [];
  let textGroup: ReportLinePreview[] = [];
  let flexGroup: ReportLinePreview[] = [];

  const flushTextGroup = () => {
    if (!textGroup.length) {
      return;
    }
    messages.push({
      type: "text",
      text: textGroup.map((preview) => preview.text).join("\n\n---\n\n"),
    });
    textGroup = [];
  };
  const flushFlexGroup = () => {
    if (!flexGroup.length) {
      return;
    }
    const flexMessage = buildFlexMessageForPreviews(flexGroup);
    if (flexMessage) {
      messages.push(flexMessage);
    }
    flexGroup = [];
  };

  for (const preview of previews) {
    if (preview.flex_message) {
      flushTextGroup();
      flexGroup.push(preview);
      continue;
    }
    flushFlexGroup();
    textGroup.push(preview);
  }

  flushTextGroup();
  flushFlexGroup();

  return messages.length > 1 ? messages.slice(0, 5) : undefined;
}

function isExecutiveFullReportDigest(previews: ReportLinePreview[]) {
  return (
    previews.length === reportKeyValues.length &&
    reportKeyValues.every((reportKey, index) => previews[index]?.report_key === reportKey)
  );
}
