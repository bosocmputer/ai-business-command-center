import {
  type DataQualityStatus,
  type SalesGoodsServicesParams,
  salesGoodsServicesParamsSchema,
  type StockBalanceLinePreview,
  type StockBalanceRow,
  type StockBalanceSnapshot,
  type StockBalanceSummary,
  type TenantId,
} from "@ai-bcc/shared";
import {
  buildExecutiveDigestFlexMessage,
  isValidLineUri as isValidExecutiveDigestUri,
  type ExecutiveDigestStatus,
  truncateLineText,
} from "./line-flex.js";

type StockBalanceRawRow = Record<string, unknown>;

export const stockBalanceContract = {
  report_key: "stock_balance",
  name: "Stock Balance",
  version: "0.1.0",
  params_schema: salesGoodsServicesParamsSchema,
  metric_truth: {
    stock_quantity:
      "ic_trans_detail.qty * stand_value / divide_value, accumulated to date_to",
    stock_value:
      "ic_trans_detail.sum_of_cost + profit_lost_cost_amount, accumulated to date_to",
    period_movement: "qty_in/out and amount_in/out from date_from to date_to",
    average_cost:
      "balance amount divided by balance quantity, plus latest item average cost",
  },
} as const;

export type StockBalanceQueryOptions = {
  itemCode?: string | null;
  search?: string | null;
};

export function validateStockBalanceParams(
  input: unknown,
): SalesGoodsServicesParams {
  return salesGoodsServicesParamsSchema.parse(input);
}

export function buildStockBalanceQuery(
  params: SalesGoodsServicesParams,
  options: StockBalanceQueryOptions = {},
) {
  validateStockBalanceParams(params);

  const values: unknown[] = [params.date_from, params.date_to];
  const inventoryFilters: string[] = [];
  const itemCode = options.itemCode?.trim();
  const search = options.search?.trim();

  if (itemCode) {
    values.push(itemCode);
    inventoryFilters.push(`and i.code = $${values.length}`);
  }

  if (search) {
    values.push(`%${search}%`);
    inventoryFilters.push(
      `and (i.code ilike $${values.length} or i.name_1 ilike $${values.length})`,
    );
  }

  return {
    text: `
with inventory_scope as (
  select
    i.code,
    i.name_1,
    i.unit_standard as ic_unit_code,
    coalesce(
      i.unit_standard_stand_value / nullif(i.unit_standard_divide_value, 0),
      1
    ) as unit_ratio,
    coalesce(u.stand_value / nullif(u.divide_value, 0), 1) as unit_standard_ratio
  from ic_inventory i
  left join ic_unit_use u on u.ic_code = i.code
    and u.code = i.unit_standard
  where coalesce(i.item_type, 0) not in (1, 3)
  ${inventoryFilters.join("\n  ")}
),
base_detail as (
  select
    d.item_code,
    inv.name_1 as ic_name,
    inv.ic_unit_code,
    inv.unit_ratio,
    inv.unit_standard_ratio,
    d.doc_date_calc,
    d.doc_time,
    d.line_number,
    d.trans_flag,
    d.inquiry_type,
    d.qty,
    d.sum_of_cost,
    d.calc_flag,
    d.average_cost,
    coalesce(d.profit_lost_cost_amount, 0) as profit_lost_cost_amount,
    round((d.qty * d.stand_value) / nullif(d.divide_value, 0), 4) as standard_qty
  from ic_trans_detail d
  inner join inventory_scope inv on inv.code = d.item_code
  where d.last_status = 0
    and d.item_type <> 5
    and d.is_doc_copy = 0
    and d.doc_date_calc <= $2::date
    and not (coalesce(d.doc_ref, '') <> '' and d.is_pos = 1)
),
classified_detail as (
  select
    *,
    (
      trans_flag in (70, 54, 60, 58, 310, 12)
      or (trans_flag = 66 and qty > 0)
      or (trans_flag = 14 and inquiry_type = 0)
      or (trans_flag = 48 and inquiry_type < 2)
    ) as is_qty_in,
    (
      trans_flag in (56, 68, 72, 44)
      or (trans_flag = 66 and qty < 0)
      or (trans_flag = 46 and inquiry_type in (0, 2))
      or (trans_flag = 16 and inquiry_type in (0, 2))
      or (trans_flag = 311 and inquiry_type = 0)
    ) as is_qty_out,
    (
      trans_flag in (70, 54, 60, 58, 310, 12)
      or (trans_flag = 66 and (qty > 0 or sum_of_cost > 0))
      or trans_flag = 14
      or (trans_flag = 48 and inquiry_type < 2)
    ) as is_amount_in,
    (
      trans_flag in (56, 68, 72, 44)
      or (trans_flag = 66 and (qty < 0 or sum_of_cost < 0))
      or trans_flag = 46
      or trans_flag = 16
      or trans_flag = 311
    ) as is_amount_out
  from base_detail
),
item_agg as (
  select
    item_code as ic_code,
    max(ic_name) as ic_name,
    max(ic_unit_code) as ic_unit_code,
    max(unit_ratio) as unit_ratio,
    max(unit_standard_ratio) as unit_standard_ratio,
    coalesce(sum(case
      when is_qty_in or is_qty_out then calc_flag * standard_qty
      else 0
    end), 0) as balance_qty,
    coalesce(sum(case
      when is_amount_in or is_amount_out then
        calc_flag * (
          case
            when trans_flag = 66 and qty < 0
              then (-1 * sum_of_cost) + profit_lost_cost_amount
            else sum_of_cost + profit_lost_cost_amount
          end
        )
      else 0
    end), 0) as balance_amount,
    coalesce(sum(case
      when doc_date_calc >= $1::date and is_qty_in
        then calc_flag * standard_qty
      else 0
    end), 0) as qty_in,
    coalesce(sum(case
      when doc_date_calc >= $1::date and is_amount_in
        then (calc_flag * sum_of_cost) + profit_lost_cost_amount
      else 0
    end), 0) as amount_in,
    coalesce(sum(case
      when doc_date_calc >= $1::date and is_qty_out
        then -1 * calc_flag * standard_qty
      else 0
    end), 0) as qty_out,
    coalesce(sum(case
      when doc_date_calc >= $1::date and is_amount_out
        then -1 * (
          (case when trans_flag = 66 and qty < 0 then -1 else calc_flag end)
          * (sum_of_cost + profit_lost_cost_amount)
        )
      else 0
    end), 0) as amount_out
  from classified_detail
  group by item_code
),
latest_cost as (
  select distinct on (item_code)
    item_code,
    average_cost
  from classified_detail
  where is_amount_in or is_amount_out
  order by item_code, doc_date_calc desc, doc_time desc, line_number desc
)
select
  agg.ic_code,
  agg.ic_name,
  agg.ic_unit_code,
  coalesce(agg.balance_qty / nullif(agg.unit_standard_ratio, 0), 0) as balance_qty,
  coalesce(
    case when agg.balance_qty = 0 then 0 else agg.balance_amount / agg.balance_qty end
    * agg.unit_standard_ratio,
    0
  ) as average_cost,
  coalesce(latest.average_cost * agg.unit_ratio, 0) as average_cost_end,
  agg.balance_amount,
  coalesce(agg.qty_in / nullif(agg.unit_standard_ratio, 0), 0) as qty_in,
  agg.amount_in,
  coalesce(
    case when agg.qty_in = 0 then 0 else agg.amount_in / agg.qty_in end
    * agg.unit_standard_ratio,
    0
  ) as average_cost_in,
  coalesce(agg.qty_out / nullif(agg.unit_standard_ratio, 0), 0) as qty_out,
  agg.amount_out,
  coalesce(
    case when agg.qty_out = 0 then 0 else agg.amount_out / agg.qty_out end
    * agg.unit_standard_ratio,
    0
  ) as average_cost_out
from item_agg agg
left join latest_cost latest on latest.item_code = agg.ic_code
where agg.qty_in <> 0
  or agg.amount_in <> 0
  or agg.qty_out <> 0
  or agg.amount_out <> 0
  or agg.balance_qty <> 0
  or agg.balance_amount <> 0
order by abs(agg.balance_amount) desc, agg.ic_code
`,
    values,
  };
}

export function summarizeStockBalance(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: StockBalanceSnapshot["source"];
  rows: StockBalanceRawRow[];
}): StockBalanceSnapshot {
  const rows = input.rows.map(normalizeStockBalanceRow);
  const topItemsByValue = sortTopItemsByValue(rows).slice(0, 20);
  const negativeItems = rows
    .filter((row) => row.balance_qty < 0)
    .sort((a, b) => a.balance_qty - b.balance_qty || a.balance_amount - b.balance_amount)
    .slice(0, 20);
  const summary = summarizeRows(rows, topItemsByValue[0] ?? null);

  return {
    tenant_id: input.tenant_id,
    report_key: "stock_balance",
    run_id: input.run_id,
    params: input.params,
    generated_at: input.generated_at,
    source: input.source,
    quality_status: resolveQualityStatus(input.source),
    summary,
    top_items_by_value: topItemsByValue,
    negative_items: negativeItems,
    line_template: {
      title: "รายงานสต็อกคงเหลือ",
      body: [
        `มูลค่าสต็อกคงเหลือ ${formatMoney(summary.stock_value)} บาท`,
        `จำนวนสินค้า ${formatInteger(summary.sku_count)} รายการ`,
        `สินค้าคงเหลือติดลบ ${formatInteger(summary.negative_stock_count)} รายการ`,
      ],
    },
  };
}

export function renderStockBalanceLinePreview(input: {
  snapshot: StockBalanceSnapshot;
  dashboardUrl?: string | null;
  tenantName?: string | null;
}): StockBalanceLinePreview {
  const { snapshot } = input;
  const dashboardUrl = input.dashboardUrl ?? null;
  const useFlexMessage = isValidExecutiveDigestUri(dashboardUrl);
  const tenantName = input.tenantName?.trim() || snapshot.tenant_id;
  const generatedAt = formatThaiDateTime(snapshot.generated_at);
  const insight = buildStockBalanceInsight(snapshot);
  const warnings = buildLineWarnings(snapshot);
  const topItem = snapshot.top_items_by_value[0] ?? null;
  const inboundLabel = formatStockMovementLabel(
    "รับเข้า",
    snapshot.params.date_from,
    snapshot.params.date_to,
  );
  const outboundLabel = formatStockMovementLabel(
    "จ่ายออก",
    snapshot.params.date_from,
    snapshot.params.date_to,
  );
  const lines = [
    "รายงานสต็อกคงเหลือ",
    "",
    `บริษัท: ${tenantName}`,
    `ข้อมูล: ${formatStockBalanceAsOf(snapshot.params.date_to)}`,
    `อัปเดต: ${generatedAt}`,
    "",
    `มูลค่าสต็อกคงเหลือ: ${formatMoney(snapshot.summary.stock_value)} บาท`,
    `จำนวนสินค้า: ${formatInteger(snapshot.summary.sku_count)} รายการ`,
    `${inboundLabel}: ${formatQty(snapshot.summary.qty_in)} หน่วย / ${formatMoney(snapshot.summary.amount_in)} บาท`,
    `${outboundLabel}: ${formatQty(snapshot.summary.qty_out)} หน่วย / ${formatMoney(snapshot.summary.amount_out)} บาท`,
    "",
    `สรุปที่ควรดู: ${insight}`,
    "",
    topItem
      ? `สินค้ามูลค่าสูงสุด: ${topItem.ic_name || topItem.ic_code} ${formatMoney(topItem.balance_amount)} บาท`
      : "สินค้ามูลค่าสูงสุด: ยังไม่มีข้อมูลในช่วงวันที่นี้",
    ...warnings.map((warning) => `\nหมายเหตุ: ${warning}`),
    "",
    useFlexMessage
      ? "เปิดรายงาน: กดปุ่มใน LINE เพื่อดูรายละเอียด"
      : "เปิดรายงาน: ยังไม่พร้อมใช้งานในข้อความนี้",
  ];
  const flexMessage = buildStockBalanceFlexMessage({
    snapshot,
    tenantName,
    generatedAt,
    dashboardUrl,
    insight,
  });

  return {
    tenant_id: snapshot.tenant_id,
    report_key: "stock_balance",
    run_id: snapshot.run_id,
    generated_at: snapshot.generated_at,
    source: snapshot.source,
    line_message_type: flexMessage ? "flex" : "text",
    title: "รายงานสต็อกคงเหลือ",
    text: lines.join("\n"),
    lines,
    flex_message: flexMessage,
    warnings,
    dashboard_url: dashboardUrl,
  };
}

function normalizeStockBalanceRow(row: StockBalanceRawRow): StockBalanceRow {
  return {
    ic_code: toStringValue(row.ic_code),
    ic_name: toStringValue(row.ic_name),
    ic_unit_code: toStringValue(row.ic_unit_code),
    balance_qty: roundQty(toNumber(row.balance_qty)),
    average_cost: roundMoney(toNumber(row.average_cost)),
    average_cost_end: roundMoney(toNumber(row.average_cost_end)),
    balance_amount: roundMoney(toNumber(row.balance_amount)),
    qty_in: roundQty(toNumber(row.qty_in)),
    amount_in: roundMoney(toNumber(row.amount_in)),
    average_cost_in: roundMoney(toNumber(row.average_cost_in)),
    qty_out: roundQty(toNumber(row.qty_out)),
    amount_out: roundMoney(toNumber(row.amount_out)),
    average_cost_out: roundMoney(toNumber(row.average_cost_out)),
  };
}

function summarizeRows(
  rows: StockBalanceRow[],
  topItem: StockBalanceRow | null,
): StockBalanceSummary {
  return {
    sku_count: rows.length,
    stock_value: roundMoney(rows.reduce((sum, row) => sum + row.balance_amount, 0)),
    balance_qty: roundQty(rows.reduce((sum, row) => sum + row.balance_qty, 0)),
    qty_in: roundQty(rows.reduce((sum, row) => sum + row.qty_in, 0)),
    amount_in: roundMoney(rows.reduce((sum, row) => sum + row.amount_in, 0)),
    qty_out: roundQty(rows.reduce((sum, row) => sum + row.qty_out, 0)),
    amount_out: roundMoney(rows.reduce((sum, row) => sum + row.amount_out, 0)),
    negative_stock_count: rows.filter((row) => row.balance_qty < 0).length,
    zero_or_missing_cost_count: rows.filter(
      (row) =>
        Math.abs(row.balance_qty) > 0.000001 &&
        row.average_cost <= 0 &&
        row.average_cost_end <= 0,
    ).length,
    top_stock_item_name: topItem ? topItem.ic_name || topItem.ic_code : null,
  };
}

function sortTopItemsByValue(rows: StockBalanceRow[]) {
  return [...rows].sort(
    (a, b) =>
      b.balance_amount - a.balance_amount ||
      Math.abs(b.balance_qty) - Math.abs(a.balance_qty) ||
      a.ic_code.localeCompare(b.ic_code),
  );
}

function buildStockBalanceInsight(snapshot: StockBalanceSnapshot) {
  if (snapshot.summary.sku_count === 0) {
    return "ยังไม่พบสินค้าที่มีความเคลื่อนไหวหรือยอดคงเหลือในช่วงนี้";
  }
  if (snapshot.summary.negative_stock_count > 0) {
    return `พบสินค้าคงเหลือติดลบ ${formatInteger(snapshot.summary.negative_stock_count)} รายการ ควรตรวจเอกสารรับเข้า/จ่ายออกก่อนใช้ยอดสต็อกตัดสินใจ`;
  }
  const topItem = snapshot.top_items_by_value[0] ?? null;
  if (topItem) {
    return `${topItem.ic_name || topItem.ic_code} เป็นสินค้ามูลค่าสต็อกสูงสุดในรายงานนี้`;
  }
  return "รายงานพร้อมใช้สำหรับดูมูลค่าสต็อก จำนวนสินค้า และความเคลื่อนไหวรับเข้า/จ่ายออก";
}

function buildLineWarnings(snapshot: StockBalanceSnapshot) {
  const warnings: string[] = [];
  if (snapshot.source === "sample_snapshot") {
    warnings.push("ข้อความนี้เป็น preview จากข้อมูลตัวอย่าง ยังไม่ใช่ข้อมูลสดจาก SML");
  }
  if (snapshot.summary.negative_stock_count > 0) {
    warnings.push("พบสินค้าคงเหลือติดลบ ควรตรวจเอกสารคลังสินค้า");
  }
  if (snapshot.summary.zero_or_missing_cost_count > 0) {
    warnings.push("พบสินค้าบางรายการไม่มีต้นทุนเฉลี่ย ควรตรวจข้อมูลต้นทุน");
  }
  return warnings;
}

function buildStockBalanceFlexMessage(input: {
  snapshot: StockBalanceSnapshot;
  tenantName: string;
  generatedAt: string;
  dashboardUrl: string | null;
  insight: string;
}) {
  const { snapshot } = input;
  const topItem = snapshot.top_items_by_value[0] ?? null;
  const inboundLabel = formatStockMovementLabel(
    "รับเข้า",
    snapshot.params.date_from,
    snapshot.params.date_to,
  );
  const outboundLabel = formatStockMovementLabel(
    "จ่ายออก",
    snapshot.params.date_from,
    snapshot.params.date_to,
  );

  return buildExecutiveDigestFlexMessage({
    variant: "executive_report_v2",
    kicker: "สต็อก · ณ วันที่",
    title: "สต็อกคงเหลือ",
    subtitle: `${input.tenantName} · ${formatStockBalanceAsOf(
      snapshot.params.date_to,
    )}`,
    altText: `สต็อกคงเหลือ ${input.tenantName} ${formatStockBalanceAsOf(
      snapshot.params.date_to,
    )}: มูลค่า ${formatMoney(snapshot.summary.stock_value)} บาท`,
    generatedAt: input.generatedAt,
    status: getStockBalanceDigestStatus(snapshot),
    primaryAmount: {
      value: formatMoney(snapshot.summary.stock_value),
      unit: "บาท",
      compact: true,
    },
    metrics: [
      {
        label: "จำนวนสินค้า",
        value: `${formatInteger(snapshot.summary.sku_count)} รายการ`,
      },
      {
        label: inboundLabel,
        value: `${formatMoney(snapshot.summary.amount_in)} บาท`,
      },
      {
        label: outboundLabel,
        value: `${formatMoney(snapshot.summary.amount_out)} บาท`,
      },
    ],
    insight: input.insight,
    topLine: topItem
      ? {
          label: "สินค้ามูลค่าสูง",
          value: `${truncateLineText(topItem.ic_name || topItem.ic_code, 34)}: ${formatMoney(
            topItem.balance_amount,
          )} บาท`,
        }
      : { label: "สินค้ามูลค่าสูง", value: "ยังไม่มีข้อมูลในช่วงนี้" },
    note: "ข้อมูลจากระบบขาย SML มีต้นทุนเฉลี่ยและมูลค่าสต็อก",
    noteTone: "info",
    dashboardUrl: input.dashboardUrl,
  });
}

function getStockBalanceDigestStatus(
  snapshot: StockBalanceSnapshot,
): ExecutiveDigestStatus {
  if (snapshot.summary.sku_count === 0) {
    return { text: "ไม่มีข้อมูล", severity: "notice" };
  }
  if (snapshot.summary.negative_stock_count > 0) {
    return { text: "ควรตรวจทันที", severity: "critical" };
  }
  if (snapshot.summary.zero_or_missing_cost_count > 0) {
    return { text: "มีข้อสังเกต", severity: "notice" };
  }
  return { text: "พร้อมใช้", severity: "ready" };
}

function resolveQualityStatus(
  source: StockBalanceSnapshot["source"],
): DataQualityStatus {
  return source === "sample_snapshot" ? "stale" : "valid";
}

function formatStockBalanceAsOf(dateTo: string) {
  return `คงเหลือ ณ ${formatDateSlash(dateTo)}`;
}

function formatStockMovementLabel(
  prefix: "รับเข้า" | "จ่ายออก",
  dateFrom: string,
  dateTo: string,
) {
  return dateFrom === dateTo ? `${prefix}ในวัน` : `${prefix}ในช่วง`;
}

function formatDateSlash(ymd: string) {
  const [year, month, day] = ymd.split("-");
  return `${day}/${month}/${year}`;
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

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatInteger(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function formatQty(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 3 });
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
