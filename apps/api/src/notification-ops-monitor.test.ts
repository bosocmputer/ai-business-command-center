import { describe, expect, it } from "vitest";
import type {
  LineDeliveryRecord,
  NotificationReportResult,
  NotificationRuleRecord,
  NotificationRuleRunRecord,
  OperationalAlertDeliveryRecord,
  Tenant,
  WorkerHeartbeatRecord,
} from "@ai-bcc/shared";
import {
  NOTIFICATION_OPS_MONITOR_WORKER_ROLE,
  runNotificationOpsMonitor,
  type NotificationOpsMonitorConfig,
} from "./notification-ops-monitor.js";
import type { AuditLogEntry } from "./system-store.js";

const now = new Date("2026-06-22T02:00:00.000Z");
const config: NotificationOpsMonitorConfig = {
  heartbeatStaleMs: 3 * 60_000,
  lineRetryGraceMs: 2 * 60_000,
  slowCriticalMs: 30 * 60_000,
  slowWarningMs: 15 * 60_000,
};

function buildTenant(id: string, name: string, telegramEnabled = true): Tenant {
  return {
    id,
    name,
    databaseName: `${id}_db`,
    description: "",
    datasourceConfigured: true,
    status: "active",
    planCode: "pro",
    suspendedReason: null,
    currentPeriodEnd: null,
    featureFlags: {
      business_signals_enabled: true,
      demo_mode_enabled: false,
      line_action_digest_v2_enabled: true,
      line_heavy_report_fallback_enabled: true,
      line_report_failure_incident_enabled: true,
      sml_chunked_heavy_reports_enabled: true,
      telegram_operational_alerts_enabled: telegramEnabled,
    },
  };
}

function buildRule(input: {
  id: string;
  tenantId: string;
  times: string[];
}): NotificationRuleRecord {
  return {
    id: input.id,
    tenant_id: input.tenantId,
    name: "Executive brief",
    enabled: true,
    timezone: "Asia/Bangkok",
    period_preset: "yesterday",
    period_strategy: "executive_checkpoints",
    schedule: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], times: input.times }],
    report_keys: ["sales_goods_services", "stock_balance"],
    target_ids: ["line_target_1"],
    message_packaging: "digest",
    digest_mode: "all_reports",
    retry_policy: { max_attempts: 2, retry_delay_minutes: 3 },
    last_run_at: null,
    last_run_status: null,
    last_safe_error_message: null,
    created_at: "2026-06-22T00:00:00.000Z",
    updated_at: "2026-06-22T00:00:00.000Z",
  };
}

function freshResult(reportKey: "sales_goods_services" | "stock_balance") {
  return {
    report_key: reportKey,
    status: "success",
    freshness: "fresh",
    run_id: `run_${reportKey}`,
    snapshot_generated_at: "2026-06-22T01:40:00.000Z",
    duration_ms: 1000,
    row_count: 10,
    degraded_reason: null,
  } satisfies NotificationReportResult;
}

function buildRun(
  overrides: Partial<NotificationRuleRunRecord> = {},
): NotificationRuleRunRecord {
  return {
    id: "notification_run_1",
    rule_id: "rule_krabi",
    tenant_id: "tenant_demo_remote",
    scheduled_local_date: "2026-06-22",
    scheduled_local_time: "08:00",
    timezone: "Asia/Bangkok",
    period_from: "2026-06-21",
    period_to: "2026-06-21",
    period_from_time: null,
    period_to_time: null,
    period_strategy: "executive_checkpoints",
    unknown_doc_time_count: 0,
    status: "running",
    mode: "send",
    source: "worker_due",
    attempt: 1,
    idempotency_key: "rule_krabi:2026-06-22:08:00:1",
    report_run_ids: [],
    report_results: null,
    delivery_ids: [],
    safe_error_message: null,
    started_at: "2026-06-22T01:44:00.000Z",
    finished_at: null,
    queued_at: "2026-06-22T01:44:00.000Z",
    claimed_at: "2026-06-22T01:44:00.000Z",
    worker_id: "worker_1",
    client_request_id: null,
    next_retry_at: null,
    progress_stage: "waiting_chunked_report",
    progress_percent: 60,
    progress_current_report_key: "stock_balance",
    progress_done_reports: 1,
    progress_total_reports: 2,
    progress_updated_at: "2026-06-22T01:58:00.000Z",
    created_at: "2026-06-22T01:44:00.000Z",
    updated_at: "2026-06-22T01:58:00.000Z",
    ...overrides,
  };
}

function buildDelivery(
  overrides: Partial<LineDeliveryRecord> = {},
): LineDeliveryRecord {
  return {
    id: "line_failed_1",
    tenant_id: "tenant_demo_remote",
    report_key: "sales_goods_services",
    report_run_id: "run_sales_goods_services",
    delivery_key:
      "notification_rule:rule_krabi:2026-06-22:18:30:target_hash",
    delivery_type: "notification_rule",
    period_from: "2026-06-22",
    period_to: "2026-06-22",
    target_id_masked: "Cd7f...e882",
    message_type: "flex",
    status: "failed",
    sent_at: null,
    provider_response_json: null,
    safe_error_message: "LINE push failed due to network or provider error.",
    created_at: "2026-06-22T01:50:00.000Z",
    ...overrides,
  };
}

function buildHeartbeat(
  checkedAt = "2026-06-22T01:59:00.000Z",
): WorkerHeartbeatRecord {
  return {
    id: "heartbeat_1",
    worker_id: "worker_1",
    role: NOTIFICATION_OPS_MONITOR_WORKER_ROLE,
    status: "ok",
    metadata_json: {},
    checked_at: checkedAt,
    created_at: checkedAt,
  };
}

function createHarness(input?: {
  heartbeats?: WorkerHeartbeatRecord[];
  lineDeliveries?: LineDeliveryRecord[];
  operationalDeliveries?: OperationalAlertDeliveryRecord[];
  rules?: NotificationRuleRecord[];
  runs?: NotificationRuleRunRecord[];
  tenants?: Tenant[];
}) {
  const calls: Array<{
    alertType: string;
    dedupeKey?: string | null;
    messageText: string;
    severity: string;
  }> = [];
  const state = {
    auditLogs: [] as AuditLogEntry[],
    heartbeats: input?.heartbeats ?? [buildHeartbeat()],
    lineDeliveries: input?.lineDeliveries ?? [],
    operationalDeliveries: input?.operationalDeliveries ?? [],
    rules:
      input?.rules ??
      [
        buildRule({
          id: "rule_krabi",
          tenantId: "tenant_demo_remote",
          times: ["08:00", "18:30"],
        }),
      ],
    runs: input?.runs ?? [],
    tenants:
      input?.tenants ??
      [
        buildTenant("tenant_demo_remote", "กระบี่"),
        buildTenant("seaandhill_demo", "seaandhill THAPPUT"),
        buildTenant("tenant_office_sml1_2026", "248 SHOP", false),
      ],
  };
  const store = {
    appendAuditLog: async (entry: Omit<AuditLogEntry, "created_at">) => {
      state.auditLogs.push({ ...entry, created_at: now.toISOString() });
    },
    findSuccessfulLineDeliveryByKey: async (input: {
      tenantId: string;
      deliveryKey: string;
    }) =>
      state.lineDeliveries.find(
        (delivery) =>
          delivery.tenant_id === input.tenantId &&
          delivery.delivery_key === input.deliveryKey &&
          delivery.status === "success",
      ) ?? null,
    findSuccessfulOperationalAlertDeliveryByDedupeKey: async (input: {
      channel: "telegram";
      dedupeKey: string;
    }) =>
      state.operationalDeliveries.find(
        (delivery) =>
          delivery.channel === input.channel &&
          delivery.dedupe_key === input.dedupeKey &&
          delivery.status === "success",
      ) ?? null,
    getLatestWorkerHeartbeat: async (role?: string) =>
      state.heartbeats
        .filter((heartbeat) => !role || heartbeat.role === role)
        .sort((a, b) => b.checked_at.localeCompare(a.checked_at))[0] ?? null,
    listLineDeliveries: async (tenantId: string) =>
      state.lineDeliveries.filter((delivery) => delivery.tenant_id === tenantId),
    listNotificationRuleRuns: async () => [...state.runs],
    listNotificationRules: async () => [...state.rules],
    listTenants: async () => [...state.tenants],
  };
  const sendAlert = async (input: {
    alertType: string;
    dedupeKey?: string | null;
    messageText: string;
    severity: "info" | "warning" | "critical";
  }) => {
    calls.push(input);
    const delivery: OperationalAlertDeliveryRecord = {
      id: `op_alert_${calls.length}`,
      channel: "telegram",
      target_id_masked: "12...3456",
      alert_type: input.alertType,
      severity: input.severity,
      status: "success",
      dedupe_key: input.dedupeKey ?? null,
      message_text: input.messageText,
      provider_response_json: {},
      safe_error_message: null,
      created_at: now.toISOString(),
      sent_at: now.toISOString(),
    };
    state.operationalDeliveries.push(delivery);
    return [delivery];
  };

  return { calls, sendAlert, state, store };
}

describe("runNotificationOpsMonitor", () => {
  it("monitors enabled DB schedules for seaandhill and Krabi without treating 248 SHOP as a failure", async () => {
    const seaRule = buildRule({
      id: "rule_sea",
      tenantId: "seaandhill_demo",
      times: ["08:00"],
    });
    const krabiRule = buildRule({
      id: "rule_krabi",
      tenantId: "tenant_demo_remote",
      times: ["08:00", "18:30"],
    });
    const harness = createHarness({
      rules: [seaRule, krabiRule],
      runs: [
        buildRun({
          id: "run_sea_0800",
          rule_id: seaRule.id,
          tenant_id: "seaandhill_demo",
          scheduled_local_time: "08:00",
        }),
        buildRun({
          id: "run_krabi_1830",
          rule_id: krabiRule.id,
          scheduled_local_time: "18:30",
        }),
        buildRun({
          id: "run_completed",
          rule_id: krabiRule.id,
          status: "success",
          finished_at: "2026-06-22T01:48:00.000Z",
          progress_stage: "completed",
        }),
      ],
    });

    const result = await runNotificationOpsMonitor({
      config,
      now,
      sendAlert: harness.sendAlert,
      store: harness.store,
    });

    expect(result.monitored_tenant_count).toBe(2);
    expect(harness.calls).toHaveLength(2);
    expect(harness.calls.map((call) => call.messageText).join("\n")).toContain(
      "seaandhill THAPPUT",
    );
    expect(harness.calls.map((call) => call.messageText).join("\n")).toContain(
      "2026-06-22 18:30",
    );
    expect(harness.calls.map((call) => call.messageText).join("\n")).not.toContain(
      "248 SHOP",
    );
  });

  it("dedupes slow warnings and sends a separate critical alert after 30 minutes", async () => {
    const harness = createHarness({
      runs: [buildRun()],
    });

    await runNotificationOpsMonitor({
      config: { ...config, heartbeatStaleMs: 60 * 60_000 },
      now,
      sendAlert: harness.sendAlert,
      store: harness.store,
    });
    await runNotificationOpsMonitor({
      config: { ...config, heartbeatStaleMs: 60 * 60_000 },
      now,
      sendAlert: harness.sendAlert,
      store: harness.store,
    });
    await runNotificationOpsMonitor({
      config: { ...config, heartbeatStaleMs: 60 * 60_000 },
      now: new Date("2026-06-22T02:15:00.000Z"),
      sendAlert: harness.sendAlert,
      store: harness.store,
    });

    expect(harness.calls.map((call) => call.severity)).toEqual([
      "warning",
      "critical",
    ]);
    expect(harness.calls.every((call) => call.alertType === "notification_run_slow"))
      .toBe(true);
  });

  it("does not alert an overdue LINE retry when the same delivery key later succeeded", async () => {
    const failedDelivery = buildDelivery();
    const harness = createHarness({
      lineDeliveries: [
        failedDelivery,
        buildDelivery({
          id: "line_success_1",
          status: "success",
          sent_at: "2026-06-22T01:58:00.000Z",
          safe_error_message: null,
        }),
      ],
      runs: [
        buildRun({
          status: "failed",
          progress_stage: "failed",
          finished_at: "2026-06-22T01:50:00.000Z",
          delivery_ids: [failedDelivery.id],
          report_results: [
            freshResult("sales_goods_services"),
            freshResult("stock_balance"),
          ],
          next_retry_at: "2026-06-22T01:55:00.000Z",
          scheduled_local_time: "18:30",
        }),
      ],
    });

    await runNotificationOpsMonitor({
      config,
      now,
      sendAlert: harness.sendAlert,
      store: harness.store,
    });

    expect(harness.calls).toHaveLength(0);
  });

  it("alerts a critical overdue LINE retry when no success exists for the delivery key", async () => {
    const failedDelivery = buildDelivery();
    const harness = createHarness({
      lineDeliveries: [failedDelivery],
      runs: [
        buildRun({
          status: "failed",
          progress_stage: "failed",
          finished_at: "2026-06-22T01:50:00.000Z",
          delivery_ids: [failedDelivery.id],
          report_results: [
            freshResult("sales_goods_services"),
            freshResult("stock_balance"),
          ],
          next_retry_at: "2026-06-22T01:55:00.000Z",
          scheduled_local_time: "18:30",
        }),
      ],
    });

    await runNotificationOpsMonitor({
      config,
      now,
      sendAlert: harness.sendAlert,
      store: harness.store,
    });

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]).toMatchObject({
      alertType: "line_delivery_failed",
      severity: "critical",
    });
    expect(harness.calls[0].messageText).toContain("LINE retry เลยกำหนด");
  });

  it("alerts a stale worker heartbeat even when the worker is not ticking", async () => {
    const harness = createHarness({
      heartbeats: [buildHeartbeat("2026-06-22T01:55:00.000Z")],
      runs: [],
    });

    const result = await runNotificationOpsMonitor({
      config,
      now,
      sendAlert: harness.sendAlert,
      store: harness.store,
    });

    expect(result.heartbeat_alerts).toBe(1);
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]).toMatchObject({
      alertType: "heartbeat_stale",
      severity: "critical",
    });
  });
});
