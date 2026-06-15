import {
  tenantIdSchema,
  type LineTargetType,
  type Tenant,
  type TenantId,
} from "@ai-bcc/shared";

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
};

const tenantDefinitions: TenantDefinition[] = [
  {
    id: "tenant_demo_remote",
    name: "DEMO SHOP",
    customerSlug: "demo-shop",
    databaseName: "demo",
    description: "Remote SML demo shop for customer-facing preview.",
  },
  {
    id: "tenant_office_sml1_2026",
    name: "248 SHOP",
    customerSlug: "248-shop",
    databaseName: "sml1_2026",
    description: "Office SML shop for local pilot validation.",
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
  const configuredTenant = tenantDefinitions.find(
    (tenant) => tenant.customerSlug === slug,
  );
  if (configuredTenant) {
    return configuredTenant.id;
  }

  const tenantId = tenantIdSchema.safeParse(slug);
  if (!tenantId.success || getTenantDefinition(tenantId.data)) {
    return null;
  }

  return tenantId.data;
}

export function getTenantSlug(tenantId: TenantId) {
  return getTenantDefinition(tenantId)?.customerSlug ?? tenantId;
}

export function readDatasourceConfig(
  tenantId: TenantId,
): DatasourceConfig | null {
  const tenant = getTenantDefinition(tenantId);
  if (!tenant) {
    return null;
  }

  return null;
}

export function readLineChannelConfig(
  tenantId: TenantId,
): LineChannelConfig | null {
  void tenantId;
  return null;
}

export function readLineChannelCredentials(
  tenantId: TenantId,
): LineChannelCredentialConfig | null {
  void tenantId;
  return null;
}

export function readLineWebhookConfig(): LineWebhookConfig | null {
  return null;
}

function readEnv(name: string, fallback: string) {
  return process.env[name] || fallback;
}

export type { DatasourceConfig, LineWebhookConfig };
