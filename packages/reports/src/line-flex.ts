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

export function buildExecutiveDigestFlexMessage(input: {
  title: string;
  subtitle: string;
  altText: string;
  generatedAt: string;
  status: ExecutiveDigestStatus;
  primaryAmount: string;
  primaryAmountColor?: string;
  metrics: ExecutiveDigestMetric[];
  insight: string;
  topLine?: { label: string; value: string } | null;
  note?: string | null;
  dashboardUrl?: string | null;
}): LineFlexMessage {
  const footerContents = isValidLineUri(input.dashboardUrl)
    ? [
        {
          type: "button",
          style: "primary",
          color: "#2563EB",
          height: "sm",
          action: {
            type: "uri",
            label: "เปิดรายละเอียด",
            uri: input.dashboardUrl,
          },
        },
      ]
    : [];

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
          text: input.primaryAmount,
          weight: "bold",
          size: "xxl",
          color: input.primaryAmountColor ?? "#111827",
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
      },
      {
        type: "text",
        text: value,
        size: "sm",
        color: "#111827",
        wrap: true,
      },
    ],
  };
}
