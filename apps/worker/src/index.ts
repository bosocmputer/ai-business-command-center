import {
  callMorningBriefEndpoint,
  callWorkerHeartbeat,
  getZonedMinute,
  readMorningBriefWorkerConfig,
  shouldRunMorningBrief,
} from "./scheduler.js";

const config = readMorningBriefWorkerConfig();
const attemptedKeys = new Set<string>();

console.log("AI Business Command Center worker started");
console.log(
  JSON.stringify({
    enabled: config.enabled,
    apiBaseUrl: config.apiBaseUrl,
    tenantIds: config.tenantIds,
    timeZone: config.timeZone,
    runAt: config.runAt,
    mode: config.mode,
    force: config.force,
    workerId: config.workerId,
    heartbeatConfigured: Boolean(config.heartbeatToken),
  }),
);

function workerMetadata() {
  return {
    enabled: config.enabled,
    tenantIds: config.tenantIds,
    timeZone: config.timeZone,
    runAt: config.runAt,
    mode: config.mode,
    force: config.force,
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

  if (
    !shouldRunMorningBrief({
      now,
      timeZone: config.timeZone,
      runAt: config.runAt,
    })
  ) {
    return;
  }

  const minute = getZonedMinute({ now, timeZone: config.timeZone });
  for (const tenantId of config.tenantIds) {
    const attemptKey = `${tenantId}:${minute.date}:${minute.time}`;
    if (attemptedKeys.has(attemptKey)) {
      continue;
    }
    attemptedKeys.add(attemptKey);

    try {
      const result = await callMorningBriefEndpoint({ config, tenantId });
      console.log(
        JSON.stringify({
          event: "morning_brief_completed",
          tenantId,
          attemptKey,
          resultStatus:
            (result.data as { delivery?: { status?: string }; status?: string })
              ?.delivery?.status ??
            (result.data as { status?: string })?.status ??
            "unknown",
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "morning_brief_failed",
          tenantId,
          attemptKey,
          safeError:
            error instanceof Error ? error.message : "Unknown worker error",
        }),
      );
    }
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
