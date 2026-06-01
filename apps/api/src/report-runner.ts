import { Pool } from "pg";
import {
  buildSalesDocumentDetailQuery,
  buildSalesDocumentPageQuery,
  buildSalesDetailQuery,
  buildSalesHeaderQuery,
  buildSalesPdfCountQuery,
  buildSmlBranchListQuery,
  buildPurchaseDetailQuery,
  buildPurchaseDocumentDetailQuery,
  buildPurchaseDocumentPageQuery,
  buildPurchaseHeaderQuery,
  buildPurchasePdfCountQuery,
  summarizePurchaseGoodsPayables,
  summarizeSalesGoodsServices,
  validatePurchaseGoodsPayablesParams,
  validateSalesGoodsServicesParams,
} from "@ai-bcc/reports";
import {
  getSmlBranchMeaning,
  type PurchaseGoodsPayablesSnapshot,
  type ReportKey,
  type SalesDocumentDetail,
  type SalesDocumentListItem,
  type SalesDocumentPage,
  type SalesDetailRow,
  type SalesGoodsServicesParams,
  type SalesGoodsServicesSnapshot,
  type SalesHeaderRow,
  type SmlBranchRecord,
  type TenantId,
} from "@ai-bcc/shared";
import type { DatasourceConfig } from "./config.js";
import { SmlJavaWsClient } from "./sml-javaws-client.js";
import {
  type QueryConfigLike,
  renderParameterizedSqlForJavaWs,
} from "./sql-render.js";

export type DatasourceConnectionTestResult = {
  ok: boolean;
  checked_at: string;
  mode: DatasourceConfig["kind"];
  latency_ms: number;
  database_name: string;
  user_name_masked: string | null;
  required_tables: {
    ic_trans: boolean;
    ic_trans_detail: boolean;
    ar_customer: boolean;
    ap_supplier: boolean;
    erp_branch_list: boolean;
  };
  safe_error_message: string | null;
};

export type ReportPdfRows = {
  tenant_id: TenantId;
  report_key: ReportKey;
  params: SalesGoodsServicesParams;
  documents: SalesHeaderRow[];
  lines: SalesDetailRow[];
};

export type ReportPdfPreflightCount = {
  documentCount: number;
  detailRowCount: number;
};

type SmlDatasourceClient = {
  source: Exclude<
    SalesGoodsServicesSnapshot["source"],
    "sample_snapshot"
  >;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string | QueryConfigLike,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
  close(): Promise<void>;
};

async function withDatasourceClient<T>(
  datasource: DatasourceConfig,
  options: {
    connectionTimeoutMs: number;
    idleTimeoutMs: number;
    statementTimeoutMs: number;
    queryTimeoutMs: number;
  },
  action: (client: SmlDatasourceClient) => Promise<T>,
) {
  const client = await createDatasourceClient(datasource, options);
  try {
    if (datasource.kind === "sml_postgres") {
      await client.query(`set statement_timeout = ${options.statementTimeoutMs}`);
    }
    return await action(client);
  } finally {
    await client.close();
  }
}

async function createDatasourceClient(
  datasource: DatasourceConfig,
  options: {
    connectionTimeoutMs: number;
    idleTimeoutMs: number;
    statementTimeoutMs: number;
    queryTimeoutMs: number;
  },
): Promise<SmlDatasourceClient> {
  if (datasource.kind === "sml_javaws") {
    const javaWsClient = new SmlJavaWsClient(datasource, options.queryTimeoutMs);
    return {
      source: "sml_javaws",
      async query<T extends Record<string, unknown> = Record<string, unknown>>(
        query: string | QueryConfigLike,
        values?: readonly unknown[],
      ) {
        const queryConfig =
          typeof query === "string" ? { text: query, values } : query;
        if (/^\s*set\s+statement_timeout\b/i.test(queryConfig.text)) {
          return { rows: [] as T[] };
        }
        const renderedSql = renderParameterizedSqlForJavaWs(queryConfig);
        return (await javaWsClient.query(renderedSql)) as { rows: T[] };
      },
      async close() {},
    };
  }

  const pool = new Pool({
    host: datasource.host,
    port: datasource.port,
    database: datasource.database,
    user: datasource.user,
    password: datasource.password,
    max: 1,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    idleTimeoutMillis: options.idleTimeoutMs,
    statement_timeout: options.statementTimeoutMs,
    query_timeout: options.queryTimeoutMs,
  });
  const pgClient = await pool.connect();

  return {
    source: "sml_postgres",
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      query: string | QueryConfigLike,
      values?: readonly unknown[],
    ) {
      if (typeof query === "string") {
        return pgClient.query<T>(query, values as unknown[]);
      }
      return pgClient.query<T>(query.text, query.values as unknown[]);
    },
    async close() {
      pgClient.release();
      await pool.end();
    },
  };
}

export async function runSalesGoodsServicesReport(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  datasource: DatasourceConfig;
}): Promise<SalesGoodsServicesSnapshot> {
  const params = validateSalesGoodsServicesParams(input.params);
  return withDatasourceClient(
    input.datasource,
    {
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 30000,
      queryTimeoutMs: 35000,
    },
    async (client) => {
      const headerQuery = buildSalesHeaderQuery(params);
      const detailQuery = buildSalesDetailQuery(params);
      const branchQuery = buildSmlBranchListQuery();
      const [headerResult, detailResult, branchResult] = await Promise.all([
        client.query(headerQuery.text, headerQuery.values),
        client.query(detailQuery.text, detailQuery.values),
        client
          .query(branchQuery.text, branchQuery.values)
          .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      ]);

      return summarizeSalesGoodsServices({
        tenant_id: input.tenant_id,
        run_id: input.run_id,
        params,
        generated_at: new Date().toISOString(),
        source: client.source,
        headers: headerResult.rows.map(mapHeaderRow),
        details: detailResult.rows.map(mapDetailRow),
        branches: branchResult.rows.map(mapBranchRow),
      });
    },
  );
}

export async function fetchSalesGoodsServicesDocumentDetail(input: {
  tenant_id: TenantId;
  params: SalesGoodsServicesParams;
  datasource: DatasourceConfig;
  doc_no: string;
}): Promise<SalesDocumentDetail | null> {
  const params = validateSalesGoodsServicesParams(input.params);
  const query = buildSalesDocumentDetailQuery(params, input.doc_no);
  return withDatasourceClient(
    input.datasource,
    {
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 15000,
      queryTimeoutMs: 20000,
    },
    async (client) => {
      const result = await client.query<Record<string, unknown>>(
        query.text,
        query.values,
      );
      if (!result.rows[0]) {
        return null;
      }

      const document = mapHeaderRow(result.rows[0]);
      const lines = result.rows
        .filter((row) => row.line_number != null || row.item_code != null)
        .map(mapDocumentDetailLineRow);

      return {
        tenant_id: input.tenant_id,
        report_key: "sales_goods_services",
        params,
        document,
        lines,
      };
    },
  );
}

export async function fetchSalesGoodsServicesDocumentPage(input: {
  tenant_id: TenantId;
  params: SalesGoodsServicesParams;
  datasource: DatasourceConfig;
  page: number;
  page_size: number;
  search?: string | null;
}): Promise<SalesDocumentPage> {
  const params = validateSalesGoodsServicesParams(input.params);
  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.min(50, Math.max(1, Math.floor(input.page_size)));
  const query = buildSalesDocumentPageQuery(params, {
    page,
    pageSize,
    search: input.search,
  });
  return withDatasourceClient(
    input.datasource,
    {
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 15000,
      queryTimeoutMs: 20000,
    },
    async (client) => {
      const branchQuery = buildSmlBranchListQuery();
      const [result, branchResult] = await Promise.all([
        client.query<Record<string, unknown>>(query.text, query.values),
        client
          .query(branchQuery.text, branchQuery.values)
          .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      ]);
      const branchNameByCode = buildBranchNameMap(
        branchResult.rows.map(mapBranchRow),
      );
      const documents = result.rows.map(mapDocumentPageRow);
      const totalItems = toNumber(result.rows[0]?.total_count);

      return {
        tenant_id: input.tenant_id,
        report_key: "sales_goods_services",
        params,
        documents: documents.map((document) =>
          enrichDocumentBranch(document, branchNameByCode),
        ),
        pagination: {
          page,
          page_size: pageSize,
          total_items: totalItems,
          total_pages: Math.max(1, Math.ceil(totalItems / pageSize)),
          search: input.search?.trim() || null,
        },
      };
    },
  );
}

export async function fetchSalesGoodsServicesPdfRows(input: {
  tenant_id: TenantId;
  params: SalesGoodsServicesParams;
  datasource: DatasourceConfig;
}): Promise<ReportPdfRows> {
  const params = validateSalesGoodsServicesParams(input.params);
  return withDatasourceClient(
    input.datasource,
    {
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 30000,
      queryTimeoutMs: 35000,
    },
    async (client) => {
      const headerQuery = buildSalesHeaderQuery(params);
      const detailQuery = buildSalesDetailQuery(params);
      const [headerResult, detailResult] = await Promise.all([
        client.query<Record<string, unknown>>(headerQuery.text, headerQuery.values),
        client.query<Record<string, unknown>>(detailQuery.text, detailQuery.values),
      ]);

      return {
        tenant_id: input.tenant_id,
        report_key: "sales_goods_services",
        params,
        documents: headerResult.rows.map(mapHeaderRow),
        lines: detailResult.rows.map(mapDetailRow),
      };
    },
  );
}

export async function countSalesGoodsServicesPdfRows(input: {
  params: SalesGoodsServicesParams;
  datasource: DatasourceConfig;
}): Promise<ReportPdfPreflightCount> {
  const params = validateSalesGoodsServicesParams(input.params);
  return withDatasourceClient(
    input.datasource,
    {
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 15000,
      queryTimeoutMs: 20000,
    },
    async (client) => {
      const query = buildSalesPdfCountQuery(params);
      const result = await client.query<Record<string, unknown>>(
        query.text,
        query.values,
      );
      return mapPdfPreflightCountRow(result.rows[0] ?? {});
    },
  );
}

export async function runPurchaseGoodsPayablesReport(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  datasource: DatasourceConfig;
}): Promise<PurchaseGoodsPayablesSnapshot> {
  const params = validatePurchaseGoodsPayablesParams(input.params);
  return withDatasourceClient(
    input.datasource,
    {
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 30000,
      queryTimeoutMs: 35000,
    },
    async (client) => {
      const headerQuery = buildPurchaseHeaderQuery(params);
      const detailQuery = buildPurchaseDetailQuery(params);
      const branchQuery = buildSmlBranchListQuery();
      const [headerResult, detailResult, branchResult] = await Promise.all([
        client.query(headerQuery.text, headerQuery.values),
        client.query(detailQuery.text, detailQuery.values),
        client
          .query(branchQuery.text, branchQuery.values)
          .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      ]);

      return summarizePurchaseGoodsPayables({
        tenant_id: input.tenant_id,
        run_id: input.run_id,
        params,
        generated_at: new Date().toISOString(),
        source: client.source,
        headers: headerResult.rows.map(mapHeaderRow),
        details: detailResult.rows.map(mapDetailRow),
        branches: branchResult.rows.map(mapBranchRow),
      });
    },
  );
}

export async function fetchPurchaseGoodsPayablesDocumentDetail(input: {
  tenant_id: TenantId;
  params: SalesGoodsServicesParams;
  datasource: DatasourceConfig;
  doc_no: string;
}): Promise<SalesDocumentDetail | null> {
  const params = validatePurchaseGoodsPayablesParams(input.params);
  const query = buildPurchaseDocumentDetailQuery(params, input.doc_no);
  return withDatasourceClient(
    input.datasource,
    {
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 15000,
      queryTimeoutMs: 20000,
    },
    async (client) => {
      const result = await client.query<Record<string, unknown>>(
        query.text,
        query.values,
      );
      if (!result.rows[0]) {
        return null;
      }

      const document = mapHeaderRow(result.rows[0]);
      const lines = result.rows
        .filter((row) => row.line_number != null || row.item_code != null)
        .map(mapDocumentDetailLineRow);

      return {
        tenant_id: input.tenant_id,
        report_key: "purchase_goods_payables",
        params,
        document,
        lines,
      };
    },
  );
}

export async function fetchPurchaseGoodsPayablesDocumentPage(input: {
  tenant_id: TenantId;
  params: SalesGoodsServicesParams;
  datasource: DatasourceConfig;
  page: number;
  page_size: number;
  search?: string | null;
}): Promise<SalesDocumentPage> {
  const params = validatePurchaseGoodsPayablesParams(input.params);
  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.min(50, Math.max(1, Math.floor(input.page_size)));
  const query = buildPurchaseDocumentPageQuery(params, {
    page,
    pageSize,
    search: input.search,
  });
  return withDatasourceClient(
    input.datasource,
    {
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 15000,
      queryTimeoutMs: 20000,
    },
    async (client) => {
      const branchQuery = buildSmlBranchListQuery();
      const [result, branchResult] = await Promise.all([
        client.query<Record<string, unknown>>(query.text, query.values),
        client
          .query(branchQuery.text, branchQuery.values)
          .catch(() => ({ rows: [] as Record<string, unknown>[] })),
      ]);
      const branchNameByCode = buildBranchNameMap(
        branchResult.rows.map(mapBranchRow),
      );
      const documents = result.rows.map(mapDocumentPageRow);
      const totalItems = toNumber(result.rows[0]?.total_count);

      return {
        tenant_id: input.tenant_id,
        report_key: "purchase_goods_payables",
        params,
        documents: documents.map((document) =>
          enrichDocumentBranch(document, branchNameByCode),
        ),
        pagination: {
          page,
          page_size: pageSize,
          total_items: totalItems,
          total_pages: Math.max(1, Math.ceil(totalItems / pageSize)),
          search: input.search?.trim() || null,
        },
      };
    },
  );
}

export async function fetchPurchaseGoodsPayablesPdfRows(input: {
  tenant_id: TenantId;
  params: SalesGoodsServicesParams;
  datasource: DatasourceConfig;
}): Promise<ReportPdfRows> {
  const params = validatePurchaseGoodsPayablesParams(input.params);
  return withDatasourceClient(
    input.datasource,
    {
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 30000,
      queryTimeoutMs: 35000,
    },
    async (client) => {
      const headerQuery = buildPurchaseHeaderQuery(params);
      const detailQuery = buildPurchaseDetailQuery(params);
      const [headerResult, detailResult] = await Promise.all([
        client.query<Record<string, unknown>>(headerQuery.text, headerQuery.values),
        client.query<Record<string, unknown>>(detailQuery.text, detailQuery.values),
      ]);

      return {
        tenant_id: input.tenant_id,
        report_key: "purchase_goods_payables",
        params,
        documents: headerResult.rows.map(mapHeaderRow),
        lines: detailResult.rows.map(mapDetailRow),
      };
    },
  );
}

export async function countPurchaseGoodsPayablesPdfRows(input: {
  params: SalesGoodsServicesParams;
  datasource: DatasourceConfig;
}): Promise<ReportPdfPreflightCount> {
  const params = validatePurchaseGoodsPayablesParams(input.params);
  return withDatasourceClient(
    input.datasource,
    {
      connectionTimeoutMs: 5000,
      idleTimeoutMs: 1000,
      statementTimeoutMs: 15000,
      queryTimeoutMs: 20000,
    },
    async (client) => {
      const query = buildPurchasePdfCountQuery(params);
      const result = await client.query<Record<string, unknown>>(
        query.text,
        query.values,
      );
      return mapPdfPreflightCountRow(result.rows[0] ?? {});
    },
  );
}

export async function testDatasourceConnection(
  datasource: DatasourceConfig,
): Promise<DatasourceConnectionTestResult> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();

  try {
    return await withDatasourceClient(
      datasource,
      {
        connectionTimeoutMs: 5000,
        idleTimeoutMs: 1000,
        statementTimeoutMs: 5000,
        queryTimeoutMs: 8000,
      },
      async (client) => {
        const result = await client.query<{
          database_name: string;
          user_name: string;
          has_ic_trans: boolean;
          has_ic_trans_detail: boolean;
          has_ar_customer: boolean;
          has_ap_supplier: boolean;
          has_erp_branch_list: boolean;
        }>(`
select
  current_database() as database_name,
  current_user as user_name,
  to_regclass('public.ic_trans') is not null as has_ic_trans,
  to_regclass('public.ic_trans_detail') is not null as has_ic_trans_detail,
  to_regclass('public.ar_customer') is not null as has_ar_customer,
  to_regclass('public.ap_supplier') is not null as has_ap_supplier,
  to_regclass('public.erp_branch_list') is not null as has_erp_branch_list
`);
        const row = result.rows[0];
        const requiredTables = {
          ic_trans: toBoolean(row?.has_ic_trans),
          ic_trans_detail: toBoolean(row?.has_ic_trans_detail),
          ar_customer: toBoolean(row?.has_ar_customer),
          ap_supplier: toBoolean(row?.has_ap_supplier),
          erp_branch_list: toBoolean(row?.has_erp_branch_list),
        };
        const ok = Object.values(requiredTables).every(Boolean);

        return {
          ok,
          checked_at: checkedAt,
          mode: datasource.kind,
          latency_ms: Date.now() - startedAt,
          database_name: row?.database_name ?? datasource.database,
          user_name_masked: row?.user_name ? maskIdentifier(row.user_name) : null,
          required_tables: requiredTables,
          safe_error_message: ok
            ? null
            : "Datasource connected, but required SML tables are missing.",
        };
      },
    );
  } catch (error) {
    return {
      ok: false,
      checked_at: checkedAt,
      mode: datasource.kind,
      latency_ms: Date.now() - startedAt,
      database_name: datasource.database,
      user_name_masked: null,
      required_tables: {
        ic_trans: false,
        ic_trans_detail: false,
        ar_customer: false,
        ap_supplier: false,
        erp_branch_list: false,
      },
      safe_error_message: toSafeDatasourceErrorMessage(error),
    };
  }
}

export function toSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/password|credential|secret/i.test(error.message)) {
      return "Report run failed because datasource authentication failed.";
    }
    if (/timeout|canceling statement/i.test(error.message)) {
      return "Report run timed out. Try a smaller date range or review query performance.";
    }
    if (/JavaWS/i.test(error.message)) {
      return "Report run failed because SML JavaWS could not return readable data.";
    }
    if (/connect|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(error.message)) {
      return "Report run failed because the datasource is unreachable.";
    }
  }
  return "Report run failed. Check server logs for the internal diagnostic details.";
}

export function toSafeDatasourceErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/password|credential|secret|authentication|28P01/i.test(error.message)) {
      return "Datasource authentication failed.";
    }
    if (/timeout|canceling statement/i.test(error.message)) {
      return "Datasource connection timed out.";
    }
    if (/JavaWS Tomcat endpoint is unreachable/i.test(error.message)) {
      return "JavaWS Tomcat endpoint is unreachable.";
    }
    if (/JavaWS endpoint or WSDL operation is missing/i.test(error.message)) {
      return "JavaWS endpoint or WSDL operation is missing.";
    }
    if (/JavaWS returned an unreadable response/i.test(error.message)) {
      return "JavaWS returned an unreadable response.";
    }
    if (/connect|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(error.message)) {
      return "Datasource is unreachable.";
    }
  }

  return "Datasource test failed. Check server logs for diagnostics.";
}

function maskIdentifier(value: string) {
  if (value.length <= 4) {
    return "****";
  }

  return `${value.slice(0, 2)}...${value.slice(-2)}`;
}

function mapHeaderRow(row: Record<string, unknown>): SalesHeaderRow {
  return {
    rownum: toNumber(row.rownum),
    doc_date: toDateString(row.doc_date),
    doc_no: toStringValue(row.doc_no),
    doc_time: toNullableString(row.doc_time),
    doc_ref_date: toNullableDateString(row.doc_ref_date),
    doc_ref: toNullableString(row.doc_ref),
    cust_code: toNullableString(row.cust_code),
    cust_name: toNullableString(row.cust_name),
    branch_code: toNullableString(row.branch_code),
    total_value: toNumber(row.total_value),
    total_discount: toNumber(row.total_discount),
    total_except_discount: toNumber(row.total_except_discount),
    total_except_vat: toNumber(row.total_except_vat),
    vat_rate: toNumber(row.vat_rate),
    total_vat_value: toNumber(row.total_vat_value),
    vat_type: toNullableString(row.vat_type),
    total_amount: toNumber(row.total_amount),
    cashier_code: toNullableString(row.cashier_code),
    last_status: toNullableString(row.last_status),
  };
}

function mapDocumentPageRow(row: Record<string, unknown>): SalesDocumentListItem {
  const resolvedBranchCode = toStringValue(row.resolved_branch_code) || "no_branch";
  const branchMeaning = getSmlBranchMeaning(resolvedBranchCode);
  return {
    ...mapHeaderRow(row),
    detail_line_count: toNumber(row.detail_line_count),
    detail_total_amount: toNumber(row.detail_total_amount),
    detail_total_qty: toNumber(row.detail_total_qty),
    resolved_branch_code: resolvedBranchCode,
    resolved_branch_label: branchMeaning.label,
    resolved_branch_name: branchMeaning.name,
    resolved_branch_note: branchMeaning.note,
  };
}

function mapBranchRow(row: Record<string, unknown>): SmlBranchRecord {
  return {
    code: toStringValue(row.code),
    name_1: toStringValue(row.name_1),
  };
}

function buildBranchNameMap(branches: SmlBranchRecord[]) {
  const map = new Map<string, string>();
  for (const branch of branches) {
    const code = branch.code.trim();
    const name = branch.name_1.trim();
    if (code && name) {
      map.set(code, name);
    }
  }
  return map;
}

function enrichDocumentBranch(
  document: SalesDocumentListItem,
  branchNameByCode: Map<string, string>,
): SalesDocumentListItem {
  const branchMeaning = getSmlBranchMeaning(
    document.resolved_branch_code,
    branchNameByCode.get(document.resolved_branch_code),
  );
  return {
    ...document,
    resolved_branch_label: branchMeaning.label,
    resolved_branch_name: branchMeaning.name,
    resolved_branch_note: branchMeaning.note,
  };
}

function mapDetailRow(row: Record<string, unknown>): SalesDetailRow {
  return {
    doc_date: toDateString(row.doc_date),
    doc_no: toStringValue(row.doc_no),
    doc_time: toNullableString(row.doc_time),
    cust_code: toNullableString(row.cust_code),
    cust_name: toNullableString(row.cust_name),
    branch_code: toStringValue(row.branch_code),
    item_code: toNullableString(row.item_code),
    barcode: toNullableString(row.barcode),
    item_name: toNullableString(row.item_name),
    wh_code: toNullableString(row.wh_code),
    shelf_code: toNullableString(row.shelf_code),
    unit_code: toNullableString(row.unit_code),
    unit_name: toNullableString(row.unit_name),
    qty: toNumber(row.qty),
    price: toNumber(row.price),
    discount: toNullableString(row.discount),
    discount_amount: toNumber(row.discount_amount),
    sum_amount: toNumber(row.sum_amount),
    vat_type: toNullableString(row.vat_type),
    tax_type: toNullableString(row.tax_type),
    ref_row: toNullableNumber(row.ref_row),
    temp_float_1: toNullableNumber(row.temp_float_1),
    temp_float_2: toNullableNumber(row.temp_float_2),
    line_number: toNullableNumber(row.line_number),
  };
}

function mapDocumentDetailLineRow(row: Record<string, unknown>): SalesDetailRow {
  return {
    doc_date: toDateString(row.doc_date),
    doc_no: toStringValue(row.doc_no),
    doc_time: toNullableString(row.doc_time),
    cust_code: toNullableString(row.cust_code),
    cust_name: toNullableString(row.cust_name),
    branch_code: toStringValue(row.detail_branch_code),
    item_code: toNullableString(row.item_code),
    barcode: toNullableString(row.barcode),
    item_name: toNullableString(row.item_name),
    wh_code: toNullableString(row.wh_code),
    shelf_code: toNullableString(row.shelf_code),
    unit_code: toNullableString(row.unit_code),
    unit_name: toNullableString(row.unit_name),
    qty: toNumber(row.qty),
    price: toNumber(row.price),
    discount: toNullableString(row.discount),
    discount_amount: toNumber(row.discount_amount),
    sum_amount: toNumber(row.sum_amount),
    vat_type: toNullableString(row.detail_vat_type),
    tax_type: toNullableString(row.tax_type),
    ref_row: toNullableNumber(row.ref_row),
    temp_float_1: toNullableNumber(row.temp_float_1),
    temp_float_2: toNullableNumber(row.temp_float_2),
    line_number: toNullableNumber(row.line_number),
  };
}

function mapPdfPreflightCountRow(
  row: Record<string, unknown>,
): ReportPdfPreflightCount {
  return {
    documentCount: toNumber(row.document_count),
    detailRowCount: toNumber(row.detail_row_count),
  };
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

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return ["true", "t", "1", "yes", "y"].includes(value.trim().toLowerCase());
  }
  return false;
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

function toNullableString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const text = String(value);
  return text === "" ? null : text;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  return toNumber(value);
}

function toDateString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return toStringValue(value).slice(0, 10);
}

function toNullableDateString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return toDateString(value);
}
