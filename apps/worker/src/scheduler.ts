import {
  type LineSendMode,
  type WorkerHeartbeatStatus,
} from "@ai-bcc/shared";

export type NotificationRulesWorkerConfig = {
  enabled: boolean;
  apiBaseUrl: string;
  catchUpMinutes: number;
  reportRunLimit: number;
  mode: LineSendMode;
  workerId: string;
  heartbeatToken: string | null;
};

export function readNotificationRulesWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): NotificationRulesWorkerConfig {
  return {
    enabled: readBoolean(env.WORKER_ENABLED, true),
    apiBaseUrl: (
      env.AI_BCC_WORKER_API_BASE_URL ||
      env.WORKER_API_BASE_URL ||
      "http://api:4000"
    ).replace(/\/$/, ""),
    catchUpMinutes: readNumber(env.WORKER_NOTIFICATION_CATCH_UP_MINUTES, 15, {
      min: 0,
      max: 60,
    }),
    reportRunLimit: readNumber(env.WORKER_REPORT_RUN_LIMIT, 2, {
      min: 1,
      max: 20,
    }),
    mode: env.WORKER_NOTIFICATION_MODE === "dry_run" ? "dry_run" : "send",
    workerId: env.WORKER_ID || "worker_notification_rules_1",
    heartbeatToken: env.WORKER_HEARTBEAT_TOKEN?.trim() || null,
  };
}

export const readMorningBriefWorkerConfig = readNotificationRulesWorkerConfig;

export function getZonedMinute(input: { now: Date; timeZone: string }) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(input.now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

export function shouldRunMorningBrief(input: {
  now: Date;
  timeZone: string;
  runAt: string;
}) {
  return getZonedMinute(input).time === input.runAt;
}

export async function callNotificationRulesTick(input: {
  config: NotificationRulesWorkerConfig;
}) {
  if (!input.config.heartbeatToken) {
    return {
      skipped: true as const,
      reason: "worker_token_missing",
    };
  }

  return fetchJsonWithTimeout({
    url: `${input.config.apiBaseUrl}/api/worker/notification-rules/tick`,
    token: input.config.heartbeatToken,
    timeoutMs: 10_000,
    body: {
      catch_up_minutes: input.config.catchUpMinutes,
      mode: input.config.mode,
      worker_id: input.config.workerId,
    },
    errorPrefix: "Notification rule tick API",
  });
}

export async function callReportRunsTick(input: {
  config: NotificationRulesWorkerConfig;
}) {
  if (!input.config.heartbeatToken) {
    return {
      skipped: true as const,
      reason: "worker_token_missing",
    };
  }

  return fetchJsonWithTimeout({
    url: `${input.config.apiBaseUrl}/api/worker/report-runs/tick`,
    token: input.config.heartbeatToken,
    timeoutMs: 10_000,
    body: {
      limit: input.config.reportRunLimit,
      worker_id: input.config.workerId,
    },
    errorPrefix: "Report run tick API",
  });
}

export async function callWorkerHeartbeat(input: {
  config: NotificationRulesWorkerConfig;
  status?: WorkerHeartbeatStatus;
  metadata?: Record<string, unknown>;
}) {
  if (!input.config.heartbeatToken) {
    return {
      skipped: true,
      reason: "worker_heartbeat_token_missing",
    };
  }

  return fetchJsonWithTimeout({
    url: `${input.config.apiBaseUrl}/api/worker/heartbeat`,
    token: input.config.heartbeatToken,
    timeoutMs: 10_000,
    body: {
      worker_id: input.config.workerId,
      role: "notification_rule_worker",
      status: input.status ?? "ok",
      metadata_json: input.metadata ?? {},
      checked_at: new Date().toISOString(),
    },
    errorPrefix: "Worker heartbeat API",
  });
}

async function fetchJsonWithTimeout(input: {
  url: string;
  token: string;
  timeoutMs: number;
  body: Record<string, unknown>;
  errorPrefix: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ai-bcc-worker-token": input.token,
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      throw new Error(
        `${input.errorPrefix} returned ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`,
      );
    }

    return payload;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`${input.errorPrefix} timed out after ${input.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /aborted/i.test(error.message))
  );
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readNumber(
  value: string | undefined,
  fallback: number,
  limits: { min: number; max: number },
) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(limits.max, Math.max(limits.min, Math.floor(parsed)));
}
