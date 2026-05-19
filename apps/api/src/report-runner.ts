import { Pool } from "pg";
import {
  buildSalesDetailQuery,
  buildSalesHeaderQuery,
  summarizeSalesGoodsServices,
  validateSalesGoodsServicesParams,
} from "@ai-bcc/reports";
import {
  type SalesDetailRow,
  type SalesGoodsServicesParams,
  type SalesGoodsServicesSnapshot,
  type SalesHeaderRow,
  type TenantId,
} from "@ai-bcc/shared";
import type { DatasourceConfig } from "./config.js";

export type DatasourceConnectionTestResult = {
  ok: boolean;
  checked_at: string;
  latency_ms: number;
  database_name: string;
  user_name_masked: string | null;
  required_tables: {
    ic_trans: boolean;
    ic_trans_detail: boolean;
    ar_customer: boolean;
  };
  safe_error_message: string | null;
};

export async function runSalesGoodsServicesReport(input: {
  tenant_id: TenantId;
  run_id: string;
  params: SalesGoodsServicesParams;
  datasource: DatasourceConfig;
}): Promise<SalesGoodsServicesSnapshot> {
  const params = validateSalesGoodsServicesParams(input.params);
  const pool = new Pool({
    host: input.datasource.host,
    port: input.datasource.port,
    database: input.datasource.database,
    user: input.datasource.user,
    password: input.datasource.password,
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
    statement_timeout: 30000,
    query_timeout: 35000,
  });

  try {
    const client = await pool.connect();
    try {
      await client.query("set statement_timeout = 30000");
      const headerQuery = buildSalesHeaderQuery(params);
      const detailQuery = buildSalesDetailQuery(params);
      const [headerResult, detailResult] = await Promise.all([
        client.query(headerQuery.text, headerQuery.values),
        client.query(detailQuery.text, detailQuery.values),
      ]);

      return summarizeSalesGoodsServices({
        tenant_id: input.tenant_id,
        run_id: input.run_id,
        params,
        generated_at: new Date().toISOString(),
        source: "sml_postgres",
        headers: headerResult.rows.map(mapHeaderRow),
        details: detailResult.rows.map(mapDetailRow),
      });
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

export async function testDatasourceConnection(
  datasource: DatasourceConfig,
): Promise<DatasourceConnectionTestResult> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const pool = new Pool({
    host: datasource.host,
    port: datasource.port,
    database: datasource.database,
    user: datasource.user,
    password: datasource.password,
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
    statement_timeout: 5000,
    query_timeout: 8000,
  });

  try {
    const client = await pool.connect();
    try {
      await client.query("set statement_timeout = 5000");
      const result = await client.query<{
        database_name: string;
        user_name: string;
        has_ic_trans: boolean;
        has_ic_trans_detail: boolean;
        has_ar_customer: boolean;
      }>(`
select
  current_database() as database_name,
  current_user as user_name,
  to_regclass('public.ic_trans') is not null as has_ic_trans,
  to_regclass('public.ic_trans_detail') is not null as has_ic_trans_detail,
  to_regclass('public.ar_customer') is not null as has_ar_customer
`);
      const row = result.rows[0];

      return {
        ok: Boolean(
          row?.has_ic_trans &&
            row.has_ic_trans_detail &&
            row.has_ar_customer,
        ),
        checked_at: checkedAt,
        latency_ms: Date.now() - startedAt,
        database_name: row?.database_name ?? datasource.database,
        user_name_masked: row?.user_name ? maskIdentifier(row.user_name) : null,
        required_tables: {
          ic_trans: Boolean(row?.has_ic_trans),
          ic_trans_detail: Boolean(row?.has_ic_trans_detail),
          ar_customer: Boolean(row?.has_ar_customer),
        },
        safe_error_message:
          row?.has_ic_trans && row.has_ic_trans_detail && row.has_ar_customer
            ? null
            : "Datasource connected, but required SML tables are missing.",
      };
    } finally {
      client.release();
    }
  } catch (error) {
    return {
      ok: false,
      checked_at: checkedAt,
      latency_ms: Date.now() - startedAt,
      database_name: datasource.database,
      user_name_masked: null,
      required_tables: {
        ic_trans: false,
        ic_trans_detail: false,
        ar_customer: false,
      },
      safe_error_message: toSafeDatasourceErrorMessage(error),
    };
  } finally {
    await pool.end();
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
    if (/connect|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(error.message)) {
      return "Report run failed because the datasource is unreachable.";
    }
  }
  return "Report run failed. Check server logs for the internal diagnostic details.";
}

function toSafeDatasourceErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/password|credential|secret|authentication|28P01/i.test(error.message)) {
      return "Datasource authentication failed.";
    }
    if (/timeout|canceling statement/i.test(error.message)) {
      return "Datasource connection timed out.";
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
    item_name: toNullableString(row.item_name),
    wh_code: toNullableString(row.wh_code),
    shelf_code: toNullableString(row.shelf_code),
    unit_code: toNullableString(row.unit_code),
    qty: toNumber(row.qty),
    price: toNumber(row.price),
    discount: toNullableString(row.discount),
    discount_amount: toNumber(row.discount_amount),
    sum_amount: toNumber(row.sum_amount),
    vat_type: toNullableString(row.vat_type),
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

function toDateString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return toStringValue(value).slice(0, 10);
}
