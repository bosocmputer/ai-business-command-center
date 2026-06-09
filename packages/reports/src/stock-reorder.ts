import {
  type DataQualityStatus,
  type SalesGoodsServicesParams,
  salesGoodsServicesParamsSchema,
  type StockReorderLinePreview,
  type StockReorderRow,
  type StockReorderSnapshot,
  type StockReorderSummary,
  type TenantId,
} from "@ai-bcc/shared";
import {
  buildExecutiveDigestFlexMessage,
  isValidLineUri as isValidExecutiveDigestUri,
  type ExecutiveDigestStatus,
  truncateLineText,
} from "./line-flex.js";

type StockReorderRawRow = Record<string, unknown>;

export const stockReorderContract = {
  report_key: "stock_reorder",
  name: "Stock Reorder",
  version: "0.1.0",
  params_schema: salesGoodsServicesParamsSchema,
  metric_truth: {
    reorder_condition:
      "ic_inventory.balance_qty < ic_inventory_detail.purchase_point",
    purchase_point: "ic_inventory_detail.purchase_point aggregated by item",
    purchase_balance_qty: "ic_inventory.accrued_in_qty",
    source_basis: "latest inventory master balance from SML",
  },
} as const;

export function validateStockReorderParams(
  input: unknown,
): SalesGoodsServicesParams {
  return salesGoodsServicesParamsSchema.parse(input);
}

export function buildStockReorderQuery(params: SalesGoodsServicesParams) {
  validateStockReorderParams(params);

  return {
    text: `
with reorder_config as (
  select
    d.ic_code,
    max(coalesce(d.purchase_point, 0)) as purchase_point
  from ic_inventory_detail d
  group by d.ic_code
),
reorder_items as (
  select
    i.code as ic_code,
    i.name_1 as ic_name,
    coalesce(i.unit_standard, '') || '~' || coalesce(i.unit_standard_name, '') as ic_unit_code,
    coalesce(i.balance_qty, 0) as balance_qty,
    r.purchase_point,
    coalesce(i.accrued_in_qty, 0) as purchase_balance_qty
  from ic_inventory i
  inner join reorder_config r on r.ic_code = i.code
  where coalesce(i.item_type, 0) <> 5
    and r.purchase_point > 0
    and coalesce(i.balance_qty, 0) < r.purchase_point
)
select
  ic_code,
  ic_name,
  ic_unit_code,
  balance_qty,
  purchase_point,
  purchase_balance_qty
from reorder_items
order by ic_code
`,
    values: [] as unknown[],
  };
}

export function summarizeStockReorder(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: StockReorderSnapshot["source"];
  rows: StockReorderRawRow[];
}): StockReorderSnapshot {
  const rows = input.rows.map(normalizeStockReorderRow);
  const topItems = sortStockReorderRows(rows).slice(0, 20);
  const summary = summarizeRows(rows, topItems[0] ?? null);

  return {
    tenant_id: input.tenant_id,
    report_key: "stock_reorder",
    run_id: input.run_id,
    params: input.params,
    generated_at: input.generated_at,
    source: input.source,
    quality_status: resolveQualityStatus(input.source),
    source_basis: "latest_inventory_balance",
    summary,
    top_items: topItems,
    line_template: {
      title: "รายงานสินค้าถึงจุดสั่งซื้อ",
      body: [
        `สินค้าถึงจุดสั่งซื้อ ${formatInteger(summary.reorder_count)} รายการ`,
        `ของหมด ${formatInteger(summary.out_of_stock_count)} รายการ`,
        `ใกล้หมด ${formatInteger(summary.low_stock_count)} รายการ`,
      ],
    },
  };
}

export function renderStockReorderLinePreview(input: {
  snapshot: StockReorderSnapshot;
  dashboardUrl?: string | null;
  tenantName?: string | null;
}): StockReorderLinePreview {
  const { snapshot } = input;
  const dashboardUrl = input.dashboardUrl ?? null;
  const useFlexMessage = isValidExecutiveDigestUri(dashboardUrl);
  const tenantName = input.tenantName?.trim() || snapshot.tenant_id;
  const generatedAt = formatThaiDateTime(snapshot.generated_at);
  const insight = buildStockReorderInsight(snapshot);
  const warnings = buildLineWarnings(snapshot);
  const topItem = snapshot.top_items[0] ?? null;
  const lines = [
    "รายงานสินค้าถึงจุดสั่งซื้อ",
    "",
    `บริษัท: ${tenantName}`,
    "ข้อมูล: ข้อมูลล่าสุดจาก SML",
    `อัปเดต: ${generatedAt}`,
    "",
    `สินค้าถึงจุดสั่งซื้อ: ${formatInteger(snapshot.summary.reorder_count)} รายการ`,
    `ของหมด: ${formatInteger(snapshot.summary.out_of_stock_count)} รายการ`,
    `ใกล้หมด: ${formatInteger(snapshot.summary.low_stock_count)} รายการ`,
    `ค้างรับเข้า: ${formatQty(snapshot.summary.purchase_balance_qty_total)}`,
    "",
    `สรุปที่ควรดู: ${insight}`,
    "",
    topItem
      ? `รายการแรกที่ควรดู: ${topItem.ic_name || topItem.ic_code} ขาดอีก ${formatQty(
          topItem.shortage_qty,
        )} ${topItem.ic_unit_code || ""}`
      : "รายการแรกที่ควรดู: ยังไม่มีสินค้าต่ำกว่าจุดสั่งซื้อ",
    ...warnings.map((warning) => `\nหมายเหตุ: ${warning}`),
    "",
    useFlexMessage
      ? "เปิดรายงาน: กดปุ่มใน LINE เพื่อดูรายละเอียด"
      : "เปิดรายงาน: ยังไม่พร้อมใช้งานในข้อความนี้",
  ];
  const flexMessage = buildStockReorderFlexMessage({
    snapshot,
    tenantName,
    generatedAt,
    dashboardUrl,
    insight,
  });

  return {
    tenant_id: snapshot.tenant_id,
    report_key: "stock_reorder",
    run_id: snapshot.run_id,
    generated_at: snapshot.generated_at,
    source: snapshot.source,
    line_message_type: flexMessage ? "flex" : "text",
    title: "รายงานสินค้าถึงจุดสั่งซื้อ",
    text: lines.join("\n"),
    lines,
    flex_message: flexMessage,
    warnings,
    dashboard_url: dashboardUrl,
  };
}

function normalizeStockReorderRow(row: StockReorderRawRow): StockReorderRow {
  const balanceQty = roundQty(toNumber(row.balance_qty));
  const purchasePoint = roundQty(toNumber(row.purchase_point));
  const shortageQty = roundQty(Math.max(purchasePoint - balanceQty, 0));
  return {
    ic_code: toStringValue(row.ic_code),
    ic_name: toStringValue(row.ic_name),
    ic_unit_code: normalizeUnitCode(toStringValue(row.ic_unit_code)),
    balance_qty: balanceQty,
    purchase_point: purchasePoint,
    purchase_balance_qty: roundQty(toNumber(row.purchase_balance_qty)),
    shortage_qty: shortageQty,
    status: balanceQty <= 0 ? "out_of_stock" : "low_stock",
  };
}

function summarizeRows(
  rows: StockReorderRow[],
  topItem: StockReorderRow | null,
): StockReorderSummary {
  return {
    reorder_count: rows.length,
    out_of_stock_count: rows.filter((row) => row.status === "out_of_stock").length,
    low_stock_count: rows.filter((row) => row.status === "low_stock").length,
    purchase_balance_qty_total: roundQty(
      rows.reduce((sum, row) => sum + row.purchase_balance_qty, 0),
    ),
    shortage_qty_total: roundQty(
      rows.reduce((sum, row) => sum + row.shortage_qty, 0),
    ),
    top_reorder_item_name: topItem ? topItem.ic_name || topItem.ic_code : null,
  };
}

function sortStockReorderRows(rows: StockReorderRow[]) {
  return [...rows].sort(
    (a, b) =>
      statusSortValue(a.status) - statusSortValue(b.status) ||
      b.shortage_qty - a.shortage_qty ||
      a.ic_code.localeCompare(b.ic_code),
  );
}

function statusSortValue(status: StockReorderRow["status"]) {
  return status === "out_of_stock" ? 0 : 1;
}

function buildStockReorderInsight(snapshot: StockReorderSnapshot) {
  if (snapshot.summary.reorder_count === 0) {
    return "ยังไม่พบสินค้าต่ำกว่าจุดสั่งซื้อจากข้อมูลล่าสุดของ SML";
  }
  if (snapshot.summary.out_of_stock_count > 0) {
    return `มี ${formatInteger(snapshot.summary.out_of_stock_count)} รายการที่คงเหลือ 0 หรือติดลบ ควรตรวจสั่งซื้อก่อน`;
  }
  return `มี ${formatInteger(snapshot.summary.low_stock_count)} รายการต่ำกว่าจุดสั่งซื้อ`;
}

function buildLineWarnings(snapshot: StockReorderSnapshot) {
  const warnings: string[] = [];
  if (snapshot.source === "sample_snapshot") {
    warnings.push("ข้อความนี้เป็น preview จากข้อมูลตัวอย่าง ยังไม่ใช่ข้อมูลสดจาก SML");
  }
  return warnings;
}

function buildStockReorderFlexMessage(input: {
  snapshot: StockReorderSnapshot;
  tenantName: string;
  generatedAt: string;
  dashboardUrl: string | null;
  insight: string;
}) {
  const { snapshot } = input;
  const topItem = snapshot.top_items[0] ?? null;

  return buildExecutiveDigestFlexMessage({
    variant: "executive_report_v2",
    kicker: "สต็อก · ล่าสุด",
    title: "สินค้าถึงจุดสั่งซื้อ",
    subtitle: `${input.tenantName} · ข้อมูลล่าสุดจาก SML`,
    altText: `สินค้าถึงจุดสั่งซื้อ ${input.tenantName}: ${formatInteger(
      snapshot.summary.reorder_count,
    )} รายการ`,
    generatedAt: input.generatedAt,
    status: getStockReorderDigestStatus(snapshot),
    primaryAmount: {
      value: formatInteger(snapshot.summary.reorder_count),
      unit: "รายการ",
    },
    metrics: [
      {
        label: "ของหมด",
        value: `${formatInteger(snapshot.summary.out_of_stock_count)} รายการ`,
      },
      {
        label: "ใกล้หมด",
        value: `${formatInteger(snapshot.summary.low_stock_count)} รายการ`,
      },
      {
        label: "ค้างรับเข้า",
        value: formatQty(snapshot.summary.purchase_balance_qty_total),
      },
    ],
    insight: input.insight,
    topLine: topItem
      ? {
          label: "รายการแรกที่ควรดู",
          value: `${truncateLineText(topItem.ic_name || topItem.ic_code, 34)} ขาดอีก ${formatQty(
            topItem.shortage_qty,
        )} ${topItem.ic_unit_code || ""}`,
        }
      : { label: "รายการแรกที่ควรดู", value: "ยังไม่มีสินค้าต่ำกว่าจุดสั่งซื้อ" },
    note: "ข้อมูลล่าสุดจาก SML เป็นยอดปัจจุบัน ไม่ใช่รายงานย้อนหลังตามวัน",
    noteTone: "info",
    dashboardUrl: input.dashboardUrl,
  });
}

function getStockReorderDigestStatus(
  snapshot: StockReorderSnapshot,
): ExecutiveDigestStatus {
  if (snapshot.summary.out_of_stock_count > 0) {
    return { text: "ควรตรวจสั่งซื้อ", severity: "notice" };
  }
  if (snapshot.summary.low_stock_count > 0) {
    return { text: "ควรตรวจสั่งซื้อ", severity: "notice" };
  }
  return { text: "พร้อมใช้", severity: "ready" };
}

function resolveQualityStatus(
  source: StockReorderSnapshot["source"],
): DataQualityStatus {
  return source === "sample_snapshot" ? "stale" : "valid";
}

function formatThaiDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatInteger(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function formatQty(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 3 });
}

function roundQty(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  return String(value);
}

function normalizeUnitCode(value: string) {
  return value.replace(/~+$/g, "").replace(/^~+/g, "").trim();
}
