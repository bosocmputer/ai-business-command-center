import type {
  ArCustomerMovementSnapshot,
  DegradedReportLinePreview,
  ReportRunRecord,
  ReportSnapshot,
  StockBalanceSnapshot,
  TenantId,
} from "@ai-bcc/shared";

export const STOCK_BALANCE_TIMEOUT_REASON = "stock_balance_timeout";
export const AR_CUSTOMER_MOVEMENT_TIMEOUT_REASON =
  "ar_customer_movement_timeout";
export const STOCK_BALANCE_TIMEOUT_COOLDOWN_MS = 10 * 60 * 1000;
export const STOCK_BALANCE_FALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const AR_CUSTOMER_MOVEMENT_TIMEOUT_COOLDOWN_MS = 10 * 60 * 1000;
export const AR_CUSTOMER_MOVEMENT_FALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type StockBalanceFallbackSnapshot = {
  snapshot: StockBalanceSnapshot;
  ageHours: number;
};

export type ArCustomerMovementFallbackSnapshot = {
  snapshot: ArCustomerMovementSnapshot;
  ageHours: number;
};

export function isStockBalanceTimeoutMessage(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) {
    return false;
  }

  return (
    text.includes("รายงานสต็อกคงเหลือใช้เวลานานเกินไป") ||
    (/stock[_ -]?balance/i.test(text) &&
      /timeout|timed out|statement timeout/i.test(text)) ||
    /timeout|timed out|canceling statement/i.test(text)
  );
}

export function isArCustomerMovementTimeoutMessage(
  value: string | null | undefined,
) {
  const text = value?.trim();
  if (!text) {
    return false;
  }

  return (
    text.includes("รายงานเคลื่อนไหวลูกหนี้ใช้เวลานานเกินไป") ||
    (/ar[_ -]?customer[_ -]?movement/i.test(text) &&
      /timeout|timed out|statement timeout/i.test(text)) ||
    /timeout|timed out|canceling statement/i.test(text)
  );
}

export function findRecentStockBalanceTimeoutRun(input: {
  runs: ReportRunRecord[];
  now?: Date;
  cooldownMs?: number;
}) {
  const nowMs = (input.now ?? new Date()).getTime();
  const cooldownMs = input.cooldownMs ?? STOCK_BALANCE_TIMEOUT_COOLDOWN_MS;
  return (
    input.runs.find((run) => {
      if (run.report_key !== "stock_balance" || run.status !== "failed") {
        return false;
      }
      if (!isStockBalanceTimeoutMessage(run.safe_error_message)) {
        return false;
      }
      const endedAt = Date.parse(run.finished_at ?? run.started_at);
      return (
        Number.isFinite(endedAt) &&
        nowMs - endedAt >= 0 &&
        nowMs - endedAt <= cooldownMs
      );
    }) ?? null
  );
}

export function findRecentArCustomerMovementTimeoutRun(input: {
  runs: ReportRunRecord[];
  now?: Date;
  cooldownMs?: number;
}) {
  const nowMs = (input.now ?? new Date()).getTime();
  const cooldownMs =
    input.cooldownMs ?? AR_CUSTOMER_MOVEMENT_TIMEOUT_COOLDOWN_MS;
  return (
    input.runs.find((run) => {
      if (run.report_key !== "ar_customer_movement" || run.status !== "failed") {
        return false;
      }
      if (!isArCustomerMovementTimeoutMessage(run.safe_error_message)) {
        return false;
      }
      const endedAt = Date.parse(run.finished_at ?? run.started_at);
      return (
        Number.isFinite(endedAt) &&
        nowMs - endedAt >= 0 &&
        nowMs - endedAt <= cooldownMs
      );
    }) ?? null
  );
}

export function resolveStockBalanceFallbackSnapshot(input: {
  snapshot: ReportSnapshot | null;
  now?: Date;
  maxAgeMs?: number;
}): StockBalanceFallbackSnapshot | null {
  const snapshot = input.snapshot;
  if (!snapshot || snapshot.report_key !== "stock_balance") {
    return null;
  }
  if (snapshot.source === "sample_snapshot") {
    return null;
  }

  const generatedAtMs = Date.parse(snapshot.generated_at);
  if (!Number.isFinite(generatedAtMs)) {
    return null;
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const ageMs = Math.max(0, nowMs - generatedAtMs);
  if (ageMs > (input.maxAgeMs ?? STOCK_BALANCE_FALLBACK_MAX_AGE_MS)) {
    return null;
  }

  return {
    snapshot,
    ageHours: roundAgeHours(ageMs / (60 * 60 * 1000)),
  };
}

export function resolveArCustomerMovementFallbackSnapshot(input: {
  snapshot: ReportSnapshot | null;
  now?: Date;
  maxAgeMs?: number;
}): ArCustomerMovementFallbackSnapshot | null {
  const snapshot = input.snapshot;
  if (!snapshot || snapshot.report_key !== "ar_customer_movement") {
    return null;
  }
  if (snapshot.source === "sample_snapshot") {
    return null;
  }

  const generatedAtMs = Date.parse(snapshot.generated_at);
  if (!Number.isFinite(generatedAtMs)) {
    return null;
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const ageMs = Math.max(0, nowMs - generatedAtMs);
  if (ageMs > (input.maxAgeMs ?? AR_CUSTOMER_MOVEMENT_FALLBACK_MAX_AGE_MS)) {
    return null;
  }

  return {
    snapshot,
    ageHours: roundAgeHours(ageMs / (60 * 60 * 1000)),
  };
}

export function buildDegradedStockBalancePreview(input: {
  tenantId: TenantId;
  tenantName: string;
  failedRunId: string;
  generatedAt?: string;
  fallback: StockBalanceFallbackSnapshot | null;
  cooldownUsed: boolean;
}): DegradedReportLinePreview {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const fallback = input.fallback;
  const title = "สต็อกคงเหลือ";
  const warning = fallback
    ? `สต็อกคงเหลือใช้ข้อมูลอ้างอิงล่าสุดเมื่อ ${formatThaiDateTime(
        fallback.snapshot.generated_at,
      )}`
    : "สต็อกคงเหลือยังไม่พร้อม ระบบจะลองใหม่ในรอบถัดไป";
  const lines = fallback
    ? [
        "รายงานสต็อกคงเหลือ",
        "",
        `บริษัท: ${input.tenantName}`,
        `สถานะ: ข้อมูลสดไม่พร้อม`,
        `ข้อมูลอ้างอิงล่าสุด: ${formatThaiDateTime(fallback.snapshot.generated_at)}`,
        "",
        `มูลค่าสต็อกคงเหลือ: ${formatMoney(fallback.snapshot.summary.stock_value)} บาท`,
        `จำนวนสินค้า: ${formatInteger(fallback.snapshot.summary.sku_count)} รายการ`,
        `สินค้าคงเหลือติดลบ: ${formatInteger(
          fallback.snapshot.summary.negative_stock_count,
        )} รายการ`,
        "",
        "หมายเหตุ: ข้อมูลนี้เป็นข้อมูลอ้างอิง ไม่ใช่ข้อมูลสดของรอบแจ้งเตือนนี้",
        input.cooldownUsed
          ? "ระบบพักการดึงรายงานสดชั่วคราวเพื่อลดภาระ JavaWS"
          : "รายงานสดใช้เวลานานเกินไป",
      ]
    : [
        "รายงานสต็อกคงเหลือ",
        "",
        `บริษัท: ${input.tenantName}`,
        `สถานะ: ข้อมูลสดไม่พร้อม`,
        "",
        "รายงานสดใช้เวลานานเกินไป และยังไม่มีข้อมูลอ้างอิงล่าสุดที่ใช้ได้",
        "ระบบจะลองใหม่ในรอบถัดไป",
        input.cooldownUsed
          ? "ระบบพักการดึงรายงานสดชั่วคราวเพื่อลดภาระ JavaWS"
          : "รายงานอื่นที่สำเร็จยังถูกส่งตามปกติ",
      ];

  return {
    tenant_id: input.tenantId,
    report_key: "stock_balance",
    run_id: input.failedRunId,
    generated_at: generatedAt,
    source: "degraded_notice",
    line_message_type: "flex",
    title,
    text: lines.join("\n"),
    lines,
    flex_message: buildStockBalanceNoticeFlex({
      tenantName: input.tenantName,
      generatedAt,
      warning,
      fallback,
      cooldownUsed: input.cooldownUsed,
    }),
    warnings: [warning],
    dashboard_url: null,
    degraded: true,
    degraded_reason: STOCK_BALANCE_TIMEOUT_REASON,
  };
}

export function buildDegradedArCustomerMovementPreview(input: {
  tenantId: TenantId;
  tenantName: string;
  failedRunId: string;
  generatedAt?: string;
  fallback: ArCustomerMovementFallbackSnapshot | null;
  cooldownUsed: boolean;
}): DegradedReportLinePreview {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const fallback = input.fallback;
  const title = "เคลื่อนไหวลูกหนี้";
  const warning = fallback
    ? `เคลื่อนไหวลูกหนี้ใช้ข้อมูลอ้างอิงล่าสุดเมื่อ ${formatThaiDateTime(
        fallback.snapshot.generated_at,
      )}`
    : "เคลื่อนไหวลูกหนี้ยังไม่พร้อม ระบบจะลองใหม่ในรอบถัดไป";
  const lines = fallback
    ? [
        "รายงานเคลื่อนไหวลูกหนี้",
        "",
        `บริษัท: ${input.tenantName}`,
        `สถานะ: ข้อมูลสดไม่พร้อม`,
        `ข้อมูลอ้างอิงล่าสุด: ${formatThaiDateTime(fallback.snapshot.generated_at)}`,
        "",
        `ยอดเคลื่อนไหวสุทธิ: ${formatMoney(
          fallback.snapshot.summary.net_movement_amount,
        )} บาท`,
        `ลูกหนี้: ${formatInteger(fallback.snapshot.summary.customer_count)} ราย`,
        `เอกสาร: ${formatInteger(fallback.snapshot.summary.document_count)} ใบ`,
        `รับชำระ/ลดหนี้: ${formatMoney(
          fallback.snapshot.summary.ar_decrease_amount +
            fallback.snapshot.summary.receipt_amount,
        )} บาท`,
        "",
        "หมายเหตุ: ข้อมูลนี้เป็นข้อมูลอ้างอิง ไม่ใช่ข้อมูลสดของรอบแจ้งเตือนนี้",
        input.cooldownUsed
          ? "ระบบพักการดึงรายงานสดชั่วคราวเพื่อลดภาระ JavaWS"
          : "รายงานสดใช้เวลานานเกินไป",
      ]
    : [
        "รายงานเคลื่อนไหวลูกหนี้",
        "",
        `บริษัท: ${input.tenantName}`,
        `สถานะ: ข้อมูลสดไม่พร้อม`,
        "",
        "รายงานสดใช้เวลานานเกินไป และยังไม่มีข้อมูลอ้างอิงล่าสุดที่ใช้ได้",
        "ระบบจะลองใหม่ในรอบถัดไป",
        input.cooldownUsed
          ? "ระบบพักการดึงรายงานสดชั่วคราวเพื่อลดภาระ JavaWS"
          : "รายงานอื่นที่สำเร็จยังถูกส่งตามปกติ",
      ];

  return {
    tenant_id: input.tenantId,
    report_key: "ar_customer_movement",
    run_id: input.failedRunId,
    generated_at: generatedAt,
    source: "degraded_notice",
    line_message_type: "flex",
    title,
    text: lines.join("\n"),
    lines,
    flex_message: buildArCustomerMovementNoticeFlex({
      tenantName: input.tenantName,
      generatedAt,
      warning,
      fallback,
      cooldownUsed: input.cooldownUsed,
    }),
    warnings: [warning],
    dashboard_url: null,
    degraded: true,
    degraded_reason: AR_CUSTOMER_MOVEMENT_TIMEOUT_REASON,
  };
}

export function buildStockBalanceDegradationAuditMetadata(input: {
  fallback: StockBalanceFallbackSnapshot | null;
  cooldownUsed: boolean;
}) {
  return {
    degraded_report_keys: ["stock_balance"],
    degraded_reason: STOCK_BALANCE_TIMEOUT_REASON,
    fallback_source_run_id: input.fallback?.snapshot.run_id ?? null,
    fallback_snapshot_generated_at: input.fallback?.snapshot.generated_at ?? null,
    fallback_snapshot_age_hours: input.fallback?.ageHours ?? null,
    heavy_report_cooldown_used: input.cooldownUsed,
  };
}

function buildStockBalanceNoticeFlex(input: {
  tenantName: string;
  generatedAt: string;
  warning: string;
  fallback: StockBalanceFallbackSnapshot | null;
  cooldownUsed: boolean;
}) {
  const primaryAmount = input.fallback
    ? `${formatMoney(input.fallback.snapshot.summary.stock_value)} บาท`
    : "ยังไม่พร้อม";
  const statusText = input.fallback ? "ข้อมูลอ้างอิง" : "ข้อมูลสดไม่พร้อม";
  const statusColor = input.fallback ? "#B45309" : "#B91C1C";
  const metrics = input.fallback
    ? [
        {
          label: "จำนวนสินค้า",
          value: `${formatInteger(input.fallback.snapshot.summary.sku_count)} รายการ`,
        },
        {
          label: "ติดลบ",
          value: `${formatInteger(
            input.fallback.snapshot.summary.negative_stock_count,
          )} รายการ`,
        },
        {
          label: "อายุข้อมูล",
          value: `${formatAgeHours(input.fallback.ageHours)}`,
        },
      ]
    : [
        { label: "สถานะ", value: "รอรอบถัดไป" },
        { label: "รายงานอื่น", value: "ส่งต่อ" },
        {
          label: "Cooldown",
          value: input.cooldownUsed ? "ใช้" : "ไม่ใช้",
        },
      ];

  return {
    type: "flex" as const,
    altText: input.fallback
      ? `สต็อกคงเหลือใช้ข้อมูลอ้างอิงล่าสุดเมื่อ ${formatThaiDateTime(
          input.fallback.snapshot.generated_at,
        )}`
      : "สต็อกคงเหลือยังไม่พร้อม ระบบจะลองใหม่ในรอบถัดไป",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#F8FAFC",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: "สต็อกคงเหลือ",
            weight: "bold",
            size: "xl",
            color: "#111827",
            wrap: true,
          },
          {
            type: "text",
            text: `${input.tenantName} · อัปเดต ${formatThaiDateTime(input.generatedAt)}`,
            size: "sm",
            color: "#6B7280",
            wrap: true,
            margin: "sm",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "20px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: statusText,
                size: "sm",
                color: statusColor,
                weight: "bold",
              },
              {
                type: "text",
                text: `อ้างอิง ${formatThaiDateTime(input.generatedAt)}`,
                size: "sm",
                color: "#6B7280",
                align: "end",
              },
            ],
          },
          {
            type: "text",
            text: primaryAmount,
            weight: "bold",
            size: input.fallback ? "xxl" : "xl",
            color: "#111827",
            wrap: true,
          },
          ...metrics.map((metric) => ({
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: metric.label,
                color: "#6B7280",
                size: "sm",
              },
              {
                type: "text",
                text: metric.value,
                color: "#111827",
                size: "sm",
                weight: "bold",
                align: "end",
                wrap: true,
              },
            ],
          })),
          {
            type: "separator",
            margin: "sm",
          },
          {
            type: "text",
            text: input.warning,
            color: "#111827",
            size: "sm",
            weight: "bold",
            wrap: true,
          },
          {
            type: "text",
            text: input.cooldownUsed
              ? "ระบบพักการดึงรายงานสดชั่วคราวเพื่อลดภาระ JavaWS"
              : "รายงานอื่นที่สำเร็จยังถูกส่งตามปกติ",
            color: "#92400E",
            size: "xs",
            wrap: true,
          },
        ],
      },
    },
  };
}

function buildArCustomerMovementNoticeFlex(input: {
  tenantName: string;
  generatedAt: string;
  warning: string;
  fallback: ArCustomerMovementFallbackSnapshot | null;
  cooldownUsed: boolean;
}) {
  const primaryAmount = input.fallback
    ? `${formatMoney(input.fallback.snapshot.summary.net_movement_amount)} บาท`
    : "ยังไม่พร้อม";
  const statusText = input.fallback ? "ข้อมูลอ้างอิง" : "ข้อมูลสดไม่พร้อม";
  const statusColor = input.fallback ? "#B45309" : "#B91C1C";
  const metrics = input.fallback
    ? [
        {
          label: "ลูกหนี้",
          value: `${formatInteger(input.fallback.snapshot.summary.customer_count)} ราย`,
        },
        {
          label: "เอกสาร",
          value: `${formatInteger(input.fallback.snapshot.summary.document_count)} ใบ`,
        },
        {
          label: "อายุข้อมูล",
          value: `${formatAgeHours(input.fallback.ageHours)}`,
        },
      ]
    : [
        { label: "สถานะ", value: "รอรอบถัดไป" },
        { label: "รายงานอื่น", value: "ส่งต่อ" },
        {
          label: "Cooldown",
          value: input.cooldownUsed ? "ใช้" : "ไม่ใช้",
        },
      ];

  return {
    type: "flex" as const,
    altText: input.fallback
      ? `เคลื่อนไหวลูกหนี้ใช้ข้อมูลอ้างอิงล่าสุดเมื่อ ${formatThaiDateTime(
          input.fallback.snapshot.generated_at,
        )}`
      : "เคลื่อนไหวลูกหนี้ยังไม่พร้อม ระบบจะลองใหม่ในรอบถัดไป",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#F8FAFC",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: "เคลื่อนไหวลูกหนี้",
            weight: "bold",
            size: "xl",
            color: "#111827",
            wrap: true,
          },
          {
            type: "text",
            text: `${input.tenantName} · อัปเดต ${formatThaiDateTime(input.generatedAt)}`,
            size: "sm",
            color: "#6B7280",
            wrap: true,
            margin: "sm",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "20px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: statusText,
                size: "sm",
                color: statusColor,
                weight: "bold",
              },
              {
                type: "text",
                text: `อ้างอิง ${formatThaiDateTime(input.generatedAt)}`,
                size: "sm",
                color: "#6B7280",
                align: "end",
              },
            ],
          },
          {
            type: "text",
            text: primaryAmount,
            weight: "bold",
            size: input.fallback ? "xxl" : "xl",
            color: "#111827",
            wrap: true,
          },
          ...metrics.map((metric) => ({
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "text",
                text: metric.label,
                color: "#6B7280",
                size: "sm",
              },
              {
                type: "text",
                text: metric.value,
                color: "#111827",
                size: "sm",
                weight: "bold",
                align: "end",
                wrap: true,
              },
            ],
          })),
          {
            type: "separator",
            margin: "sm",
          },
          {
            type: "text",
            text: input.warning,
            color: "#111827",
            size: "sm",
            weight: "bold",
            wrap: true,
          },
          {
            type: "text",
            text: input.cooldownUsed
              ? "ระบบพักการดึงรายงานสดชั่วคราวเพื่อลดภาระ JavaWS"
              : "รายงานอื่นที่สำเร็จยังถูกส่งตามปกติ",
            color: "#92400E",
            size: "xs",
            wrap: true,
          },
        ],
      },
    },
  };
}

function formatThaiDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatInteger(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function formatAgeHours(value: number) {
  if (value < 1) {
    return "ไม่ถึง 1 ชม.";
  }
  return `${value.toLocaleString("th-TH", {
    maximumFractionDigits: 1,
  })} ชม.`;
}

function roundAgeHours(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}
