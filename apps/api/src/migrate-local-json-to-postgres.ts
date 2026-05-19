import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  LineDeliveryRecord,
  LineWebhookEventRecord,
  ReportRunRecord,
  SalesGoodsServicesSnapshot,
  Tenant,
} from "@ai-bcc/shared";
import { listTenants } from "./config.js";
import {
  createSystemStore,
  type AuditLogEntry,
  type ReportDefinitionSeed,
} from "./system-store.js";
import { reportDefinitionSeeds } from "./report-definitions.js";

type StoreFile = {
  tenants?: Tenant[];
  reportDefinitions?: ReportDefinitionSeed[];
  runs?: ReportRunRecord[];
  snapshots?: SalesGoodsServicesSnapshot[];
  lineDeliveries?: Partial<LineDeliveryRecord>[];
  lineWebhookEvents?: LineWebhookEventRecord[];
  auditLogs?: AuditLogEntry[];
};

const sourcePath = resolve(
  process.env.SYSTEM_STORE_MIGRATION_FILE ||
    process.env.SYSTEM_STORE_FILE ||
    ".data/system-store.json",
);

if (!process.env.SYSTEM_DATABASE_URL?.trim()) {
  throw new Error("SYSTEM_DATABASE_URL is required for local JSON migration.");
}

await access(sourcePath);
const source = JSON.parse(await readFile(sourcePath, "utf8")) as StoreFile;
const store = createSystemStore();

if (store.kind !== "postgres") {
  throw new Error("Migration target must be a PostgreSQL SystemStore.");
}

await store.initialize({
  tenants: listTenants(),
  reportDefinitions: reportDefinitionSeeds,
});

const runs = source.runs ?? [];
for (const run of runs) {
  await store.upsertRun(run);
}

const snapshots = source.snapshots ?? [];
for (const snapshot of snapshots) {
  await store.saveSnapshot(snapshot);
}

const lineDeliveries = (source.lineDeliveries ?? [])
  .filter((delivery): delivery is LineDeliveryRecord =>
    Boolean(
      delivery.id &&
        delivery.tenant_id &&
        delivery.report_key &&
        delivery.report_run_id &&
        delivery.message_type &&
        delivery.status &&
        delivery.created_at,
    ),
  )
  .map(normalizeLineDelivery);
for (const delivery of lineDeliveries) {
  await store.saveLineDelivery(delivery);
}

const webhookEvents = source.lineWebhookEvents ?? [];
await store.saveLineWebhookEvents(webhookEvents);

const auditLogs = source.auditLogs ?? [];
await store.importAuditLogs(auditLogs);

await store.close();

console.log(
  JSON.stringify(
    {
      migrated: true,
      sourcePath,
      counts: {
        runs: runs.length,
        snapshots: snapshots.length,
        lineDeliveries: lineDeliveries.length,
        lineWebhookEvents: webhookEvents.length,
        auditLogs: auditLogs.length,
      },
    },
    null,
    2,
  ),
);

function normalizeLineDelivery(
  delivery: LineDeliveryRecord,
): LineDeliveryRecord {
  return {
    ...delivery,
    delivery_key: delivery.delivery_key ?? null,
    delivery_type: delivery.delivery_type ?? "manual_test",
    period_from: delivery.period_from ?? null,
    period_to: delivery.period_to ?? null,
    target_id_masked: delivery.target_id_masked ?? null,
    sent_at: delivery.sent_at ?? null,
    provider_response_json: delivery.provider_response_json ?? null,
    safe_error_message: delivery.safe_error_message ?? null,
  };
}
