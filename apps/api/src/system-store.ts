import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import {
  type LineDeliveryRecord,
  type LineTargetRecord,
  type LineWebhookEventRecord,
  type ReportRunRecord,
  type SalesGoodsServicesSnapshot,
  type Tenant,
  type TenantId,
  type WorkerHeartbeatRecord,
} from "@ai-bcc/shared";
import type { StoredLineTargetRecord } from "./line-targets.js";
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
  getSnapshotByRunId(
    tenantId: TenantId,
    runId: string,
  ): Promise<SalesGoodsServicesSnapshot | null>;
  saveSnapshot(snapshot: SalesGoodsServicesSnapshot): Promise<void>;
  listRuns(tenantId: TenantId): Promise<ReportRunRecord[]>;
  upsertRun(run: ReportRunRecord): Promise<void>;
  saveLineDelivery(delivery: LineDeliveryRecord): Promise<void>;
  findSuccessfulLineDeliveryByKey(input: {
    tenantId: TenantId;
    deliveryKey: string;
  }): Promise<LineDeliveryRecord | null>;
  listLineDeliveries(tenantId: TenantId): Promise<LineDeliveryRecord[]>;
  listLineTargets(tenantId?: TenantId): Promise<StoredLineTargetRecord[]>;
  getLineTargetById(id: string): Promise<StoredLineTargetRecord | null>;
  getLineTargetByHash(input: {
    tenantId: TenantId;
    targetIdHash: string;
  }): Promise<StoredLineTargetRecord | null>;
  upsertLineTarget(
    target: StoredLineTargetRecord,
  ): Promise<StoredLineTargetRecord>;
  saveLineWebhookEvents(events: LineWebhookEventRecord[]): Promise<void>;
  listLineWebhookEvents(limit: number): Promise<LineWebhookEventRecord[]>;
  saveWorkerHeartbeat(
    heartbeat: Omit<WorkerHeartbeatRecord, "id" | "created_at">,
  ): Promise<WorkerHeartbeatRecord>;
  getLatestWorkerHeartbeat(role?: string): Promise<WorkerHeartbeatRecord | null>;
  appendAuditLog(entry: Omit<AuditLogEntry, "created_at">): Promise<void>;
  importAuditLogs(entries: AuditLogEntry[]): Promise<void>;
  listAuditLogs(limit: number): Promise<AuditLogEntry[]>;
  close(): Promise<void>;
};

type StoreFile = {
  tenants: Tenant[];
  reportDefinitions: ReportDefinitionSeed[];
  runs: ReportRunRecord[];
  snapshots: SalesGoodsServicesSnapshot[];
  lineDeliveries: LineDeliveryRecord[];
  lineTargets: StoredLineTargetRecord[];
  lineWebhookEvents: LineWebhookEventRecord[];
  workerHeartbeats: WorkerHeartbeatRecord[];
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

  async getSnapshotByRunId(tenantId: TenantId, runId: string) {
    const data = this.requireData();
    return (
      data.snapshots.find(
        (snapshot) =>
          snapshot.tenant_id === tenantId &&
          snapshot.report_key === "sales_goods_services" &&
          snapshot.run_id === runId,
      ) ?? null
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

  async findSuccessfulLineDeliveryByKey(input: {
    tenantId: TenantId;
    deliveryKey: string;
  }) {
    return (
      this.requireData().lineDeliveries.find(
        (delivery) =>
          delivery.tenant_id === input.tenantId &&
          delivery.delivery_key === input.deliveryKey &&
          delivery.status === "success",
      ) ?? null
    );
  }

  async listLineDeliveries(tenantId: TenantId) {
    return this.requireData().lineDeliveries
      .filter((delivery) => delivery.tenant_id === tenantId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50);
  }

  async listLineTargets(tenantId?: TenantId) {
    return this.requireData().lineTargets
      .filter((target) => !tenantId || target.tenant_id === tenantId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getLineTargetById(id: string) {
    return this.requireData().lineTargets.find((target) => target.id === id) ?? null;
  }

  async getLineTargetByHash(input: {
    tenantId: TenantId;
    targetIdHash: string;
  }) {
    return (
      this.requireData().lineTargets.find(
        (target) =>
          target.tenant_id === input.tenantId &&
          target.target_id_hash === input.targetIdHash,
      ) ?? null
    );
  }

  async upsertLineTarget(target: StoredLineTargetRecord) {
    const data = this.requireData();
    data.lineTargets = [
      target,
      ...data.lineTargets.filter((existing) => existing.id !== target.id),
    ];
    await this.persist();
    return target;
  }

  async saveLineWebhookEvents(events: LineWebhookEventRecord[]) {
    if (!events.length) {
      return;
    }

    const data = this.requireData();
    const incomingIds = new Set(events.map((event) => event.id));
    data.lineWebhookEvents = [
      ...events,
      ...data.lineWebhookEvents.filter((event) => !incomingIds.has(event.id)),
    ].slice(0, 200);
    await this.persist();
  }

  async listLineWebhookEvents(limit: number) {
    return this.requireData().lineWebhookEvents
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }

  async saveWorkerHeartbeat(
    heartbeat: Omit<WorkerHeartbeatRecord, "id" | "created_at">,
  ) {
    const data = this.requireData();
    const record: WorkerHeartbeatRecord = {
      ...heartbeat,
      id: `heartbeat_${heartbeat.worker_id}_${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    data.workerHeartbeats = [
      record,
      ...data.workerHeartbeats.filter((existing) => existing.id !== record.id),
    ].slice(0, 200);
    await this.persist();
    return record;
  }

  async getLatestWorkerHeartbeat(role?: string) {
    const data = this.requireData();
    return (
      data.workerHeartbeats
        .filter((heartbeat) => !role || heartbeat.role === role)
        .sort((a, b) => b.checked_at.localeCompare(a.checked_at))[0] ?? null
    );
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

  async importAuditLogs(entries: AuditLogEntry[]) {
    if (!entries.length) {
      return;
    }

    const data = this.requireData();
    const existingKeys = new Set(
      data.auditLogs.map((entry) => auditLogImportKey(entry)),
    );
    for (const entry of entries) {
      const key = auditLogImportKey(entry);
      if (!existingKeys.has(key)) {
        data.auditLogs.push(entry);
        existingKeys.add(key);
      }
    }
    data.auditLogs = data.auditLogs
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 1000);
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
        lineTargets: normalizeLineTargets(parsed.lineTargets),
        lineWebhookEvents: parsed.lineWebhookEvents ?? [],
        workerHeartbeats: parsed.workerHeartbeats ?? [],
        auditLogs: parsed.auditLogs ?? [],
      };
    } catch {
      return {
        tenants: [],
        reportDefinitions: [],
        runs: [],
        snapshots: [],
        lineDeliveries: [],
        lineTargets: [],
        lineWebhookEvents: [],
        workerHeartbeats: [],
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

  async getSnapshotByRunId(tenantId: TenantId, runId: string) {
    const result = await this.pool.query(
      `
select snapshot_json
from report_snapshots
where tenant_id = $1
  and report_key = 'sales_goods_services'
  and report_run_id = $2
limit 1
`,
      [tenantId, runId],
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
  delivery_key,
  delivery_type,
  period_from,
  period_to,
  target_id_masked,
  message_type,
  status,
  sent_at,
  provider_response_json,
  safe_error_message,
  created_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, $13::jsonb, $14, $15::timestamptz)
on conflict (id) do update
set status = excluded.status,
    delivery_key = excluded.delivery_key,
    delivery_type = excluded.delivery_type,
    period_from = excluded.period_from,
    period_to = excluded.period_to,
    target_id_masked = excluded.target_id_masked,
    message_type = excluded.message_type,
    sent_at = excluded.sent_at,
    provider_response_json = excluded.provider_response_json,
    safe_error_message = excluded.safe_error_message
`,
      [
        delivery.id,
        delivery.tenant_id,
        delivery.report_key,
        delivery.report_run_id,
        delivery.delivery_key,
        delivery.delivery_type,
        delivery.period_from,
        delivery.period_to,
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

  async findSuccessfulLineDeliveryByKey(input: {
    tenantId: TenantId;
    deliveryKey: string;
  }) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  report_key,
  report_run_id,
  delivery_key,
  delivery_type,
  period_from,
  period_to,
  target_id_masked,
  message_type,
  status,
  sent_at,
  provider_response_json,
  safe_error_message,
  created_at
from line_deliveries
where tenant_id = $1
  and report_key = 'sales_goods_services'
  and delivery_key = $2
  and status = 'success'
order by created_at desc
limit 1
`,
      [input.tenantId, input.deliveryKey],
    );

    return result.rows[0] ? mapLineDeliveryRow(result.rows[0]) : null;
  }

  async listLineDeliveries(tenantId: TenantId) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  report_key,
  report_run_id,
  delivery_key,
  delivery_type,
  period_from,
  period_to,
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

    return result.rows.map(mapLineDeliveryRow);
  }

  async listLineTargets(tenantId?: TenantId) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  display_name,
  target_type,
  target_id,
  target_id_masked,
  target_id_hash,
  access_profile_key,
  allowed_report_keys,
  allowed_actions,
  enabled,
  approved,
  source,
  last_delivery_at,
  created_at,
  updated_at
from line_targets
where ($1::text is null or tenant_id = $1)
order by updated_at desc
`,
      [tenantId ?? null],
    );

    return result.rows.map(mapLineTargetRow);
  }

  async getLineTargetById(id: string) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  display_name,
  target_type,
  target_id,
  target_id_masked,
  target_id_hash,
  access_profile_key,
  allowed_report_keys,
  allowed_actions,
  enabled,
  approved,
  source,
  last_delivery_at,
  created_at,
  updated_at
from line_targets
where id = $1
limit 1
`,
      [id],
    );

    return result.rows[0] ? mapLineTargetRow(result.rows[0]) : null;
  }

  async getLineTargetByHash(input: {
    tenantId: TenantId;
    targetIdHash: string;
  }) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  display_name,
  target_type,
  target_id,
  target_id_masked,
  target_id_hash,
  access_profile_key,
  allowed_report_keys,
  allowed_actions,
  enabled,
  approved,
  source,
  last_delivery_at,
  created_at,
  updated_at
from line_targets
where tenant_id = $1 and target_id_hash = $2
limit 1
`,
      [input.tenantId, input.targetIdHash],
    );

    return result.rows[0] ? mapLineTargetRow(result.rows[0]) : null;
  }

  async upsertLineTarget(target: StoredLineTargetRecord) {
    const result = await this.pool.query(
      `
insert into line_targets (
  id,
  tenant_id,
  display_name,
  target_type,
  target_id,
  target_id_masked,
  target_id_hash,
  access_profile_key,
  allowed_report_keys,
  allowed_actions,
  enabled,
  approved,
  source,
  last_delivery_at,
  created_at,
  updated_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14::timestamptz, $15::timestamptz, $16::timestamptz)
on conflict (id) do update
set display_name = excluded.display_name,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    target_id_masked = excluded.target_id_masked,
    target_id_hash = excluded.target_id_hash,
    access_profile_key = excluded.access_profile_key,
    allowed_report_keys = excluded.allowed_report_keys,
    allowed_actions = excluded.allowed_actions,
    enabled = excluded.enabled,
    approved = excluded.approved,
    source = excluded.source,
    last_delivery_at = excluded.last_delivery_at,
    updated_at = excluded.updated_at
returning
  id,
  tenant_id,
  display_name,
  target_type,
  target_id,
  target_id_masked,
  target_id_hash,
  access_profile_key,
  allowed_report_keys,
  allowed_actions,
  enabled,
  approved,
  source,
  last_delivery_at,
  created_at,
  updated_at
`,
      [
        target.id,
        target.tenant_id,
        target.display_name,
        target.target_type,
        target.target_id,
        target.target_id_masked,
        target.target_id_hash,
        target.access_profile_key,
        JSON.stringify(target.allowed_report_keys),
        JSON.stringify(target.allowed_actions),
        target.enabled,
        target.approved,
        target.source,
        target.last_delivery_at,
        target.created_at,
        target.updated_at,
      ],
    );

    return mapLineTargetRow(result.rows[0]);
  }

  async saveLineWebhookEvents(events: LineWebhookEventRecord[]) {
    for (const event of events) {
      await this.pool.query(
        `
insert into line_webhook_events (
  id,
  event_type,
  source_type,
  source_id,
  source_id_masked,
  user_id,
  message_text,
  raw_event_json,
  created_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)
on conflict (id) do update
set event_type = excluded.event_type,
    source_type = excluded.source_type,
    source_id = excluded.source_id,
    source_id_masked = excluded.source_id_masked,
    user_id = excluded.user_id,
    message_text = excluded.message_text,
    raw_event_json = excluded.raw_event_json,
    created_at = excluded.created_at
`,
        [
          event.id,
          event.event_type,
          event.source_type,
          event.source_id,
          event.source_id_masked,
          event.user_id,
          event.message_text,
          JSON.stringify(event.raw_event_json),
          event.created_at,
        ],
      );
    }
  }

  async listLineWebhookEvents(limit: number) {
    const result = await this.pool.query(
      `
select
  id,
  event_type,
  source_type,
  source_id,
  source_id_masked,
  user_id,
  message_text,
  raw_event_json,
  created_at
from line_webhook_events
order by created_at desc
limit $1
`,
      [limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      event_type: row.event_type,
      source_type: row.source_type,
      source_id: row.source_id,
      source_id_masked: row.source_id_masked,
      user_id: row.user_id,
      message_text: row.message_text,
      raw_event_json: row.raw_event_json,
      created_at: toIsoString(row.created_at),
    })) as LineWebhookEventRecord[];
  }

  async saveWorkerHeartbeat(
    heartbeat: Omit<WorkerHeartbeatRecord, "id" | "created_at">,
  ) {
    const id = `heartbeat_${heartbeat.worker_id}_${Date.now()}`;
    const createdAt = new Date().toISOString();
    const result = await this.pool.query(
      `
insert into worker_heartbeats (
  id,
  worker_id,
  role,
  status,
  metadata_json,
  checked_at,
  created_at
)
values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)
returning
  id,
  worker_id,
  role,
  status,
  metadata_json,
  checked_at,
  created_at
`,
      [
        id,
        heartbeat.worker_id,
        heartbeat.role,
        heartbeat.status,
        JSON.stringify(heartbeat.metadata_json),
        heartbeat.checked_at,
        createdAt,
      ],
    );

    return mapWorkerHeartbeatRow(result.rows[0]);
  }

  async getLatestWorkerHeartbeat(role?: string) {
    const result = await this.pool.query(
      `
select
  id,
  worker_id,
  role,
  status,
  metadata_json,
  checked_at,
  created_at
from worker_heartbeats
where ($1::text is null or role = $1)
order by checked_at desc
limit 1
`,
      [role ?? null],
    );

    return result.rows[0] ? mapWorkerHeartbeatRow(result.rows[0]) : null;
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

  async importAuditLogs(entries: AuditLogEntry[]) {
    for (const entry of entries) {
      if (entry.id !== undefined) {
        await this.pool.query(
          `
insert into audit_logs (
  id,
  tenant_id,
  actor_id,
  action,
  target_type,
  target_id,
  metadata_json,
  created_at
)
values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)
on conflict (id) do update
set tenant_id = excluded.tenant_id,
    actor_id = excluded.actor_id,
    action = excluded.action,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    metadata_json = excluded.metadata_json,
    created_at = excluded.created_at
`,
          [
            entry.id,
            entry.tenant_id,
            entry.actor_id,
            entry.action,
            entry.target_type,
            entry.target_id,
            JSON.stringify(entry.metadata_json),
            entry.created_at,
          ],
        );
        continue;
      }

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
values ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
`,
        [
          entry.tenant_id,
          entry.actor_id,
          entry.action,
          entry.target_type,
          entry.target_id,
          JSON.stringify(entry.metadata_json),
          entry.created_at,
        ],
      );
    }

    await this.pool.query(
      `
select setval(
  pg_get_serial_sequence('audit_logs', 'id'),
  greatest(coalesce((select max(id) from audit_logs), 1), 1),
  true
)
`,
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

function auditLogImportKey(entry: AuditLogEntry) {
  return [
    entry.id ?? "",
    entry.tenant_id ?? "",
    entry.action,
    entry.target_type,
    entry.target_id ?? "",
    entry.created_at,
  ].join(":");
}

function toDateOnly(value: unknown) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return typeof value === "string" ? value.slice(0, 10) : null;
}

function mapLineDeliveryRow(row: Record<string, unknown>): LineDeliveryRecord {
  return {
    id: String(row.id),
    tenant_id: row.tenant_id as TenantId,
    report_key: "sales_goods_services",
    report_run_id: String(row.report_run_id),
    delivery_key: typeof row.delivery_key === "string" ? row.delivery_key : null,
    delivery_type:
      row.delivery_type === "morning_brief" ? "morning_brief" : "manual_test",
    period_from: toDateOnly(row.period_from),
    period_to: toDateOnly(row.period_to),
    target_id_masked:
      typeof row.target_id_masked === "string" ? row.target_id_masked : null,
    message_type: row.message_type === "flex" ? "flex" : "text",
    status: row.status as LineDeliveryRecord["status"],
    sent_at: row.sent_at ? toIsoString(row.sent_at as string | Date) : null,
    provider_response_json:
      (row.provider_response_json as Record<string, unknown> | null) ?? null,
    safe_error_message:
      typeof row.safe_error_message === "string"
        ? row.safe_error_message
        : null,
    created_at: toIsoString(row.created_at as string | Date),
  };
}

function mapLineTargetRow(row: Record<string, unknown>): StoredLineTargetRecord {
  return {
    id: String(row.id),
    tenant_id: row.tenant_id as TenantId,
    display_name: String(row.display_name),
    target_type:
      row.target_type === "group" || row.target_type === "room"
        ? row.target_type
        : "user",
    target_id: String(row.target_id),
    target_id_masked: String(row.target_id_masked),
    target_id_hash: String(row.target_id_hash),
    access_profile_key: normalizeAccessProfile(row.access_profile_key),
    allowed_report_keys: normalizeReportKeys(row.allowed_report_keys),
    allowed_actions: normalizeLineActions(row.allowed_actions),
    enabled: Boolean(row.enabled),
    approved: Boolean(row.approved),
    source: normalizeLineTargetSource(row.source),
    last_delivery_at: row.last_delivery_at
      ? toIsoString(row.last_delivery_at as string | Date)
      : null,
    created_at: toIsoString(row.created_at as string | Date),
    updated_at: toIsoString(row.updated_at as string | Date),
  };
}

function mapWorkerHeartbeatRow(
  row: Record<string, unknown>,
): WorkerHeartbeatRecord {
  const status =
    row.status === "warning" || row.status === "error" ? row.status : "ok";

  return {
    id: String(row.id),
    worker_id: String(row.worker_id),
    role: String(row.role),
    status,
    metadata_json:
      (row.metadata_json as Record<string, unknown> | null) ?? {},
    checked_at: toIsoString(row.checked_at as string | Date),
    created_at: toIsoString(row.created_at as string | Date),
  };
}

function isNoSpaceError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOSPC"
  );
}

function normalizeLineTargets(
  value: unknown,
): StoredLineTargetRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((target) => normalizeLineTarget(target))
    .filter((target): target is StoredLineTargetRecord => Boolean(target));
}

function normalizeLineTarget(value: unknown): StoredLineTargetRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const target = value as Partial<StoredLineTargetRecord>;
  if (
    !target.id ||
    !target.tenant_id ||
    !target.target_id ||
    !target.target_id_hash ||
    !target.target_id_masked
  ) {
    return null;
  }

  return {
    id: String(target.id),
    tenant_id: target.tenant_id,
    display_name: String(target.display_name || "LINE target"),
    target_type:
      target.target_type === "group" || target.target_type === "room"
        ? target.target_type
        : "user",
    target_id: String(target.target_id),
    target_id_masked: String(target.target_id_masked),
    target_id_hash: String(target.target_id_hash),
    access_profile_key: normalizeAccessProfile(target.access_profile_key),
    allowed_report_keys: normalizeReportKeys(target.allowed_report_keys),
    allowed_actions: normalizeLineActions(target.allowed_actions),
    enabled: Boolean(target.enabled),
    approved: Boolean(target.approved),
    source: normalizeLineTargetSource(target.source),
    last_delivery_at: target.last_delivery_at ?? null,
    created_at: target.created_at ?? new Date().toISOString(),
    updated_at: target.updated_at ?? new Date().toISOString(),
  };
}

function normalizeAccessProfile(value: unknown) {
  if (
    value === "executive" ||
    value === "sales_manager" ||
    value === "operations" ||
    value === "staff"
  ) {
    return value;
  }

  return "staff";
}

function normalizeReportKeys(value: unknown): LineTargetRecord["allowed_report_keys"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is "sales_goods_services" => item === "sales_goods_services");
}

function normalizeLineActions(value: unknown): LineTargetRecord["allowed_actions"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (
      item,
    ): item is LineTargetRecord["allowed_actions"][number] =>
      item === "receive_morning_brief" ||
      item === "ask_report" ||
      item === "open_signed_viewer",
  );
}

function normalizeLineTargetSource(value: unknown): LineTargetRecord["source"] {
  if (value === "env_fallback" || value === "webhook" || value === "manual") {
    return value;
  }

  return "manual";
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

create index if not exists report_snapshots_run_idx
on report_snapshots (tenant_id, report_key, report_run_id);

create index if not exists report_runs_latest_idx
on report_runs (tenant_id, report_key, started_at desc);

create table if not exists line_deliveries (
  id text primary key,
  tenant_id text not null references tenants(id),
  report_key text not null references report_definitions(report_key),
  report_run_id text not null references report_runs(id),
  delivery_key text,
  delivery_type text not null default 'manual_test',
  period_from date,
  period_to date,
  target_id_masked text,
  message_type text not null,
  status text not null,
  sent_at timestamptz,
  provider_response_json jsonb,
  safe_error_message text,
  created_at timestamptz not null default now()
);

alter table line_deliveries
  add column if not exists delivery_key text,
  add column if not exists delivery_type text not null default 'manual_test',
  add column if not exists period_from date,
  add column if not exists period_to date;

create index if not exists line_deliveries_latest_idx
on line_deliveries (tenant_id, report_key, created_at desc);

create index if not exists line_deliveries_delivery_key_idx
on line_deliveries (tenant_id, report_key, delivery_key, status)
where delivery_key is not null;

create table if not exists line_targets (
  id text primary key,
  tenant_id text not null references tenants(id),
  display_name text not null,
  target_type text not null,
  target_id text not null,
  target_id_masked text not null,
  target_id_hash text not null,
  access_profile_key text not null,
  allowed_report_keys jsonb not null default '[]'::jsonb,
  allowed_actions jsonb not null default '[]'::jsonb,
  enabled boolean not null default false,
  approved boolean not null default false,
  source text not null default 'manual',
  last_delivery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, target_id_hash)
);

create index if not exists line_targets_tenant_idx
on line_targets (tenant_id, updated_at desc);

create table if not exists line_webhook_events (
  id text primary key,
  event_type text not null,
  source_type text not null,
  source_id text,
  source_id_masked text,
  user_id text,
  message_text text,
  raw_event_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists line_webhook_events_latest_idx
on line_webhook_events (created_at desc);

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

create table if not exists worker_heartbeats (
  id text primary key,
  worker_id text not null,
  role text not null,
  status text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists worker_heartbeats_latest_idx
on worker_heartbeats (role, checked_at desc);
`;
