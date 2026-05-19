import {
  BANGKOK_TIME_ZONE,
  tenantIdSchema,
  type LineSendMode,
  type TenantId,
} from "@ai-bcc/shared";

export type MorningBriefWorkerConfig = {
  enabled: boolean;
  apiBaseUrl: string;
  tenantIds: TenantId[];
  timeZone: string;
  runAt: string;
  mode: LineSendMode;
  force: boolean;
};

export function readMorningBriefWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): MorningBriefWorkerConfig {
  return {
    enabled: readBoolean(env.MORNING_BRIEF_ENABLED, true),
    apiBaseUrl: (env.MORNING_BRIEF_API_BASE_URL || "http://api:4000").replace(
      /\/$/,
      "",
    ),
    tenantIds: parseTenantIds(env.MORNING_BRIEF_TENANT_IDS),
    timeZone: env.MORNING_BRIEF_TIMEZONE || BANGKOK_TIME_ZONE,
    runAt: env.MORNING_BRIEF_TIME || "08:00",
    mode: env.MORNING_BRIEF_MODE === "dry_run" ? "dry_run" : "send",
    force: readBoolean(env.MORNING_BRIEF_FORCE, false),
  };
}

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

export async function callMorningBriefEndpoint(input: {
  config: MorningBriefWorkerConfig;
  tenantId: TenantId;
}) {
  const response = await fetch(
    `${input.config.apiBaseUrl}/api/reports/${input.tenantId}/sales_goods_services/morning-brief/run-and-send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period: "yesterday",
        mode: input.config.mode,
        force: input.config.force,
      }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    throw new Error(
      `Morning brief API returned ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`,
    );
  }

  return payload;
}

function parseTenantIds(value: string | undefined): TenantId[] {
  const raw = value?.trim() || "tenant_demo_remote";
  const tenantIds = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => tenantIdSchema.parse(item));

  return tenantIds.length ? tenantIds : ["tenant_demo_remote"];
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
