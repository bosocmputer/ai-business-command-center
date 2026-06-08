import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  type BusinessSignalRecord,
  type BusinessSignalStatus,
  type BusinessSignalThresholdsConfig,
  type LineChannelRecord,
  type LineDeliveryRecord,
  type LineTargetRecord,
  type LineWebhookEventRecord,
  type NotificationRuleRecord,
  type NotificationRuleRunRecord,
  type PlanCode,
  type ReportKey,
  type ReportRunRecord,
  type ReportSnapshot,
  type Tenant,
  type TenantFeatureFlags,
  type TenantId,
  type LineAccessProfileKey,
  type TenantReportRolePermissionRecord,
  type TenantStatus,
  type UserRecord,
  type WorkerHeartbeatRecord,
  businessSignalCategorySchema,
  businessSignalSeveritySchema,
  businessSignalStatusSchema,
  businessSignalThresholdsSchema,
  notificationDigestModeSchema,
  reportKeySchema,
  tenantFeatureFlagsSchema,
} from "@ai-bcc/shared";
import type { StoredLineTargetRecord } from "./line-targets.js";
import { createSampleSnapshot } from "./sample-data.js";
import { readSystemDatabaseUrl } from "./bootstrap-config.js";

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
  report_key: ReportKey;
  name: string;
  version: string;
  contract_json: Record<string, unknown>;
};

export type SecretRecord = {
  id: string;
  tenant_id: TenantId | null;
  scope: "datasource" | "line_channel" | "system";
  secret_key: string;
  encrypted_value: string;
  encryption_key_id: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SecretMetadataRecord = Omit<SecretRecord, "encrypted_value"> & {
  has_encrypted_value: boolean;
};

export type TenantCancellationResult = {
  tenant: Tenant | null;
  disabledNotificationRuleCount: number;
  alreadyCancelled: boolean;
};

export type SystemStore = {
  readonly kind: "postgres" | "local-json";
  initialize(input: {
    tenants: Tenant[];
    reportDefinitions: ReportDefinitionSeed[];
  }): Promise<void>;
  listTenants(): Promise<Tenant[]>;
  upsertTenant(tenant: Tenant): Promise<Tenant>;
  updateTenantStatus(input: {
    tenantId: TenantId;
    status: TenantStatus;
    planCode?: PlanCode;
    suspendedReason?: string | null;
    currentPeriodEnd?: string | null;
  }): Promise<Tenant | null>;
  cancelTenant(input: {
    tenantId: TenantId;
    reason?: string | null;
    cancelledAt: string;
  }): Promise<TenantCancellationResult>;
  listUsers(tenantId?: TenantId): Promise<UserRecord[]>;
  upsertUser(user: UserRecord): Promise<UserRecord>;
  listLineChannels(tenantId?: TenantId): Promise<LineChannelRecord[]>;
  upsertLineChannel(channel: LineChannelRecord): Promise<LineChannelRecord>;
  getSecretRecord(id: string): Promise<SecretRecord | null>;
  upsertSecretRecord(secret: SecretRecord): Promise<SecretRecord>;
  listSecretMetadata(tenantId?: TenantId): Promise<SecretMetadataRecord[]>;
  getLatestSnapshot(
    tenantId: TenantId,
    reportKey?: ReportKey,
  ): Promise<ReportSnapshot | null>;
  getSnapshotByRunId(
    tenantId: TenantId,
    runId: string,
    reportKey?: ReportKey,
  ): Promise<ReportSnapshot | null>;
  saveSnapshot(snapshot: ReportSnapshot): Promise<void>;
  upsertBusinessSignals(
    signals: BusinessSignalRecord[],
  ): Promise<BusinessSignalRecord[]>;
  listBusinessSignals(input: {
    tenantId: TenantId;
    status?: BusinessSignalRecord["status"];
    limit?: number;
  }): Promise<BusinessSignalRecord[]>;
  updateBusinessSignalStatus(input: {
    tenantId: TenantId;
    signalId: string;
    status: BusinessSignalStatus;
    updatedAt: string;
  }): Promise<BusinessSignalRecord | null>;
  listRuns(tenantId: TenantId, reportKey?: ReportKey): Promise<ReportRunRecord[]>;
  upsertRun(run: ReportRunRecord): Promise<void>;
  saveLineDelivery(delivery: LineDeliveryRecord): Promise<void>;
  findSuccessfulLineDeliveryByKey(input: {
    tenantId: TenantId;
    deliveryKey: string;
  }): Promise<LineDeliveryRecord | null>;
  listLineDeliveries(tenantId: TenantId): Promise<LineDeliveryRecord[]>;
  listNotificationRules(tenantId?: TenantId): Promise<NotificationRuleRecord[]>;
  getNotificationRule(id: string): Promise<NotificationRuleRecord | null>;
  upsertNotificationRule(
    rule: NotificationRuleRecord,
  ): Promise<NotificationRuleRecord>;
  listNotificationRuleRuns(input?: {
    tenantId?: TenantId;
    ruleId?: string;
    limit?: number;
  }): Promise<NotificationRuleRunRecord[]>;
  getNotificationRuleRunByKey(
    idempotencyKey: string,
  ): Promise<NotificationRuleRunRecord | null>;
  upsertNotificationRuleRun(
    run: NotificationRuleRunRecord,
  ): Promise<NotificationRuleRunRecord>;
  listLineTargets(tenantId?: TenantId): Promise<StoredLineTargetRecord[]>;
  getLineTargetById(id: string): Promise<StoredLineTargetRecord | null>;
  getLineTargetByHash(input: {
    tenantId: TenantId;
    targetIdHash: string;
  }): Promise<StoredLineTargetRecord | null>;
  upsertLineTarget(
    target: StoredLineTargetRecord,
  ): Promise<StoredLineTargetRecord>;
  listTenantReportRolePermissions(
    tenantId: TenantId,
  ): Promise<TenantReportRolePermissionRecord[]>;
  saveTenantReportRolePermissions(input: {
    tenantId: TenantId;
    permissions: TenantReportRolePermissionRecord[];
  }): Promise<{
    permissions: TenantReportRolePermissionRecord[];
    updatedTargetCount: number;
  }>;
  saveLineWebhookEvents(events: LineWebhookEventRecord[]): Promise<void>;
  listLineWebhookEvents(limit: number): Promise<LineWebhookEventRecord[]>;
  saveWorkerHeartbeat(
    heartbeat: Omit<WorkerHeartbeatRecord, "id" | "created_at">,
  ): Promise<WorkerHeartbeatRecord>;
  getLatestWorkerHeartbeat(role?: string): Promise<WorkerHeartbeatRecord | null>;
  appendAuditLog(entry: Omit<AuditLogEntry, "created_at">): Promise<void>;
  importAuditLogs(entries: AuditLogEntry[]): Promise<void>;
  listAuditLogs(limit: number): Promise<AuditLogEntry[]>;
  createViewerToken(input: {
    tokenHash: string;
    tenantId: TenantId;
    runId: string;
    expiresAt: Date;
  }): Promise<void>;
  accessViewerToken(
    tokenHash: string,
    cookieSessionId: string | null,
  ): Promise<{
    ok: boolean;
    newSessionId?: string;
    reason?: "not_found" | "expired";
  }>;
  purgeExpiredViewerTokens(): Promise<void>;
  close(): Promise<void>;
};

type StoreFile = {
  tenants: Tenant[];
  reportDefinitions: ReportDefinitionSeed[];
  runs: ReportRunRecord[];
  snapshots: ReportSnapshot[];
  businessSignals: BusinessSignalRecord[];
  lineDeliveries: LineDeliveryRecord[];
  notificationRules: NotificationRuleRecord[];
  notificationRuleRuns: NotificationRuleRunRecord[];
  lineTargets: StoredLineTargetRecord[];
  reportRolePermissions: TenantReportRolePermissionRecord[];
  lineWebhookEvents: LineWebhookEventRecord[];
  workerHeartbeats: WorkerHeartbeatRecord[];
  auditLogs: AuditLogEntry[];
  users: UserRecord[];
  lineChannels: LineChannelRecord[];
  secrets: SecretRecord[];
};

export function createSystemStore(): SystemStore {
  const databaseUrl = readSystemDatabaseUrl();
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
    this.data.tenants = mergeTenants(this.data.tenants, input.tenants);
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

  async listTenants() {
    return this.requireData().tenants.map(normalizeTenantRecord);
  }

  async upsertTenant(tenant: Tenant) {
    const data = this.requireData();
    const normalizedTenant = normalizeTenantRecord(tenant);
    data.tenants = [
      normalizedTenant,
      ...data.tenants.filter((existing) => existing.id !== normalizedTenant.id),
    ].sort((a, b) => a.name.localeCompare(b.name));
    await this.persist();
    return normalizedTenant;
  }

  async updateTenantStatus(input: {
    tenantId: TenantId;
    status: TenantStatus;
    planCode?: PlanCode;
    suspendedReason?: string | null;
    currentPeriodEnd?: string | null;
  }) {
    const data = this.requireData();
    const tenant = data.tenants.find((item) => item.id === input.tenantId);
    if (!tenant) {
      return null;
    }

    const updated: Tenant = {
      ...tenant,
      status: input.status,
      planCode: input.planCode ?? tenant.planCode,
      suspendedReason:
        input.suspendedReason !== undefined
          ? input.suspendedReason
          : tenant.suspendedReason,
      currentPeriodEnd:
        input.currentPeriodEnd !== undefined
          ? input.currentPeriodEnd
          : tenant.currentPeriodEnd,
    };
    await this.upsertTenant(updated);
    return updated;
  }

  async cancelTenant(input: {
    tenantId: TenantId;
    reason?: string | null;
    cancelledAt: string;
  }): Promise<TenantCancellationResult> {
    const data = this.requireData();
    const tenant = data.tenants.find((item) => item.id === input.tenantId);
    if (!tenant) {
      return {
        tenant: null,
        disabledNotificationRuleCount: 0,
        alreadyCancelled: false,
      };
    }

    const alreadyCancelled = tenant.status === "cancelled";
    const updated: Tenant = alreadyCancelled
      ? tenant
      : {
          ...tenant,
          status: "cancelled",
          suspendedReason:
            input.reason?.trim() || "ยกเลิกร้านโดย Owner Admin",
        };

    let disabledNotificationRuleCount = 0;
    data.notificationRules = data.notificationRules.map((rule) => {
      if (rule.tenant_id !== input.tenantId || !rule.enabled) {
        return rule;
      }
      disabledNotificationRuleCount += 1;
      return {
        ...rule,
        enabled: false,
        updated_at: input.cancelledAt,
      };
    });

    if (!alreadyCancelled) {
      data.tenants = [
        updated,
        ...data.tenants.filter((existing) => existing.id !== input.tenantId),
      ].sort((a, b) => a.name.localeCompare(b.name));
    }

    if (!alreadyCancelled || disabledNotificationRuleCount > 0) {
      await this.persist();
    }

    return {
      tenant: updated,
      disabledNotificationRuleCount,
      alreadyCancelled,
    };
  }

  async listUsers(tenantId?: TenantId) {
    return this.requireData().users.filter(
      (user) => !tenantId || user.tenant_id === tenantId,
    );
  }

  async upsertUser(user: UserRecord) {
    const data = this.requireData();
    data.users = [
      user,
      ...data.users.filter((existing) => existing.id !== user.id),
    ];
    await this.persist();
    return user;
  }

  async listLineChannels(tenantId?: TenantId) {
    return this.requireData().lineChannels
      .filter((channel) => !tenantId || channel.tenant_id === tenantId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async upsertLineChannel(channel: LineChannelRecord) {
    const data = this.requireData();
    data.lineChannels = [
      channel,
      ...data.lineChannels.filter((existing) => existing.id !== channel.id),
    ];
    await this.persist();
    return channel;
  }

  async getSecretRecord(id: string) {
    return this.requireData().secrets.find((secret) => secret.id === id) ?? null;
  }

  async upsertSecretRecord(secret: SecretRecord) {
    const data = this.requireData();
    data.secrets = [
      secret,
      ...data.secrets.filter((existing) => existing.id !== secret.id),
    ];
    await this.persist();
    return secret;
  }

  async listSecretMetadata(tenantId?: TenantId) {
    return this.requireData().secrets
      .filter((secret) => !tenantId || secret.tenant_id === tenantId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(toSecretMetadata);
  }

  async getLatestSnapshot(
    tenantId: TenantId,
    reportKey: ReportKey = "sales_goods_services",
  ) {
    const data = this.requireData();
    return (
      data.snapshots
        .filter(
          (snapshot) =>
            snapshot.tenant_id === tenantId && snapshot.report_key === reportKey,
        )
        .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0] ?? null
    );
  }

  async getSnapshotByRunId(
    tenantId: TenantId,
    runId: string,
    reportKey: ReportKey = "sales_goods_services",
  ) {
    const data = this.requireData();
    return (
      data.snapshots.find(
        (snapshot) =>
          snapshot.tenant_id === tenantId &&
          snapshot.report_key === reportKey &&
          snapshot.run_id === runId,
      ) ?? null
    );
  }

  async saveSnapshot(snapshot: ReportSnapshot) {
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

  async upsertBusinessSignals(signals: BusinessSignalRecord[]) {
    if (!signals.length) {
      return [];
    }
    const data = this.requireData();
    const existingByKey = new Map(
      data.businessSignals.map((signal) => [businessSignalDedupeKey(signal), signal]),
    );
    const saved = signals.map((signal) => {
      const existing = existingByKey.get(businessSignalDedupeKey(signal));
      return {
        ...signal,
        id: existing?.id ?? signal.id,
        status: existing?.status ?? signal.status,
        created_at: existing?.created_at ?? signal.created_at,
        updated_at: signal.updated_at,
      };
    });
    const savedKeys = new Set(saved.map(businessSignalDedupeKey));
    data.businessSignals = [
      ...saved,
      ...data.businessSignals.filter(
        (signal) => !savedKeys.has(businessSignalDedupeKey(signal)),
      ),
    ]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 2000);
    await this.persist();
    return saved;
  }

  async listBusinessSignals(input: {
    tenantId: TenantId;
    status?: BusinessSignalRecord["status"];
    limit?: number;
  }) {
    return this.requireData().businessSignals
      .filter(
        (signal) =>
          signal.tenant_id === input.tenantId &&
          (!input.status || signal.status === input.status),
      )
      .sort(compareBusinessSignals)
      .slice(0, input.limit ?? 50);
  }

  async updateBusinessSignalStatus(input: {
    tenantId: TenantId;
    signalId: string;
    status: BusinessSignalStatus;
    updatedAt: string;
  }) {
    const data = this.requireData();
    const signal = data.businessSignals.find(
      (item) => item.tenant_id === input.tenantId && item.id === input.signalId,
    );
    if (!signal) {
      return null;
    }
    const updated: BusinessSignalRecord = {
      ...signal,
      status: input.status,
      updated_at: input.updatedAt,
    };
    data.businessSignals = data.businessSignals
      .map((item) => (item.id === signal.id ? updated : item))
      .sort(compareBusinessSignals);
    await this.persist();
    return updated;
  }

  async listRuns(tenantId: TenantId, reportKey?: ReportKey) {
    const data = this.requireData();
    return data.runs
      .filter(
        (run) => run.tenant_id === tenantId && (!reportKey || run.report_key === reportKey),
      )
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

  async listNotificationRules(tenantId?: TenantId) {
    return this.requireData().notificationRules
      .filter((rule) => !tenantId || rule.tenant_id === tenantId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getNotificationRule(id: string) {
    return (
      this.requireData().notificationRules.find((rule) => rule.id === id) ??
      null
    );
  }

  async upsertNotificationRule(rule: NotificationRuleRecord) {
    const data = this.requireData();
    data.notificationRules = [
      rule,
      ...data.notificationRules.filter((existing) => existing.id !== rule.id),
    ].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    await this.persist();
    return rule;
  }

  async listNotificationRuleRuns(input?: {
    tenantId?: TenantId;
    ruleId?: string;
    limit?: number;
  }) {
    return this.requireData().notificationRuleRuns
      .filter(
        (run) =>
          (!input?.tenantId || run.tenant_id === input.tenantId) &&
          (!input?.ruleId || run.rule_id === input.ruleId),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, input?.limit ?? 50);
  }

  async getNotificationRuleRunByKey(idempotencyKey: string) {
    return (
      this.requireData().notificationRuleRuns.find(
        (run) => run.idempotency_key === idempotencyKey,
      ) ?? null
    );
  }

  async upsertNotificationRuleRun(run: NotificationRuleRunRecord) {
    const data = this.requireData();
    data.notificationRuleRuns = [
      run,
      ...data.notificationRuleRuns.filter((existing) => existing.id !== run.id),
    ]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 1000);
    await this.persist();
    return run;
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

  async listTenantReportRolePermissions(tenantId: TenantId) {
    return this.requireData().reportRolePermissions
      .filter((permission) => permission.tenant_id === tenantId)
      .sort((a, b) => a.access_profile_key.localeCompare(b.access_profile_key));
  }

  async saveTenantReportRolePermissions(input: {
    tenantId: TenantId;
    permissions: TenantReportRolePermissionRecord[];
  }) {
    const data = this.requireData();
    const incomingProfileKeys = new Set(
      input.permissions.map((permission) => permission.access_profile_key),
    );
    data.reportRolePermissions = [
      ...input.permissions,
      ...data.reportRolePermissions.filter(
        (permission) =>
          permission.tenant_id !== input.tenantId ||
          !incomingProfileKeys.has(permission.access_profile_key),
      ),
    ];

    const permissionByRole = new Map<LineAccessProfileKey, ReportKey[]>(
      input.permissions.map((permission) => [
        permission.access_profile_key,
        permission.allowed_report_keys,
      ]),
    );
    let updatedTargetCount = 0;
    data.lineTargets = data.lineTargets.map((target) => {
      if (target.tenant_id !== input.tenantId) {
        return target;
      }
      const allowedReportKeys = permissionByRole.get(target.access_profile_key);
      if (!allowedReportKeys) {
        return target;
      }
      updatedTargetCount += 1;
      return {
        ...target,
        allowed_report_keys: [...allowedReportKeys],
        updated_at: new Date().toISOString(),
      };
    });

    await this.persist();
    return {
      permissions: input.permissions,
      updatedTargetCount,
    };
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

  async createViewerToken(_input: {
    tokenHash: string;
    tenantId: TenantId;
    runId: string;
    expiresAt: Date;
  }) {
    // local-json store: OTT not enforced in dev/test mode
  }

  async accessViewerToken(
    _tokenHash: string,
    _cookieSessionId: string | null,
  ): Promise<{ ok: boolean; newSessionId?: string }> {
    // local-json store: always allow (no enforcement in dev mode)
    return { ok: true };
  }

  async purgeExpiredViewerTokens() {
    // local-json store: no-op
  }

  async close() {
    await this.writeQueue;
  }

  private async load(): Promise<StoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      return {
        tenants: normalizeTenants(parsed.tenants),
        reportDefinitions: parsed.reportDefinitions ?? [],
        runs: parsed.runs ?? [],
        snapshots: parsed.snapshots ?? [],
        businessSignals: normalizeBusinessSignals(parsed.businessSignals),
        lineDeliveries: parsed.lineDeliveries ?? [],
        notificationRules: normalizeNotificationRules(parsed.notificationRules),
        notificationRuleRuns: normalizeNotificationRuleRuns(
          parsed.notificationRuleRuns,
        ),
        lineTargets: normalizeLineTargets(parsed.lineTargets),
        reportRolePermissions: normalizeReportRolePermissions(
          parsed.reportRolePermissions,
        ),
        lineWebhookEvents: parsed.lineWebhookEvents ?? [],
        workerHeartbeats: parsed.workerHeartbeats ?? [],
        auditLogs: parsed.auditLogs ?? [],
        users: normalizeUsers(parsed.users),
        lineChannels: normalizeLineChannels(parsed.lineChannels),
        secrets: normalizeSecrets(parsed.secrets),
      };
    } catch {
      return {
        tenants: [],
        reportDefinitions: [],
        runs: [],
        snapshots: [],
        businessSignals: [],
        lineDeliveries: [],
        notificationRules: [],
        notificationRuleRuns: [],
        lineTargets: [],
        reportRolePermissions: [],
        lineWebhookEvents: [],
        workerHeartbeats: [],
        auditLogs: [],
        users: [],
        lineChannels: [],
        secrets: [],
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
      await this.upsertSeedTenant(tenant);
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

  async listTenants() {
    const result = await this.pool.query(
      `
select id, name, status, plan_code, database_name, description, datasource_configured, feature_flags_json, business_signal_thresholds_json, suspended_reason, current_period_end
from tenants
order by name asc
`,
    );

    return result.rows.map(mapTenantRow);
  }

  private async upsertSeedTenant(tenant: Tenant) {
    await this.pool.query(
      `
insert into tenants (
  id,
  name,
  status,
  plan_code,
  database_name,
  description,
  datasource_configured,
  feature_flags_json,
  business_signal_thresholds_json,
  suspended_reason,
  current_period_end
)
values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::timestamptz)
on conflict (id) do update
set name = excluded.name,
    database_name = excluded.database_name,
    description = excluded.description,
    datasource_configured = excluded.datasource_configured,
    feature_flags_json = coalesce(tenants.feature_flags_json, excluded.feature_flags_json),
    business_signal_thresholds_json = coalesce(tenants.business_signal_thresholds_json, excluded.business_signal_thresholds_json)
`,
      [
        tenant.id,
        tenant.name,
        tenant.status,
        tenant.planCode,
        tenant.databaseName,
        tenant.description,
        tenant.datasourceConfigured,
        JSON.stringify(normalizeTenantFeatureFlags(tenant.featureFlags)),
        JSON.stringify(
          normalizeBusinessSignalThresholds(tenant.businessSignalThresholds),
        ),
        tenant.suspendedReason,
        tenant.currentPeriodEnd,
      ],
    );
  }

  async upsertTenant(tenant: Tenant) {
    const result = await this.pool.query(
      `
insert into tenants (
  id,
  name,
  status,
  plan_code,
  database_name,
  description,
  datasource_configured,
  feature_flags_json,
  business_signal_thresholds_json,
  suspended_reason,
  current_period_end
)
values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::timestamptz)
on conflict (id) do update
set name = excluded.name,
    status = excluded.status,
    plan_code = excluded.plan_code,
    database_name = excluded.database_name,
    description = excluded.description,
    datasource_configured = excluded.datasource_configured,
    feature_flags_json = excluded.feature_flags_json,
    business_signal_thresholds_json = excluded.business_signal_thresholds_json,
    suspended_reason = excluded.suspended_reason,
    current_period_end = excluded.current_period_end
returning id, name, status, plan_code, database_name, description, datasource_configured, feature_flags_json, business_signal_thresholds_json, suspended_reason, current_period_end
`,
      [
        tenant.id,
        tenant.name,
        tenant.status,
        tenant.planCode,
        tenant.databaseName,
        tenant.description,
        tenant.datasourceConfigured,
        JSON.stringify(normalizeTenantFeatureFlags(tenant.featureFlags)),
        JSON.stringify(
          normalizeBusinessSignalThresholds(tenant.businessSignalThresholds),
        ),
        tenant.suspendedReason,
        tenant.currentPeriodEnd,
      ],
    );

    return mapTenantRow(result.rows[0]);
  }

  async updateTenantStatus(input: {
    tenantId: TenantId;
    status: TenantStatus;
    planCode?: PlanCode;
    suspendedReason?: string | null;
    currentPeriodEnd?: string | null;
  }) {
    const result = await this.pool.query(
      `
update tenants
set status = $2,
    plan_code = coalesce($3, plan_code),
    suspended_reason = $4,
    current_period_end = $5::timestamptz
where id = $1
returning id, name, status, plan_code, database_name, description, datasource_configured, feature_flags_json, business_signal_thresholds_json, suspended_reason, current_period_end
`,
      [
        input.tenantId,
        input.status,
        input.planCode ?? null,
        input.suspendedReason ?? null,
        input.currentPeriodEnd ?? null,
      ],
    );

    return result.rows[0] ? mapTenantRow(result.rows[0]) : null;
  }

  async cancelTenant(input: {
    tenantId: TenantId;
    reason?: string | null;
    cancelledAt: string;
  }): Promise<TenantCancellationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      const currentResult = await client.query(
        `
select id, name, status, plan_code, database_name, description, datasource_configured, feature_flags_json, business_signal_thresholds_json, suspended_reason, current_period_end
from tenants
where id = $1
for update
`,
        [input.tenantId],
      );

      if (!currentResult.rows[0]) {
        await client.query("rollback");
        return {
          tenant: null,
          disabledNotificationRuleCount: 0,
          alreadyCancelled: false,
        };
      }

      const current = mapTenantRow(currentResult.rows[0]);
      const disabledResult = await client.query(
        `
update notification_rules
set enabled = false,
    updated_at = $2::timestamptz
where tenant_id = $1
  and enabled = true
returning id
`,
        [input.tenantId, input.cancelledAt],
      );

      const alreadyCancelled = current.status === "cancelled";
      let tenant = current;
      if (!alreadyCancelled) {
        const updatedResult = await client.query(
          `
update tenants
set status = 'cancelled',
    suspended_reason = $2
where id = $1
returning id, name, status, plan_code, database_name, description, datasource_configured, feature_flags_json, business_signal_thresholds_json, suspended_reason, current_period_end
`,
          [
            input.tenantId,
            input.reason?.trim() || "ยกเลิกร้านโดย Owner Admin",
          ],
        );
        tenant = mapTenantRow(updatedResult.rows[0]);
      }

      await client.query("commit");
      return {
        tenant,
        disabledNotificationRuleCount: disabledResult.rowCount ?? 0,
        alreadyCancelled,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listUsers(tenantId?: TenantId) {
    const result = await this.pool.query(
      `
select id, email, display_name, role, tenant_id, enabled, created_at, updated_at
from users
where ($1::text is null or tenant_id = $1)
order by created_at desc
`,
      [tenantId ?? null],
    );

    return result.rows.map(mapUserRow);
  }

  async upsertUser(user: UserRecord) {
    const result = await this.pool.query(
      `
insert into users (
  id, email, display_name, role, tenant_id, enabled, created_at, updated_at
)
values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
on conflict (id) do update
set email = excluded.email,
    display_name = excluded.display_name,
    role = excluded.role,
    tenant_id = excluded.tenant_id,
    enabled = excluded.enabled,
    updated_at = excluded.updated_at
returning id, email, display_name, role, tenant_id, enabled, created_at, updated_at
`,
      [
        user.id,
        user.email,
        user.display_name,
        user.role,
        user.tenant_id,
        user.enabled,
        user.created_at,
        user.updated_at,
      ],
    );

    return mapUserRow(result.rows[0]);
  }

  async listLineChannels(tenantId?: TenantId) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  display_name,
  channel_type,
  scope,
  channel_access_token_configured,
  channel_secret_configured,
  enabled,
  source,
  created_at,
  updated_at
from line_channels
where ($1::text is null or tenant_id = $1)
order by updated_at desc
`,
      [tenantId ?? null],
    );

    return result.rows.map(mapLineChannelRow);
  }

  async upsertLineChannel(channel: LineChannelRecord) {
    const result = await this.pool.query(
      `
insert into line_channels (
  id,
  tenant_id,
  display_name,
  channel_type,
  scope,
  channel_access_token_configured,
  channel_secret_configured,
  enabled,
  source,
  created_at,
  updated_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)
on conflict (id) do update
set display_name = excluded.display_name,
    channel_type = excluded.channel_type,
    scope = excluded.scope,
    channel_access_token_configured = excluded.channel_access_token_configured,
    channel_secret_configured = excluded.channel_secret_configured,
    enabled = excluded.enabled,
    source = excluded.source,
    updated_at = excluded.updated_at
returning
  id,
  tenant_id,
  display_name,
  channel_type,
  scope,
  channel_access_token_configured,
  channel_secret_configured,
  enabled,
  source,
  created_at,
  updated_at
`,
      [
        channel.id,
        channel.tenant_id,
        channel.display_name,
        channel.channel_type,
        channel.scope ?? "tenant",
        channel.channel_access_token_configured,
        channel.channel_secret_configured,
        channel.enabled,
        channel.source,
        channel.created_at,
        channel.updated_at,
      ],
    );

    return mapLineChannelRow(result.rows[0]);
  }

  async getSecretRecord(id: string) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  scope,
  secret_key,
  encrypted_value,
  encryption_key_id,
  metadata_json,
  created_at,
  updated_at
from secrets
where id = $1
limit 1
`,
      [id],
    );

    return result.rows[0] ? mapSecretRow(result.rows[0]) : null;
  }

  async upsertSecretRecord(secret: SecretRecord) {
    const result = await this.pool.query(
      `
insert into secrets (
  id,
  tenant_id,
  scope,
  secret_key,
  encrypted_value,
  encryption_key_id,
  metadata_json,
  created_at,
  updated_at
)
values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9::timestamptz)
on conflict (id) do update
set tenant_id = excluded.tenant_id,
    scope = excluded.scope,
    secret_key = excluded.secret_key,
    encrypted_value = excluded.encrypted_value,
    encryption_key_id = excluded.encryption_key_id,
    metadata_json = excluded.metadata_json,
    updated_at = excluded.updated_at
returning
  id,
  tenant_id,
  scope,
  secret_key,
  encrypted_value,
  encryption_key_id,
  metadata_json,
  created_at,
  updated_at
`,
      [
        secret.id,
        secret.tenant_id,
        secret.scope,
        secret.secret_key,
        secret.encrypted_value,
        secret.encryption_key_id,
        JSON.stringify(secret.metadata_json),
        secret.created_at,
        secret.updated_at,
      ],
    );

    return mapSecretRow(result.rows[0]);
  }

  async listSecretMetadata(tenantId?: TenantId) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  scope,
  secret_key,
  encrypted_value,
  encryption_key_id,
  metadata_json,
  created_at,
  updated_at
from secrets
where ($1::text is null or tenant_id = $1)
order by updated_at desc
`,
      [tenantId ?? null],
    );

    return result.rows.map((row) => toSecretMetadata(mapSecretRow(row)));
  }

  async getLatestSnapshot(
    tenantId: TenantId,
    reportKey: ReportKey = "sales_goods_services",
  ) {
    const result = await this.pool.query(
      `
select snapshot_json
from report_snapshots
where tenant_id = $1 and report_key = $2
order by created_at desc
limit 1
`,
      [tenantId, reportKey],
    );

    return (
      (result.rows[0]?.snapshot_json as ReportSnapshot | undefined) ??
      null
    );
  }

  async getSnapshotByRunId(
    tenantId: TenantId,
    runId: string,
    reportKey: ReportKey = "sales_goods_services",
  ) {
    const result = await this.pool.query(
      `
select snapshot_json
from report_snapshots
where tenant_id = $1
  and report_key = $2
  and report_run_id = $3
limit 1
`,
      [tenantId, reportKey, runId],
    );

    return (
      (result.rows[0]?.snapshot_json as ReportSnapshot | undefined) ??
      null
    );
  }

  async saveSnapshot(snapshot: ReportSnapshot) {
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

  async upsertBusinessSignals(signals: BusinessSignalRecord[]) {
    if (!signals.length) {
      return [];
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const saved: BusinessSignalRecord[] = [];
      for (const signal of signals) {
        const result = await client.query(
          `
insert into business_signals (
  id,
  tenant_id,
  signal_key,
  category,
  severity,
  title,
  insight,
  recommended_action,
  amount_impact,
  source_report_key,
  source_run_id,
  period_from,
  period_to,
  dimension_type,
  dimension_id,
  rule_version,
  status,
  evidence_json,
  created_at,
  updated_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13::date, $14, $15, $16, $17, $18::jsonb, $19::timestamptz, $20::timestamptz)
on conflict (tenant_id, signal_key, period_from, period_to, dimension_type, dimension_id) do update
set category = excluded.category,
    severity = excluded.severity,
    title = excluded.title,
    insight = excluded.insight,
    recommended_action = excluded.recommended_action,
    amount_impact = excluded.amount_impact,
    source_report_key = excluded.source_report_key,
    source_run_id = excluded.source_run_id,
    rule_version = excluded.rule_version,
    evidence_json = excluded.evidence_json,
    updated_at = excluded.updated_at
returning
  id,
  tenant_id,
  signal_key,
  category,
  severity,
  title,
  insight,
  recommended_action,
  amount_impact,
  source_report_key,
  source_run_id,
  period_from,
  period_to,
  dimension_type,
  dimension_id,
  rule_version,
  status,
  evidence_json,
  created_at,
  updated_at
`,
          [
            signal.id,
            signal.tenant_id,
            signal.signal_key,
            signal.category,
            signal.severity,
            signal.title,
            signal.insight,
            signal.recommended_action,
            signal.amount_impact,
            signal.source_report_key,
            signal.source_run_id,
            signal.period_from,
            signal.period_to,
            signal.dimension_type,
            signal.dimension_id,
            signal.rule_version,
            signal.status,
            JSON.stringify(signal.evidence_json),
            signal.created_at,
            signal.updated_at,
          ],
        );
        saved.push(mapBusinessSignalRow(result.rows[0]));
      }
      await client.query("commit");
      return saved;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listBusinessSignals(input: {
    tenantId: TenantId;
    status?: BusinessSignalRecord["status"];
    limit?: number;
  }) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  signal_key,
  category,
  severity,
  title,
  insight,
  recommended_action,
  amount_impact,
  source_report_key,
  source_run_id,
  period_from,
  period_to,
  dimension_type,
  dimension_id,
  rule_version,
  status,
  evidence_json,
  created_at,
  updated_at
from business_signals
where tenant_id = $1
  and ($2::text is null or status = $2)
order by
  case severity when 'critical' then 3 when 'warning' then 2 else 1 end desc,
  coalesce(amount_impact, 0) desc,
  updated_at desc
limit $3
`,
      [input.tenantId, input.status ?? null, input.limit ?? 50],
    );

    return result.rows.map(mapBusinessSignalRow);
  }

  async updateBusinessSignalStatus(input: {
    tenantId: TenantId;
    signalId: string;
    status: BusinessSignalStatus;
    updatedAt: string;
  }) {
    const result = await this.pool.query(
      `
update business_signals
set status = $3,
    updated_at = $4::timestamptz
where tenant_id = $1
  and id = $2
returning
  id,
  tenant_id,
  signal_key,
  category,
  severity,
  title,
  insight,
  recommended_action,
  amount_impact,
  source_report_key,
  source_run_id,
  period_from,
  period_to,
  dimension_type,
  dimension_id,
  rule_version,
  status,
  evidence_json,
  created_at,
  updated_at
`,
      [input.tenantId, input.signalId, input.status, input.updatedAt],
    );

    return result.rows[0] ? mapBusinessSignalRow(result.rows[0]) : null;
  }

  async listRuns(tenantId: TenantId, reportKey?: ReportKey) {
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
where tenant_id = $1
  and ($2::text is null or report_key = $2)
order by started_at desc
limit 50
`,
      [tenantId, reportKey ?? null],
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
where tenant_id = $1
order by created_at desc
limit 50
`,
      [tenantId],
    );

    return result.rows.map(mapLineDeliveryRow);
  }

  async listNotificationRules(tenantId?: TenantId) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  name,
  enabled,
  timezone,
  period_preset,
  schedule_json,
  report_keys_json,
  target_ids_json,
  message_packaging,
  digest_mode,
  retry_policy_json,
  last_run_at,
  last_run_status,
  last_safe_error_message,
  created_at,
  updated_at
from notification_rules
where ($1::text is null or tenant_id = $1)
order by updated_at desc
`,
      [tenantId ?? null],
    );

    return result.rows.map(mapNotificationRuleRow);
  }

  async getNotificationRule(id: string) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  name,
  enabled,
  timezone,
  period_preset,
  schedule_json,
  report_keys_json,
  target_ids_json,
  message_packaging,
  digest_mode,
  retry_policy_json,
  last_run_at,
  last_run_status,
  last_safe_error_message,
  created_at,
  updated_at
from notification_rules
where id = $1
limit 1
`,
      [id],
    );

    return result.rows[0] ? mapNotificationRuleRow(result.rows[0]) : null;
  }

  async upsertNotificationRule(rule: NotificationRuleRecord) {
    const result = await this.pool.query(
      `
insert into notification_rules (
  id,
  tenant_id,
  name,
  enabled,
  timezone,
  period_preset,
  schedule_json,
  report_keys_json,
  target_ids_json,
  message_packaging,
  digest_mode,
  retry_policy_json,
  last_run_at,
  last_run_status,
  last_safe_error_message,
  created_at,
  updated_at
)
values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12::jsonb, $13::timestamptz, $14, $15, $16::timestamptz, $17::timestamptz)
on conflict (id) do update
set name = excluded.name,
    enabled = excluded.enabled,
    timezone = excluded.timezone,
    period_preset = excluded.period_preset,
    schedule_json = excluded.schedule_json,
    report_keys_json = excluded.report_keys_json,
    target_ids_json = excluded.target_ids_json,
    message_packaging = excluded.message_packaging,
    digest_mode = excluded.digest_mode,
    retry_policy_json = excluded.retry_policy_json,
    last_run_at = excluded.last_run_at,
    last_run_status = excluded.last_run_status,
    last_safe_error_message = excluded.last_safe_error_message,
    updated_at = excluded.updated_at
returning
  id,
  tenant_id,
  name,
  enabled,
  timezone,
  period_preset,
  schedule_json,
  report_keys_json,
  target_ids_json,
  message_packaging,
  digest_mode,
  retry_policy_json,
  last_run_at,
  last_run_status,
  last_safe_error_message,
  created_at,
  updated_at
`,
      [
        rule.id,
        rule.tenant_id,
        rule.name,
        rule.enabled,
        rule.timezone,
        rule.period_preset,
        JSON.stringify(rule.schedule),
        JSON.stringify(rule.report_keys),
        JSON.stringify(rule.target_ids),
        rule.message_packaging,
        rule.digest_mode,
        JSON.stringify(rule.retry_policy),
        rule.last_run_at,
        rule.last_run_status,
        rule.last_safe_error_message,
        rule.created_at,
        rule.updated_at,
      ],
    );

    return mapNotificationRuleRow(result.rows[0]);
  }

  async listNotificationRuleRuns(input?: {
    tenantId?: TenantId;
    ruleId?: string;
    limit?: number;
  }) {
    const result = await this.pool.query(
      `
select
  id,
  rule_id,
  tenant_id,
  scheduled_local_date,
  scheduled_local_time,
  timezone,
  period_from,
  period_to,
  status,
  attempt,
  idempotency_key,
  report_run_ids_json,
  delivery_ids_json,
  safe_error_message,
  started_at,
  finished_at,
  next_retry_at,
  created_at,
  updated_at
from notification_rule_runs
where ($1::text is null or tenant_id = $1)
  and ($2::text is null or rule_id = $2)
order by created_at desc
limit $3
`,
      [input?.tenantId ?? null, input?.ruleId ?? null, input?.limit ?? 50],
    );

    return result.rows.map(mapNotificationRuleRunRow);
  }

  async getNotificationRuleRunByKey(idempotencyKey: string) {
    const result = await this.pool.query(
      `
select
  id,
  rule_id,
  tenant_id,
  scheduled_local_date,
  scheduled_local_time,
  timezone,
  period_from,
  period_to,
  status,
  attempt,
  idempotency_key,
  report_run_ids_json,
  delivery_ids_json,
  safe_error_message,
  started_at,
  finished_at,
  next_retry_at,
  created_at,
  updated_at
from notification_rule_runs
where idempotency_key = $1
limit 1
`,
      [idempotencyKey],
    );

    return result.rows[0] ? mapNotificationRuleRunRow(result.rows[0]) : null;
  }

  async upsertNotificationRuleRun(run: NotificationRuleRunRecord) {
    const result = await this.pool.query(
      `
insert into notification_rule_runs (
  id,
  rule_id,
  tenant_id,
  scheduled_local_date,
  scheduled_local_time,
  timezone,
  period_from,
  period_to,
  status,
  attempt,
  idempotency_key,
  report_run_ids_json,
  delivery_ids_json,
  safe_error_message,
  started_at,
  finished_at,
  next_retry_at,
  created_at,
  updated_at
)
values ($1, $2, $3, $4::date, $5, $6, $7::date, $8::date, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15::timestamptz, $16::timestamptz, $17::timestamptz, $18::timestamptz, $19::timestamptz)
on conflict (id) do update
set status = excluded.status,
    attempt = excluded.attempt,
    report_run_ids_json = excluded.report_run_ids_json,
    delivery_ids_json = excluded.delivery_ids_json,
    safe_error_message = excluded.safe_error_message,
    started_at = excluded.started_at,
    finished_at = excluded.finished_at,
    next_retry_at = excluded.next_retry_at,
    updated_at = excluded.updated_at
returning
  id,
  rule_id,
  tenant_id,
  scheduled_local_date,
  scheduled_local_time,
  timezone,
  period_from,
  period_to,
  status,
  attempt,
  idempotency_key,
  report_run_ids_json,
  delivery_ids_json,
  safe_error_message,
  started_at,
  finished_at,
  next_retry_at,
  created_at,
  updated_at
`,
      [
        run.id,
        run.rule_id,
        run.tenant_id,
        run.scheduled_local_date,
        run.scheduled_local_time,
        run.timezone,
        run.period_from,
        run.period_to,
        run.status,
        run.attempt,
        run.idempotency_key,
        JSON.stringify(run.report_run_ids),
        JSON.stringify(run.delivery_ids),
        run.safe_error_message,
        run.started_at,
        run.finished_at,
        run.next_retry_at,
        run.created_at,
        run.updated_at,
      ],
    );

    return mapNotificationRuleRunRow(result.rows[0]);
  }

  async listLineTargets(tenantId?: TenantId) {
    const result = await this.pool.query(
      `
select
  id,
  tenant_id,
  line_channel_id,
  display_name,
  target_type,
  target_id,
  target_id_masked,
  target_id_hash,
  recipient_count_estimate,
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
  line_channel_id,
  display_name,
  target_type,
  target_id,
  target_id_masked,
  target_id_hash,
  recipient_count_estimate,
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
  line_channel_id,
  display_name,
  target_type,
  target_id,
  target_id_masked,
  target_id_hash,
  recipient_count_estimate,
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
  line_channel_id,
  display_name,
  target_type,
  target_id,
  target_id_masked,
  target_id_hash,
  recipient_count_estimate,
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
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16::timestamptz, $17::timestamptz, $18::timestamptz)
on conflict (id) do update
set line_channel_id = excluded.line_channel_id,
    display_name = excluded.display_name,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    target_id_masked = excluded.target_id_masked,
    target_id_hash = excluded.target_id_hash,
    recipient_count_estimate = excluded.recipient_count_estimate,
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
  line_channel_id,
  display_name,
  target_type,
  target_id,
  target_id_masked,
  target_id_hash,
  recipient_count_estimate,
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
        target.line_channel_id,
        target.display_name,
        target.target_type,
        target.target_id,
        target.target_id_masked,
        target.target_id_hash,
        target.recipient_count_estimate ?? null,
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

  async listTenantReportRolePermissions(tenantId: TenantId) {
    const result = await this.pool.query(
      `
select
  tenant_id,
  access_profile_key,
  allowed_report_keys_json,
  updated_at
from tenant_report_role_permissions
where tenant_id = $1
order by access_profile_key asc
`,
      [tenantId],
    );

    return result.rows.map(mapTenantReportRolePermissionRow);
  }

  async saveTenantReportRolePermissions(input: {
    tenantId: TenantId;
    permissions: TenantReportRolePermissionRecord[];
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      for (const permission of input.permissions) {
        await client.query(
          `
insert into tenant_report_role_permissions (
  tenant_id,
  access_profile_key,
  allowed_report_keys_json,
  updated_at
)
values ($1, $2, $3::jsonb, $4::timestamptz)
on conflict (tenant_id, access_profile_key) do update
set allowed_report_keys_json = excluded.allowed_report_keys_json,
    updated_at = excluded.updated_at
`,
          [
            input.tenantId,
            permission.access_profile_key,
            JSON.stringify(permission.allowed_report_keys),
            permission.updated_at,
          ],
        );
      }

      const syncResult = await client.query(
        `
with permission_matrix as (
  select access_profile_key, allowed_report_keys_json
  from tenant_report_role_permissions
  where tenant_id = $1
)
update line_targets as target
set allowed_report_keys = permission_matrix.allowed_report_keys_json,
    updated_at = now()
from permission_matrix
where target.tenant_id = $1
  and target.access_profile_key = permission_matrix.access_profile_key
returning target.id
`,
        [input.tenantId],
      );

      const listResult = await client.query(
        `
select
  tenant_id,
  access_profile_key,
  allowed_report_keys_json,
  updated_at
from tenant_report_role_permissions
where tenant_id = $1
order by access_profile_key asc
`,
        [input.tenantId],
      );
      await client.query("commit");
      return {
        permissions: listResult.rows.map(mapTenantReportRolePermissionRow),
        updatedTargetCount: syncResult.rowCount ?? 0,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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

  async createViewerToken(input: {
    tokenHash: string;
    tenantId: TenantId;
    runId: string;
    expiresAt: Date;
  }) {
    await this.pool.query(
      `
insert into report_viewer_tokens (token_hash, tenant_id, run_id, expires_at)
values ($1, $2, $3, $4::timestamptz)
on conflict (token_hash) do nothing
`,
      [input.tokenHash, input.tenantId, input.runId, input.expiresAt.toISOString()],
    );
  }

  async accessViewerToken(
    tokenHash: string,
    cookieSessionId: string | null,
  ): Promise<{
    ok: boolean;
    newSessionId?: string;
    reason?: "not_found" | "expired";
  }> {
    const newSessionId = randomUUID();
    const result = await this.pool.query(
      `
update report_viewer_tokens
set session_id = coalesce(session_id, $2),
    session_bound_at = coalesce(session_bound_at, now())
where token_hash = $1
  and expires_at > now()
returning session_id, session_bound_at
`,
      [tokenHash, newSessionId],
    );

    if (result.rowCount === 0) {
      // token not found or already expired
      const check = await this.pool.query(
        `select token_hash from report_viewer_tokens where token_hash = $1`,
        [tokenHash],
      );
      return {
        ok: false,
        reason: check.rowCount === 0 ? "not_found" : "expired",
      };
    }

    const boundSessionId = result.rows[0].session_id as string;

    // First access: bind a lightweight browser session for observability.
    if (boundSessionId === newSessionId) {
      return { ok: true, newSessionId };
    }

    // LINE links can move between LINE's webview and the external browser on the
    // same phone, and proxied browser cookies are not stable enough to be a hard
    // security boundary. The signed token remains bound to tenant/report/run and
    // expiry; the session is advisory only.
    void cookieSessionId;
    return { ok: true };
  }

  async purgeExpiredViewerTokens() {
    await this.pool.query(
      `delete from report_viewer_tokens where expires_at < now() - interval '1 day'`,
    );
  }

  async close() {
    await this.pool.end();
  }
}

function snapshotToRunRecord(snapshot: ReportSnapshot): ReportRunRecord {
  return {
    id: snapshot.run_id,
    tenant_id: snapshot.tenant_id,
    report_key: snapshot.report_key,
    params: snapshot.params,
    status: "success",
    started_at: snapshot.generated_at,
    finished_at: snapshot.generated_at,
    row_count: getSnapshotRowCount(snapshot),
    safe_error_message: null,
  };
}

function getSnapshotRowCount(snapshot: ReportSnapshot) {
  if (snapshot.report_key === "stock_balance") {
    return snapshot.summary.sku_count;
  }
  if (
    snapshot.report_key === "gross_profit_by_product" ||
    snapshot.report_key === "gross_profit_by_ar_customer"
  ) {
    return snapshot.summary.row_count;
  }
  return snapshot.summary.document_count + snapshot.summary.line_count;
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

function businessSignalDedupeKey(signal: BusinessSignalRecord) {
  return [
    signal.tenant_id,
    signal.signal_key,
    signal.period_from,
    signal.period_to,
    signal.dimension_type,
    signal.dimension_id,
  ].join(":");
}

function compareBusinessSignals(
  left: BusinessSignalRecord,
  right: BusinessSignalRecord,
) {
  const severityDelta =
    businessSignalSeverityRank(right.severity) -
    businessSignalSeverityRank(left.severity);
  if (severityDelta) {
    return severityDelta;
  }

  const impactDelta = (right.amount_impact ?? 0) - (left.amount_impact ?? 0);
  if (impactDelta) {
    return impactDelta;
  }

  return right.updated_at.localeCompare(left.updated_at);
}

function businessSignalSeverityRank(
  severity: BusinessSignalRecord["severity"],
) {
  if (severity === "critical") {
    return 3;
  }
  if (severity === "warning") {
    return 2;
  }
  return 1;
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

function mapBusinessSignalRow(row: Record<string, unknown>): BusinessSignalRecord {
  return normalizeBusinessSignal({
    id: row.id,
    tenant_id: row.tenant_id,
    signal_key: row.signal_key,
    category: row.category,
    severity: row.severity,
    title: row.title,
    insight: row.insight,
    recommended_action: row.recommended_action,
    amount_impact:
      row.amount_impact === null || row.amount_impact === undefined
        ? null
        : Number(row.amount_impact),
    source_report_key: row.source_report_key,
    source_run_id: row.source_run_id,
    period_from: toDateOnly(row.period_from),
    period_to: toDateOnly(row.period_to),
    dimension_type: row.dimension_type,
    dimension_id: row.dimension_id,
    rule_version: row.rule_version,
    status: row.status,
    evidence_json: row.evidence_json,
    created_at: row.created_at
      ? toIsoString(row.created_at as string | Date)
      : undefined,
    updated_at: row.updated_at
      ? toIsoString(row.updated_at as string | Date)
      : undefined,
  }) as BusinessSignalRecord;
}

function mapLineDeliveryRow(row: Record<string, unknown>): LineDeliveryRecord {
  const deliveryType =
    row.delivery_type === "morning_brief" ||
    row.delivery_type === "notification_rule"
      ? row.delivery_type
      : "manual_test";

  return {
    id: String(row.id),
    tenant_id: row.tenant_id as TenantId,
    report_key: row.report_key as ReportKey,
    report_run_id: String(row.report_run_id),
    delivery_key: typeof row.delivery_key === "string" ? row.delivery_key : null,
    delivery_type: deliveryType,
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

function mapNotificationRuleRow(
  row: Record<string, unknown>,
): NotificationRuleRecord {
  return normalizeNotificationRule({
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    enabled: row.enabled,
    timezone: row.timezone,
    period_preset: row.period_preset,
    schedule: row.schedule_json,
    report_keys: row.report_keys_json,
    target_ids: row.target_ids_json,
    message_packaging: row.message_packaging,
    digest_mode: row.digest_mode,
    retry_policy: row.retry_policy_json,
    last_run_at: row.last_run_at
      ? toIsoString(row.last_run_at as string | Date)
      : null,
    last_run_status: row.last_run_status,
    last_safe_error_message: row.last_safe_error_message,
    created_at: row.created_at
      ? toIsoString(row.created_at as string | Date)
      : undefined,
    updated_at: row.updated_at
      ? toIsoString(row.updated_at as string | Date)
      : undefined,
  }) as NotificationRuleRecord;
}

function mapNotificationRuleRunRow(
  row: Record<string, unknown>,
): NotificationRuleRunRecord {
  return normalizeNotificationRuleRun({
    id: row.id,
    rule_id: row.rule_id,
    tenant_id: row.tenant_id,
    scheduled_local_date: toDateOnly(row.scheduled_local_date),
    scheduled_local_time: row.scheduled_local_time,
    timezone: row.timezone,
    period_from: toDateOnly(row.period_from),
    period_to: toDateOnly(row.period_to),
    status: row.status,
    attempt: row.attempt,
    idempotency_key: row.idempotency_key,
    report_run_ids: row.report_run_ids_json,
    delivery_ids: row.delivery_ids_json,
    safe_error_message: row.safe_error_message,
    started_at: row.started_at
      ? toIsoString(row.started_at as string | Date)
      : null,
    finished_at: row.finished_at
      ? toIsoString(row.finished_at as string | Date)
      : null,
    next_retry_at: row.next_retry_at
      ? toIsoString(row.next_retry_at as string | Date)
      : null,
    created_at: row.created_at
      ? toIsoString(row.created_at as string | Date)
      : undefined,
    updated_at: row.updated_at
      ? toIsoString(row.updated_at as string | Date)
      : undefined,
  }) as NotificationRuleRunRecord;
}

function mapTenantRow(row: Record<string, unknown>): Tenant {
  return {
    id: String(row.id) as TenantId,
    name: String(row.name),
    databaseName:
      typeof row.database_name === "string" ? row.database_name : "",
    description:
      typeof row.description === "string" ? row.description : "",
    datasourceConfigured: Boolean(row.datasource_configured),
    status: normalizeTenantStatus(row.status),
    planCode: normalizePlanCode(row.plan_code),
    featureFlags: normalizeTenantFeatureFlags(row.feature_flags_json),
    businessSignalThresholds: normalizeBusinessSignalThresholds(
      row.business_signal_thresholds_json,
    ),
    suspendedReason:
      typeof row.suspended_reason === "string" ? row.suspended_reason : null,
    currentPeriodEnd: row.current_period_end
      ? toIsoString(row.current_period_end as string | Date)
      : null,
  };
}

function mapUserRow(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    display_name: String(row.display_name),
    role: row.role === "owner_admin" ? "owner_admin" : "tenant_viewer",
    tenant_id:
      typeof row.tenant_id === "string" ? (row.tenant_id as TenantId) : null,
    enabled: Boolean(row.enabled),
    created_at: toIsoString(row.created_at as string | Date),
    updated_at: toIsoString(row.updated_at as string | Date),
  };
}

function mapLineChannelRow(row: Record<string, unknown>): LineChannelRecord {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id) as TenantId,
    display_name: String(row.display_name),
    channel_type: "line_oa",
    scope: row.scope === "owner_shared" ? "owner_shared" : "tenant",
    channel_access_token_configured: Boolean(
      row.channel_access_token_configured,
    ),
    channel_secret_configured: Boolean(row.channel_secret_configured),
    enabled: Boolean(row.enabled),
    source: row.source === "env" ? "env" : "manual",
    created_at: toIsoString(row.created_at as string | Date),
    updated_at: toIsoString(row.updated_at as string | Date),
  };
}

function mapSecretRow(row: Record<string, unknown>): SecretRecord {
  return {
    id: String(row.id),
    tenant_id:
      typeof row.tenant_id === "string" ? (row.tenant_id as TenantId) : null,
    scope: normalizeSecretScope(row.scope),
    secret_key: String(row.secret_key),
    encrypted_value: String(row.encrypted_value),
    encryption_key_id: String(row.encryption_key_id),
    metadata_json:
      (row.metadata_json as Record<string, unknown> | null) ?? {},
    created_at: toIsoString(row.created_at as string | Date),
    updated_at: toIsoString(row.updated_at as string | Date),
  };
}

function toSecretMetadata(secret: SecretRecord): SecretMetadataRecord {
  const { encrypted_value: _encryptedValue, ...metadata } = secret;
  return {
    ...metadata,
    has_encrypted_value: Boolean(_encryptedValue),
  };
}

function mapLineTargetRow(row: Record<string, unknown>): StoredLineTargetRecord {
  return {
    id: String(row.id),
    tenant_id: row.tenant_id as TenantId,
    line_channel_id:
      typeof row.line_channel_id === "string" ? row.line_channel_id : null,
    display_name: String(row.display_name),
    target_type:
      row.target_type === "group" || row.target_type === "room"
        ? row.target_type
        : "user",
    target_id: String(row.target_id),
    target_id_masked: String(row.target_id_masked),
    target_id_hash: String(row.target_id_hash),
    recipient_count_estimate: normalizeRecipientCountEstimate(
      row.recipient_count_estimate,
      row.target_type,
    ),
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

function mapTenantReportRolePermissionRow(
  row: Record<string, unknown>,
): TenantReportRolePermissionRecord {
  return {
    tenant_id: row.tenant_id as TenantId,
    access_profile_key: normalizeAccessProfile(row.access_profile_key),
    allowed_report_keys: normalizeReportKeys(row.allowed_report_keys_json),
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

function normalizeTenants(value: unknown): Tenant[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((tenant) => normalizeTenantRecord(tenant))
    .filter((tenant): tenant is Tenant => tenant.id.length > 0);
}

function normalizeTenantRecord(value: unknown): Tenant {
  if (!value || typeof value !== "object") {
    return {
      id: "" as TenantId,
      name: "Unnamed tenant",
      databaseName: "",
      description: "",
      datasourceConfigured: false,
      status: "active",
      planCode: "starter",
      featureFlags: normalizeTenantFeatureFlags(undefined),
      businessSignalThresholds: normalizeBusinessSignalThresholds(undefined),
      suspendedReason: null,
      currentPeriodEnd: null,
    };
  }

  const tenant = value as Partial<Tenant>;
  return {
    id: String(tenant.id ?? "") as TenantId,
    name: String(tenant.name ?? tenant.id ?? "Unnamed tenant"),
    databaseName: String(tenant.databaseName ?? ""),
    description: String(tenant.description ?? ""),
    datasourceConfigured: Boolean(tenant.datasourceConfigured),
    status: normalizeTenantStatus(tenant.status),
    planCode: normalizePlanCode(tenant.planCode),
    featureFlags: normalizeTenantFeatureFlags(tenant.featureFlags),
    businessSignalThresholds: normalizeBusinessSignalThresholds(
      tenant.businessSignalThresholds,
    ),
    suspendedReason:
      typeof tenant.suspendedReason === "string" ? tenant.suspendedReason : null,
    currentPeriodEnd:
      typeof tenant.currentPeriodEnd === "string" ? tenant.currentPeriodEnd : null,
  };
}

function normalizeTenantFeatureFlags(value: unknown): TenantFeatureFlags {
  const parsed = tenantFeatureFlagsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : tenantFeatureFlagsSchema.parse({});
}

function normalizeBusinessSignalThresholds(
  value: unknown,
): BusinessSignalThresholdsConfig {
  const parsed = businessSignalThresholdsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : businessSignalThresholdsSchema.parse({});
}

function normalizeBusinessSignals(value: unknown): BusinessSignalRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((signal) => normalizeBusinessSignal(signal))
    .filter((signal): signal is BusinessSignalRecord => Boolean(signal))
    .sort(compareBusinessSignals);
}

function normalizeBusinessSignal(value: unknown): BusinessSignalRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const signal = value as Partial<BusinessSignalRecord>;
  const reportKey = reportKeySchema.safeParse(signal.source_report_key);
  if (
    !signal.id ||
    !signal.tenant_id ||
    !signal.signal_key ||
    !signal.title ||
    !signal.insight ||
    !signal.recommended_action ||
    !signal.source_run_id ||
    !reportKey.success
  ) {
    return null;
  }

  const category = businessSignalCategorySchema.safeParse(signal.category);
  const severity = businessSignalSeveritySchema.safeParse(signal.severity);
  const status = businessSignalStatusSchema.safeParse(signal.status);
  const now = new Date().toISOString();
  const amountImpact =
    typeof signal.amount_impact === "number" && Number.isFinite(signal.amount_impact)
      ? signal.amount_impact
      : null;

  return {
    id: String(signal.id),
    tenant_id: signal.tenant_id as TenantId,
    signal_key: String(signal.signal_key),
    category: category.success ? category.data : "data_quality",
    severity: severity.success ? severity.data : "warning",
    title: String(signal.title),
    insight: String(signal.insight),
    recommended_action: String(signal.recommended_action),
    amount_impact: amountImpact,
    source_report_key: reportKey.data,
    source_run_id: String(signal.source_run_id),
    period_from:
      typeof signal.period_from === "string"
        ? signal.period_from.slice(0, 10)
        : now.slice(0, 10),
    period_to:
      typeof signal.period_to === "string"
        ? signal.period_to.slice(0, 10)
        : now.slice(0, 10),
    dimension_type:
      typeof signal.dimension_type === "string"
        ? signal.dimension_type
        : "report",
    dimension_id:
      typeof signal.dimension_id === "string"
        ? signal.dimension_id
        : reportKey.data,
    rule_version:
      typeof signal.rule_version === "string"
        ? signal.rule_version
        : "unknown",
    status: status.success ? status.data : "open",
    evidence_json:
      signal.evidence_json && typeof signal.evidence_json === "object"
        ? (signal.evidence_json as Record<string, unknown>)
        : {},
    created_at:
      typeof signal.created_at === "string" ? signal.created_at : now,
    updated_at:
      typeof signal.updated_at === "string" ? signal.updated_at : now,
  };
}

function normalizeNotificationRules(
  value: unknown,
): NotificationRuleRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((rule) => normalizeNotificationRule(rule))
    .filter((rule): rule is NotificationRuleRecord => Boolean(rule));
}

function normalizeNotificationRule(
  value: unknown,
): NotificationRuleRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rule = value as Partial<NotificationRuleRecord>;
  if (!rule.id || !rule.tenant_id || !rule.name) {
    return null;
  }

  const schedule = normalizeNotificationSchedule(rule.schedule);
  const reportKeys = normalizeReportKeys(rule.report_keys);
  const targetIds = Array.isArray(rule.target_ids)
    ? rule.target_ids
        .filter((item): item is string => typeof item === "string" && item.length > 0)
        .slice(0, 50)
    : [];
  if (!schedule.length || !reportKeys.length || !targetIds.length) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: String(rule.id),
    tenant_id: rule.tenant_id as TenantId,
    name: String(rule.name),
    enabled: rule.enabled !== false,
    timezone: typeof rule.timezone === "string" ? rule.timezone : "Asia/Bangkok",
    period_preset: normalizeNotificationPeriodPreset(rule.period_preset),
    schedule,
    report_keys: reportKeys,
    target_ids: targetIds,
    message_packaging: "digest",
    digest_mode: normalizeNotificationDigestMode(rule.digest_mode),
    retry_policy: normalizeNotificationRetryPolicy(rule.retry_policy),
    last_run_at:
      typeof rule.last_run_at === "string" ? rule.last_run_at : null,
    last_run_status: normalizeNotificationRunStatus(rule.last_run_status, null),
    last_safe_error_message:
      typeof rule.last_safe_error_message === "string"
        ? rule.last_safe_error_message
        : null,
    created_at: rule.created_at ?? now,
    updated_at: rule.updated_at ?? now,
  };
}

function normalizeNotificationRuleRuns(
  value: unknown,
): NotificationRuleRunRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((run) => normalizeNotificationRuleRun(run))
    .filter((run): run is NotificationRuleRunRecord => Boolean(run));
}

function normalizeNotificationRuleRun(
  value: unknown,
): NotificationRuleRunRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const run = value as Partial<NotificationRuleRunRecord>;
  if (!run.id || !run.rule_id || !run.tenant_id || !run.idempotency_key) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: String(run.id),
    rule_id: String(run.rule_id),
    tenant_id: run.tenant_id as TenantId,
    scheduled_local_date:
      typeof run.scheduled_local_date === "string"
        ? run.scheduled_local_date.slice(0, 10)
        : now.slice(0, 10),
    scheduled_local_time:
      typeof run.scheduled_local_time === "string"
        ? run.scheduled_local_time
        : "00:00",
    timezone: typeof run.timezone === "string" ? run.timezone : "Asia/Bangkok",
    period_from:
      typeof run.period_from === "string" ? run.period_from.slice(0, 10) : now.slice(0, 10),
    period_to:
      typeof run.period_to === "string" ? run.period_to.slice(0, 10) : now.slice(0, 10),
    status: normalizeNotificationRunStatus(run.status, "failed"),
    attempt:
      typeof run.attempt === "number" && Number.isInteger(run.attempt)
        ? Math.max(1, run.attempt)
        : 1,
    idempotency_key: String(run.idempotency_key),
    report_run_ids: Array.isArray(run.report_run_ids)
      ? run.report_run_ids.filter((item): item is string => typeof item === "string")
      : [],
    delivery_ids: Array.isArray(run.delivery_ids)
      ? run.delivery_ids.filter((item): item is string => typeof item === "string")
      : [],
    safe_error_message:
      typeof run.safe_error_message === "string"
        ? run.safe_error_message
        : null,
    started_at: typeof run.started_at === "string" ? run.started_at : null,
    finished_at: typeof run.finished_at === "string" ? run.finished_at : null,
    next_retry_at:
      typeof run.next_retry_at === "string" ? run.next_retry_at : null,
    created_at: run.created_at ?? now,
    updated_at: run.updated_at ?? now,
  };
}

function normalizeNotificationSchedule(
  value: unknown,
): NotificationRuleRecord["schedule"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const item = entry as {
        weekdays?: unknown;
        times?: unknown;
      };
      const weekdays = Array.isArray(item.weekdays)
        ? item.weekdays
            .map((weekday) => Number(weekday))
            .filter((weekday) => Number.isInteger(weekday) && weekday >= 1 && weekday <= 7)
        : [];
      const times = Array.isArray(item.times)
        ? item.times.filter(
            (time): time is string =>
              typeof time === "string" && /^\d{2}:\d{2}$/.test(time),
          )
        : [];

      return weekdays.length && times.length
        ? {
            weekdays: [...new Set(weekdays)].slice(0, 7),
            times: [...new Set(times)].slice(0, 12),
          }
        : null;
    })
    .filter(
      (entry): entry is NotificationRuleRecord["schedule"][number] =>
        Boolean(entry),
    );
}

function normalizeNotificationPeriodPreset(
  value: unknown,
): NotificationRuleRecord["period_preset"] {
  if (value === "today_so_far" || value === "last_7_days") {
    return value;
  }

  return "yesterday";
}

function normalizeNotificationDigestMode(
  value: unknown,
): NotificationRuleRecord["digest_mode"] {
  const parsed = notificationDigestModeSchema.safeParse(value);
  return parsed.success ? parsed.data : "action_only";
}

function normalizeNotificationRetryPolicy(
  value: unknown,
): NotificationRuleRecord["retry_policy"] {
  if (!value || typeof value !== "object") {
    return { max_attempts: 2, retry_delay_minutes: 3 };
  }

  const policy = value as Partial<NotificationRuleRecord["retry_policy"]>;
  return {
    max_attempts:
      typeof policy.max_attempts === "number" &&
      Number.isInteger(policy.max_attempts)
        ? Math.max(1, Math.min(policy.max_attempts, 5))
        : 2,
    retry_delay_minutes:
      typeof policy.retry_delay_minutes === "number" &&
      Number.isFinite(policy.retry_delay_minutes)
        ? Math.max(1, Math.min(policy.retry_delay_minutes, 60))
        : 3,
  };
}

function normalizeNotificationRunStatus<T extends NotificationRuleRecord["last_run_status"]>(
  value: unknown,
  fallback: T,
) {
  if (
    value === "running" ||
    value === "success" ||
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }

  return fallback;
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

function normalizeReportRolePermissions(
  value: unknown,
): TenantReportRolePermissionRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeReportRolePermission(item))
    .filter(
      (
        permission,
      ): permission is TenantReportRolePermissionRecord => Boolean(permission),
    );
}

function normalizeReportRolePermission(
  value: unknown,
): TenantReportRolePermissionRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const permission = value as Partial<TenantReportRolePermissionRecord>;
  if (!permission.tenant_id || !permission.access_profile_key) {
    return null;
  }

  return {
    tenant_id: permission.tenant_id,
    access_profile_key: normalizeAccessProfile(permission.access_profile_key),
    allowed_report_keys: normalizeReportKeys(permission.allowed_report_keys),
    updated_at: permission.updated_at ?? new Date().toISOString(),
  };
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
    line_channel_id: target.line_channel_id ?? null,
    display_name: String(target.display_name || "LINE target"),
    target_type:
      target.target_type === "group" || target.target_type === "room"
        ? target.target_type
        : "user",
    target_id: String(target.target_id),
    target_id_masked: String(target.target_id_masked),
    target_id_hash: String(target.target_id_hash),
    recipient_count_estimate: normalizeRecipientCountEstimate(
      target.recipient_count_estimate,
      target.target_type,
    ),
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

function normalizeRecipientCountEstimate(
  value: unknown,
  targetType: unknown,
): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return targetType === "user" ? 1 : null;
}

function normalizeReportKeys(value: unknown): LineTargetRecord["allowed_report_keys"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is ReportKey =>
    reportKeySchema.safeParse(item).success,
  );
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

function normalizeTenantStatus(value: unknown): TenantStatus {
  if (
    value === "trial" ||
    value === "active" ||
    value === "past_due" ||
    value === "suspended" ||
    value === "cancelled"
  ) {
    return value;
  }

  return "active";
}

function normalizePlanCode(value: unknown): PlanCode {
  if (value === "business" || value === "pro") {
    return value;
  }

  return "starter";
}

function mergeTenants(existing: Tenant[], seeds: Tenant[]) {
  const byId = new Map(
    existing.map((tenant) => {
      const normalized = normalizeTenantRecord(tenant);
      return [normalized.id, normalized] as const;
    }),
  );
  for (const seed of seeds) {
    const normalizedSeed = normalizeTenantRecord(seed);
    const current = byId.get(normalizedSeed.id);
    byId.set(
      normalizedSeed.id,
      current
        ? {
            ...current,
            ...normalizedSeed,
            status: current.status,
            featureFlags: current.featureFlags ?? normalizedSeed.featureFlags,
          }
        : normalizedSeed,
    );
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeUsers(value: unknown): UserRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is UserRecord => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: String(item.id),
      email: String(item.email),
      display_name: String(item.display_name || item.email || "User"),
      role: item.role === "owner_admin" ? "owner_admin" : "tenant_viewer",
      tenant_id:
        typeof item.tenant_id === "string" ? (item.tenant_id as TenantId) : null,
      enabled: item.enabled !== false,
      created_at: item.created_at ?? new Date().toISOString(),
      updated_at: item.updated_at ?? new Date().toISOString(),
    }));
}

function normalizeLineChannels(value: unknown): LineChannelRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is Partial<LineChannelRecord> =>
        Boolean(item && typeof item === "object" && item.id && item.tenant_id),
    )
    .map((item) => ({
      id: String(item.id),
      tenant_id: String(item.tenant_id) as TenantId,
      display_name: String(item.display_name || "LINE OA"),
      channel_type: "line_oa",
      scope: item.scope === "owner_shared" ? "owner_shared" : "tenant",
      channel_access_token_configured: Boolean(
        item.channel_access_token_configured,
      ),
      channel_secret_configured: Boolean(item.channel_secret_configured),
      enabled: item.enabled !== false,
      source: item.source === "env" ? "env" : "manual",
      created_at: item.created_at ?? new Date().toISOString(),
      updated_at: item.updated_at ?? new Date().toISOString(),
    }));
}

function normalizeSecrets(value: unknown): SecretRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is Partial<SecretRecord> =>
        Boolean(
          item &&
            typeof item === "object" &&
            item.id &&
            item.scope &&
            item.secret_key &&
            item.encrypted_value,
        ),
    )
    .map((item) => ({
      id: String(item.id),
      tenant_id:
        typeof item.tenant_id === "string" ? (item.tenant_id as TenantId) : null,
      scope: normalizeSecretScope(item.scope),
      secret_key: String(item.secret_key),
      encrypted_value: String(item.encrypted_value),
      encryption_key_id: String(item.encryption_key_id || "unknown"),
      metadata_json:
        item.metadata_json && typeof item.metadata_json === "object"
          ? (item.metadata_json as Record<string, unknown>)
          : {},
      created_at: item.created_at ?? new Date().toISOString(),
      updated_at: item.updated_at ?? new Date().toISOString(),
    }));
}

function normalizeSecretScope(value: unknown): SecretRecord["scope"] {
  if (
    value === "datasource" ||
    value === "line_channel" ||
    value === "system"
  ) {
    return value;
  }

  return "system";
}

const systemSchemaSql = `
create table if not exists tenants (
  id text primary key,
  name text not null,
  status text not null default 'active',
  plan_code text not null default 'starter',
  database_name text not null default '',
  description text not null default '',
  datasource_configured boolean not null default false,
  feature_flags_json jsonb not null default '{"business_signals_enabled":true,"line_action_digest_v2_enabled":false,"demo_mode_enabled":false}'::jsonb,
  business_signal_thresholds_json jsonb not null default '{}'::jsonb,
  suspended_reason text,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

alter table tenants
  add column if not exists plan_code text not null default 'starter',
  add column if not exists database_name text not null default '',
  add column if not exists description text not null default '',
  add column if not exists datasource_configured boolean not null default false,
  add column if not exists feature_flags_json jsonb not null default '{"business_signals_enabled":true,"line_action_digest_v2_enabled":false,"demo_mode_enabled":false}'::jsonb,
  add column if not exists business_signal_thresholds_json jsonb not null default '{}'::jsonb,
  add column if not exists suspended_reason text,
  add column if not exists current_period_end timestamptz;

create table if not exists users (
  id text primary key,
  email text not null unique,
  display_name text not null,
  role text not null,
  tenant_id text references tenants(id),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_tenant_idx
on users (tenant_id, created_at desc);

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

create table if not exists business_signals (
  id text primary key,
  tenant_id text not null references tenants(id),
  signal_key text not null,
  category text not null,
  severity text not null,
  title text not null,
  insight text not null,
  recommended_action text not null,
  amount_impact numeric,
  source_report_key text not null references report_definitions(report_key),
  source_run_id text not null references report_runs(id),
  period_from date not null,
  period_to date not null,
  dimension_type text not null default 'report',
  dimension_id text not null default '',
  rule_version text not null,
  status text not null default 'open',
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, signal_key, period_from, period_to, dimension_type, dimension_id)
);

create index if not exists business_signals_tenant_period_idx
on business_signals (tenant_id, period_to desc, severity, status);

create index if not exists business_signals_source_run_idx
on business_signals (tenant_id, source_report_key, source_run_id);

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

create table if not exists notification_rules (
  id text primary key,
  tenant_id text not null references tenants(id),
  name text not null,
  enabled boolean not null default true,
  timezone text not null default 'Asia/Bangkok',
  period_preset text not null default 'yesterday',
  schedule_json jsonb not null,
  report_keys_json jsonb not null,
  target_ids_json jsonb not null,
  message_packaging text not null default 'digest',
  digest_mode text not null default 'action_only',
  retry_policy_json jsonb not null default '{"max_attempts":2,"retry_delay_minutes":3}'::jsonb,
  last_run_at timestamptz,
  last_run_status text,
  last_safe_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table notification_rules
  add column if not exists digest_mode text not null default 'action_only';

create index if not exists notification_rules_tenant_idx
on notification_rules (tenant_id, enabled, updated_at desc);

create table if not exists notification_rule_runs (
  id text primary key,
  rule_id text not null references notification_rules(id),
  tenant_id text not null references tenants(id),
  scheduled_local_date date not null,
  scheduled_local_time text not null,
  timezone text not null default 'Asia/Bangkok',
  period_from date not null,
  period_to date not null,
  status text not null,
  attempt integer not null default 1,
  idempotency_key text not null unique,
  report_run_ids_json jsonb not null default '[]'::jsonb,
  delivery_ids_json jsonb not null default '[]'::jsonb,
  safe_error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_rule_runs_rule_idx
on notification_rule_runs (rule_id, created_at desc);

create index if not exists notification_rule_runs_retry_idx
on notification_rule_runs (status, next_retry_at)
where next_retry_at is not null;

create table if not exists line_targets (
  id text primary key,
  tenant_id text not null references tenants(id),
  line_channel_id text,
  display_name text not null,
  target_type text not null,
  target_id text not null,
  target_id_masked text not null,
  target_id_hash text not null,
  recipient_count_estimate integer,
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

alter table line_targets
  add column if not exists line_channel_id text;

alter table line_targets
  add column if not exists recipient_count_estimate integer;

create table if not exists tenant_report_role_permissions (
  tenant_id text not null references tenants(id) on delete cascade,
  access_profile_key text not null,
  allowed_report_keys_json jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, access_profile_key)
);

create index if not exists tenant_report_role_permissions_tenant_idx
on tenant_report_role_permissions (tenant_id, updated_at desc);

create table if not exists line_channels (
  id text primary key,
  tenant_id text not null references tenants(id),
  display_name text not null,
  channel_type text not null default 'line_oa',
  scope text not null default 'tenant',
  channel_access_token_configured boolean not null default false,
  channel_secret_configured boolean not null default false,
  enabled boolean not null default true,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table line_channels
  add column if not exists scope text not null default 'tenant';

create index if not exists line_channels_tenant_idx
on line_channels (tenant_id, updated_at desc);

create table if not exists secrets (
  id text primary key,
  tenant_id text references tenants(id),
  scope text not null,
  secret_key text not null,
  encrypted_value text not null,
  encryption_key_id text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, scope, secret_key)
);

create index if not exists secrets_tenant_idx
on secrets (tenant_id, scope, updated_at desc);

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

create table if not exists report_viewer_tokens (
  token_hash   text primary key,
  tenant_id    text not null,
  run_id       text not null,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists report_viewer_tokens_expires_idx
on report_viewer_tokens (expires_at);

alter table report_viewer_tokens
  add column if not exists session_id text,
  add column if not exists session_bound_at timestamptz;
`;
