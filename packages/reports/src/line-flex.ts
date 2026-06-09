import type { LineFlexMessage } from "@ai-bcc/shared";

export type ExecutiveDigestSeverity = "ready" | "notice" | "critical";

export type ExecutiveDigestStatus = {
  text: string;
  severity: ExecutiveDigestSeverity;
};

export type ExecutiveDigestMetric = {
  label: string;
  value: string;
};

export type ExecutiveDigestVariant = "classic" | "executive_report_v2";

export type ExecutiveDigestNoteTone = "neutral" | "info" | "warning";

export type ExecutiveDigestPrimaryAmount =
  | string
  | {
      value: string;
      unit?: string | null;
      compact?: boolean | null;
      color?: string | null;
    };

type BuildExecutiveDigestFlexMessageInput = {
  title: string;
  subtitle: string;
  altText: string;
  generatedAt: string;
  status: ExecutiveDigestStatus;
  primaryAmount: ExecutiveDigestPrimaryAmount;
  primaryAmountColor?: string;
  metrics: ExecutiveDigestMetric[];
  insight: string;
  variant?: ExecutiveDigestVariant;
  kicker?: string | null;
  topLine?: { label: string; value: string } | null;
  note?: string | null;
  noteTone?: ExecutiveDigestNoteTone;
  dashboardUrl?: string | null;
  actionLabel?: string | null;
};

export function buildExecutiveDigestFlexMessage(
  input: BuildExecutiveDigestFlexMessageInput,
): LineFlexMessage {
  const footerContents = isValidLineUri(input.dashboardUrl)
    ? [
        {
          type: "button",
          style: "primary",
          color: "#2563EB",
          height: "sm",
          action: {
            type: "uri",
            label: input.actionLabel ?? "เปิดรายละเอียด",
            uri: input.dashboardUrl,
          },
        },
      ]
    : [];

  const contents =
    input.variant === "executive_report_v2"
      ? buildExecutiveReportV2Bubble(input, footerContents)
      : buildClassicBubble(input, footerContents);

  return {
    type: "flex",
    altText: truncateLineText(input.altText, 300),
    contents,
  };
}

export function truncateLineText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function isValidLineUri(value: string | null | undefined): value is string {
  if (!value || value.length > 1000) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function buildClassicBubble(
  input: BuildExecutiveDigestFlexMessageInput,
  footerContents: Record<string, unknown>[],
) {
  const primaryAmount = normalizePrimaryAmount(
    input.primaryAmount,
    input.primaryAmountColor,
  );
  const contents: Record<string, unknown> = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      backgroundColor: "#F8FAFC",
      contents: [
        {
          type: "text",
          text: input.title,
          weight: "bold",
          size: "lg",
          color: "#111827",
          wrap: true,
        },
        {
          type: "text",
          text: input.subtitle,
          size: "sm",
          color: "#6B7280",
          margin: "sm",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      spacing: "sm",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: input.status.text,
              size: "xs",
              weight: "bold",
              color: getStatusColor(input.status.severity),
              flex: 1,
            },
            {
              type: "text",
              text: `อัปเดต ${input.generatedAt}`,
              size: "xs",
              color: "#6B7280",
              align: "end",
              flex: 2,
            },
          ],
        },
        {
          type: "text",
          text: formatPrimaryAmountText(primaryAmount),
          weight: "bold",
          size: "xxl",
          color: primaryAmount.color,
          wrap: true,
        },
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: input.metrics.slice(0, 3).map((metric) =>
            buildFlexMetricRow(metric.label, truncateLineText(metric.value, 42)),
          ),
        },
        { type: "separator", margin: "md" },
        buildFlexInfoBlock("วันนี้ควรรู้อะไร", truncateLineText(input.insight, 84)),
        ...(input.topLine
          ? [
              buildFlexInfoBlock(
                input.topLine.label,
                truncateLineText(input.topLine.value, 72),
              ),
            ]
          : []),
        ...(input.note
          ? [
              {
                type: "text",
                text: truncateLineText(input.note, 96),
                size: "xs",
                color: "#92400E",
                wrap: true,
                margin: "md",
              },
            ]
          : []),
      ],
    },
  };

  if (footerContents.length) {
    contents.footer = {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      contents: footerContents,
    };
  }

  return contents;
}

function buildExecutiveReportV2Bubble(
  input: BuildExecutiveDigestFlexMessageInput,
  footerContents: Record<string, unknown>[],
) {
  const primaryAmount = normalizePrimaryAmount(
    input.primaryAmount,
    input.primaryAmountColor,
  );
  const contents: Record<string, unknown> = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      backgroundColor: "#F8FAFC",
      contents: [
        ...(input.kicker
          ? [
              {
                type: "text",
                text: truncateLineText(input.kicker, 40),
                weight: "bold",
                size: "xs",
                color: "#2563EB",
                maxLines: 1,
              },
            ]
          : []),
        {
          type: "text",
          text: input.title,
          weight: "bold",
          size: "lg",
          color: "#111827",
          wrap: true,
          maxLines: 2,
          margin: input.kicker ? "xs" : "none",
        },
        {
          type: "text",
          text: input.subtitle,
          size: "sm",
          color: "#6B7280",
          margin: "sm",
          wrap: true,
          maxLines: 2,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      spacing: "sm",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: input.status.text,
              size: "xs",
              weight: "bold",
              color: getStatusColor(input.status.severity),
              flex: 1,
              maxLines: 1,
            },
            {
              type: "text",
              text: `อัปเดต ${input.generatedAt}`,
              size: "xs",
              color: "#6B7280",
              align: "end",
              flex: 2,
              maxLines: 1,
            },
          ],
        },
        buildPrimaryAmountBaseline(primaryAmount),
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: input.metrics.slice(0, 3).map((metric) =>
            buildFlexMetricRow(metric.label, truncateLineText(metric.value, 42)),
          ),
        },
        { type: "separator", margin: "md" },
        buildFlexInfoBlock("สิ่งที่ควรดู", truncateLineText(input.insight, 84)),
        ...(input.topLine
          ? [
              buildFlexInfoBlock(
                input.topLine.label,
                truncateLineText(input.topLine.value, 72),
              ),
            ]
          : []),
        ...(input.note
          ? [
              buildFlexNoteBlock(
                truncateLineText(input.note, 96),
                input.noteTone ?? "neutral",
              ),
            ]
          : []),
      ],
    },
  };

  if (footerContents.length) {
    contents.footer = {
      type: "box",
      layout: "vertical",
      paddingAll: "16px",
      contents: footerContents,
    };
  }

  return contents;
}

function normalizePrimaryAmount(
  value: ExecutiveDigestPrimaryAmount,
  fallbackColor: string | undefined,
) {
  if (typeof value === "string") {
    return {
      value,
      unit: null,
      compact: false,
      color: fallbackColor ?? "#111827",
    };
  }

  return {
    value: value.value,
    unit: value.unit ?? null,
    compact: Boolean(value.compact),
    color: value.color ?? fallbackColor ?? "#111827",
  };
}

function formatPrimaryAmountText(input: ReturnType<typeof normalizePrimaryAmount>) {
  return input.unit ? `${input.value} ${input.unit}` : input.value;
}

function buildPrimaryAmountBaseline(
  input: ReturnType<typeof normalizePrimaryAmount>,
) {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      {
        type: "text",
        text: input.value,
        weight: "bold",
        size: input.compact ? "xl" : "xxl",
        color: input.color,
        flex: 0,
        wrap: true,
        maxLines: 2,
      },
      ...(input.unit
        ? [
            {
              type: "text",
              text: input.unit,
              weight: "bold",
              size: input.compact ? "md" : "xl",
              color: input.color,
              flex: 1,
              wrap: true,
              maxLines: 2,
            },
          ]
        : []),
    ],
  };
}

function buildFlexNoteBlock(value: string, tone: ExecutiveDigestNoteTone) {
  const palette = getNoteTonePalette(tone);
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: palette.backgroundColor,
    cornerRadius: "6px",
    paddingAll: "8px",
    margin: "md",
    contents: [
      {
        type: "text",
        text: value,
        size: "xs",
        color: palette.color,
        wrap: true,
        maxLines: 3,
      },
    ],
  };
}

function getNoteTonePalette(tone: ExecutiveDigestNoteTone) {
  if (tone === "warning") {
    return { backgroundColor: "#FFF7ED", color: "#9A3412" };
  }
  if (tone === "info") {
    return { backgroundColor: "#EFF6FF", color: "#1D4ED8" };
  }
  return { backgroundColor: "#F8FAFC", color: "#475569" };
}

function getStatusColor(severity: ExecutiveDigestSeverity) {
  if (severity === "critical") {
    return "#B42318";
  }
  if (severity === "notice") {
    return "#B45309";
  }
  return "#047857";
}

function buildFlexMetricRow(label: string, value: string) {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      {
        type: "text",
        text: label,
        size: "sm",
        color: "#6B7280",
        flex: 2,
        wrap: true,
        maxLines: 2,
      },
      {
        type: "text",
        text: value,
        size: "sm",
        color: "#111827",
        align: "end",
        weight: "bold",
        flex: 2,
        wrap: true,
        maxLines: 2,
      },
    ],
  };
}

function buildFlexInfoBlock(label: string, value: string) {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    contents: [
      {
        type: "text",
        text: label,
        size: "xs",
        color: "#6B7280",
        weight: "bold",
        maxLines: 1,
      },
      {
        type: "text",
        text: value,
        size: "sm",
        color: "#111827",
        wrap: true,
        maxLines: 3,
      },
    ],
  };
}
