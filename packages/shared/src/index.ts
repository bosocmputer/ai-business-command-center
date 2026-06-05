import { z } from "zod";

export const tenantIdSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    "tenant_id must use lowercase letters, numbers, underscores, or hyphens",
  );

export const reportKeySchema = z.enum([
  "sales_goods_services",
  "purchase_goods_payables",
  "gross_profit_by_product",
  "gross_profit_by_ar_customer",
]);

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
  demo_mode_enabled: z.boolean().default(false),
});

export const businessSignalThresholdsSchema = z.object({
  low_gross_margin_percent: z.coerce.number().min(0).max(100).default(5),
  sales_drop_percent: z.coerce.number().min(0).max(100).default(20),
  sales_drop_amount: z.coerce.number().min(0).max(1_000_000_000).default(1000),
  purchase_concentration_percent: z.coerce.number().min(0).max(100).default(80),
  missing_branch_amount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  no_sales_enabled: z.boolean().default(true),
});

export const planCodeSchema = z.enum(["starter", "business", "pro"]);

export const userRoleSchema = z.enum(["owner_admin", "tenant_viewer"]);

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const salesGoodsServicesParamsSchema = z
  .object({
    date_from: isoDateSchema,
    date_to: isoDateSchema,
  })
  .superRefine((value, ctx) => {
    if (value.date_from > value.date_to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "date_from must be earlier than or equal to date_to",
        path: ["date_from"],
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

export type ReportRunStatus = "success" | "failed" | "running";

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

export type ReportSnapshot =
  | SalesGoodsServicesSnapshot
  | PurchaseGoodsPayablesSnapshot
  | GrossProfitByProductSnapshot
  | GrossProfitByArCustomerSnapshot;

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
      note: "ไม่พบรหัสสาขาในหัวบิลหรือรายการสินค้า",
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
  report_key: ReportKey;
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

export type ReportLinePreview =
  | SalesGoodsServicesLinePreview
  | PurchaseGoodsPayablesLinePreview
  | GrossProfitLinePreview;

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

export const notificationRuleRunStatusSchema = z.enum([
  "running",
  "success",
  "failed",
  "skipped",
]);

export const notificationDigestModeSchema = z.enum([
  "action_only",
  "all_reports",
]);

export const notificationScheduleEntrySchema = z.object({
  weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7),
  times: z
    .array(z.string().regex(/^\d{2}:\d{2}$/))
    .min(1)
    .max(12),
});

export const notificationRulePayloadSchema = z.object({
  tenant_id: tenantIdSchema,
  name: z.string().trim().min(2).max(120),
  enabled: z.boolean().default(true),
  timezone: z.string().trim().min(1).max(80).default(BANGKOK_TIME_ZONE),
  period_preset: notificationPeriodPresetSchema.default("yesterday"),
  schedule: z.array(notificationScheduleEntrySchema).min(1).max(7),
  report_keys: z.array(reportKeySchema).min(1).max(5),
  target_ids: z.array(z.string().trim().min(1).max(180)).max(50).default([]),
  digest_mode: notificationDigestModeSchema.default("action_only"),
});

export type NotificationPeriodPreset = z.infer<
  typeof notificationPeriodPresetSchema
>;
export type NotificationRuleRunStatus = z.infer<
  typeof notificationRuleRunStatusSchema
>;
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
  status: NotificationRuleRunStatus;
  attempt: number;
  idempotency_key: string;
  report_run_ids: string[];
  delivery_ids: string[];
  safe_error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
};

export function deriveNotificationPeriodRange(input: {
  periodPreset: NotificationPeriodPreset;
  now?: Date;
  timeZone?: string;
}): SalesGoodsServicesParams {
  const timeZone = input.timeZone ?? BANGKOK_TIME_ZONE;
  const currentYmd = formatDateInTimeZone(input.now ?? new Date(), timeZone);

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
  if (!input.rule.enabled) {
    return null;
  }

  const zoned = getZonedDateTimeParts({
    now: input.now,
    timeZone: input.rule.timezone || BANGKOK_TIME_ZONE,
  });
  const due = input.rule.schedule.some(
    (entry) =>
      entry.weekdays.includes(zoned.isoWeekday) &&
      entry.times.includes(zoned.time),
  );

  return due ? zoned : null;
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
};
