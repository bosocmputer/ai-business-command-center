import { z } from "zod";

export const tenantIdSchema = z.enum([
  "tenant_demo_remote",
  "tenant_office_sml1_2026",
]);

export const reportKeySchema = z.literal("sales_goods_services");

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
export type SalesGoodsServicesParams = z.infer<
  typeof salesGoodsServicesParamsSchema
>;
export type DataQualityStatus = z.infer<typeof dataQualityStatusSchema>;

export type Tenant = {
  id: TenantId;
  name: string;
  databaseName: string;
  description: string;
  datasourceConfigured: boolean;
};

export type ReportRunStatus = "success" | "failed" | "running";

export type SalesHeaderRow = {
  rownum: number;
  doc_date: string;
  doc_no: string;
  doc_time: string | null;
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
};

export type SalesDetailRow = {
  doc_date: string;
  doc_no: string;
  doc_time: string | null;
  cust_code: string | null;
  cust_name: string | null;
  branch_code: string;
  item_code: string | null;
  item_name: string | null;
  wh_code: string | null;
  shelf_code: string | null;
  unit_code: string | null;
  qty: number;
  price: number;
  discount: string | null;
  discount_amount: number;
  sum_amount: number;
  vat_type: string | null;
};

export type BranchSales = {
  branch_code: string;
  total_amount: number;
  document_count: number;
  line_count: number;
};

export type TopProduct = {
  item_code: string;
  item_name: string;
  qty: number;
  sum_amount: number;
  line_count: number;
};

export type ReconciliationSummary = {
  header_total_amount: number;
  detail_sum_amount: number;
  difference_amount: number;
  status: DataQualityStatus;
  note: string;
};

export type SalesGoodsServicesSnapshot = {
  tenant_id: TenantId;
  report_key: ReportKey;
  run_id: string;
  params: SalesGoodsServicesParams;
  generated_at: string;
  source: "sml_postgres" | "sample_snapshot";
  quality_status: DataQualityStatus;
  summary: {
    total_sales: number;
    document_count: number;
    line_count: number;
    total_qty: number;
    top_product_name: string | null;
  };
  branch_sales: BranchSales[];
  top_products: TopProduct[];
  documents: SalesHeaderRow[];
  lines: SalesDetailRow[];
  reconciliation: ReconciliationSummary;
  line_template: {
    title: string;
    body: string[];
  };
};

export type SalesGoodsServicesLinePreview = {
  tenant_id: TenantId;
  report_key: ReportKey;
  run_id: string;
  generated_at: string;
  source: SalesGoodsServicesSnapshot["source"];
  line_message_type: "text";
  title: string;
  text: string;
  lines: string[];
  warnings: string[];
  dashboard_url: string | null;
};

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
  target_id_masked: string | null;
  message_type: "text";
  status: LineDeliveryStatus;
  sent_at: string | null;
  provider_response_json: Record<string, unknown> | null;
  safe_error_message: string | null;
  created_at: string;
};

export type LineSendMode = "dry_run" | "send";

export const lineSendRequestSchema = z.object({
  mode: z.enum(["dry_run", "send"]).default("dry_run"),
});

export type LineSendRequest = z.infer<typeof lineSendRequestSchema>;

export type LineSendResult = {
  delivery: LineDeliveryRecord;
  preview: SalesGoodsServicesLinePreview;
  configured: boolean;
  mode: LineSendMode;
};

export type ReportRunRecord = {
  id: string;
  tenant_id: TenantId;
  report_key: ReportKey;
  params: SalesGoodsServicesParams;
  status: ReportRunStatus;
  started_at: string;
  finished_at: string | null;
  row_count: number;
  safe_error_message: string | null;
};
