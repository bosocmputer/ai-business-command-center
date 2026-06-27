import {
  tenantFeatureFlagsSchema,
  type LineDeliveryRecord,
  type NotificationRuleRecord,
  type NotificationRuleRunRecord,
  type OperationalAlertDeliveryRecord,
  type OperationalAlertSeverity,
  type Tenant,
} from "@ai-bcc/shared";
import {
  buildOperationalAlertDedupeKey,
  buildOperationalAlertMessage,
  type OperationalAlertType,
} from "./operational-alerts.js";
import { selectDeliveryRetryReportResults } from "./notification-delivery-retry.js";
import type { SystemStore } from "./system-store.js";

export const NOTIFICATION_OPS_MONITOR_WORKER_ROLE =
  "notification_rule_worker";

type NotificationOpsMonitorStore = Pick<
  SystemStore,
  | "appendAuditLog"
  | "findSuccessfulLineDeliveryByKey"
  | "findSuccessfulOperationalAlertDeliveryByDedupeKey"
  | "getLatestWorkerHeartbeat"
  | "listLineDeliveries"
  | "listNotificationRuleRuns"
  | "listNotificationRules"
  | "listTenants"
>;

type SendOpsAlert = (input: {
  tenant?: Tenant | null;
  alertType: OperationalAlertType;
  severity: OperationalAlertSeverity;
  dedupeKey?: string | null;
  messageText: string;
  forceEnabled?: boolean;
}) => Promise<OperationalAlertDeliveryRecord[]>;

export type NotificationOpsMonitorConfig = {
  heartbeatStaleMs: number;
  lineRetryGraceMs: number;
  slowCriticalMs: number;
  slowWarningMs: number;
  lookbackLimit?: number;
};

export type NotificationOpsMonitorResult = {
  active_run_alerts: number;
  heartbeat_alerts: number;
  line_retry_alerts: number;
  monitored_rule_count: number;
  monitored_tenant_count: number;
  skipped: string[];
};

export async function runNotificationOpsMonitor(input: {
  config: NotificationOpsMonitorConfig;
  now?: Date;
  sendAlert: SendOpsAlert;
  store: NotificationOpsMonitorStore;
}): Promise<NotificationOpsMonitorResult> {
  const now = input.now ?? new Date();
  const lookbackLimit = input.config.lookbackLimit ?? 500;
  const tenants = await input.store.listTenants();
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const rules = (await input.store.listNotificationRules()).filter(
    (rule) => rule.enabled,
  );
  const monitoredRules = rules.filter((rule) => {
    const tenant = tenantById.get(rule.tenant_id);
    return isActiveTenant(tenant) && opsAlertsEnabled(tenant);
  });
  const monitoredTenantIds = new Set(
    monitoredRules.map((rule) => rule.tenant_id),
  );
  const result: NotificationOpsMonitorResult = {
    active_run_alerts: 0,
    heartbeat_alerts: 0,
    line_retry_alerts: 0,
    monitored_rule_count: monitoredRules.length,
    monitored_tenant_count: monitoredTenantIds.size,
    skipped: [],
  };

  if (!monitoredRules.length) {
    result.skipped.push("no_enabled_notification_rules_with_ops_alerts");
    return result;
  }

  const ruleById = new Map(monitoredRules.map((rule) => [rule.id, rule]));
  const runs = await input.store.listNotificationRuleRuns({
    limit: lookbackLimit,
  });
  result.active_run_alerts += await alertSlowNotificationRuns({
    config: input.config,
    now,
    result,
    ruleById,
    sendAlert: input.sendAlert,
    store: input.store,
    tenantById,
    runs,
  });
  result.line_retry_alerts += await alertOverdueLineRetries({
    config: input.config,
    now,
    ruleById,
    sendAlert: input.sendAlert,
    store: input.store,
    tenantById,
    runs,
  });
  result.heartbeat_alerts += await alertStaleWorkerHeartbeat({
    config: input.config,
    monitoredTenantIds,
    now,
    sendAlert: input.sendAlert,
    store: input.store,
  });

  return result;
}

async function alertSlowNotificationRuns(input: {
  config: NotificationOpsMonitorConfig;
  now: Date;
  result: NotificationOpsMonitorResult;
  ruleById: Map<string, NotificationRuleRecord>;
  sendAlert: SendOpsAlert;
  store: NotificationOpsMonitorStore;
  tenantById: Map<string, Tenant>;
  runs: NotificationRuleRunRecord[];
}) {
  let alertCount = 0;
  for (const run of input.runs) {
    if (!isActiveSendRun(run)) {
      continue;
    }
    const rule = input.ruleById.get(run.rule_id);
    if (!rule) {
      continue;
    }
    const tenant = input.tenantById.get(run.tenant_id);
    if (!tenant) {
      continue;
    }
    const elapsedMs = input.now.getTime() - getRunAnchorMs(run);
    const severity =
      elapsedMs >= input.config.slowCriticalMs
        ? "critical"
        : elapsedMs >= input.config.slowWarningMs
          ? "warning"
          : null;
    if (!severity) {
      continue;
    }

    const alerted = await sendAndAudit({
      action: "notification_run_slow_alert_processed",
      alertType: "notification_run_slow",
      dedupeKey: buildOperationalAlertDedupeKey({
        alertType: "notification_run_slow",
        tenantId: run.tenant_id,
        ruleId: run.rule_id,
        scheduledDate: run.scheduled_local_date,
        scheduledTime: run.scheduled_local_time,
        severity,
      }),
      messageText: buildOperationalAlertMessage({
        title: "งานแจ้งเตือนผู้บริหารใช้เวลานานกว่าปกติ",
        severity,
        tenantName: tenant.name,
        scheduledTime: `${run.scheduled_local_date} ${run.scheduled_local_time}`,
        reportKey: run.progress_current_report_key,
        runId: run.id,
        status: run.status,
        details: [
          `elapsed_minutes: ${Math.floor(elapsedMs / 60_000)}`,
          `attempt: ${run.attempt}`,
          `source: ${run.source}`,
          `progress_stage: ${run.progress_stage ?? "unknown"}`,
        ],
        action:
          severity === "critical"
            ? "ตรวจ worker, report chunks, SML JavaWS และปล่อยให้ retry/monitor จัดการต่อ"
            : "ดูสถานะ run/chunked report ถ้ายังไม่จบก่อน threshold critical",
      }),
      notificationRunId: run.id,
      sendAlert: input.sendAlert,
      severity,
      store: input.store,
      tenant,
    });
    if (alerted) {
      alertCount += 1;
    }
  }
  return alertCount;
}

async function alertOverdueLineRetries(input: {
  config: NotificationOpsMonitorConfig;
  now: Date;
  ruleById: Map<string, NotificationRuleRecord>;
  sendAlert: SendOpsAlert;
  store: NotificationOpsMonitorStore;
  tenantById: Map<string, Tenant>;
  runs: NotificationRuleRunRecord[];
}) {
  let alertCount = 0;
  const lineDeliveriesByTenant = new Map<string, LineDeliveryRecord[]>();
  for (const run of input.runs) {
    if (
      run.status !== "failed" ||
      run.mode !== "send" ||
      !run.next_retry_at ||
      run.delivery_ids.length === 0
    ) {
      continue;
    }
    const retryDueAt = new Date(run.next_retry_at).getTime();
    if (
      !Number.isFinite(retryDueAt) ||
      retryDueAt + input.config.lineRetryGraceMs > input.now.getTime()
    ) {
      continue;
    }
    const rule = input.ruleById.get(run.rule_id);
    if (!rule || run.attempt >= rule.retry_policy.max_attempts) {
      continue;
    }
    if (!selectDeliveryRetryReportResults({ rule, retryFromRun: run })) {
      continue;
    }
    const tenant = input.tenantById.get(run.tenant_id);
    if (!tenant) {
      continue;
    }
    let deliveries = lineDeliveriesByTenant.get(run.tenant_id);
    if (!deliveries) {
      deliveries = await input.store.listLineDeliveries(run.tenant_id);
      lineDeliveriesByTenant.set(run.tenant_id, deliveries);
    }
    const failedDelivery = deliveries.find(
      (delivery) =>
        run.delivery_ids.includes(delivery.id) &&
        delivery.delivery_type === "notification_rule" &&
        delivery.status === "failed" &&
        Boolean(delivery.delivery_key),
    );
    if (!failedDelivery?.delivery_key) {
      continue;
    }
    const successfulRetry = await input.store.findSuccessfulLineDeliveryByKey({
      tenantId: run.tenant_id,
      deliveryKey: failedDelivery.delivery_key,
    });
    if (successfulRetry) {
      continue;
    }

    const retryErrMsg = failedDelivery.safe_error_message ?? run.safe_error_message ?? "ส่ง LINE ไม่สำเร็จ";
    const isRateLimit = retryErrMsg.includes("429");
    const retryOverdueSeverity = isRateLimit ? "warning" : "critical";
    const retryOverdueAction = isRateLimit
      ? "LINE quota หมดหรือถูก rate limit — ตรวจ LINE OA Console และ upgrade plan ถ้าจำเป็น ระบบไม่ retry อีกแล้วในรอบนี้"
      : "ตรวจ worker retry tick, LINE OA token/quota และ delivery key ว่ามี success ซ้ำหรือไม่";
    const alerted = await sendAndAudit({
      action: "notification_line_retry_overdue_alert_processed",
      alertType: "line_delivery_failed",
      dedupeKey: buildOperationalAlertDedupeKey({
        alertType: "line_delivery_failed",
        tenantId: run.tenant_id,
        ruleId: run.rule_id,
        scheduledDate: run.scheduled_local_date,
        scheduledTime: run.scheduled_local_time,
        reportKey: "retry_overdue",
        severity: retryOverdueSeverity,
      }),
      messageText: buildOperationalAlertMessage({
        title: "LINE retry เลยกำหนดและยังไม่สำเร็จ",
        severity: retryOverdueSeverity,
        tenantName: tenant.name,
        scheduledTime: `${run.scheduled_local_date} ${run.scheduled_local_time}`,
        runId: run.id,
        status: run.status,
        details: [
          `next_retry_at: ${run.next_retry_at}`,
          `attempt: ${run.attempt}/${rule.retry_policy.max_attempts}`,
          `LINE target: ${failedDelivery.target_id_masked ?? "unknown"}`,
          `สาเหตุ: ${retryErrMsg}`,
          ...(isRateLimit ? ["หมายเหตุ: 429 อาจเกิดจาก quota ร่วมกับร้านอื่นในช่อง LINE OA เดียวกัน"] : []),
        ],
        action: retryOverdueAction,
      }),
      notificationRunId: run.id,
      sendAlert: input.sendAlert,
      severity: retryOverdueSeverity,
      store: input.store,
      tenant,
    });
    if (alerted) {
      alertCount += 1;
    }
  }
  return alertCount;
}

async function alertStaleWorkerHeartbeat(input: {
  config: NotificationOpsMonitorConfig;
  monitoredTenantIds: Set<string>;
  now: Date;
  sendAlert: SendOpsAlert;
  store: NotificationOpsMonitorStore;
}) {
  if (!input.monitoredTenantIds.size) {
    return 0;
  }
  const heartbeat = await input.store.getLatestWorkerHeartbeat(
    NOTIFICATION_OPS_MONITOR_WORKER_ROLE,
  );
  const heartbeatAgeMs = heartbeat
    ? input.now.getTime() - new Date(heartbeat.checked_at).getTime()
    : Number.POSITIVE_INFINITY;
  if (heartbeat && heartbeatAgeMs <= input.config.heartbeatStaleMs) {
    return 0;
  }
  const dedupeParts = hourlyDedupeParts(input.now);
  const alerted = await sendAndAudit({
    action: "notification_worker_heartbeat_stale_alert_processed",
    alertType: "heartbeat_stale",
    dedupeKey: buildOperationalAlertDedupeKey({
      alertType: "heartbeat_stale",
      tenantId: "system",
      ruleId: NOTIFICATION_OPS_MONITOR_WORKER_ROLE,
      scheduledDate: dedupeParts.date,
      scheduledTime: dedupeParts.time,
      severity: "critical",
    }),
    forceEnabled: true,
    messageText: buildOperationalAlertMessage({
      title: "Worker heartbeat หายหรือเกิน SLA",
      severity: "critical",
      status: heartbeat ? "stale" : "missing",
      details: [
        `role: ${NOTIFICATION_OPS_MONITOR_WORKER_ROLE}`,
        heartbeat ? `worker_id: ${heartbeat.worker_id}` : "worker_id: unknown",
        heartbeat
          ? `latest_checked_at: ${heartbeat.checked_at}`
          : "latest_checked_at: none",
        Number.isFinite(heartbeatAgeMs)
          ? `age_seconds: ${Math.floor(heartbeatAgeMs / 1000)}`
          : "age_seconds: unknown",
      ],
      action:
        "ตรวจ container worker, API base URL, worker token และ restart worker ถ้า heartbeat ไม่กลับมา",
    }),
    notificationRunId: null,
    sendAlert: input.sendAlert,
    severity: "critical",
    store: input.store,
    tenant: null,
  });
  return alerted ? 1 : 0;
}

async function sendAndAudit(input: {
  action: string;
  alertType: OperationalAlertType;
  dedupeKey: string;
  forceEnabled?: boolean;
  messageText: string;
  notificationRunId: string | null;
  sendAlert: SendOpsAlert;
  severity: OperationalAlertSeverity;
  store: NotificationOpsMonitorStore;
  tenant: Tenant | null;
}) {
  try {
    const existing =
      await input.store.findSuccessfulOperationalAlertDeliveryByDedupeKey({
        channel: "telegram",
        dedupeKey: input.dedupeKey,
      });
    if (existing) {
      return false;
    }
    const deliveries = await input.sendAlert({
      tenant: input.tenant,
      alertType: input.alertType,
      severity: input.severity,
      messageText: input.messageText,
      dedupeKey: input.dedupeKey,
      forceEnabled: input.forceEnabled,
    });
    await input.store.appendAuditLog({
      tenant_id: input.tenant?.id ?? null,
      actor_id: null,
      action: input.action,
      target_type: "operational_alert",
      target_id: input.alertType,
      metadata_json: {
        alert_type: input.alertType,
        severity: input.severity,
        notification_rule_run_id: input.notificationRunId,
        dedupe_key: input.dedupeKey,
        delivery_ids: deliveries.map((delivery) => delivery.id),
        delivery_statuses: deliveries.map((delivery) => delivery.status),
      },
    });
    return true;
  } catch (error) {
    await input.store.appendAuditLog({
      tenant_id: input.tenant?.id ?? null,
      actor_id: null,
      action: "notification_ops_monitor_alert_failed",
      target_type: "operational_alert",
      target_id: input.alertType,
      metadata_json: {
        alert_type: input.alertType,
        severity: input.severity,
        notification_rule_run_id: input.notificationRunId,
        dedupe_key: input.dedupeKey,
        safe_error_message:
          error instanceof Error ? error.message : "Unknown monitor alert error",
      },
    });
    return false;
  }
}

function isActiveTenant(tenant: Tenant | undefined): tenant is Tenant {
  return tenant?.status === "active";
}

function opsAlertsEnabled(tenant: Tenant | undefined) {
  return (
    tenantFeatureFlagsSchema.parse(tenant?.featureFlags ?? {})
      .telegram_operational_alerts_enabled === true
  );
}

function isActiveSendRun(run: NotificationRuleRunRecord) {
  return (
    run.mode === "send" &&
    (run.status === "queued" || run.status === "running")
  );
}

function getRunAnchorMs(run: NotificationRuleRunRecord) {
  const anchor = run.started_at ?? run.claimed_at ?? run.queued_at ?? run.created_at;
  const timestamp = new Date(anchor).getTime();
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function hourlyDedupeParts(now: Date) {
  const iso = now.toISOString();
  return {
    date: iso.slice(0, 10),
    time: `${iso.slice(11, 13)}:00`,
  };
}
