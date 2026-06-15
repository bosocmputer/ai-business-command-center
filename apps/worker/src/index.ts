import {
  callNotificationRulesTick,
  callReportRunsTick,
  callWorkerHeartbeat,
  readNotificationRulesWorkerConfig,
} from "./scheduler.js";

const config = readNotificationRulesWorkerConfig();
let tickInFlight = false;
let consecutiveNotificationTickFailures = 0;
let consecutiveReportRunTickFailures = 0;
let lastNotificationTickError: string | null = null;
let lastReportRunTickError: string | null = null;

console.log("AI Business Command Center worker started");
console.log(
  JSON.stringify({
    enabled: config.enabled,
    apiBaseUrl: config.apiBaseUrl,
    mode: config.mode,
    reportRunLimit: config.reportRunLimit,
    workerId: config.workerId,
    heartbeatConfigured: Boolean(config.heartbeatToken),
  }),
);

function workerMetadata() {
  return {
    enabled: config.enabled,
    mode: config.mode,
    scheduler: "db_notification_rules_and_report_runs",
    tick_in_flight: tickInFlight,
    consecutive_notification_tick_failures: consecutiveNotificationTickFailures,
    consecutive_report_run_tick_failures: consecutiveReportRunTickFailures,
    last_notification_tick_error: lastNotificationTickError,
    last_report_run_tick_error: lastReportRunTickError,
  };
}

async function sendHeartbeat() {
  try {
    const maxConsecutiveFailures = Math.max(
      consecutiveNotificationTickFailures,
      consecutiveReportRunTickFailures,
    );
    const result = await callWorkerHeartbeat({
      config,
      status: !config.enabled
        ? "warning"
        : maxConsecutiveFailures >= 3
          ? "error"
          : maxConsecutiveFailures > 0
            ? "warning"
            : "ok",
      metadata: workerMetadata(),
    });
    if ("skipped" in result) {
      console.warn(
        JSON.stringify({
          event: "worker_heartbeat_skipped",
          reason: result.reason,
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "worker_heartbeat_failed",
        safeError:
          error instanceof Error ? error.message : "Unknown heartbeat error",
      }),
    );
  }
}

async function tick(now = new Date()) {
  if (!config.enabled) {
    return;
  }
  if (tickInFlight) {
    console.warn(
      JSON.stringify({
        event: "worker_tick_skipped",
        reason: "tick_in_flight",
        checkedAt: now.toISOString(),
      }),
    );
    return;
  }

  tickInFlight = true;
  try {
    const result = await callNotificationRulesTick({ config });
    if ("skipped" in result) {
      console.warn(
        JSON.stringify({
          event: "notification_rule_tick_skipped",
          reason: result.reason,
          checkedAt: now.toISOString(),
        }),
      );
    } else {
      console.log(
        JSON.stringify({
          event: "notification_rule_tick_completed",
          checkedAt: now.toISOString(),
          queued:
            (result.data as { queued?: unknown[] } | undefined)?.queued?.length ??
            0,
          processed:
            (result.data as { processed?: unknown[] } | undefined)?.processed
              ?.length ?? 0,
          skipped:
            (result.data as { skipped?: unknown[] } | undefined)?.skipped
              ?.length ?? 0,
        }),
      );
    }
    consecutiveNotificationTickFailures = 0;
    lastNotificationTickError = null;
  } catch (error) {
    consecutiveNotificationTickFailures += 1;
    lastNotificationTickError =
      error instanceof Error ? error.message : "Unknown worker error";
    console.error(
      JSON.stringify({
        event: "notification_rule_tick_failed",
        checkedAt: now.toISOString(),
        safeError: lastNotificationTickError,
        consecutiveFailures: consecutiveNotificationTickFailures,
      }),
    );
  }

  try {
    const result = await callReportRunsTick({ config });
    if ("skipped" in result) {
      console.warn(
        JSON.stringify({
          event: "report_run_tick_skipped",
          reason: result.reason,
          checkedAt: now.toISOString(),
        }),
      );
      return;
    }
    console.log(
      JSON.stringify({
        event: "report_run_tick_completed",
        checkedAt: now.toISOString(),
        processed:
          (result.data as { processed?: unknown[] } | undefined)?.processed
            ?.length ?? 0,
        skipped:
          (result.data as { skipped?: unknown[] } | undefined)?.skipped
            ?.length ?? 0,
      }),
    );
    consecutiveReportRunTickFailures = 0;
    lastReportRunTickError = null;
  } catch (error) {
    consecutiveReportRunTickFailures += 1;
    lastReportRunTickError =
      error instanceof Error ? error.message : "Unknown worker error";
    console.error(
      JSON.stringify({
        event: "report_run_tick_failed",
        checkedAt: now.toISOString(),
        safeError: lastReportRunTickError,
        consecutiveFailures: consecutiveReportRunTickFailures,
      }),
    );
  } finally {
    tickInFlight = false;
  }
}

await sendHeartbeat();
await tick();
setInterval(() => {
  void tick();
}, 30_000);
setInterval(() => {
  void sendHeartbeat();
}, 60_000);
