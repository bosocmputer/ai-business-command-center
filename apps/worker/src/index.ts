import {
  callMorningBriefEndpoint,
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
  }),
);

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

await tick();
setInterval(() => {
  void tick();
}, 30_000);
