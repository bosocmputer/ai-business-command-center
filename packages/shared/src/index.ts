import { z } from "zod";

export const tenantIdSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    "tenant_id must use lowercase letters, numbers, underscores, or hyphens",
  );

export const reportKeyValues = [
  "sales_goods_services",
  "purchase_goods_payables",
  "gross_profit_by_product",
  "gross_profit_by_ar_customer",
  "stock_balance",
  "stock_reorder",
  "ar_customer_movement",
  "ar_debt_receipt",
  "cash_bank_receipts",
  "cash_bank_payments",
] as const;

export const reportKeySchema = z.enum(reportKeyValues);

export const tenantStatusSchema = z.enum([
  "trial",
  "active",
  "past_due",
  "suspended",
  "cancelled",
]);

export const tenantFeatureFlagsSchema = z.object({
  business_signals_enabled: z.boolean().default(true),
  line_action_digest_v2_enabled: z.boolean().default(false),
  line_heavy_report_fallback_enabled: z.boolean().default(true),
  line_report_failure_incident_enabled: z.boolean().default(false),
  sml_chunked_heavy_reports_enabled: z.boolean().default(false),
  telegram_operational_alerts_enabled: z.boolean().default(false),
  demo_mode_enabled: z.boolean().default(false),
});

export const businessSignalThresholdsSchema = z.object({
  low_gross_margin_percent: z.coerce.number().min(0).max(100).default(5),
  sales_drop_percent: z.coerce.number().min(0).max(100).default(20),
  sales_drop_amount: z.coerce.number().min(0).max(1_000_000_000).default(1000),
  purchase_concentration_percent: z.coerce.number().min(0).max(100).default(80),
  missing_branch_amount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  negative_gross_profit_amount: z.coerce
    .number()
    .min(0)
    .max(1_000_000_000)
    .default(0),
  no_sales_enabled: z.boolean().default(true),
});

export const planCodeSchema = z.enum(["starter", "business", "pro"]);

export const userRoleSchema = z.enum(["owner_admin", "tenant_viewer"]);

export function findSensitiveTenantNoteHints(value: string) {
  const normalized = value.toLowerCase();
  const hints: string[] = [];
  const terms = [
    ["token", "token"],
    ["password", "password"],
    ["passwd", "password"],
    ["pwd", "password"],
    ["bearer", "bearer"],
    ["authorization", "authorization"],
    ["basic auth", "basic auth"],
    ["access_token", "access token"],
    ["access token", "access token"],
    ["api key", "api key"],
    ["apikey", "api key"],
    ["channel secret", "channel secret"],
    ["channel_secret", "channel secret"],
    ["secret", "secret"],
    ["รหัสผ่าน", "รหัสผ่าน"],
    ["คีย์ลับ", "คีย์ลับ"],
  ] as const;

  for (const [needle, label] of terms) {
    if (
      label === "secret" &&
      (normalized.includes("channel secret") ||
        normalized.includes("channel_secret"))
    ) {
      continue;
    }
    if (normalized.includes(needle) && !hints.includes(label)) {
      hints.push(label);
    }
  }

  if (/\b[a-z0-9_-]{32,}\b/i.test(value) && !hints.includes("ค่าลับยาว")) {
    hints.push("ค่าลับยาว");
  }

  return hints;
}

export function suggestTenantIdFromName(value: string) {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized) {
    const maxBaseLength = 80 - "tenant_".length;
    const base = normalized.slice(0, maxBaseLength).replace(/_+$/g, "");
    return base ? `tenant_${base}` : "";
  }

  const compact = value.trim().replace(/\s+/g, "");
  if (!compact) {
    return "";
  }

  return `tenant_store_${hashTenantName(compact)}`;
}

function hashTenantName(value: string) {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 8);
}

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:mm");

export const salesGoodsServicesParamsSchema = z
  .object({
    date_from: isoDateSchema,
    date_to: isoDateSchema,
    time_from: localTimeSchema.optional(),
    time_to: localTimeSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.date_from > value.date_to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "date_from must be earlier than or equal to date_to",
        path: ["date_from"],
      });
    }
    if (Boolean(value.time_from) !== Boolean(value.time_to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "time_from and time_to must be provided together",
        path: value.time_from ? ["time_to"] : ["time_from"],
      });
    }
    if (
      value.date_from === value.date_to &&
      value.time_from &&
      value.time_to &&
      value.time_from > value.time_to
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "time_from must be earlier than or equal to time_to",
        path: ["time_from"],
      });
    }
  });

export const dataQualityStatusSchema = z.enum([
  "valid",
  "stale",
  "failed",
  "partial",
  "reconciled_with_warning",
]);

export type TenantId = z.infer<typeof tenantIdSchema>;
export type ReportKey = z.infer<typeof reportKeySchema>;
export type ReportCategory =
  | "sales"
  | "purchase"
  | "gross_profit"
  | "inventory"
  | "ar"
  | "cash_bank";
export type ReportCatalogEntryFor<K extends ReportKey = ReportKey> = {
  key: K;
  definitionName: string;
  label: string;
  shortLabel: string;
  category: ReportCategory;
  permissionLabel: string;
  permissionDescription: string;
  sensitive: boolean;
  capabilities: {
    lineCard: boolean;
    signedViewer: boolean;
    pdf: boolean;
    businessSignals: boolean;
  };
};
export type TenantStatus = z.infer<typeof tenantStatusSchema>;
export type TenantFeatureFlags = z.infer<typeof tenantFeatureFlagsSchema>;
export type BusinessSignalThresholdsConfig = z.infer<
  typeof businessSignalThresholdsSchema
>;
export type PlanCode = z.infer<typeof planCodeSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type SalesGoodsServicesParams = z.infer<
  typeof salesGoodsServicesParamsSchema
>;
export type ReportParams = SalesGoodsServicesParams;
export type DataQualityStatus = z.infer<typeof dataQualityStatusSchema>;

export const reportCatalog = {
  sales_goods_services: {
    key: "sales_goods_services",
    definitionName: "Sales Goods and Services",
    label: "รายงานขายสินค้าและบริการ",
    shortLabel: "รายงานขาย",
    category: "sales",
    permissionLabel: "รายงานขายสินค้าและบริการ",
    permissionDescription: "ยอดขาย บิลขาย สาขา และสินค้าขายดีจาก SML",
    sensitive: false,
    capabilities: {
      lineCard: true,
      signedViewer: true,
      pdf: true,
      businessSignals: true,
    },
  },
  purchase_goods_payables: {
    key: "purchase_goods_payables",
    definitionName: "Purchase Goods and Payables",
    label: "รายงานซื้อสินค้า/ตั้งหนี้",
    shortLabel: "รายงานซื้อ",
    category: "purchase",
    permissionLabel: "รายงานซื้อ/ตั้งหนี้",
    permissionDescription: "ยอดซื้อ/ตั้งหนี้ ผู้จำหน่าย และสินค้าที่ซื้อจาก SML",
    sensitive: false,
    capabilities: {
      lineCard: true,
      signedViewer: true,
      pdf: true,
      businessSignals: true,
    },
  },
  gross_profit_by_product: {
    key: "gross_profit_by_product",
    definitionName: "Gross Profit by Product",
    label: "รายงานกำไรขั้นต้นสินค้า",
    shortLabel: "กำไรสินค้า",
    category: "gross_profit",
    permissionLabel: "กำไรขั้นต้นสินค้า",
    permissionDescription: "มีข้อมูลต้นทุนและ margin ควรเปิดเฉพาะผู้บริหาร",
    sensitive: true,
    capabilities: {
      lineCard: true,
      signedViewer: true,
      pdf: false,
      businessSignals: true,
    },
  },
  gross_profit_by_ar_customer: {
    key: "gross_profit_by_ar_customer",
    definitionName: "Gross Profit by AR Customer",
    label: "รายงานกำไรขั้นต้นลูกหนี้",
    shortLabel: "กำไรลูกหนี้",
    category: "gross_profit",
    permissionLabel: "กำไรขั้นต้นลูกหนี้",
    permissionDescription: "มีข้อมูลต้นทุนและ margin ควรเปิดเฉพาะผู้บริหาร",
    sensitive: true,
    capabilities: {
      lineCard: true,
      signedViewer: true,
      pdf: false,
      businessSignals: true,
    },
  },
  stock_balance: {
    key: "stock_balance",
    definitionName: "Stock Balance",
    label: "รายงานสต็อกคงเหลือ",
    shortLabel: "สต็อกคงเหลือ",
    category: "inventory",
    permissionLabel: "สต็อกคงเหลือ",
    permissionDescription: "มีข้อมูลต้นทุนเฉลี่ยและมูลค่าสต็อก ควรเปิดเฉพาะผู้บริหาร",
    sensitive: true,
    capabilities: {
      lineCard: true,
      signedViewer: true,
      pdf: false,
      businessSignals: false,
    },
  },
  stock_reorder: {
    key: "stock_reorder",
    definitionName: "Stock Reorder",
    label: "รายงานสินค้าถึงจุดสั่งซื้อ",
    shortLabel: "ถึงจุดสั่งซื้อ",
    category: "inventory",
    permissionLabel: "สินค้าถึงจุดสั่งซื้อ",
    permissionDescription: "สินค้าที่คงเหลือต่ำกว่าจุดสั่งซื้อจาก SML",
    sensitive: false,
    capabilities: {
      lineCard: true,
      signedViewer: true,
      pdf: false,
      businessSignals: false,
    },
  },
  ar_customer_movement: {
    key: "ar_customer_movement",
    definitionName: "AR Customer Movement",
    label: "รายงานเคลื่อนไหวลูกหนี้",
    shortLabel: "เคลื่อนไหวลูกหนี้",
    category: "ar",
    permissionLabel: "เคลื่อนไหวลูกหนี้",
    permissionDescription:
      "เอกสารเคลื่อนไหวลูกหนี้และยอดรับชำระจาก SML มีชื่อลูกค้าและยอดเงิน",
    sensitive: true,
    capabilities: {
      lineCard: true,
      signedViewer: true,
      pdf: false,
      businessSignals: false,
    },
  },
  ar_debt_receipt: {
    key: "ar_debt_receipt",
    definitionName: "AR Debt Receipt",
    label: "รายงานรับชำระหนี้",
    shortLabel: "รับชำระหนี้",
    category: "ar",
    permissionLabel: "รับชำระหนี้",
    permissionDescription:
      "เอกสารรับชำระหนี้ ลูกหนี้ และยอดเงินสด/โอนจาก SML",
    sensitive: true,
    capabilities: {
      lineCard: true,
      signedViewer: true,
      pdf: false,
      businessSignals: false,
    },
  },
  cash_bank_receipts: {
    key: "cash_bank_receipts",
    definitionName: "Cash Bank Receipts",
    label: "รายงานรับเงิน",
    shortLabel: "รับเงิน",
    category: "cash_bank",
    permissionLabel: "รายงานรับเงิน",
    permissionDescription:
      "เอกสารรับเงินและยอดตามช่องทางจาก SML มีข้อมูลลูกค้าและหมายเหตุ",
    sensitive: true,
    capabilities: {
      lineCard: true,
      signedViewer: true,
      pdf: false,
      businessSignals: false,
    },
  },
  cash_bank_payments: {
    key: "cash_bank_payments",
    definitionName: "Cash Bank Payments",
    label: "รายงานจ่ายเงิน",
    shortLabel: "จ่ายเงิน",
    category: "cash_bank",
    permissionLabel: "รายงานจ่ายเงิน",
    permissionDescription:
      "เอกสารจ่ายเงินและยอดตามช่องทางจาก SML มีข้อมูลผู้รับเงินและหมายเหตุ",
    sensitive: true,
    capabilities: {
      lineCard: true,
      signedViewer: true,
      pdf: false,
      businessSignals: false,
    },
  },
} satisfies { [K in ReportKey]: ReportCatalogEntryFor<K> };

export type ReportCatalogEntry = (typeof reportCatalog)[ReportKey];

export const reportPresetKeyValues = [
  "executive_full",
  "executive_focus",
  "sales_profit",
  "inventory",
  "finance_ar",
] as const;

export type ReportPresetKey = (typeof reportPresetKeyValues)[number];

export type ReportPresetCatalogEntry = {
  key: ReportPresetKey;
  label: string;
  description: string;
  reportKeys: ReportKey[];
};

export const reportPresetCatalog = {
  executive_full: {
    key: "executive_full",
    label: "ผู้บริหารครบ 10 รายงาน",
    description: "ส่งรายงานครบทุกใบ เหมาะกับผู้บริหารที่ต้องการเห็นตัวเลขครบทุกเช้า",
    reportKeys: [...reportKeyValues],
  },
  executive_focus: {
    key: "executive_focus",
    label: "ผู้บริหารเน้นภาพรวม",
    description: "ยอดขาย กำไรสินค้า สต็อก และรับชำระหนี้",
    reportKeys: [
      "sales_goods_services",
      "gross_profit_by_product",
      "stock_balance",
      "ar_debt_receipt",
    ],
  },
  sales_profit: {
    key: "sales_profit",
    label: "ขายและกำไร",
    description: "ยอดขาย กำไรตามสินค้า และกำไรตามลูกหนี้",
    reportKeys: [
      "sales_goods_services",
      "gross_profit_by_product",
      "gross_profit_by_ar_customer",
    ],
  },
  inventory: {
    key: "inventory",
    label: "คลังสินค้า",
    description: "สต็อกคงเหลือ สินค้าถึงจุดสั่งซื้อ และซื้อ/ตั้งหนี้",
    reportKeys: [
      "stock_balance",
      "stock_reorder",
      "purchase_goods_payables",
    ],
  },
  finance_ar: {
    key: "finance_ar",
    label: "การเงินลูกหนี้",
    description: "ซื้อ/ตั้งหนี้ เคลื่อนไหวลูกหนี้ และรับชำระหนี้",
    reportKeys: [
      "purchase_goods_payables",
      "ar_customer_movement",
      "ar_debt_receipt",
    ],
  },
} satisfies Record<ReportPresetKey, ReportPresetCatalogEntry>;

export function getReportPresetEntry(
  presetKey: ReportPresetKey,
): (typeof reportPresetCatalog)[ReportPresetKey] {
  return reportPresetCatalog[presetKey];
}

export function matchReportPreset(reportKeys: ReportKey[]): ReportPresetKey | null {
  const normalized = normalizeReportKeySet(reportKeys);
  for (const presetKey of reportPresetKeyValues) {
    if (
      sameReportKeyOrder(
        normalized,
        normalizeReportKeySet(reportPresetCatalog[presetKey].reportKeys),
      )
    ) {
      return presetKey;
    }
  }
  return null;
}

function normalizeReportKeySet(reportKeys: ReportKey[]) {
  const order = new Map<ReportKey, number>(
    reportKeyValues.map((reportKey, index) => [reportKey, index]),
  );
  return [...new Set(reportKeys)].sort(
    (left, right) => (order.get(left) ?? 999) - (order.get(right) ?? 999),
  );
}

function sameReportKeyOrder(left: ReportKey[], right: ReportKey[]) {
  return (
    left.length === right.length &&
    left.every((reportKey, index) => reportKey === right[index])
  );
}

export function isReportKey(value: string | null | undefined): value is ReportKey {
  return reportKeySchema.safeParse(value).success;
}

export function getReportCatalogEntry<K extends ReportKey>(
  reportKey: K,
): (typeof reportCatalog)[K] {
  return reportCatalog[reportKey];
}

export type Tenant = {
  id: TenantId;
  name: string;
  databaseName: string;
  description: string;
  datasourceConfigured: boolean;
  status: TenantStatus;
  planCode: PlanCode;
  featureFlags?: TenantFeatureFlags;
  businessSignalThresholds?: BusinessSignalThresholdsConfig;
  suspendedReason: string | null;
  currentPeriodEnd: string | null;
};

export type SubscriptionRecord = {
  tenant_id: TenantId;
  plan_code: PlanCode;
  status: TenantStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  suspended_reason: string | null;
  updated_at: string;
};

export type UserRecord = {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  tenant_id: TenantId | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type ReportRunStatus = "queued" | "success" | "failed" | "running";

export type ReportExecutionStrategy = "direct" | "chunked";

export type ReportRunProgressStage =
  | "queued"
  | "claimed"
  | "preflight"
  | "running_chunk"
  | "summarizing"
  | "completed"
  | "failed";

export type ReportRunChunkStatus = "queued" | "running" | "success" | "failed";

export type SalesHeaderRow = {
  rownum: number;
  doc_date: string;
  doc_no: string;
  doc_time: string | null;
  doc_ref_date?: string | null;
  doc_ref: string | null;
  cust_code: string | null;
  cust_name: string | null;
  branch_code: string | null;
  total_value: number;
  total_discount: number;
  total_except_discount: number;
  total_except_vat: number;
  vat_rate: number;
  total_vat_value: number;
  vat_type: string | null;
  total_amount: number;
  cashier_code: string | null;
  last_status?: string | null;
};

export type SalesDetailRow = {
  doc_date: string;
  doc_no: string;
  doc_time: string | null;
  cust_code: string | null;
  cust_name: string | null;
  branch_code: string;
  item_code: string | null;
  barcode?: string | null;
  item_name: string | null;
  wh_code: string | null;
  shelf_code: string | null;
  unit_code: string | null;
  unit_name?: string | null;
  qty: number;
  price: number;
  discount: string | null;
  discount_amount: number;
  sum_amount: number;
  vat_type: string | null;
  tax_type?: string | null;
  ref_row?: number | null;
  temp_float_1?: number | null;
  temp_float_2?: number | null;
  line_number?: number | null;
};

export type SalesDocumentDetail = {
  tenant_id: TenantId;
  report_key: ReportKey;
  params: SalesGoodsServicesParams;
  document: SalesHeaderRow;
  lines: SalesDetailRow[];
};

export type SalesDocumentListItem = SalesHeaderRow & {
  detail_line_count: number;
  detail_total_amount: number;
  detail_total_qty: number;
  resolved_branch_code: string;
  resolved_branch_label?: string;
  resolved_branch_name?: string;
  resolved_branch_note?: string;
};

export type SalesDocumentPage = {
  tenant_id: TenantId;
  report_key: ReportKey;
  params: SalesGoodsServicesParams;
  documents: SalesDocumentListItem[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
    search: string | null;
  };
};

export type BranchSales = {
  branch_code: string;
  branch_label?: string;
  branch_name?: string;
  branch_note?: string;
  total_amount: number;
  document_count: number;
  line_count: number;
};

export type BranchMeaning = {
  code: string;
  label: string;
  name: string;
  note: string;
  is_unmapped: boolean;
};

export type SmlBranchRecord = {
  code: string;
  name_1: string;
};

export type SalesFinancialBreakdown = {
  gross_sales: number;
  total_discount: number;
  after_discount_amount: number;
  before_vat_amount: number;
  vat_amount: number;
  net_sales: number;
  discount_percent: number | null;
  vat_rate: number | null;
  document_count_with_discount: number;
};

export type TopProduct = {
  item_code: string;
  item_name: string;
  qty: number;
  sum_amount: number;
  line_count: number;
};

export type TopSupplier = {
  supplier_code: string;
  supplier_name: string;
  total_amount: number;
  document_count: number;
};

export type ReconciliationSummary = {
  header_total_amount: number;
  detail_sum_amount: number;
  difference_amount: number;
  status: DataQualityStatus;
  note: string;
};

export type SalesComparisonPoint = {
  label: "previous_day" | "same_weekday_last_week";
  date_from: string;
  date_to: string;
  total_sales: number;
  document_count: number;
  difference_amount: number;
  difference_percent: number | null;
  direction: "up" | "down" | "flat" | "no_reference";
};

export type SalesGoodsServicesSnapshot = {
  tenant_id: TenantId;
  report_key: "sales_goods_services";
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: "sml_postgres" | "sml_javaws" | "sample_snapshot";
  quality_status: DataQualityStatus;
  summary: {
    total_sales: number;
    document_count: number;
    line_count: number;
    total_qty: number;
    top_product_name: string | null;
  };
  financial_breakdown?: SalesFinancialBreakdown;
  branch_sales: BranchSales[];
  top_products: TopProduct[];
  documents: SalesHeaderRow[];
  lines: SalesDetailRow[];
  reconciliation: ReconciliationSummary;
  comparison?: {
    previous_day: SalesComparisonPoint | null;
    same_weekday_last_week: SalesComparisonPoint | null;
  };
  line_template: {
    title: string;
    body: string[];
  };
};

export type PurchaseGoodsPayablesSnapshot = {
  tenant_id: TenantId;
  report_key: "purchase_goods_payables";
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: "sml_postgres" | "sml_javaws" | "sample_snapshot";
  quality_status: DataQualityStatus;
  summary: {
    total_purchase: number;
    document_count: number;
    line_count: number;
    total_qty: number;
    top_supplier_name: string | null;
    top_product_name: string | null;
  };
  financial_breakdown?: SalesFinancialBreakdown;
  top_suppliers: TopSupplier[];
  branch_purchases: BranchSales[];
  top_products: TopProduct[];
  documents: SalesHeaderRow[];
  lines: SalesDetailRow[];
  reconciliation: ReconciliationSummary;
  line_template: {
    title: string;
    body: string[];
  };
};

export type GrossProfitReportKey =
  | "gross_profit_by_product"
  | "gross_profit_by_ar_customer";

export type GrossProfitBaseRow = {
  qty_sale: number;
  amount_sale: number;
  cost_sale: number;
  qty_sale_return: number;
  amount_sale_return: number;
  cost_sale_return: number;
  net_qty: number;
  net_amount: number;
  net_cost: number;
  gross_profit: number;
  gross_margin_percent: number | null;
};

export type GrossProfitByProductRow = GrossProfitBaseRow & {
  code: string;
  name_1: string;
  unit_name: string;
};

export type GrossProfitByArCustomerRow = GrossProfitBaseRow & {
  ar_code: string;
  ar_detail: string;
};

export type GrossProfitSummary = {
  row_count: number;
  document_count: number;
  line_count: number;
  total_qty: number;
  total_sales: number;
  total_returns: number;
  net_amount: number;
  net_cost: number;
  gross_profit: number;
  gross_margin_percent: number | null;
  negative_gross_profit_count: number;
  top_gross_profit_name: string | null;
};

export type GrossProfitByProductSnapshot = {
  tenant_id: TenantId;
  report_key: "gross_profit_by_product";
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: "sml_postgres" | "sml_javaws" | "sample_snapshot";
  quality_status: DataQualityStatus;
  summary: GrossProfitSummary;
  rows: GrossProfitByProductRow[];
  top_rows: GrossProfitByProductRow[];
  negative_rows: GrossProfitByProductRow[];
  line_template: {
    title: string;
    body: string[];
  };
};

export type GrossProfitByArCustomerSnapshot = {
  tenant_id: TenantId;
  report_key: "gross_profit_by_ar_customer";
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: "sml_postgres" | "sml_javaws" | "sample_snapshot";
  quality_status: DataQualityStatus;
  summary: GrossProfitSummary;
  rows: GrossProfitByArCustomerRow[];
  top_rows: GrossProfitByArCustomerRow[];
  negative_rows: GrossProfitByArCustomerRow[];
  line_template: {
    title: string;
    body: string[];
  };
};

export type StockBalanceRow = {
  ic_code: string;
  ic_name: string;
  ic_unit_code: string;
  balance_qty: number;
  average_cost: number;
  average_cost_end: number;
  balance_amount: number;
  qty_in: number;
  amount_in: number;
  average_cost_in: number;
  qty_out: number;
  amount_out: number;
  average_cost_out: number;
};

export type StockBalanceSummary = {
  sku_count: number;
  stock_value: number;
  balance_qty: number;
  qty_in: number;
  amount_in: number;
  qty_out: number;
  amount_out: number;
  negative_stock_count: number;
  zero_or_missing_cost_count: number;
  top_stock_item_name: string | null;
};

export type StockBalanceSnapshot = {
  tenant_id: TenantId;
  report_key: "stock_balance";
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: "sml_postgres" | "sml_javaws" | "sample_snapshot";
  quality_status: DataQualityStatus;
  summary: StockBalanceSummary;
  top_items_by_value: StockBalanceRow[];
  negative_items: StockBalanceRow[];
  line_template: {
    title: string;
    body: string[];
  };
};

export type StockReorderStatus = "out_of_stock" | "low_stock";

export type StockReorderRow = {
  ic_code: string;
  ic_name: string;
  ic_unit_code: string;
  balance_qty: number;
  purchase_point: number;
  purchase_balance_qty: number;
  shortage_qty: number;
  status: StockReorderStatus;
};

export type StockReorderSummary = {
  reorder_count: number;
  out_of_stock_count: number;
  low_stock_count: number;
  purchase_balance_qty_total: number;
  shortage_qty_total: number;
  top_reorder_item_name: string | null;
};

export type StockReorderSnapshot = {
  tenant_id: TenantId;
  report_key: "stock_reorder";
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: "sml_postgres" | "sml_javaws" | "sample_snapshot";
  quality_status: DataQualityStatus;
  source_basis: "latest_inventory_balance";
  summary: StockReorderSummary;
  top_items: StockReorderRow[];
  line_template: {
    title: string;
    body: string[];
  };
};

export type ArCustomerMovementType =
  | "ar_increase"
  | "ar_decrease"
  | "receipt";

export type ArCustomerMovementRow = {
  roworder: number | null;
  doc_sort: number;
  movement_type: ArCustomerMovementType;
  cust_code: string;
  cust_name: string;
  doc_type: number;
  doc_date: string;
  doc_no: string;
  tax_doc_no: string;
  doc_ref: string;
  credit_day: number;
  amount: number;
};

export type ArCustomerMovementCustomerSummary = {
  cust_code: string;
  cust_name: string;
  document_count: number;
  ar_increase_amount: number;
  ar_decrease_amount: number;
  receipt_amount: number;
  net_movement_amount: number;
};

export type ArCustomerMovementSummary = {
  document_count: number;
  customer_count: number;
  ar_increase_amount: number;
  ar_decrease_amount: number;
  receipt_amount: number;
  net_movement_amount: number;
  top_customer_name: string | null;
};

export type ArCustomerMovementSnapshot = {
  tenant_id: TenantId;
  report_key: "ar_customer_movement";
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: "sml_postgres" | "sml_javaws" | "sample_snapshot";
  quality_status: DataQualityStatus;
  source_basis: "ar_movement_as_of_date";
  summary: ArCustomerMovementSummary;
  top_customers: ArCustomerMovementCustomerSummary[];
  top_documents: ArCustomerMovementRow[];
  line_template: {
    title: string;
    body: string[];
  };
};

export type ArDebtReceiptPaymentStatus =
  | "matched"
  | "missing_payment_split"
  | "mismatched_payment_split";

export type ArDebtReceiptRow = {
  doc_date: string;
  doc_no: string;
  billing_date: string | null;
  cust_code: string;
  cust_name: string;
  cash_amount: number;
  transfer_amount: number;
  total_received_amount: number;
  payment_split_amount: number;
  payment_difference_amount: number;
  payment_status: ArDebtReceiptPaymentStatus;
};

export type ArDebtReceiptCustomerSummary = {
  cust_code: string;
  cust_name: string;
  receipt_count: number;
  cash_amount: number;
  transfer_amount: number;
  total_received_amount: number;
  unmatched_payment_count: number;
};

export type ArDebtReceiptSummary = {
  receipt_count: number;
  customer_count: number;
  total_received_amount: number;
  cash_amount: number;
  transfer_amount: number;
  unmatched_payment_count: number;
  top_customer_name: string | null;
};

export type ArDebtReceiptSnapshot = {
  tenant_id: TenantId;
  report_key: "ar_debt_receipt";
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: "sml_postgres" | "sml_javaws" | "sample_snapshot";
  quality_status: DataQualityStatus;
  source_basis: "ar_debt_receipt_doc_date";
  summary: ArDebtReceiptSummary;
  top_customers: ArDebtReceiptCustomerSummary[];
  top_receipts: ArDebtReceiptRow[];
  data_quality_notes: string[];
  line_template: {
    title: string;
    body: string[];
  };
};

export type CashBankReportKey = "cash_bank_receipts" | "cash_bank_payments";
export type CashBankDirection = "receipt" | "payment";
export type CashBankChannelKey =
  | "cash"
  | "card"
  | "cheque"
  | "transfer"
  | "income"
  | "coupon"
  | "petty_cash"
  | "unallocated";
export type CashBankDocumentStatus =
  | "matched"
  | "unallocated_amount"
  | "channel_over_total";
export type CashBankSourceBasis =
  | "cash_bank_receipts_doc_date"
  | "cash_bank_payments_doc_date";

export type CashBankDocumentRow = {
  doc_date: string;
  doc_no: string;
  doc_time: string | null;
  trans_flag_code: number | null;
  trans_flag_label: string;
  ap_ar_code: string;
  ap_ar_name: string;
  cash_amount: number;
  card_amount: number;
  chq_amount: number;
  transfer_amount: number;
  total_income_amount: number;
  coupon_amount: number;
  petty_cash_amount: number;
  total_amount: number;
  channel_total_amount: number;
  unallocated_amount: number;
  channel_status: CashBankDocumentStatus;
};

export type CashBankChannelSummary = {
  channel_key: CashBankChannelKey;
  label: string;
  amount: number;
  document_count: number;
};

export type CashBankTransFlagSummary = {
  trans_flag_code: number | null;
  trans_flag_label: string;
  document_count: number;
  total_amount: number;
  cash_amount: number;
  card_amount: number;
  chq_amount: number;
  transfer_amount: number;
  total_income_amount: number;
  coupon_amount: number;
  petty_cash_amount: number;
  channel_total_amount: number;
  unallocated_amount: number;
  mismatch_document_count: number;
};

export type CashBankSummary = {
  document_count: number;
  party_count: number;
  total_amount: number;
  cash_amount: number;
  card_amount: number;
  chq_amount: number;
  transfer_amount: number;
  total_income_amount: number;
  coupon_amount: number;
  petty_cash_amount: number;
  channel_total_amount: number;
  unallocated_amount: number;
  mismatch_document_count: number;
  top_party_name: string | null;
  first_doc_time: string | null;
  last_doc_time: string | null;
};

export type CashBankSnapshot = {
  tenant_id: TenantId;
  report_key: CashBankReportKey;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: "sml_postgres" | "sml_javaws" | "sample_snapshot";
  quality_status: DataQualityStatus;
  source_basis: CashBankSourceBasis;
  direction: CashBankDirection;
  summary: CashBankSummary;
  channel_summary: CashBankChannelSummary[];
  trans_flag_summary: CashBankTransFlagSummary[];
  top_documents: CashBankDocumentRow[];
  mismatch_documents: CashBankDocumentRow[];
  data_quality_notes: string[];
  line_template: {
    title: string;
    body: string[];
  };
};

export type ReportSnapshot =
  | SalesGoodsServicesSnapshot
  | PurchaseGoodsPayablesSnapshot
  | GrossProfitByProductSnapshot
  | GrossProfitByArCustomerSnapshot
  | StockBalanceSnapshot
  | StockReorderSnapshot
  | ArCustomerMovementSnapshot
  | ArDebtReceiptSnapshot
  | CashBankSnapshot;

export const businessSignalSeveritySchema = z.enum([
  "info",
  "warning",
  "critical",
]);

export const businessSignalCategorySchema = z.enum([
  "sales",
  "profit",
  "purchase",
  "stock",
  "ar",
  "data_quality",
]);

export const businessSignalStatusSchema = z.enum([
  "open",
  "acknowledged",
  "resolved",
  "dismissed",
]);

export const businessSignalEvidenceSchema = z.record(z.string(), z.unknown());

export type BusinessSignalSeverity = z.infer<
  typeof businessSignalSeveritySchema
>;
export type BusinessSignalCategory = z.infer<
  typeof businessSignalCategorySchema
>;
export type BusinessSignalStatus = z.infer<typeof businessSignalStatusSchema>;

export type BusinessSignalRecord = {
  id: string;
  tenant_id: TenantId;
  signal_key: string;
  category: BusinessSignalCategory;
  severity: BusinessSignalSeverity;
  title: string;
  insight: string;
  recommended_action: string;
  amount_impact: number | null;
  source_report_key: ReportKey;
  source_run_id: string;
  period_from: string;
  period_to: string;
  dimension_type: string;
  dimension_id: string;
  rule_version: string;
  status: BusinessSignalStatus;
  evidence_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export function getSmlBranchMeaning(
  branchCode: string | null | undefined,
  branchName?: string | null,
): BranchMeaning {
  const code = branchCode?.trim() || "no_branch";
  const mappedName = branchName?.trim();

  if (code === "no_branch") {
    return {
      code,
      label: "ไม่ระบุสาขา",
      name: "ไม่ระบุสาขา",
      note: "ไม่พบรหัสสาขาตามกฎสาขาของรายงาน",
      is_unmapped: true,
    };
  }

  if (mappedName) {
    return {
      code,
      label: mappedName,
      name: mappedName,
      note: `ชื่อสาขาจาก erp_branch_list (${code})`,
      is_unmapped: false,
    };
  }

  if (["0", "00", "000", "0000"].includes(code)) {
    return {
      code,
      label: `สาขาหลัก (${code})`,
      name: "สาขาหลัก",
      note: "ตีความจากรหัสสาขา SML ยังไม่ได้ map เป็นชื่อสาขาจริง",
      is_unmapped: true,
    };
  }

  return {
    code,
    label: `สาขา ${code}`,
    name: `สาขา ${code}`,
    note: "รหัสสาขาจาก SML ยังไม่ได้ map เป็นชื่อสาขาจริง",
    is_unmapped: true,
  };
}

export function formatSmlBranchLabel(
  branchCode: string | null | undefined,
  branchName?: string | null,
): string {
  return getSmlBranchMeaning(branchCode, branchName).label;
}

export type LineFlexMessage = {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
};

export type LineMessageType = "text" | "flex";

export const lineAccessProfileKeySchema = z.enum([
  "executive",
  "sales_manager",
  "operations",
  "staff",
]);

export const allowedLineActionSchema = z.enum([
  "receive_morning_brief",
  "ask_report",
  "open_signed_viewer",
]);

export type LineAccessProfileKey = z.infer<
  typeof lineAccessProfileKeySchema
>;
export type AllowedLineAction = z.infer<typeof allowedLineActionSchema>;
export type LineTargetType = "user" | "group" | "room";
export type LineTargetSource = "env_fallback" | "webhook" | "manual";
export type LineChannelScope = "tenant" | "owner_shared";

export type LineChannelRecord = {
  id: string;
  tenant_id: TenantId;
  display_name: string;
  channel_type: "line_oa";
  scope?: LineChannelScope;
  channel_access_token_configured: boolean;
  channel_secret_configured: boolean;
  enabled: boolean;
  source: "env" | "manual";
  created_at: string;
  updated_at: string;
};

export type LineTargetRecord = {
  id: string;
  tenant_id: TenantId;
  line_channel_id: string | null;
  display_name: string;
  target_type: LineTargetType;
  target_id_masked: string;
  target_id_hash: string;
  recipient_count_estimate?: number | null;
  access_profile_key: LineAccessProfileKey;
  allowed_report_keys: ReportKey[];
  allowed_actions: AllowedLineAction[];
  enabled: boolean;
  approved: boolean;
  source: LineTargetSource;
  last_delivery_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LineRecipientRecord = {
  id: string;
  source_target_id: string;
  source_tenant_id: TenantId;
  source_tenant_name: string;
  display_name: string;
  target_type: LineTargetType;
  target_id_masked: string;
  target_id_hash: string;
  line_channel_id: string | null;
  line_channel_display_name: string | null;
  line_channel_scope: LineChannelScope | null;
  line_channel_token_configured: boolean;
  assigned_tenant_ids: TenantId[];
  assignment_count: number;
  source: LineTargetSource;
  last_delivery_at: string | null;
  created_at: string;
  updated_at: string;
};

export const tenantReportRolePermissionSchema = z.object({
  access_profile_key: lineAccessProfileKeySchema,
  allowed_report_keys: z.array(reportKeySchema).max(50),
});

export const tenantReportRolePermissionsPayloadSchema = z.object({
  permissions: z
    .array(tenantReportRolePermissionSchema)
    .min(1)
    .max(lineAccessProfileKeySchema.options.length),
});

export type TenantReportRolePermission = z.infer<
  typeof tenantReportRolePermissionSchema
>;

export type TenantReportRolePermissionsPayload = z.infer<
  typeof tenantReportRolePermissionsPayloadSchema
>;

export type TenantReportRolePermissionRecord =
  TenantReportRolePermission & {
    tenant_id: TenantId;
    updated_at: string;
  };

export type LinePermissionDenyReason =
  | "target_not_found"
  | "tenant_mismatch"
  | "target_not_approved"
  | "target_disabled"
  | "action_not_allowed"
  | "report_not_allowed";

export type LinePermissionDecision =
  | {
      allowed: true;
      reason: "allowed";
      message: string;
    }
  | {
      allowed: false;
      reason: LinePermissionDenyReason;
      message: string;
    };

export type SalesGoodsServicesLinePreview = {
  tenant_id: TenantId;
  report_key: "sales_goods_services";
  run_id: string;
  generated_at: string;
  source: SalesGoodsServicesSnapshot["source"];
  line_message_type: LineMessageType;
  title: string;
  text: string;
  lines: string[];
  flex_message?: LineFlexMessage;
  warnings: string[];
  dashboard_url: string | null;
};

export type PurchaseGoodsPayablesLinePreview = {
  tenant_id: TenantId;
  report_key: "purchase_goods_payables";
  run_id: string;
  generated_at: string;
  source: PurchaseGoodsPayablesSnapshot["source"];
  line_message_type: LineMessageType;
  title: string;
  text: string;
  lines: string[];
  flex_message?: LineFlexMessage;
  warnings: string[];
  dashboard_url: string | null;
};

export type GrossProfitLinePreview = {
  tenant_id: TenantId;
  report_key: GrossProfitReportKey;
  run_id: string;
  generated_at: string;
  source: GrossProfitByProductSnapshot["source"];
  line_message_type: LineMessageType;
  title: string;
  text: string;
  lines: string[];
  flex_message?: LineFlexMessage;
  warnings: string[];
  dashboard_url: string | null;
};

export type StockBalanceLinePreview = {
  tenant_id: TenantId;
  report_key: "stock_balance";
  run_id: string;
  generated_at: string;
  source: StockBalanceSnapshot["source"];
  line_message_type: LineMessageType;
  title: string;
  text: string;
  lines: string[];
  flex_message?: LineFlexMessage;
  warnings: string[];
  dashboard_url: string | null;
};

export type StockReorderLinePreview = {
  tenant_id: TenantId;
  report_key: "stock_reorder";
  run_id: string;
  generated_at: string;
  source: StockReorderSnapshot["source"];
  line_message_type: LineMessageType;
  title: string;
  text: string;
  lines: string[];
  flex_message?: LineFlexMessage;
  warnings: string[];
  dashboard_url: string | null;
};

export type ArCustomerMovementLinePreview = {
  tenant_id: TenantId;
  report_key: "ar_customer_movement";
  run_id: string;
  generated_at: string;
  source: ArCustomerMovementSnapshot["source"];
  line_message_type: LineMessageType;
  title: string;
  text: string;
  lines: string[];
  flex_message?: LineFlexMessage;
  warnings: string[];
  dashboard_url: string | null;
};

export type ArDebtReceiptLinePreview = {
  tenant_id: TenantId;
  report_key: "ar_debt_receipt";
  run_id: string;
  generated_at: string;
  source: ArDebtReceiptSnapshot["source"];
  line_message_type: LineMessageType;
  title: string;
  text: string;
  lines: string[];
  flex_message?: LineFlexMessage;
  warnings: string[];
  dashboard_url: string | null;
};

export type CashBankLinePreview = {
  tenant_id: TenantId;
  report_key: CashBankReportKey;
  run_id: string;
  generated_at: string;
  source: CashBankSnapshot["source"];
  line_message_type: LineMessageType;
  title: string;
  text: string;
  lines: string[];
  flex_message?: LineFlexMessage;
  warnings: string[];
  dashboard_url: string | null;
};

export type DegradedReportLinePreview = {
  tenant_id: TenantId;
  report_key: ReportKey;
  run_id: string;
  generated_at: string;
  source: "degraded_notice";
  line_message_type: LineMessageType;
  title: string;
  text: string;
  lines: string[];
  flex_message?: LineFlexMessage;
  warnings: string[];
  dashboard_url: null;
  degraded: true;
  degraded_reason: string;
};

export type OperationalIncidentLinePreview = {
  tenant_id: TenantId;
  report_key: ReportKey;
  run_id: string;
  generated_at: string;
  source: "operational_incident";
  line_message_type: LineMessageType;
  title: string;
  text: string;
  lines: string[];
  flex_message?: LineFlexMessage;
  warnings: string[];
  dashboard_url: null;
  incident: true;
  failure_kind: string;
};

export type ReportLinePreview =
  | SalesGoodsServicesLinePreview
  | PurchaseGoodsPayablesLinePreview
  | GrossProfitLinePreview
  | StockBalanceLinePreview
  | StockReorderLinePreview
  | ArCustomerMovementLinePreview
  | ArDebtReceiptLinePreview
  | CashBankLinePreview
  | DegradedReportLinePreview
  | OperationalIncidentLinePreview;

export type LineDeliveryStatus =
  | "dry_run"
  | "success"
  | "failed"
  | "skipped";

export type LineDeliveryRecord = {
  id: string;
  tenant_id: TenantId;
  report_key: ReportKey;
  report_run_id: string;
  delivery_key: string | null;
  delivery_type: "manual_test" | "morning_brief" | "notification_rule";
  period_from: string | null;
  period_to: string | null;
  target_id_masked: string | null;
  message_type: LineMessageType;
  status: LineDeliveryStatus;
  sent_at: string | null;
  provider_response_json: Record<string, unknown> | null;
  safe_error_message: string | null;
  created_at: string;
};

export type LineSendMode = "dry_run" | "send";

export const BANGKOK_TIME_ZONE = "Asia/Bangkok";

export const lineSendRequestSchema = z.object({
  mode: z.enum(["dry_run", "send"]).default("dry_run"),
});

export type LineSendRequest = z.infer<typeof lineSendRequestSchema>;

export const morningBriefRequestSchema = z.object({
  period: z.literal("yesterday").default("yesterday"),
  mode: z.enum(["dry_run", "send"]).default("send"),
  force: z.boolean().default(false),
});

export type MorningBriefRequest = z.infer<typeof morningBriefRequestSchema>;

export function deriveMorningBriefDateRange(input?: {
  period?: MorningBriefRequest["period"];
  now?: Date;
  timeZone?: string;
}): SalesGoodsServicesParams {
  const period = input?.period ?? "yesterday";
  if (period !== "yesterday") {
    throw new Error(`Unsupported morning brief period: ${period}`);
  }

  const currentYmd = formatDateInTimeZone(
    input?.now ?? new Date(),
    input?.timeZone ?? BANGKOK_TIME_ZONE,
  );
  const yesterday = addDays(currentYmd, -1);
  return {
    date_from: yesterday,
    date_to: yesterday,
  };
}

export function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export type LineSendResult = {
  delivery: LineDeliveryRecord;
  preview: ReportLinePreview;
  configured: boolean;
  mode: LineSendMode;
};

export const notificationPeriodPresetSchema = z.enum([
  "yesterday",
  "today_so_far",
  "last_7_days",
]);

export const notificationPeriodStrategySchema = z.enum([
  "same_period_all_runs",
  "executive_checkpoints",
]);

export const notificationRuleRunStatusSchema = z.enum([
  "queued",
  "running",
  "success",
  "success_with_warnings",
  "failed",
  "skipped",
]);

export const notificationRuleRunSourceSchema = z.enum([
  "worker_due",
  "worker_retry",
  "manual_test",
  "manual_run_now",
]);

export const notificationRunProgressStageSchema = z.enum([
  "queued",
  "claimed",
  "running_report",
  "waiting_chunked_report",
  "preparing_line",
  "sending_line",
  "completed",
  "failed",
]);

export const notificationDigestModeSchema = z.enum([
  "action_only",
  "all_reports",
]);

export const notificationScheduleEntrySchema = z.object({
  weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7),
  times: z
    .array(localTimeSchema)
    .min(1)
    .max(12),
});

export const notificationRulePayloadSchema = z.object({
  tenant_id: tenantIdSchema,
  name: z.string().trim().min(2).max(120),
  enabled: z.boolean().default(true),
  timezone: z.string().trim().min(1).max(80).default(BANGKOK_TIME_ZONE),
  period_preset: notificationPeriodPresetSchema.default("yesterday"),
  period_strategy: notificationPeriodStrategySchema.default("executive_checkpoints"),
  schedule: z.array(notificationScheduleEntrySchema).min(1).max(7),
  report_keys: z.array(reportKeySchema).min(1).max(8),
  target_ids: z.array(z.string().trim().min(1).max(180)).max(50).default([]),
  digest_mode: notificationDigestModeSchema.default("action_only"),
});

export type NotificationPeriodPreset = z.infer<
  typeof notificationPeriodPresetSchema
>;
export type NotificationPeriodStrategy = z.infer<
  typeof notificationPeriodStrategySchema
>;
export type NotificationRuleRunStatus = z.infer<
  typeof notificationRuleRunStatusSchema
>;
export type NotificationRuleRunSource = z.infer<
  typeof notificationRuleRunSourceSchema
>;
export type NotificationRunProgressStage = z.infer<
  typeof notificationRunProgressStageSchema
>;
export type NotificationReportResultStatus =
  | "success"
  | "success_with_warning"
  | "failed";
export type NotificationReportFreshness =
  | "fresh"
  | "reference"
  | "unavailable";
export type NotificationReportResult = {
  report_key: ReportKey;
  status: NotificationReportResultStatus;
  freshness: NotificationReportFreshness;
  run_id: string | null;
  snapshot_generated_at: string | null;
  duration_ms: number | null;
  row_count: number | null;
  degraded_reason: string | null;
};
export type NotificationDigestMode = z.infer<
  typeof notificationDigestModeSchema
>;
export type NotificationScheduleEntry = z.infer<
  typeof notificationScheduleEntrySchema
>;
export type NotificationRulePayload = z.infer<
  typeof notificationRulePayloadSchema
>;

export type NotificationMessagePackaging = "digest";

export type NotificationRetryPolicy = {
  max_attempts: number;
  retry_delay_minutes: number;
};

export type NotificationRuleRecord = NotificationRulePayload & {
  id: string;
  message_packaging: NotificationMessagePackaging;
  retry_policy: NotificationRetryPolicy;
  last_run_at: string | null;
  last_run_status: NotificationRuleRunStatus | null;
  last_safe_error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type NotificationRuleRunRecord = {
  id: string;
  rule_id: string;
  tenant_id: TenantId;
  scheduled_local_date: string;
  scheduled_local_time: string;
  timezone: string;
  period_from: string;
  period_to: string;
  period_from_time: string | null;
  period_to_time: string | null;
  period_strategy: NotificationPeriodStrategy;
  unknown_doc_time_count: number;
  status: NotificationRuleRunStatus;
  mode: LineSendMode;
  source: NotificationRuleRunSource;
  attempt: number;
  idempotency_key: string;
  report_run_ids: string[];
  report_results: NotificationReportResult[] | null;
  delivery_ids: string[];
  safe_error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  queued_at: string | null;
  claimed_at: string | null;
  worker_id: string | null;
  client_request_id: string | null;
  next_retry_at: string | null;
  progress_stage: NotificationRunProgressStage | null;
  progress_percent: number | null;
  progress_current_report_key: ReportKey | null;
  progress_done_reports: number | null;
  progress_total_reports: number | null;
  progress_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export function deriveNotificationPeriodRange(input: {
  periodPreset: NotificationPeriodPreset;
  periodStrategy?: NotificationPeriodStrategy;
  scheduledLocalDate?: string;
  scheduledLocalTime?: string;
  now?: Date;
  timeZone?: string;
}): SalesGoodsServicesParams {
  const timeZone = input.timeZone ?? BANGKOK_TIME_ZONE;
  const zoned =
    input.scheduledLocalDate && input.scheduledLocalTime
      ? { date: input.scheduledLocalDate, time: input.scheduledLocalTime }
      : getZonedDateTimeParts({
          now: input.now ?? new Date(),
          timeZone,
        });
  const currentYmd = zoned.date;

  if (input.periodStrategy === "executive_checkpoints") {
    if (zoned.time < "12:00") {
      const yesterday = addDays(currentYmd, -1);
      return {
        date_from: yesterday,
        date_to: yesterday,
        time_from: "00:00",
        time_to: "23:59",
      };
    }

    return {
      date_from: currentYmd,
      date_to: currentYmd,
      time_from: "00:00",
      time_to: zoned.time,
    };
  }

  if (input.periodPreset === "today_so_far") {
    return { date_from: currentYmd, date_to: currentYmd };
  }

  if (input.periodPreset === "last_7_days") {
    return { date_from: addDays(currentYmd, -6), date_to: currentYmd };
  }

  const yesterday = addDays(currentYmd, -1);
  return { date_from: yesterday, date_to: yesterday };
}

export function getZonedDateTimeParts(input: { now: Date; timeZone: string }) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(input.now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;

  return {
    date,
    time: `${values.hour}:${values.minute}`,
    isoWeekday: isoWeekdayFromYmd(date),
  };
}

export function isNotificationRuleDue(input: {
  rule: Pick<NotificationRuleRecord, "enabled" | "schedule" | "timezone">;
  now: Date;
}) {
  return (
    getDueNotificationRuleTimes({
      rule: input.rule,
      now: input.now,
      catchUpMinutes: 0,
    })[0] ?? null
  );
}

export function getDueNotificationRuleTimes(input: {
  rule: Pick<NotificationRuleRecord, "enabled" | "schedule" | "timezone">;
  now: Date;
  catchUpMinutes?: number;
}) {
  if (!input.rule.enabled) {
    return [];
  }

  const timeZone = input.rule.timezone || BANGKOK_TIME_ZONE;
  const catchUpMinutes = Math.max(0, Math.floor(input.catchUpMinutes ?? 0));
  const dueByKey = new Map<
    string,
    { date: string; time: string; isoWeekday: number }
  >();

  for (let minuteOffset = catchUpMinutes; minuteOffset >= 0; minuteOffset -= 1) {
    const candidate = new Date(input.now.getTime() - minuteOffset * 60_000);
    const zoned = getZonedDateTimeParts({ now: candidate, timeZone });
    const due = input.rule.schedule.some(
      (entry) =>
        entry.weekdays.includes(zoned.isoWeekday) &&
        entry.times.includes(zoned.time),
    );
    if (due) {
      dueByKey.set(`${zoned.date}T${zoned.time}`, zoned);
    }
  }

  return [...dueByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

export function buildNotificationIdempotencyKey(input: {
  ruleId: string;
  scheduledLocalDate: string;
  scheduledLocalTime: string;
  attempt?: number;
}) {
  return [
    "notification_rule",
    input.ruleId,
    input.scheduledLocalDate,
    input.scheduledLocalTime,
    input.attempt ?? 1,
  ].join(":");
}

export function getNextNotificationRunAt(input: {
  rule: Pick<NotificationRuleRecord, "enabled" | "schedule" | "timezone">;
  now?: Date;
}): { date: string; time: string; timezone: string } | null {
  if (!input.rule.enabled) {
    return null;
  }

  const timeZone = input.rule.timezone || BANGKOK_TIME_ZONE;
  const start = input.now ?? new Date();
  for (let minuteOffset = 1; minuteOffset <= 14 * 24 * 60; minuteOffset += 1) {
    const candidate = new Date(start.getTime() + minuteOffset * 60_000);
    const zoned = getZonedDateTimeParts({ now: candidate, timeZone });
    if (
      input.rule.schedule.some(
        (entry) =>
          entry.weekdays.includes(zoned.isoWeekday) &&
          entry.times.includes(zoned.time),
      )
    ) {
      return { date: zoned.date, time: zoned.time, timezone: timeZone };
    }
  }

  return null;
}

function isoWeekdayFromYmd(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export type LineWebhookSourceType = "user" | "group" | "room" | "unknown";

export type LineWebhookEventRecord = {
  id: string;
  event_type: string;
  source_type: LineWebhookSourceType;
  source_id: string | null;
  source_id_masked: string | null;
  user_id: string | null;
  message_text: string | null;
  raw_event_json: Record<string, unknown>;
  created_at: string;
};

export type WorkerHeartbeatStatus = "ok" | "warning" | "error";

export type WorkerHeartbeatRecord = {
  id: string;
  worker_id: string;
  role: string;
  status: WorkerHeartbeatStatus;
  metadata_json: Record<string, unknown>;
  checked_at: string;
  created_at: string;
};

export type ReportRunRecord = {
  id: string;
  tenant_id: TenantId;
  report_key: ReportKey;
  params: ReportParams;
  status: ReportRunStatus;
  started_at: string;
  finished_at: string | null;
  row_count: number;
  safe_error_message: string | null;
  queued_at?: string | null;
  claimed_at?: string | null;
  worker_id?: string | null;
  execution_strategy?: ReportExecutionStrategy | null;
  progress_stage?: ReportRunProgressStage | null;
  progress_percent?: number | null;
  progress_updated_at?: string | null;
  failure_kind?: JavaWsFailureKind | null;
  failure_phase?: JavaWsFailurePhase | null;
  failure_metadata_json?: Record<string, unknown>;
};

export type JavaWsFailureKind =
  | "timeout"
  | "unreachable"
  | "operation_missing"
  | "unreadable_response"
  | "unknown";

export type JavaWsFailurePhase =
  | "timeout"
  | "unreachable"
  | "operation_missing"
  | "http_error"
  | "soap_fault"
  | "soap_parse_failed"
  | "missing_return"
  | "non_base64_return"
  | "invalid_zip"
  | "empty_zip"
  | "xml_parse_failed"
  | "missing_resultset"
  | "invalid_resultset"
  | "unknown";

export type OperationalAlertChannel = "telegram";

export type OperationalAlertSeverity = "info" | "warning" | "critical";

export type OperationalAlertDeliveryStatus =
  | "dry_run"
  | "success"
  | "failed"
  | "skipped";

export type OperationalAlertTargetRecord = {
  id: string;
  channel: OperationalAlertChannel;
  display_name: string;
  target_id_encrypted: string;
  target_id_masked: string;
  target_id_hash: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type OperationalAlertDeliveryRecord = {
  id: string;
  channel: OperationalAlertChannel;
  target_id_masked: string | null;
  alert_type: string;
  severity: OperationalAlertSeverity;
  status: OperationalAlertDeliveryStatus;
  dedupe_key: string | null;
  message_text: string;
  provider_response_json: Record<string, unknown> | null;
  safe_error_message: string | null;
  created_at: string;
  sent_at: string | null;
};

export type ReportRunChunkRecord = {
  id: string;
  tenant_id: TenantId;
  report_run_id: string;
  report_key: ReportKey;
  chunk_no: number;
  chunk_key: string;
  status: ReportRunChunkStatus;
  attempt: number;
  unit_start_index: number;
  unit_count: number;
  total_units: number;
  row_count: number;
  cursor_from: string | null;
  cursor_to: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  safe_error_message: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
