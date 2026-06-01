import type { LineTargetType, Tenant, TenantId } from "@ai-bcc/shared";

export type PostgresDatasourceConfig = {
  kind: "sml_postgres";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export type JavaWsDatasourceConfig = {
  kind: "sml_javaws";
  baseUrl: string;
  webappPath: string;
  endpoint: "DotNetFrameWork";
  configFileName: string;
  database: string;
  queryMethod: "_queryCompress";
  auth:
    | { mode: "none" }
    | { mode: "basic"; username: string; password: string }
    | { mode: "bearer"; token: string };
};

type DatasourceConfig = PostgresDatasourceConfig | JavaWsDatasourceConfig;

export type LineChannelCredentialConfig = {
  channelAccessToken: string;
};

export type LineChannelConfig = LineChannelCredentialConfig & {
  targetId: string;
  targetType?: LineTargetType | null;
};

type LineWebhookConfig = {
  channelSecret: string;
  debugToken: string | null;
};

type TenantDefinition = Pick<
  Tenant,
  "id" | "name" | "databaseName" | "description"
> & {
  customerSlug: string;
  envPrefix: "SML_DEMO_DB" | "SML_OFFICE_DB";
  lineEnvPrefix: "LINE_DEMO" | "LINE_OFFICE";
};

const tenantDefinitions: TenantDefinition[] = [
  {
    id: "tenant_demo_remote",
    name: "DEMO SHOP",
    customerSlug: "demo-shop",
    databaseName: readEnv("SML_DEMO_DB_NAME", "demo"),
    description: "Remote SML demo shop for customer-facing preview.",
    envPrefix: "SML_DEMO_DB",
    lineEnvPrefix: "LINE_DEMO",
  },
  {
    id: "tenant_office_sml1_2026",
    name: "248 SHOP",
    customerSlug: "248-shop",
    databaseName: readEnv("SML_OFFICE_DB_NAME", "sml1_2026"),
    description: "Office SML shop for local pilot validation.",
    envPrefix: "SML_OFFICE_DB",
    lineEnvPrefix: "LINE_OFFICE",
  },
];

export function getApiConfig() {
  return {
    host: readEnv("API_HOST", "127.0.0.1"),
    port: Number(readEnv("API_PORT", "4000")),
  };
}

export function listTenants(): Tenant[] {
  return tenantDefinitions.map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    databaseName: tenant.databaseName,
    description: tenant.description,
    datasourceConfigured: Boolean(readDatasourceConfig(tenant.id)),
    status: "active",
    planCode: tenant.id === "tenant_demo_remote" ? "business" : "starter",
    suspendedReason: null,
    currentPeriodEnd: null,
  }));
}

export function getTenantDefinition(tenantId: TenantId) {
  return tenantDefinitions.find((tenant) => tenant.id === tenantId) ?? null;
}

export function resolveTenantIdFromSlug(slug: string): TenantId | null {
  return (
    tenantDefinitions.find((tenant) => tenant.customerSlug === slug)?.id ?? null
  );
}

export function getTenantSlug(tenantId: TenantId) {
  return getTenantDefinition(tenantId)?.customerSlug ?? null;
}

export function readDatasourceConfig(
  tenantId: TenantId,
): DatasourceConfig | null {
  const tenant = getTenantDefinition(tenantId);
  if (!tenant) {
    return null;
  }

  const host = process.env[`${tenant.envPrefix}_HOST`];
  const port = process.env[`${tenant.envPrefix}_PORT`];
  const database = process.env[`${tenant.envPrefix}_NAME`];
  const user = process.env[`${tenant.envPrefix}_USER`];
  const password = process.env[`${tenant.envPrefix}_PASSWORD`];

  if (!host || !port || !database || !user || !password) {
    return null;
  }

  return {
    kind: "sml_postgres",
    host,
    port: Number(port),
    database,
    user,
    password,
  };
}

export function readLineChannelConfig(
  tenantId: TenantId,
): LineChannelConfig | null {
  const credentials = readLineChannelCredentials(tenantId);
  if (!credentials) {
    return null;
  }

  const tenant = getTenantDefinition(tenantId);
  if (!tenant) {
    return null;
  }

  const targetId =
    process.env[`${tenant.lineEnvPrefix}_TARGET_ID`] ||
    process.env.LINE_TARGET_ID;
  const targetType = normalizeLineTargetType(
    process.env[`${tenant.lineEnvPrefix}_TARGET_TYPE`] ||
      process.env.LINE_TARGET_TYPE,
  );

  if (!targetId) {
    return null;
  }

  return {
    channelAccessToken: credentials.channelAccessToken,
    targetId,
    targetType,
  };
}

export function readLineChannelCredentials(
  tenantId: TenantId,
): LineChannelCredentialConfig | null {
  const tenant = getTenantDefinition(tenantId);
  if (!tenant) {
    return null;
  }

  const channelAccessToken =
    process.env[`${tenant.lineEnvPrefix}_CHANNEL_ACCESS_TOKEN`] ||
    readLegacyLineChannelAccessToken(tenant.id);

  if (!channelAccessToken) {
    return null;
  }

  return {
    channelAccessToken,
  };
}

function readLegacyLineChannelAccessToken(tenantId: TenantId) {
  if (tenantId !== "tenant_demo_remote") {
    return undefined;
  }

  return process.env.LINE_CHANNEL_ACCESS_TOKEN;
}

export function readLineWebhookConfig(): LineWebhookConfig | null {
  const channelSecret = process.env.LINE_CHANNEL_SECRET?.trim();
  if (!channelSecret) {
    return null;
  }

  return {
    channelSecret,
    debugToken: process.env.LINE_WEBHOOK_DEBUG_TOKEN?.trim() || null,
  };
}

function readEnv(name: string, fallback: string) {
  return process.env[name] || fallback;
}

function normalizeLineTargetType(value: string | undefined) {
  if (value === "user" || value === "group" || value === "room") {
    return value;
  }

  return null;
}

export type { DatasourceConfig, LineWebhookConfig };
