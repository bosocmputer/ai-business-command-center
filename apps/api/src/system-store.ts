import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import {
  type LineDeliveryRecord,
  type ReportRunRecord,
  type SalesGoodsServicesSnapshot,
  type Tenant,
  type TenantId,
} from "@ai-bcc/shared";
import { createSampleSnapshot } from "./sample-data.js";

export type AuditLogEntry = {
  id?: number;
  tenant_id: TenantId | null;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

export type ReportDefinitionSeed = {
  report_key: "sales_goods_services";
  name: string;
  version: string;
  contract_json: Record<string, unknown>;
};

export type SystemStore = {
  readonly kind: "postgres" | "local-json";
  initialize(input: {
    tenants: Tenant[];
    reportDefinitions: ReportDefinitionSeed[];
  }): Promise<void>;
  getLatestSnapshot(
    tenantId: TenantId,
  ): Promise<SalesGoodsServicesSnapshot | null>;
  saveSnapshot(snapshot: SalesGoodsServicesSnapshot): Promise<void>;
  listRuns(tenantId: TenantId): Promise<ReportRunRecord[]>;
  upsertRun(run: ReportRunRecord): Promise<void>;
  saveLineDelivery(delivery: LineDeliveryRecord): Promise<void>;
  listLineDeliveries(tenantId: TenantId): Promise<LineDeliveryRecord[]>;
  appendAuditLog(entry: Omit<AuditLogEntry, "created_at">): Promise<void>;
  listAuditLogs(limit: number): Promise<AuditLogEntry[]>;
  close(): Promise<void>;
};

type StoreFile = {
  tenants: Tenant[];
  reportDefinitions: ReportDefinitionSeed[];
  runs: ReportRunRecord[];
  snapshots: SalesGoodsServicesSnapshot[];
  lineDeliveries: LineDeliveryRecord[];
  auditLogs: AuditLogEntry[];
};

export function createSystemStore(): SystemStore {
  const databaseUrl = process.env.SYSTEM_DATABASE_URL?.trim();
  if (databaseUrl) {
    return new PostgresSystemStore(databaseUrl);
  }

  return new LocalJsonSystemStore(
    resolve(process.env.SYSTEM_STORE_FILE || ".data/system-store.json"),
  );
}

class LocalJsonSystemStore implements SystemStore {
  readonly kind = "local-json" as const;
  private data: StoreFile | null = null;
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(input: {
    tenants: Tenant[];
    reportDefinitions: ReportDefinitionSeed[];
  }) {
    this.data = await this.load();
    this.data.tenants = input.tenants;
    this.data.reportDefinitions = input.reportDefinitions;

    for (const tenant of input.tenants) {
      if (!this.data.snapshots.some((snapshot) => snapshot.tenant_id === tenant.id)) {
        const snapshot = createSampleSnapshot(tenant.id);
        this.data.snapshots.push(snapshot);
        this.data.runs.unshift(snapshotToRunRecord(snapshot));
      }
    }

    await this.persist();
  }

  async getLatestSnapshot(tenantId: TenantId) {
    const data = this.requireData();
    return (
      data.snapshots
        .filter((snapshot) => snapshot.tenant_id === tenantId)
        .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0] ?? null
    );
  }

  async saveSnapshot(snapshot: SalesGoodsServicesSnapshot) {
    const data = this.requireData();
    data.snapshots = [
      snapshot,
      ...data.snapshots.filter(
        (existing) =>
          !(
            existing.tenant_id === snapshot.tenant_id &&
            existing.report_key === snapshot.report_key &&
            existing.run_id === snapshot.run_id
          ),
      ),
    ].slice(0, 200);
    await this.persist();
  }

  async listRuns(tenantId: TenantId) {
    const data = this.requireData();
    return data.runs
      .filter((run) => run.tenant_id === tenantId)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 50);
  }

  async upsertRun(run: ReportRunRecord) {
    const data = this.requireData();
    data.runs = [
      run,
      ...data.runs.filter((existing) => existing.id !== run.id),
    ].slice(0, 500);
    await this.persist();
  }

  async saveLineDelivery(delivery: LineDeliveryRecord) {
    const data = this.requireData();
    data.lineDeliveries = [
      delivery,
      ...data.lineDeliveries.filter((existing) => existing.id !== delivery.id),
    ].slice(0, 500);
    await this.persist();
  }

  async listLineDeliveries(tenantId: TenantId) {
    return this.requireData().lineDeliveries
      .filter((delivery) => delivery.tenant_id === tenantId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50);
  }

  async appendAuditLog(entry: Omit<AuditLogEntry, "created_at">) {
    const data = this.requireData();
    data.auditLogs.unshift({
      ...entry,
      id: data.auditLogs.length + 1,
      created_at: new Date().toISOString(),
    });
    data.auditLogs = data.auditLogs.slice(0, 1000);
    await this.persist();
  }

  async listAuditLogs(limit: number) {
    return this.requireData().auditLogs.slice(0, limit);
  }

  async close() {
    await this.writeQueue;
  }

  private async load(): Promise<StoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      return {
        tenants: parsed.tenants ?? [],
        reportDefinitions: parsed.reportDefinitions ?? [],
        runs: parsed.runs ?? [],
        snapshots: parsed.snapshots ?? [],
        lineDeliveries: parsed.lineDeliveries ?? [],
        auditLogs: parsed.auditLogs ?? [],
      };
    } catch {
      return {
        tenants: [],
        reportDefinitions: [],
        runs: [],
        snapshots: [],
        lineDeliveries: [],
        auditLogs: [],
      };
    }
  }

  private persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      const data = this.requireData();
      await mkdir(dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      const payload = `${JSON.stringify(data, null, 2)}\n`;
      await writeFile(tempPath, payload);
      try {
        await rename(tempPath, this.filePath);
      } catch (error) {
        if (isNoSpaceError(error)) {
          await writeFile(this.filePath, payload);
          await unlink(tempPath).catch(() => undefined);
          return;
        }

        throw error;
      }
    });
    return this.writeQueue;
  }

  private requireData() {
    if (!this.data) {
      throw new Error("System store has not been initialized.");
    }
    return this.data;
  }
}

class PostgresSystemStore implements SystemStore {
  readonly kind = "postgres" as const;
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      statement_timeout: 30000,
      query_timeout: 35000,
    });
  }

  async initialize(input: {
    tenants: Tenant[];
    reportDefinitions: ReportDefinitionSeed[];
  }) {
    await this.pool.query(systemSchemaSql);

    for (const tenant of input.tenants) {
      await this.pool.query(
        `
insert into tenants (id, name, status)
values ($1, $2, 'active')
on conflict (id) do update set name = excluded.name
`,
        [tenant.id, tenant.name],
      );
    }

    for (const definition of input.reportDefinitions) {
      await this.pool.query(
        `
insert into report_definitions (report_key, name, version, contract_json)
values ($1, $2, $3, $4::jsonb)
on conflict (report_key) do update
set name = excluded.name,
    version = excluded.version,
    contract_json = excluded.contract_json
`,
        [
          definition.report_key,
          definition.name,
          definition.version,
          JSON.stringify(definition.contract_json),
        ],
      );
    }

    for (const tenant of input.tenants) {
      const latest = await this.getLatestSnapshot(tenant.id);
      if (!latest) {
        const snapshot = createSampleSnapshot(tenant.id);
        await this.upsertRun(snapshotToRunRecord(snapshot));
        await this.saveSnapshot(snapshot);
      }
    }
  }

  async getLatestSnapshot(tenantId: TenantId) {
    const result = await this.pool.query(
      `
select snapshot_json
from report_snapshots
where tenant_id = $1 and report_key = 'sales_goods_services'
order by created_at desc
limit 1
`,
      [tenantId],
    );

    return (
      (result.rows[0]?.snapshot_json as SalesGoodsServicesSnapshot | undefined) ??
      null
    );
  }

  async saveSnapshot(snapshot: SalesGoodsServicesSnapshot) {
    await this.pool.query(
      `
insert into report_snapshots (
  id,
  tenant_id,
  report_key,
  report_run_id,
  snapshot_json,
  created_at
)
values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
on conflict (id) do update
set snapshot_json = excluded.snapshot_json,
    created_at = excluded.created_at
`,
      [
        `${snapshot.tenant_id}:${snapshot.report_key}:${snapshot.run_id}`,
        snapshot.tenant_id,
        snapshot.report_key,
        snapshot.run_id,
        JSON.stringify(snapshot),
        snapshot.generated_at,
      ],
    );
  }

  async listRuns(tenantId: TenantId) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  report_key,
  params_json as params,
  status,
  started_at,
  finished_at,
  row_count,
  safe_error_message
from report_runs
where tenant_id = $1 and report_key = 'sales_goods_services'
order by started_at desc
limit 50
`,
      [tenantId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      report_key: row.report_key,
      params: row.params,
      status: row.status,
      started_at: toIsoString(row.started_at),
      finished_at: row.finished_at ? toIsoString(row.finished_at) : null,
      row_count: Number(row.row_count ?? 0),
      safe_error_message: row.safe_error_message,
    })) as ReportRunRecord[];
  }

  async upsertRun(run: ReportRunRecord) {
    await this.pool.query(
      `
insert into report_runs (
  id,
  tenant_id,
  report_key,
  params_json,
  status,
  started_at,
  finished_at,
  row_count,
  safe_error_message
)
values ($1, $2, $3, $4::jsonb, $5, $6::timestamptz, $7::timestamptz, $8, $9)
on conflict (id) do update
set status = excluded.status,
    finished_at = excluded.finished_at,
    row_count = excluded.row_count,
    safe_error_message = excluded.safe_error_message
`,
      [
        run.id,
        run.tenant_id,
        run.report_key,
        JSON.stringify(run.params),
        run.status,
        run.started_at,
        run.finished_at,
        run.row_count,
        run.safe_error_message,
      ],
    );
  }

  async saveLineDelivery(delivery: LineDeliveryRecord) {
    await this.pool.query(
      `
insert into line_deliveries (
  id,
  tenant_id,
  report_key,
  report_run_id,
  target_id_masked,
  message_type,
  status,
  sent_at,
  provider_response_json,
  safe_error_message,
  created_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::jsonb, $10, $11::timestamptz)
on conflict (id) do update
set status = excluded.status,
    sent_at = excluded.sent_at,
    provider_response_json = excluded.provider_response_json,
    safe_error_message = excluded.safe_error_message
`,
      [
        delivery.id,
        delivery.tenant_id,
        delivery.report_key,
        delivery.report_run_id,
        delivery.target_id_masked,
        delivery.message_type,
        delivery.status,
        delivery.sent_at,
        delivery.provider_response_json
          ? JSON.stringify(delivery.provider_response_json)
          : null,
        delivery.safe_error_message,
        delivery.created_at,
      ],
    );
  }

  async listLineDeliveries(tenantId: TenantId) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  report_key,
  report_run_id,
  target_id_masked,
  message_type,
  status,
  sent_at,
  provider_response_json,
  safe_error_message,
  created_at
from line_deliveries
where tenant_id = $1 and report_key = 'sales_goods_services'
order by created_at desc
limit 50
`,
      [tenantId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      report_key: row.report_key,
      report_run_id: row.report_run_id,
      target_id_masked: row.target_id_masked,
      message_type: row.message_type,
      status: row.status,
      sent_at: row.sent_at ? toIsoString(row.sent_at) : null,
      provider_response_json: row.provider_response_json,
      safe_error_message: row.safe_error_message,
      created_at: toIsoString(row.created_at),
    })) as LineDeliveryRecord[];
  }

  async appendAuditLog(entry: Omit<AuditLogEntry, "created_at">) {
    await this.pool.query(
      `
insert into audit_logs (
  tenant_id,
  actor_id,
  action,
  target_type,
  target_id,
  metadata_json,
  created_at
)
values ($1, $2, $3, $4, $5, $6::jsonb, now())
`,
      [
        entry.tenant_id,
        entry.actor_id,
        entry.action,
        entry.target_type,
        entry.target_id,
        JSON.stringify(entry.metadata_json),
      ],
    );
  }

  async listAuditLogs(limit: number) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  actor_id,
  action,
  target_type,
  target_id,
  metadata_json,
  created_at
from audit_logs
order by created_at desc
limit $1
`,
      [limit],
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      tenant_id: row.tenant_id,
      actor_id: row.actor_id,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      metadata_json: row.metadata_json,
      created_at: toIsoString(row.created_at),
    })) as AuditLogEntry[];
  }

  async close() {
    await this.pool.end();
  }
}

function snapshotToRunRecord(
  snapshot: SalesGoodsServicesSnapshot,
): ReportRunRecord {
  return {
    id: snapshot.run_id,
    tenant_id: snapshot.tenant_id,
    report_key: snapshot.report_key,
    params: snapshot.params,
    status: "success",
    started_at: snapshot.generated_at,
    finished_at: snapshot.generated_at,
    row_count: snapshot.summary.document_count + snapshot.summary.line_count,
    safe_error_message: null,
  };
}

function toIsoString(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isNoSpaceError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOSPC"
  );
}

const systemSchemaSql = `
create table if not exists tenants (
  id text primary key,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists report_definitions (
  report_key text primary key,
  name text not null,
  version text not null,
  contract_json jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists report_runs (
  id text primary key,
  tenant_id text not null references tenants(id),
  report_key text not null references report_definitions(report_key),
  params_json jsonb not null,
  status text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  row_count integer not null default 0,
  safe_error_message text
);

create table if not exists report_snapshots (
  id text primary key,
  tenant_id text not null references tenants(id),
  report_key text not null references report_definitions(report_key),
  report_run_id text not null references report_runs(id),
  snapshot_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists report_snapshots_latest_idx
on report_snapshots (tenant_id, report_key, created_at desc);

create index if not exists report_runs_latest_idx
on report_runs (tenant_id, report_key, started_at desc);

create table if not exists line_deliveries (
  id text primary key,
  tenant_id text not null references tenants(id),
  report_key text not null references report_definitions(report_key),
  report_run_id text not null references report_runs(id),
  target_id_masked text,
  message_type text not null,
  status text not null,
  sent_at timestamptz,
  provider_response_json jsonb,
  safe_error_message text,
  created_at timestamptz not null default now()
);

create index if not exists line_deliveries_latest_idx
on line_deliveries (tenant_id, report_key, created_at desc);

create table if not exists audit_logs (
  id bigserial primary key,
  tenant_id text,
  actor_id text,
  action text not null,
  target_type text not null,
  target_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
`;
