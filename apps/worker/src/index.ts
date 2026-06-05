import {
  callNotificationRulesTick,
  callWorkerHeartbeat,
  readNotificationRulesWorkerConfig,
} from "./scheduler.js";

const config = readNotificationRulesWorkerConfig();

console.log("AI Business Command Center worker started");
console.log(
  JSON.stringify({
    enabled: config.enabled,
    apiBaseUrl: config.apiBaseUrl,
    mode: config.mode,
    workerId: config.workerId,
    heartbeatConfigured: Boolean(config.heartbeatToken),
  }),
);

function workerMetadata() {
  return {
    enabled: config.enabled,
    mode: config.mode,
    scheduler: "db_notification_rules",
  };
}

async function sendHeartbeat() {
  try {
    const result = await callWorkerHeartbeat({
      config,
      status: config.enabled ? "ok" : "warning",
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
      return;
    }
    console.log(
      JSON.stringify({
        event: "notification_rule_tick_completed",
        checkedAt: now.toISOString(),
        processed:
          (result.data as { processed?: unknown[] } | undefined)?.processed
            ?.length ?? 0,
        skipped:
          (result.data as { skipped?: unknown[] } | undefined)?.skipped
            ?.length ?? 0,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "notification_rule_tick_failed",
        checkedAt: now.toISOString(),
        safeError:
          error instanceof Error ? error.message : "Unknown worker error",
      }),
    );
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
